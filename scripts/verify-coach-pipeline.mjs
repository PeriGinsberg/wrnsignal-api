#!/usr/bin/env node
// Verification for the pipeline config API (spec §5, §7, §0.4).
//
// Hits GET /api/coach/pipeline (triggers lazy seed), asserts 11 stages with
// Convert terminal + last; then PUT (reorder + deselect + add custom) and
// asserts it persisted; then exercises the server-side guards (reject moving
// Convert off last, removing Convert, deactivating Convert). Cleans up at the
// end by deleting the coach's pipeline rows so re-runs re-seed fresh.
//
// SAFETY: dev-ref guard (aborts on prod), mirrors verify-action-items.
//
// USAGE (migration 20260602_prospect_pipeline.sql must be applied to dev, and a
// dev server must be running — local or point ENDPOINT_BASE at staging):
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   ENDPOINT_BASE=http://localhost:3000 \
//   node scripts/verify-coach-pipeline.mjs

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const COACH_EMAIL = (process.env.COACH_EMAIL || "").trim().toLowerCase()
const TEST_PASSWORD = process.env.TEST_PASSWORD || "dev-test-1234"
const ENDPOINT_BASE = process.env.ENDPOINT_BASE || "http://localhost:3000"
const TAG = "[verify-coach-pipeline]"

