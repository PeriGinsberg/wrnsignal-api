#!/usr/bin/env node
// Verification for the client-facing engagement-activity read — GET /api/me/activities.
//
// A coached client sees ONLY their OWN engagement activities (owner 'client' or
// 'both'), grouped by deliverable — never coach-owner activities, never another
// client's, and only while the relationship is ACTIVE. A coach builds a mixed-
// owner package and attaches it; the client signs in and reads /api/me/activities.
//
// SAFETY: dev-ref guard (aborts on prod). Sign-in-able fixture clients
// (alex/brooke/casey) + coach peri+coach1. Distinct profiles for A and B. All
// throwaway artifacts are cleaned by name markers (engagement snapshot name =
// package name, so a reused fixture relationship survives — only its throwaway
// engagement is removed). Absence checks are scoped to THIS run's __act_ set.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   ENDPOINT_BASE=https://wrnsignal-api-staging.vercel.app \
//   node scripts/verify-me-activities.mjs

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
const CLIENT_C_EMAIL = (process.env.CLIENT_C_EMAIL || "casey+test@example.com").trim().toLowerCase()
const TEST_PASSWORD = process.env.TEST_PASSWORD || "dev-test-1234"
const ENDPOINT_BASE = process.env.ENDPOINT_BASE || "http://localhost:3000"
const MARKER_REL = "__verify_me_acts_rel__"
const DELIV_NAME = "__me_act_deliv__"
const PKG_NAME = "__me_act_pkg__"
const ACT_CLIENT = "__act_client__"
const ACT_BOTH = "__act_both__"
const ACT_COACH = "__act_coach__"
const TAG = "[verify-me-activities]"

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
// Get-or-create a coach→client relationship; report whether we created it + its
// prior status (so a reused fixture relationship can be restored on cleanup).
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
async function cleanup() {
  // Throwaway engagement snapshots (name = package name) → cascades deliverables
  // + activities. Then package (cascades package_milestones), then catalog
  // milestone (cascades catalog activities), then any relationship WE created.
  await sb.from("coach_client_engagements").delete().eq("name", PKG_NAME)
  await sb.from("coach_packages").delete().eq("name", PKG_NAME)
  await sb.from("coach_milestones").delete().eq("name", DELIV_NAME)
  await sb.from("coach_clients").delete().eq("name", MARKER_REL)
}
// Flatten activity names / objects across an /api/me/activities response.
const actNamesOf = (j) => (j?.groups || []).flatMap((g) => (g.activities || []).map((a) => a.name))
const actObjsOf = (j) => (j?.groups || []).flatMap((g) => g.activities || [])

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} A=${CLIENT_A_EMAIL} B=${CLIENT_B_EMAIL} coach=${COACH_EMAIL}`)

  const coachId = await resolveProfileId(COACH_EMAIL)
  const aId = await resolveProfileId(CLIENT_A_EMAIL)
  const bId = await resolveProfileId(CLIENT_B_EMAIL)
  const cId = await resolveProfileId(CLIENT_C_EMAIL)
  if (new Set([aId, bId, cId]).size !== 3) abort("A, B, C must be distinct client profiles")

  await cleanup()
  const coachToken = await getToken(COACH_EMAIL)
  const aToken = await getToken(CLIENT_A_EMAIL)
  const bToken = await getToken(CLIENT_B_EMAIL)
  const cToken = await getToken(CLIENT_C_EMAIL)

  // ── Setup: catalog deliverable + mixed-owner activities → package → attach ──
  console.log("\nSetup: coach builds a mixed-owner package and attaches it to A")
  const mk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones`, { name: DELIV_NAME })
  check("create deliverable (milestone) → 201", mk.status === 201, `status ${mk.status} ${JSON.stringify(mk.json).slice(0,140)}`)
  const milestoneId = mk.json?.milestone?.id
  const addAct = async (name, owner) => {
    const r = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones/${milestoneId}/activities`, { name, owner })
    check(`add activity ${name} (${owner}) → 201`, r.status === 201, `status ${r.status} ${JSON.stringify(r.json).slice(0,140)}`)
  }
  await addAct(ACT_CLIENT, "client")
  await addAct(ACT_BOTH, "both")
  await addAct(ACT_COACH, "coach")
  const pk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/packages`, { name: PKG_NAME, deliverable_ids: [milestoneId] })
  check("create package → 201", pk.status === 201, `status ${pk.status} ${JSON.stringify(pk.json).slice(0,140)}`)
  const packageId = pk.json?.package?.id

  const relA = await getOrCreateRel(coachId, aId)
  await setRelStatus(relA.id, "active") // ensure active for the main read
  const att = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/coach-clients/${relA.id}/engagements`, { package_id: packageId })
  check("attach package to A's relationship → 201", att.status === 201, `status ${att.status} ${JSON.stringify(att.json).slice(0,160)}`)

  // ── A's read: owned activities grouped by deliverable ──
  console.log("\nA's /api/me/activities — owner filter + grouping")
  const aRes = await http(aToken, "GET", ME)
  check("A GET 200", aRes.status === 200, `status ${aRes.status}`)
  const aNames = actNamesOf(aRes.json)
  check("client-owner activity APPEARS", aNames.includes(ACT_CLIENT))
  check("both-owner activity APPEARS", aNames.includes(ACT_BOTH))
  check("coach-owner activity ABSENT (owner filter)", !aNames.includes(ACT_COACH))
  // Grouped by deliverable: our two owned activities sit under the deliverable name.
  const grp = (aRes.json?.groups || []).find((g) => (g.activities || []).some((a) => a.name === ACT_CLIENT))
  check("grouped by deliverable (group name = deliverable)", grp?.name === DELIV_NAME, grp?.name)
  // Minimal payload — only id/name/status/owner.
  const sample = actObjsOf(aRes.json).find((a) => a.name === ACT_CLIENT) || {}
  const extra = Object.keys(sample).filter((k) => !["id", "name", "status", "owner"].includes(k))
  check("payload minimal (id/name/status/owner only)", extra.length === 0, `extra keys: ${extra.join(",")}`)
  check("status present + valid", ["not_started", "in_progress", "complete"].includes(sample.status), sample.status)

  // ── Cross-client: B does not see A's activities ──
  console.log("\nCross-client isolation (B)")
  const bRes = await http(bToken, "GET", ME)
  check("B GET 200", bRes.status === 200, `status ${bRes.status}`)
  check("B sees none of this run's activities", !actNamesOf(bRes.json).some((n) => [ACT_CLIENT, ACT_BOTH, ACT_COACH].includes(n)))

  // ── Non-coached / no active relationship (C) → ok + empty of this run ──
  console.log("\nNon-coached client (C) → ok, none of this run's activities")
  const cRes = await http(cToken, "GET", ME)
  check("C GET 200 ok", cRes.status === 200 && cRes.json?.ok === true, `status ${cRes.status}`)
  check("C sees none of this run's activities", !actNamesOf(cRes.json).some((n) => [ACT_CLIENT, ACT_BOTH, ACT_COACH].includes(n)))

  // ── Active-only: paused / revoked relationship → empty for A ──
  console.log("\nActive-only gating (paused / revoked → empty)")
  await setRelStatus(relA.id, "paused")
  const aPaused = await http(aToken, "GET", ME)
  check("paused → A sees none of this run's activities", aPaused.status === 200 && !actNamesOf(aPaused.json).some((n) => [ACT_CLIENT, ACT_BOTH].includes(n)))
  await setRelStatus(relA.id, "revoked")
  const aRevoked = await http(aToken, "GET", ME)
  check("revoked → A sees none of this run's activities", aRevoked.status === 200 && !actNamesOf(aRevoked.json).some((n) => [ACT_CLIENT, ACT_BOTH].includes(n)))
  // Restore (only matters for a reused fixture relationship; created ones are deleted).
  if (!relA.created) await setRelStatus(relA.id, relA.prevStatus)

  // ── Auth ──
  console.log("\nAuth")
  check("no bearer → 401", (await http(null, "GET", ME)).status === 401)
  check("invalid bearer → 401", (await http("garbage.token.value", "GET", ME)).status === 401)

  await cleanup()
  console.log("\ncleanup: throwaway engagement + package + milestone + created relationship cleared")
  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
