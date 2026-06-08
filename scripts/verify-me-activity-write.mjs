#!/usr/bin/env node
// Verification for the client activity WRITE — PATCH /api/me/activities/[activity_id].
// The INVERTED ownership guard is the load-bearing piece: a client may write ONLY
// their own ('client'/'both') activities, on their own ACTIVE engagement.
//
// A coach attaches a mixed-owner package to client A's active relationship (A1c
// client-owner, A1b both-owner, A1coach coach-owner) AND to client B's own
// relationship (B1c). Then, as A:
//   - lifecycle not_started→in_progress→complete persists; both-owner writable
//   - complete logs exactly ONE activity_completed (by_client:true, actor=A);
//     re-complete / downgrade log nothing
//   - the write touches ONLY status (sibling + name/owner unchanged)
//   - ATTACK (a): A → B1c (another client's activity) → 404, B1c unchanged
//   - ATTACK (b): A → A1coach (coach-owner on A's own engagement) → 404, unchanged
//   - active-only: paused/revoked relationship → 404
//   - invalid status → 400; no/invalid bearer → 401
//
// SAFETY: dev-ref guard (aborts on prod). Sign-in-able fixture clients A/B,
// distinct profiles. FK-safe marker cleanup (engagement snapshot name = package
// name; throwaway events by context.engagement_name). Checks scoped to this run.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   ENDPOINT_BASE=https://wrnsignal-api-staging.vercel.app \
//   node scripts/verify-me-activity-write.mjs

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const COACH_EMAIL = (process.env.COACH_EMAIL || "peri+coach1@workforcereadynow.com").trim().toLowerCase()
const CLIENT_A_EMAIL = (process.env.CLIENT_A_EMAIL || "alex+test@example.com").trim().toLowerCase()
const CLIENT_B_EMAIL = (process.env.CLIENT_B_EMAIL || "brooke+test@example.com").trim().toLowerCase()
const TEST_PASSWORD = process.env.TEST_PASSWORD || "dev-test-1234"
const ENDPOINT_BASE = process.env.ENDPOINT_BASE || "http://localhost:3000"
const MARKER_REL = "__verify_actw_rel__"
const DELIV_NAME = "__actw_deliv__"
const PKG_NAME = "__actw_pkg__"
const ACT_CLIENT = "__actw_client__"
const ACT_BOTH = "__actw_both__"
const ACT_COACH = "__actw_coach__"
const TAG = "[verify-me-activity-write]"

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
const meAct = (id) => `${ENDPOINT_BASE}/api/me/activities/${id}`

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
async function actRow(id) {
  const { data } = await sb.from("coach_client_engagement_activities").select("status, name, owner").eq("id", id).maybeSingle()
  return data
}
// activity_completed events for a relationship + a given activity name (scoped to this run).
async function completedEvents(relId, name) {
  const { data } = await sb.from("coach_client_events")
    .select("actor_profile_id, context").eq("coach_client_id", relId).eq("event_type", "activity_completed")
  return (data || []).filter((e) => e?.context?.name === name)
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

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} A=${CLIENT_A_EMAIL} B=${CLIENT_B_EMAIL} coach=${COACH_EMAIL}`)

  const coachId = await resolveProfileId(COACH_EMAIL)
  const aId = await resolveProfileId(CLIENT_A_EMAIL)
  const bId = await resolveProfileId(CLIENT_B_EMAIL)
  if (aId === bId) abort("A and B must be distinct profiles")

  await cleanup()
  const coachToken = await getToken(COACH_EMAIL)
  const aToken = await getToken(CLIENT_A_EMAIL)

  // ── Setup: mixed-owner package, attached to A's and B's active relationships ──
  console.log("\nSetup: build mixed-owner package; attach to A and B")
  const mk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones`, { name: DELIV_NAME })
  check("create deliverable → 201", mk.status === 201, `status ${mk.status}`)
  const milestoneId = mk.json?.milestone?.id
  for (const [name, owner] of [[ACT_CLIENT, "client"], [ACT_BOTH, "both"], [ACT_COACH, "coach"]]) {
    const r = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones/${milestoneId}/activities`, { name, owner })
    check(`add activity ${name} (${owner}) → 201`, r.status === 201, `status ${r.status}`)
  }
  const pk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/packages`, { name: PKG_NAME, deliverable_ids: [milestoneId] })
  check("create package → 201", pk.status === 201, `status ${pk.status}`)
  const packageId = pk.json?.package?.id

  const relA = await getOrCreateRel(coachId, aId)
  await setRelStatus(relA.id, "active")
  const relB = await getOrCreateRel(coachId, bId)
  await setRelStatus(relB.id, "active")
  const attA = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/coach-clients/${relA.id}/engagements`, { package_id: packageId })
  check("attach to A → 201", attA.status === 201, `status ${attA.status} ${JSON.stringify(attA.json).slice(0,140)}`)
  const attB = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/coach-clients/${relB.id}/engagements`, { package_id: packageId })
  check("attach to B → 201", attB.status === 201, `status ${attB.status}`)

  const A1c = findAct(attA.json?.engagement, ACT_CLIENT)?.id
  const A1b = findAct(attA.json?.engagement, ACT_BOTH)?.id
  const A1coach = findAct(attA.json?.engagement, ACT_COACH)?.id
  const B1c = findAct(attB.json?.engagement, ACT_CLIENT)?.id
  check("captured A1c / A1b / A1coach / B1c ids", !!(A1c && A1b && A1coach && B1c), `A1c=${A1c} A1b=${A1b} A1coach=${A1coach} B1c=${B1c}`)

  // ── Phase 1: A1c lifecycle persists ──
  console.log("\nPhase 1: A1c lifecycle not_started → in_progress → complete")
  const s1 = await http(aToken, "PATCH", meAct(A1c), { status: "not_started" })
  check("→ not_started 200", s1.status === 200 && s1.json?.activity?.status === "not_started", `status ${s1.status}`)
  const s2 = await http(aToken, "PATCH", meAct(A1c), { status: "in_progress" })
  check("→ in_progress 200", s2.status === 200 && s2.json?.activity?.status === "in_progress")
  const s3 = await http(aToken, "PATCH", meAct(A1c), { status: "complete" })
  check("→ complete 200", s3.status === 200 && s3.json?.activity?.status === "complete")
  const gA = await http(aToken, "GET", ME)
  const a1cInGet = (gA.json?.groups || []).flatMap((g) => g.activities || []).find((a) => a.id === A1c)
  check("GET reflects A1c = complete (persisted)", a1cInGet?.status === "complete", a1cInGet?.status)

  // ── Phase 1b: write isolation — only status, only this row ──
  console.log("\nPhase 1b: write touched ONLY status")
  check("sibling A1b unchanged (still not_started)", (await actRow(A1b))?.status === "not_started")
  const a1cRow = await actRow(A1c)
  check("A1c name unchanged", a1cRow?.name === ACT_CLIENT)
  check("A1c owner unchanged", a1cRow?.owner === "client")

  // ── Phase 2: event de-dup + attribution ──
  console.log("\nPhase 2: activity_completed event — exactly one, by_client, actor=A")
  let evs = await completedEvents(relA.id, ACT_CLIENT)
  check("exactly ONE activity_completed for A1c", evs.length === 1, `count ${evs.length}`)
  check("event actor = A's profile id", evs[0]?.actor_profile_id === aId, evs[0]?.actor_profile_id)
  check("event context by_client = true", evs[0]?.context?.by_client === true)
  const reC = await http(aToken, "PATCH", meAct(A1c), { status: "complete" })
  check("re-PATCH complete → 200", reC.status === 200)
  check("no SECOND event on re-complete", (await completedEvents(relA.id, ACT_CLIENT)).length === 1)
  await http(aToken, "PATCH", meAct(A1c), { status: "in_progress" })
  await http(aToken, "PATCH", meAct(A1c), { status: "not_started" })
  check("no event on downgrade (in_progress / not_started)", (await completedEvents(relA.id, ACT_CLIENT)).length === 1)

  // ── Phase 3: both-owner writable + completes ──
  console.log("\nPhase 3: A1b (both) writable")
  const b1 = await http(aToken, "PATCH", meAct(A1b), { status: "complete" })
  check("A1b → complete 200", b1.status === 200 && b1.json?.activity?.status === "complete")
  check("A1b persisted complete", (await actRow(A1b))?.status === "complete")
  const evsB = await completedEvents(relA.id, ACT_BOTH)
  check("A1b exactly one activity_completed, by_client, actor=A", evsB.length === 1 && evsB[0]?.actor_profile_id === aId && evsB[0]?.context?.by_client === true, `count ${evsB.length}`)

  // ── ATTACK (a): A → B1c (another client's activity) ──
  console.log("\nATTACK (a): A PATCHes B1c (another client's activity)")
  const atkA = await http(aToken, "PATCH", meAct(B1c), { status: "complete" })
  check("A → B1c rejected 404", atkA.status === 404, `status ${atkA.status}`)
  check("B1c unchanged (still not_started)", (await actRow(B1c))?.status === "not_started")

  // ── ATTACK (b): A → A1coach (coach-owner on A's OWN engagement) ──
  console.log("\nATTACK (b): A PATCHes A1coach (coach-owner, own engagement)")
  const atkB = await http(aToken, "PATCH", meAct(A1coach), { status: "complete" })
  check("A → A1coach rejected 404", atkB.status === 404, `status ${atkB.status}`)
  check("A1coach unchanged (still not_started)", (await actRow(A1coach))?.status === "not_started")

  // ── Active-only: paused/revoked → 404 ──
  console.log("\nActive-only gating")
  await setRelStatus(relA.id, "paused")
  check("paused → A PATCH A1c 404", (await http(aToken, "PATCH", meAct(A1c), { status: "complete" })).status === 404)
  await setRelStatus(relA.id, "revoked")
  check("revoked → A PATCH A1c 404", (await http(aToken, "PATCH", meAct(A1c), { status: "complete" })).status === 404)
  await setRelStatus(relA.id, "active")

  // ── Validation + auth ──
  console.log("\nValidation + auth")
  check("invalid status='done' → 400", (await http(aToken, "PATCH", meAct(A1c), { status: "done" })).status === 400)
  check("no bearer → 401", (await http(null, "PATCH", meAct(A1c), { status: "complete" })).status === 401)
  check("invalid bearer → 401", (await http("garbage.token.value", "PATCH", meAct(A1c), { status: "complete" })).status === 401)

  // Restore reused fixture relationships.
  if (!relA.created) await setRelStatus(relA.id, relA.prevStatus)
  if (!relB.created) await setRelStatus(relB.id, relB.prevStatus)

  await cleanup()
  console.log("\ncleanup: throwaway events + engagements + package + milestone + created relationships cleared")
  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
