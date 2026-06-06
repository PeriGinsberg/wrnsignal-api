#!/usr/bin/env node
// Verification for the Client Library category API (coach_document_categories).
//
// Exercises: lazy seed of the 8 defaults on first GET; idempotent 2nd GET (no
// re-seed / no dupes); POST custom; PATCH rename + reorder; soft DELETE; the
// LOAD-BEARING test (soft-delete ALL → GET empty, but rows persist so the guard
// never re-seeds — deletions stick); cross-coach isolation; per-coach seed.
//
// SAFETY: dev-ref guard (aborts on prod), mirrors verify-coach-pipeline.
//
// USAGE (migration 20260606_coach_client_library.sql applied to dev + a dev
// server running — local or point ENDPOINT_BASE at staging):
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   COACH_B_EMAIL=peri+devcoach1@workforcereadynow.com \
//   ENDPOINT_BASE=http://localhost:3000 \
//   node scripts/verify-coach-document-categories.mjs

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const COACH_EMAIL = (process.env.COACH_EMAIL || "peri+coach1@workforcereadynow.com").trim().toLowerCase()
const COACH_B_EMAIL = (process.env.COACH_B_EMAIL || "peri+devcoach1@workforcereadynow.com").trim().toLowerCase()
const TEST_PASSWORD = process.env.TEST_PASSWORD || "dev-test-1234"
const ENDPOINT_BASE = process.env.ENDPOINT_BASE || "http://localhost:3000"
const TAG = "[verify-coach-document-categories]"

const DEFAULTS = [
  "Resume", "Cover Letter", "LinkedIn", "Interview Guides",
  "Career / Skill Assessments", "Networking", "Job Search Strategy", "Offer & Negotiation",
]

