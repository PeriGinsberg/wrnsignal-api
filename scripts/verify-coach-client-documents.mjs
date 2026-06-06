#!/usr/bin/env node
// Verification for the Client Library per-client documents API
// (coach_client_documents), keyed by coach_clients.id.
//
// Exercises: POST with a valid category (URL normalization: prepend-https +
// reject non-http(s) scheme); POST with no category (Uncategorized); POST/PATCH
// with a foreign or inactive category → rejected; GET active list + ordering;
// PATCH edit; soft DELETE (gone from GET, row persists w/ deleted_at);
// nested-resource guard (reach a doc via a DIFFERENT owned relationship → 404);
// cross-coach isolation; activity_id rejected this slice.
//
// SAFETY: dev-ref guard (aborts on prod), mirrors the other verify scripts.
//
// USAGE (migration 20260606 applied to dev + a dev server running, or point
// ENDPOINT_BASE at staging):
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   COACH_B_EMAIL=peri+devcoach1@workforcereadynow.com \
//   ENDPOINT_BASE=https://wrnsignal-api-staging.vercel.app \
//   node scripts/verify-coach-client-documents.mjs

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
const MARKER = "__verify_docs_throwaway__"
const TAG = "[verify-coach-client-documents]"

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
async function http(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
const docsUrl = (relId, path = "") => `${ENDPOINT_BASE}/api/coach/coach-clients/${relId}/documents${path}`
const catUrl = (path = "") => `${ENDPOINT_BASE}/api/coach/document-categories${path}`

async function resolveCoachId(email) {
  const { data } = await sb.from("client_profiles").select("id, is_coach").eq("email", email).maybeSingle()
  if (!data?.id) abort(`No client_profiles row for ${email}`)
  if (!data.is_coach) abort(`${email} is not is_coach=true`)
  return data.id
}
async function clearCategories(coachId) {
  await sb.from("coach_document_categories").delete().eq("coach_profile_id", coachId)
}
async function clearThrowawayRels(coachId) {
  // Cascades coach_client_documents.
  await sb.from("coach_clients").delete().eq("coach_profile_id", coachId).eq("name", MARKER)
}
async function createRel(coachId, clientProfileId) {
  const { data, error } = await sb.from("coach_clients").insert({
    coach_profile_id: coachId,
    client_profile_id: clientProfileId,
    status: "active",
    access_level: "full",
    lifecycle_status: "Prospect",
    prospect_status: "active",
    source_category: "referral",
    name: MARKER,
  }).select("id").single()
  if (error) abort(`createRel failed: ${error.message}`)
  return data.id
}
// Distinct client_profiles ids not already linked to this coach (coach_clients
// has UNIQUE(coach_profile_id, client_profile_id), so each throwaway rel needs
// its own client). Never the coach itself.
async function pickClientProfiles(coachId, n, exclude = []) {
  const { data: profs } = await sb.from("client_profiles").select("id").limit(1000)
  const { data: links } = await sb.from("coach_clients").select("client_profile_id").eq("coach_profile_id", coachId)
  const taken = new Set((links || []).map((l) => l.client_profile_id))
  const ex = new Set([coachId, ...exclude])
  const free = (profs || []).map((p) => p.id).filter((id) => !taken.has(id) && !ex.has(id))
  if (free.length < n) abort(`not enough free client_profiles for coach ${coachId} (need ${n}, have ${free.length})`)
  return free.slice(0, n)
}

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} A=${COACH_EMAIL} B=${COACH_B_EMAIL}`)

  const coachAId = await resolveCoachId(COACH_EMAIL)
  const coachBId = await resolveCoachId(COACH_B_EMAIL)

  // Clean slate (prior runs + deterministic category seed).
  await clearThrowawayRels(coachAId)
  await clearThrowawayRels(coachBId)
  await clearCategories(coachAId)
  await clearCategories(coachBId)

  const tokenA = await getToken(COACH_EMAIL)
  const tokenB = await getToken(COACH_B_EMAIL)

  // Seed both coaches' categories via the categories API (lazy seed).
  const aCats = (await http(tokenA, "GET", catUrl())).json?.categories || []
  const bCats = (await http(tokenB, "GET", catUrl())).json?.categories || []
  check("coach A has seeded categories", aCats.length === 8, `got ${aCats.length}`)
  check("coach B has seeded categories", bCats.length === 8, `got ${bCats.length}`)
  const aCatId = aCats[0]?.id            // valid, coach A's
  const aCatId2 = aCats[1]?.id           // second valid, for PATCH move
  const bCatId = bCats[0]?.id            // FOREIGN (coach B's)
  // Soft-delete one of A's categories to get an INACTIVE one.
  const aInactiveCatId = aCats[7]?.id
  await http(tokenA, "DELETE", catUrl(`/${aInactiveCatId}`))

  // Throwaway relationships: relA1 (primary), relA2 (2nd owned by A, nested
  // guard), relB1 (owned by B, cross-coach). Each needs a distinct, unlinked
  // client_profile_id (non-null, and unique per coach).
  const [clientA1, clientA2] = await pickClientProfiles(coachAId, 2)
  const [clientB1] = await pickClientProfiles(coachBId, 1, [clientA1, clientA2])
  const relA1 = await createRel(coachAId, clientA1)
  const relA2 = await createRel(coachAId, clientA2)
  const relB1 = await createRel(coachBId, clientB1)

  // ── 1. POST valid category + URL normalization ──
  console.log("\n1. POST valid category, URL normalized (prepend https)")
  const p1 = await http(tokenA, "POST", docsUrl(relA1), { title: "Resume v3", url: "example.com/resume", category_id: aCatId })
  check("POST 201", p1.status === 201, `status ${p1.status} ${JSON.stringify(p1.json).slice(0, 160)}`)
  check("category_id persisted", p1.json?.document?.category_id === aCatId)
  check("URL prepended to https://", p1.json?.document?.url === "https://example.com/resume", p1.json?.document?.url)
  const docValid = p1.json?.document?.id

  // ── 2. POST non-http(s) scheme → 400 ──
  console.log("\n2. POST non-http(s) scheme → 400")
  const p2 = await http(tokenA, "POST", docsUrl(relA1), { title: "Bad", url: "ftp://files.example.com/x" })
  check("rejected 400", p2.status === 400, `status ${p2.status}`)
  check("code INVALID_URL", p2.json?.code === "INVALID_URL", JSON.stringify(p2.json).slice(0, 120))

  // ── 3. POST no category → 201, category_id null ──
  console.log("\n3. POST no category → Uncategorized")
  const p3 = await http(tokenA, "POST", docsUrl(relA1), { title: "Portfolio", url: "https://drive.google.com/abc" })
  check("POST 201", p3.status === 201, `status ${p3.status}`)
  check("category_id null", p3.json?.document?.category_id === null)
  check("full https URL unchanged", p3.json?.document?.url === "https://drive.google.com/abc")
  const docNoCat = p3.json?.document?.id

  // ── 4. POST foreign / inactive category → rejected ──
  console.log("\n4. POST foreign / inactive category → 404")
  const p4a = await http(tokenA, "POST", docsUrl(relA1), { title: "X", url: "https://x.com", category_id: bCatId })
  check("foreign category rejected 404", p4a.status === 404, `status ${p4a.status}`)
  const p4b = await http(tokenA, "POST", docsUrl(relA1), { title: "X", url: "https://x.com", category_id: aInactiveCatId })
  check("inactive category rejected 404", p4b.status === 404, `status ${p4b.status}`)

  // ── 5. GET lists active docs, ordered (categorized before uncategorized) ──
  console.log("\n5. GET active list + ordering")
  const g5 = await http(tokenA, "GET", docsUrl(relA1))
  check("GET 200", g5.status === 200)
  const docs5 = g5.json?.documents || []
  check("exactly 2 active docs (rejected ones absent)", docs5.length === 2, `got ${docs5.length}`)
  check("categorized doc sorts before uncategorized", docs5[0]?.id === docValid && docs5[1]?.id === docNoCat,
    JSON.stringify(docs5.map((d) => d.category_id)))

  // ── 6. PATCH edits (title, url, category move, sort) ──
  console.log("\n6. PATCH edits persist")
  const r6 = await http(tokenA, "PATCH", docsUrl(relA1, `/${docValid}`), { title: "Resume v4", url: "linkedin.com/in/me", category_id: aCatId2, sort_order: 5 })
  check("PATCH 200", r6.status === 200, `status ${r6.status} ${JSON.stringify(r6.json).slice(0, 160)}`)
  const g6 = await http(tokenA, "GET", docsUrl(relA1))
  const edited = (g6.json?.documents || []).find((d) => d.id === docValid)
  check("title persisted", edited?.title === "Resume v4")
  check("url normalized on PATCH", edited?.url === "https://linkedin.com/in/me", edited?.url)
  check("category moved", edited?.category_id === aCatId2)
  check("sort_order persisted", edited?.sort_order === 5)
  // PATCH foreign/inactive category → rejected.
  const r6b = await http(tokenA, "PATCH", docsUrl(relA1, `/${docValid}`), { category_id: bCatId })
  check("PATCH foreign category rejected 404", r6b.status === 404, `status ${r6b.status}`)

  // ── 7. Soft DELETE → gone from GET, row persists with deleted_at ──
  console.log("\n7. DELETE (soft)")
  const d7 = await http(tokenA, "DELETE", docsUrl(relA1, `/${docNoCat}`))
  check("DELETE 200", d7.status === 200, `status ${d7.status}`)
  const g7 = await http(tokenA, "GET", docsUrl(relA1))
  check("deleted doc absent from GET", !(g7.json?.documents || []).some((d) => d.id === docNoCat))
  const { data: rawDel } = await sb.from("coach_client_documents").select("deleted_at").eq("id", docNoCat).maybeSingle()
  check("row persists with deleted_at set (not hard-deleted)", rawDel && rawDel.deleted_at !== null, JSON.stringify(rawDel))
  const d7b = await http(tokenA, "DELETE", docsUrl(relA1, `/${docNoCat}`))
  check("re-DELETE already-deleted → 404", d7b.status === 404, `status ${d7b.status}`)

  // ── 8. Nested-resource guard: reach docValid via relA2 (also owned by A) ──
  console.log("\n8. Nested-resource guard (different owned relationship → 404)")
  const n8a = await http(tokenA, "PATCH", docsUrl(relA2, `/${docValid}`), { title: "Hijack" })
  check("PATCH via wrong relationship → 404", n8a.status === 404, `status ${n8a.status}`)
  const n8b = await http(tokenA, "DELETE", docsUrl(relA2, `/${docValid}`))
  check("DELETE via wrong relationship → 404", n8b.status === 404, `status ${n8b.status}`)
  const { data: stillThere } = await sb.from("coach_client_documents").select("title, deleted_at").eq("id", docValid).maybeSingle()
  check("docValid untouched (title + still active)", stillThere?.title === "Resume v4" && stillThere?.deleted_at === null)

  // ── 9. Cross-coach isolation ──
  console.log("\n9. Cross-coach isolation (coach B vs coach A)")
  check("B GET on A's relationship → 404", (await http(tokenB, "GET", docsUrl(relA1))).status === 404)
  check("B POST on A's relationship → 404", (await http(tokenB, "POST", docsUrl(relA1), { title: "x", url: "https://x.com" })).status === 404)
  check("B PATCH on A's doc → 404", (await http(tokenB, "PATCH", docsUrl(relA1, `/${docValid}`), { title: "x" })).status === 404)
  check("B DELETE on A's doc → 404", (await http(tokenB, "DELETE", docsUrl(relA1, `/${docValid}`))).status === 404)
  // B can't reach A's doc by pairing it with B's OWN relationship id.
  check("B reach A's doc via B's own relationship → 404", (await http(tokenB, "PATCH", docsUrl(relB1, `/${docValid}`), { title: "x" })).status === 404)
  check("B DELETE A's doc via B's own relationship → 404", (await http(tokenB, "DELETE", docsUrl(relB1, `/${docValid}`))).status === 404)

  // ── 10. activity_id rejected this slice ──
  console.log("\n10. activity_id rejected (Slice A)")
  const t10a = await http(tokenA, "POST", docsUrl(relA1), { title: "x", url: "https://x.com", activity_id: "00000000-0000-0000-0000-000000000000" })
  check("POST with activity_id → 400", t10a.status === 400, `status ${t10a.status}`)
  const t10b = await http(tokenA, "PATCH", docsUrl(relA1, `/${docValid}`), { activity_id: "00000000-0000-0000-0000-000000000000" })
  check("PATCH with activity_id → 400 (unknown field)", t10b.status === 400, `status ${t10b.status}`)

  // ── Cleanup ──
  await clearThrowawayRels(coachAId)
  await clearThrowawayRels(coachBId)
  await clearCategories(coachAId)
  await clearCategories(coachBId)
  console.log("\ncleanup: throwaway relationships + category rows cleared for A and B")

  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
