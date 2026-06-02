#!/usr/bin/env node
// Verification for the stage-progress API (spec §4, §5.3, §7).
//
// Creates a throwaway test prospect, then exercises both endpoints end-to-end:
//   - PATCH /api/coach/prospects/[id]/stage : advance through a few stages,
//     assert prospect_stage_progress rows + reached_at + current_stage_key
//     (incl. "furthest, not latest" semantics + reached_at preserved on
//     re-touch).
//   - PATCH /api/coach/prospects/[id]/status : set active/inactive/lost, assert;
//     assert 'won' is rejected (400) and lifecycle_status is never touched.
//   - PATCH .../stage to the terminal Convert stage : assert the EXISTING
//     conversion happened (lifecycle_status -> Active) AND prospect_status -> won,
//     plus the converted/redirect_to signal.
// Cleans up the test prospect (hard delete via service-role, cascades progress).
//
// SAFETY: dev-ref guard (aborts on prod), mirrors verify-coach-pipeline.
//
// USAGE (migration 20260602_prospect_pipeline.sql must be applied to dev, and a
// dev server must be running — local or point ENDPOINT_BASE at staging):
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   ENDPOINT_BASE=http://localhost:3000 \
//   node scripts/verify-prospect-stage.mjs

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
const TAG = "[verify-prospect-stage]"

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
async function api(token, path, method, body) {
  const res = await fetch(`${ENDPOINT_BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} coach=${COACH_EMAIL}`)

  const { data: prof } = await sb.from("client_profiles").select("id, is_coach").eq("email", COACH_EMAIL).maybeSingle()
  if (!prof?.id) abort(`No client_profiles row for ${COACH_EMAIL}`)
  if (!prof.is_coach) abort(`${COACH_EMAIL} is not is_coach=true`)
  const coachProfileId = prof.id

  const token = await getToken()

  // Ensure the coach's pipeline exists (seed via GET) and learn the keys.
  const pipe = await api(token, "/api/coach/pipeline", "GET")
  if (pipe.status !== 200) abort(`pipeline GET failed: ${pipe.status}`)
  const stages = pipe.json?.stages || []
  const terminalKey = stages.find((s) => s.is_terminal)?.stage_key
  if (!terminalKey) abort("pipeline has no terminal stage")
  const k = (key) => stages.find((s) => s.stage_key === key)?.stage_key
  const LEAD = k("lead_identified")
  const INITIAL = k("initial_contact")
  const CONSULT = k("consult_scheduled")
  if (!LEAD || !INITIAL || !CONSULT) abort("expected default master stages missing")

  // Create a throwaway prospect directly (mirrors prospects POST insert fields).
  let prospectId = null
  const { data: created, error: createErr } = await sb
    .from("coach_clients")
    .insert({
      coach_profile_id: coachProfileId,
      client_profile_id: null,
      status: "active",
      access_level: "full",
      lifecycle_status: "Prospect",
      prospect_status: "active",
      name: "[verify-prospect-stage] test prospect",
      source_category: "referral",
    })
    .select("id, lifecycle_status, prospect_status")
    .single()
  if (createErr || !created?.id) abort(`Failed to seed test prospect: ${createErr?.message}`)
  prospectId = created.id
  console.log(`seeded prospect ${prospectId}`)

  const progressRows = async () => {
    const { data } = await sb.from("prospect_stage_progress").select("stage_key, reached_at").eq("coach_client_id", prospectId)
    return data || []
  }
  const prospectRow = async () => {
    const { data } = await sb.from("coach_clients").select("lifecycle_status, prospect_status, current_stage_key").eq("id", prospectId).single()
    return data
  }

  try {
    // ── 1. Advance lead_identified ──
    console.log("\n1. PATCH stage -> lead_identified")
    const a1 = await api(token, `/api/coach/prospects/${prospectId}/stage`, "PATCH", { stage_key: LEAD })
    check("200", a1.status === 200, `status ${a1.status} ${JSON.stringify(a1.json).slice(0,160)}`)
    check("converted:false", a1.json?.converted === false)
    let pr = await progressRows()
    const leadRow = pr.find((p) => p.stage_key === LEAD)
    check("progress row written for lead", !!leadRow)
    check("reached_at set", !!leadRow?.reached_at)
    let row = await prospectRow()
    check("current_stage_key = lead_identified", row?.current_stage_key === LEAD, row?.current_stage_key)
    const leadReachedAt = leadRow?.reached_at

    // ── 2. Advance consult_scheduled (higher sort) ──
    console.log("\n2. PATCH stage -> consult_scheduled (furthest advances)")
    const a2 = await api(token, `/api/coach/prospects/${prospectId}/stage`, "PATCH", { stage_key: CONSULT })
    check("200", a2.status === 200, `status ${a2.status}`)
    row = await prospectRow()
    check("current_stage_key = consult_scheduled", row?.current_stage_key === CONSULT, row?.current_stage_key)

    // ── 3. Advance initial_contact (lower sort) → current stays furthest ──
    console.log("\n3. PATCH stage -> initial_contact (lower sort; current stays furthest)")
    const a3 = await api(token, `/api/coach/prospects/${prospectId}/stage`, "PATCH", { stage_key: INITIAL })
    check("200", a3.status === 200, `status ${a3.status}`)
    row = await prospectRow()
    check("current_stage_key STAYS consult_scheduled (furthest, not latest)", row?.current_stage_key === CONSULT, row?.current_stage_key)
    pr = await progressRows()
    check("3 progress rows now", pr.length === 3, `got ${pr.length}`)

    // ── 4. Re-touch lead → reached_at preserved ──
    console.log("\n4. PATCH stage -> lead_identified again (reached_at preserved)")
    const a4 = await api(token, `/api/coach/prospects/${prospectId}/stage`, "PATCH", { stage_key: LEAD })
    check("200", a4.status === 200, `status ${a4.status}`)
    pr = await progressRows()
    check("still 3 rows (no dup)", pr.length === 3, `got ${pr.length}`)
    check("reached_at unchanged", pr.find((p) => p.stage_key === LEAD)?.reached_at === leadReachedAt)

    // ── 5. Invalid stage_key rejected ──
    console.log("\n5. PATCH stage -> unknown stage_key → reject")
    const a5 = await api(token, `/api/coach/prospects/${prospectId}/stage`, "PATCH", { stage_key: "not_a_stage" })
    check("rejected 400", a5.status === 400, `status ${a5.status}`)

    // ── 6. Status active/inactive/lost ──
    console.log("\n6. PATCH status active / inactive / lost")
    for (const st of ["active", "inactive", "lost"]) {
      const s = await api(token, `/api/coach/prospects/${prospectId}/status`, "PATCH", { prospect_status: st })
      check(`set ${st} → 200`, s.status === 200, `status ${s.status} ${JSON.stringify(s.json).slice(0,120)}`)
      const rr = await prospectRow()
      check(`prospect_status now ${st}`, rr?.prospect_status === st, rr?.prospect_status)
      check(`lifecycle_status untouched (Prospect)`, rr?.lifecycle_status === "Prospect", rr?.lifecycle_status)
    }

    // ── 7. 'won' rejected via status endpoint ──
    console.log("\n7. PATCH status won → reject")
    const w = await api(token, `/api/coach/prospects/${prospectId}/status`, "PATCH", { prospect_status: "won" })
    check("rejected 400", w.status === 400, `status ${w.status}`)
    check("error explains automatic-on-convert", /convert/i.test(w.json?.error || ""), w.json?.error)
    const garbage = await api(token, `/api/coach/prospects/${prospectId}/status`, "PATCH", { prospect_status: "bogus" })
    check("garbage status rejected 400", garbage.status === 400, `status ${garbage.status}`)

    // ── 8. Terminal Convert → existing conversion + won ──
    console.log("\n8. PATCH stage -> convert_to_client (terminal: reuse conversion + won)")
    const c = await api(token, `/api/coach/prospects/${prospectId}/stage`, "PATCH", { stage_key: terminalKey })
    check("200", c.status === 200, `status ${c.status} ${JSON.stringify(c.json).slice(0,160)}`)
    check("converted:true", c.json?.converted === true)
    check("prospect_status:won in response", c.json?.prospect_status === "won")
    check("redirect_to → coach-clients", /\/dashboard\/coach\/coach-clients\//.test(c.json?.redirect_to || ""), c.json?.redirect_to)
    row = await prospectRow()
    check("lifecycle_status → Active (existing conversion ran)", row?.lifecycle_status === "Active", row?.lifecycle_status)
    check("prospect_status → won (automatic)", row?.prospect_status === "won", row?.prospect_status)
    pr = await progressRows()
    check("terminal progress row recorded", pr.some((p) => p.stage_key === terminalKey))
  } finally {
    // Hard delete the test prospect (cascades prospect_stage_progress + notes).
    if (prospectId) {
      await sb.from("coach_clients").delete().eq("id", prospectId)
      console.log(`\ncleanup: deleted test prospect ${prospectId}`)
    }
  }

  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