function abort(msg) { console.error(`✗ ${msg}`); process.exit(1) }
if (!SUPABASE_URL) abort("SUPABASE_URL is required")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL contains the PROD ref (${PROD_REF}). Dev only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain dev ref (${DEV_REF}).`)
if (!SUPABASE_SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required")
if (!NEXT_PUBLIC_SUPABASE_ANON_KEY) abort("NEXT_PUBLIC_SUPABASE_ANON_KEY is required (sign-in path)")

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)

let pass = true
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ✓ ${name}`) }
  else { pass = false; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

async function getToken(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error || !data?.session?.access_token) abort(`Sign-in failed for ${email}: ${error?.message}`)
  return data.session.access_token
}
const BASE = `${ENDPOINT_BASE}/api/coach/document-categories`
async function req(token, method, path = "", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
const apiGet = (t) => req(t, "GET")
const apiPost = (t, body) => req(t, "POST", "", body)
const apiPatch = (t, id, body) => req(t, "PATCH", `/${id}`, body)
const apiDel = (t, id) => req(t, "DELETE", `/${id}`)

async function rawCount(coachProfileId, activeOnly) {
  let q = sb.from("coach_document_categories").select("id", { count: "exact", head: true }).eq("coach_profile_id", coachProfileId)
  if (activeOnly) q = q.eq("active", true)
  const { count } = await q
  return count || 0
}
async function clearCategories(coachProfileId) {
  await sb.from("coach_document_categories").delete().eq("coach_profile_id", coachProfileId)
}
async function resolveCoachId(email) {
  const { data } = await sb.from("client_profiles").select("id, is_coach").eq("email", email).maybeSingle()
  if (!data?.id) abort(`No client_profiles row for ${email}`)
  if (!data.is_coach) abort(`${email} is not is_coach=true`)
  return data.id
}

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} A=${COACH_EMAIL} B=${COACH_B_EMAIL}`)

  const coachAId = await resolveCoachId(COACH_EMAIL)
  const coachBId = await resolveCoachId(COACH_B_EMAIL)

  // Start clean so the first GET exercises the lazy seed for both coaches.
  await clearCategories(coachAId)
  await clearCategories(coachBId)

  const tokenA = await getToken(COACH_EMAIL)

  // ── 1. First GET seeds exactly 8 defaults, in order ──
  console.log("\n1. GET (lazy seed)")
  const g1 = await apiGet(tokenA)
  check("GET 200", g1.status === 200, `status ${g1.status}`)
  const cats = g1.json?.categories || []
  check("8 categories seeded", cats.length === 8, `got ${cats.length}`)
  check("seeded flag set", g1.json?.seeded === true)
  check("names match defaults in order", JSON.stringify(cats.map((c) => c.name)) === JSON.stringify(DEFAULTS),
    JSON.stringify(cats.map((c) => c.name)))
  check("sort_order 0..7", cats.every((c, i) => c.sort_order === i))
  check("all is_custom=false", cats.every((c) => c.is_custom === false))
  check("all active=true", cats.every((c) => c.active === true))
  const aIds = new Set(cats.map((c) => c.id))

  // ── 2. Second GET — same 8, no re-seed, no dupes ──
  console.log("\n2. GET again (no re-seed)")
  const g2 = await apiGet(tokenA)
  check("still 8 categories", (g2.json?.categories || []).length === 8)
  check("seeded flag NOT set on 2nd GET", g2.json?.seeded !== true)
  check("raw DB row count is exactly 8 (no dupes)", (await rawCount(coachAId, false)) === 8)

  // ── 3. POST custom → appears, is_custom=true, sort_order after defaults ──
  console.log("\n3. POST custom category")
  const p3 = await apiPost(tokenA, { name: "Portfolio" })
  check("POST 201", p3.status === 201, `status ${p3.status} ${JSON.stringify(p3.json).slice(0, 160)}`)
  check("custom is_custom=true", p3.json?.category?.is_custom === true)
  check("custom sort_order = 8 (after the 8 defaults)", p3.json?.category?.sort_order === 8, `got ${p3.json?.category?.sort_order}`)
  const customId = p3.json?.category?.id
  aIds.add(customId)
  const g3 = await apiGet(tokenA)
  check("GET now returns 9", (g3.json?.categories || []).length === 9)
  check("custom is last in order", (g3.json?.categories || []).at(-1)?.id === customId)

  // ── 4. PATCH rename + PATCH reorder persist ──
  console.log("\n4. PATCH rename + reorder")
  const r4a = await apiPatch(tokenA, customId, { name: "Work Samples" })
  check("rename 200", r4a.status === 200, `status ${r4a.status}`)
  check("rename returned", r4a.json?.category?.name === "Work Samples")
  const r4b = await apiPatch(tokenA, customId, { sort_order: 0 })
  check("reorder 200", r4b.status === 200)
  const g4 = await apiGet(tokenA)
  const renamed = (g4.json?.categories || []).find((c) => c.id === customId)
  check("rename persisted", renamed?.name === "Work Samples", renamed?.name)
  check("reorder persisted (sort_order=0)", renamed?.sort_order === 0, `got ${renamed?.sort_order}`)

  // ── 5. Soft DELETE → gone from active list, row persists inactive ──
  console.log("\n5. DELETE (soft)")
  const resumeCat = (g4.json?.categories || []).find((c) => c.name === "Resume")
  const d5 = await apiDel(tokenA, resumeCat.id)
  check("DELETE 200", d5.status === 200, `status ${d5.status}`)
  const g5 = await apiGet(tokenA)
  check("deleted category absent from active GET", !(g5.json?.categories || []).some((c) => c.id === resumeCat.id))
  const { data: rawResume } = await sb.from("coach_document_categories").select("active").eq("id", resumeCat.id).maybeSingle()
  check("row persists in DB with active=false (not hard-deleted)", rawResume && rawResume.active === false, JSON.stringify(rawResume))

  // ── 6. *** LOAD-BEARING: soft-delete ALL → empty GET, NO re-seed *** ──
  console.log("\n6. *** LOAD-BEARING — soft-delete ALL, GET stays empty, deletions STICK ***")
  const beforeNuke = await rawCount(coachAId, false)
  for (const c of (g5.json?.categories || [])) {
    await apiDel(tokenA, c.id)
  }
  const g6 = await apiGet(tokenA)
  check("GET returns empty after deleting all", (g6.json?.categories || []).length === 0, `got ${(g6.json?.categories || []).length}`)
  check("GET did NOT re-seed (seeded flag absent)", g6.json?.seeded !== true)
  const rawAll = await rawCount(coachAId, false)
  check("raw row count still >= 1 (soft-deletes persist)", rawAll >= 1, `rows ${rawAll}`)
  check("raw row count unchanged by the nuke (all soft, none hard)", rawAll === beforeNuke, `before ${beforeNuke} after ${rawAll}`)
  const g6b = await apiGet(tokenA)
  check("2nd GET STILL empty (deletions stick across loads)", (g6b.json?.categories || []).length === 0)

  // ── 7 & 8. Cross-coach isolation + per-coach seed ──
  console.log("\n7+8. Cross-coach isolation + per-coach seed (coach B)")
  const tokenB = await getToken(COACH_B_EMAIL)
  const gB = await apiGet(tokenB)
  check("B GET 200", gB.status === 200, `status ${gB.status}`)
  const bCats = gB.json?.categories || []
  check("B's first GET seeds B's own 8 (independent of A)", bCats.length === 8, `got ${bCats.length}`)
  check("B seeded flag set", gB.json?.seeded === true)
  check("B's category ids disjoint from A's (can't see A's)", bCats.every((c) => !aIds.has(c.id)))
  check("B's raw count is 8 (A's deletions didn't affect B)", (await rawCount(coachBId, false)) === 8)
  // B cannot PATCH or DELETE one of A's categories (A's id, B's token → 404).
  const anAId = [...aIds][0]
  const xPatch = await apiPatch(tokenB, anAId, { name: "Hijack" })
  check("B PATCH of A's category → 404", xPatch.status === 404, `status ${xPatch.status}`)
  const xDel = await apiDel(tokenB, anAId)
  check("B DELETE of A's category → 404", xDel.status === 404, `status ${xDel.status}`)
  // And A's row was NOT mutated by B's attempts.
  const { data: aRowAfter } = await sb.from("coach_document_categories").select("name").eq("id", anAId).maybeSingle()
  check("A's category untouched by B's attempts", aRowAfter && aRowAfter.name !== "Hijack")

  // ── Cleanup: clear both coaches so re-runs seed fresh ──
  await clearCategories(coachAId)
  await clearCategories(coachBId)
  console.log("\ncleanup: category rows cleared for A and B")

  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
