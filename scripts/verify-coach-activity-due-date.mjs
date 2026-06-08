#!/usr/bin/env node
// Verification for per-activity due dates (Slice 4).
// Exercises the coach WRITE (PATCH .../activities/[activity_id] with due_date) and
// both READS (coach getApiEngagementById GET + client GET /api/me/activities).
//
// A coach attaches a package with two CLIENT-owned activities (target + sibling)
// to client A's ACTIVE relationship, then as the coach:
//   - due_date starts null in BOTH reads
//   - PATCH { due_date:'2026-07-01' } → persists; appears in coach read AND client read
//   - PATCH { due_date:null } → clears it in both reads
//   - invalid date (2026-13-40 / 2026-7-1 unpadded / 'nope') → 400; DB unchanged
//   - status-only PATCH still works and leaves a previously-set due_date UNTOUCHED
//   - due_date-only PATCH leaves status UNTOUCHED
//   - the write touches ONLY status/due_date: sibling + name/owner never move
//   - empty body {} → 400
//
// SAFETY: dev-ref guard (aborts on prod). Sign-in-able fixture coach + client A.
// Marker cleanup (engagement snapshot name = package name). Scoped to this run.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   CLIENT_A_EMAIL=alex+test@example.com \
//   ENDPOINT_BASE=https://wrnsignal-api-staging.vercel.app \
//   node scripts/verify-coach-activity-due-date.mjs

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const COACH_EMAIL = (process.env.COACH_EMAIL || "peri+coach1@workforcereadynow.com").trim().toLowerCase()
const CLIENT_A_EMAIL = (process.env.CLIENT_A_EMAIL || "alex+test@example.com").trim().toLowerCase()
const TEST_PASSWORD = process.env.TEST_PASSWORD || "dev-test-1234"
const ENDPOINT_BASE = process.env.ENDPOINT_BASE || "http://localhost:3000"
const MARKER_REL = "__verify_due_rel__"
const DELIV_NAME = "__due_deliv__"
const PKG_NAME = "__due_pkg__"
const ACT_TARGET = "__due_target__"
const ACT_SIB = "__due_sib__"
const TAG = "[verify-coach-activity-due-date]"

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
  if (cond) console.log(`  ✓ ${name}`)
  else { pass = false; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

async function getToken(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error || !data?.session?.access_token) abort(`Sign-in failed for ${email}: ${error?.message} (is the dev fixture seeded?)`)
  return data.session.access_token
}
async function http(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
const ME = `${ENDPOINT_BASE}/api/me/activities`

async function resolveProfileId(email) {
  const { data } = await sb.from("client_profiles").select("id").eq("email", email).maybeSingle()
  if (!data?.id) abort(`No client_profiles row for ${email} (is the dev fixture seeded?)`)
  return data.id
}
async function getOrCreateRel(coachId, clientId) {
  const { data: existing } = await sb.from("coach_clients").select("id, status")
    .eq("coach_profile_id", coachId).eq("client_profile_id", clientId).maybeSingle()
  if (existing?.id) return { id: existing.id, created: false, prevStatus: existing.status }
  const { data, error } = await sb.from("coach_clients").insert({
    coach_profile_id: coachId, client_profile_id: clientId,
    status: "active", access_level: "full", lifecycle_status: "Active", name: MARKER_REL,
  }).select("id").single()
  if (error) abort(`getOrCreateRel failed: ${error.message}`)
  return { id: data.id, created: true, prevStatus: "active" }
}
async function setRelStatus(relId, status) {
  const { error } = await sb.from("coach_clients").update({ status }).eq("id", relId)
  if (error) abort(`setRelStatus(${status}) failed: ${error.message}`)
}
// Service-role read of the raw row — ground truth for persistence + field isolation.
async function actRow(id) {
  const { data } = await sb.from("coach_client_engagement_activities").select("status, name, owner, due_date").eq("id", id).maybeSingle()
  return data
}
async function cleanup() {
  await sb.from("coach_client_events").delete().eq("event_type", "activity_completed").filter("context->>engagement_name", "eq", PKG_NAME)
  await sb.from("coach_client_engagements").delete().eq("name", PKG_NAME)
  await sb.from("coach_packages").delete().eq("name", PKG_NAME)
  await sb.from("coach_milestones").delete().eq("name", DELIV_NAME)
  await sb.from("coach_clients").delete().eq("name", MARKER_REL)
}
const findAct = (engagement, name) =>
  (engagement?.deliverables || []).flatMap((d) => d.activities || []).find((a) => a.name === name)
// Find an activity (by id) in the client /api/me/activities response.
const findInMe = (meJson, id) =>
  (meJson?.groups || []).flatMap((g) => g.activities || []).find((a) => a.id === id)

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} A=${CLIENT_A_EMAIL} coach=${COACH_EMAIL}`)

  const coachId = await resolveProfileId(COACH_EMAIL)
  const aId = await resolveProfileId(CLIENT_A_EMAIL)

  await cleanup()
  const coachToken = await getToken(COACH_EMAIL)
  const aToken = await getToken(CLIENT_A_EMAIL)

  // ── Setup: deliverable with two client-owned activities → package → attach to A ──
  console.log("\nSetup: client-owned target + sibling; attach to A's active relationship")
  const mk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones`, { name: DELIV_NAME })
  check("create deliverable → 201", mk.status === 201, `status ${mk.status}`)
  const milestoneId = mk.json?.milestone?.id
  for (const name of [ACT_TARGET, ACT_SIB]) {
    const r = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones/${milestoneId}/activities`, { name, owner: "client" })
    check(`add activity ${name} (client) → 201`, r.status === 201, `status ${r.status}`)
  }
  const pk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/packages`, { name: PKG_NAME, deliverable_ids: [milestoneId] })
  check("create package → 201", pk.status === 201, `status ${pk.status}`)
  const packageId = pk.json?.package?.id

  const rel = await getOrCreateRel(coachId, aId)
  await setRelStatus(rel.id, "active")
  const att = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/coach-clients/${rel.id}/engagements`, { package_id: packageId })
  check("attach to A → 201", att.status === 201, `status ${att.status} ${JSON.stringify(att.json).slice(0, 140)}`)
  const E = att.json?.engagement?.id
  const target = findAct(att.json?.engagement, ACT_TARGET)?.id
  const sib = findAct(att.json?.engagement, ACT_SIB)?.id
  check("captured target + sibling ids", !!(E && target && sib), `E=${E} target=${target} sib=${sib}`)
  const actBase = `${ENDPOINT_BASE}/api/coach/coach-clients/${rel.id}/engagements/${E}/activities`
  const engGet = () => http(coachToken, "GET", `${ENDPOINT_BASE}/api/coach/coach-clients/${rel.id}/engagements/${E}`)

  // ── Phase 0: due_date starts null in BOTH reads + the attach payload ──
  console.log("\nPhase 0: due_date null on a fresh snapshot")
  check("attach payload target.due_date = null", findAct(att.json?.engagement, ACT_TARGET)?.due_date === null,
    JSON.stringify(findAct(att.json?.engagement, ACT_TARGET)?.due_date))
  const g0 = await engGet()
  check("coach read target.due_date = null", findAct(g0.json?.engagement, ACT_TARGET)?.due_date === null)
  const me0 = await http(aToken, "GET", ME)
  check("client read target.due_date = null", findInMe(me0.json, target)?.due_date === null,
    JSON.stringify(findInMe(me0.json, target)?.due_date))

  // ── Phase 1: set due_date → persists + appears in coach read AND client read ──
  console.log("\nPhase 1: PATCH due_date='2026-07-01' → both reads")
  const p1 = await http(coachToken, "PATCH", `${actBase}/${target}`, { due_date: "2026-07-01" })
  check("PATCH due_date → 200", p1.status === 200, `status ${p1.status} ${JSON.stringify(p1.json).slice(0, 120)}`)
  check("DB row due_date = 2026-07-01", (await actRow(target))?.due_date === "2026-07-01")
  check("coach read shows 2026-07-01", findAct((await engGet()).json?.engagement, ACT_TARGET)?.due_date === "2026-07-01")
  check("client read shows 2026-07-01", findInMe((await http(aToken, "GET", ME)).json, target)?.due_date === "2026-07-01")

  // ── Phase 2: clear due_date → null in both reads ──
  console.log("\nPhase 2: PATCH due_date=null → cleared")
  const p2 = await http(coachToken, "PATCH", `${actBase}/${target}`, { due_date: null })
  check("PATCH due_date=null → 200", p2.status === 200, `status ${p2.status}`)
  check("DB row due_date = null", (await actRow(target))?.due_date === null)
  check("coach read cleared (null)", findAct((await engGet()).json?.engagement, ACT_TARGET)?.due_date === null)
  check("client read cleared (null)", findInMe((await http(aToken, "GET", ME)).json, target)?.due_date === null)

  // ── Phase 3: invalid dates → 400, DB untouched ──
  console.log("\nPhase 3: invalid dates → 400")
  for (const bad of ["2026-13-40", "2026-7-1", "nope", "07/01/2026"]) {
    check(`PATCH due_date='${bad}' → 400`, (await http(coachToken, "PATCH", `${actBase}/${target}`, { due_date: bad })).status === 400)
  }
  check("DB row still null after invalid attempts", (await actRow(target))?.due_date === null)

  // ── Phase 4: status-only PATCH still works AND leaves a set due_date untouched ──
  console.log("\nPhase 4: status-only PATCH does not disturb due_date")
  await http(coachToken, "PATCH", `${actBase}/${target}`, { due_date: "2026-08-15" })
  const p4 = await http(coachToken, "PATCH", `${actBase}/${target}`, { status: "in_progress" })
  check("status-only PATCH → 200", p4.status === 200, `status ${p4.status}`)
  const r4 = await actRow(target)
  check("status now in_progress", r4?.status === "in_progress", r4?.status)
  check("due_date UNTOUCHED (still 2026-08-15)", r4?.due_date === "2026-08-15", JSON.stringify(r4?.due_date))

  // ── Phase 5: due_date-only PATCH leaves status untouched ──
  console.log("\nPhase 5: due_date-only PATCH does not disturb status")
  await http(coachToken, "PATCH", `${actBase}/${target}`, { status: "complete" })
  const p5 = await http(coachToken, "PATCH", `${actBase}/${target}`, { due_date: "2026-09-01" })
  check("due_date-only PATCH → 200", p5.status === 200, `status ${p5.status}`)
  const r5 = await actRow(target)
  check("status UNTOUCHED (still complete)", r5?.status === "complete", r5?.status)
  check("due_date now 2026-09-01", r5?.due_date === "2026-09-01")

  // ── Phase 6: field isolation — only status/due_date move; sibling never does ──
  console.log("\nPhase 6: write isolation")
  const rt = await actRow(target)
  check("target name unchanged", rt?.name === ACT_TARGET)
  check("target owner unchanged", rt?.owner === "client")
  const rs = await actRow(sib)
  check("sibling due_date still null", rs?.due_date === null, JSON.stringify(rs?.due_date))
  check("sibling status still not_started", rs?.status === "not_started", rs?.status)

  // ── Phase 7: empty body → 400 ──
  console.log("\nPhase 7: empty body")
  check("PATCH {} → 400", (await http(coachToken, "PATCH", `${actBase}/${target}`, {})).status === 400)

  if (!rel.created) await setRelStatus(rel.id, rel.prevStatus)
  await cleanup()
  console.log("\ncleanup: throwaway events + engagement + package + milestone + created relationship cleared")
  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