function abort(msg) { console.error(`✗ ${msg}`); process.exit(1) }
if (!SUPABASE_URL) abort("SUPABASE_URL is required")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL contains the PROD ref (${PROD_REF}). Dev only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain dev ref (${DEV_REF}).`)
if (!SUPABASE_SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required")
if (!NEXT_PUBLIC_SUPABASE_ANON_KEY) abort("NEXT_PUBLIC_SUPABASE_ANON_KEY is required (sign-in path)")
if (!COACH_EMAIL) abort("COACH_EMAIL is required")

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)

let pass = true
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ✓ ${name}`) }
  else { pass = false; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

async function getToken() {
  const { data, error } = await anon.auth.signInWithPassword({ email: COACH_EMAIL, password: TEST_PASSWORD })
  if (error || !data?.session?.access_token) abort(`Sign-in failed for ${COACH_EMAIL}: ${error?.message}`)
  return data.session.access_token
}
async function api(token, method, body) {
  const res = await fetch(`${ENDPOINT_BASE}/api/coach/pipeline`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function clearPipeline(coachProfileId) {
  await sb.from("coach_pipeline_stages").delete().eq("coach_profile_id", coachProfileId)
}

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} coach=${COACH_EMAIL}`)

  // Resolve coach profile id for cleanup.
  const { data: prof } = await sb.from("client_profiles").select("id, is_coach").eq("email", COACH_EMAIL).maybeSingle()
  if (!prof?.id) abort(`No client_profiles row for ${COACH_EMAIL}`)
  if (!prof.is_coach) abort(`${COACH_EMAIL} is not is_coach=true`)
  const coachProfileId = prof.id

  // Start clean so the GET exercises the lazy seed.
  await clearPipeline(coachProfileId)

  const token = await getToken()

  // ── 1. GET triggers seed ──
  console.log("\n1. GET (lazy seed)")
  const g1 = await api(token, "GET")
  check("GET 200", g1.status === 200, `status ${g1.status}`)
  const stages = g1.json?.stages || []
  check("11 stages seeded", stages.length === 11, `got ${stages.length}`)
  check("seeded flag set", g1.json?.seeded === true)
  const terminal = stages.find((s) => s.is_terminal)
  check("exactly one terminal stage", stages.filter((s) => s.is_terminal).length === 1)
  check("terminal is convert_to_client", terminal?.stage_key === "convert_to_client")
  const maxSort = Math.max(...stages.map((s) => s.sort_order))
  check("terminal is last (highest sort_order)", terminal?.sort_order === maxSort)
  check("all seeded active + non-custom", stages.every((s) => s.active === true && s.is_custom === false))
  check("ordered ascending by sort_order", stages.every((s, i) => i === 0 || stages[i - 1].sort_order <= s.sort_order))

  // ── 2. GET again is idempotent (no re-seed) ──
  console.log("\n2. GET again (no re-seed)")
  const g2 = await api(token, "GET")
  check("still 11 stages", (g2.json?.stages || []).length === 11)
  check("seeded flag NOT set on 2nd GET", g2.json?.seeded !== true)

  // ── 3. Valid PUT: reorder + deselect + add custom ──
  console.log("\n3. PUT (reorder + deselect sow_drafted + add custom), Convert last")
  // Build: keep all non-terminal master stages, deactivate sow_drafted, swap
  // order of initial_contact <-> consult_scheduled, add one custom stage, and
  // keep Convert with the highest sort_order.
  const nonTerminal = stages.filter((s) => !s.is_terminal)
  const putStages = nonTerminal.map((s) => ({
    stage_key: s.stage_key,
    sort_order: s.stage_key === "initial_contact" ? 3 : s.stage_key === "consult_scheduled" ? 2 : s.sort_order,
    active: s.stage_key === "sow_drafted" ? false : true,
  }))
  // Custom stage: integer sort below the terminal, above the master stages.
  putStages.push({ is_custom: true, label: "Reference Check", sort_order: 105 })
  putStages.push({ stage_key: "convert_to_client", sort_order: 999, active: true })
  const p1 = await api(token, "PUT", { stages: putStages })
  check("PUT 200", p1.status === 200, `status ${p1.status} ${JSON.stringify(p1.json).slice(0,160)}`)
  const after = p1.json?.stages || []
  const customRow = after.find((s) => s.is_custom)
  check("custom stage added", !!customRow && customRow.label === "Reference Check")
  check("custom stage has generated key", !!customRow && customRow.stage_key?.startsWith("custom_"))
  const sowDrafted = after.find((s) => s.stage_key === "sow_drafted")
  check("sow_drafted deactivated (not deleted)", !!sowDrafted && sowDrafted.active === false)
  const t2 = after.find((s) => s.is_terminal)
  check("Convert still last after PUT", t2 && t2.sort_order === Math.max(...after.map((s) => s.sort_order)))
  const ic = after.find((s) => s.stage_key === "initial_contact")
  const cs = after.find((s) => s.stage_key === "consult_scheduled")
  check("reorder persisted (initial_contact sort=3, consult_scheduled sort=2)", ic?.sort_order === 3 && cs?.sort_order === 2)

  // ── 4. Guard: Convert moved off last → reject ──
  console.log("\n4. PUT guard — Convert not last → reject")
  const badOrder = [
    { stage_key: "lead_identified", sort_order: 1, active: true },
    { stage_key: "convert_to_client", sort_order: 2, active: true }, // not the max
    { stage_key: "initial_contact", sort_order: 3, active: true },
  ]
  const p2 = await api(token, "PUT", { stages: badOrder })
  check("rejected with 400", p2.status === 400, `status ${p2.status}`)
  check("error mentions last", /last/i.test(p2.json?.error || ""), p2.json?.error)

  // ── 5. Guard: Convert removed → reject ──
  console.log("\n5. PUT guard — Convert absent → reject")
  const noConvert = [
    { stage_key: "lead_identified", sort_order: 1, active: true },
    { stage_key: "initial_contact", sort_order: 2, active: true },
  ]
  const p3 = await api(token, "PUT", { stages: noConvert })
  check("rejected with 400", p3.status === 400, `status ${p3.status}`)
  check("error mentions Convert must remain", /convert/i.test(p3.json?.error || ""), p3.json?.error)

  // ── 6. Guard: Convert deactivated → reject ──
  console.log("\n6. PUT guard — Convert deactivated → reject")
  const deactivateConvert = [
    { stage_key: "lead_identified", sort_order: 1, active: true },
    { stage_key: "convert_to_client", sort_order: 999, active: false },
  ]
  const p4 = await api(token, "PUT", { stages: deactivateConvert })
  check("rejected with 400", p4.status === 400, `status ${p4.status}`)
  check("error mentions deactivat", /deactivat/i.test(p4.json?.error || ""), p4.json?.error)

  // ── 7. Guard: unknown stage_key → reject ──
  console.log("\n7. PUT guard — unknown stage_key → reject")
  const unknown = [
    { stage_key: "not_a_real_stage", sort_order: 1, active: true },
    { stage_key: "convert_to_client", sort_order: 999, active: true },
  ]
  const p5 = await api(token, "PUT", { stages: unknown })
  check("rejected with 400", p5.status === 400, `status ${p5.status}`)

  // ── Cleanup: clear pipeline so re-runs re-seed fresh ──
  await clearPipeline(coachProfileId)
  console.log("\ncleanup: pipeline rows cleared for", COACH_EMAIL)

  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
