#!/usr/bin/env node
// Verification for the activity-note PRIVACY WALL on the client read.
// The load-bearing guarantee: GET /api/me/activities surfaces ONLY notes with
// visible_to_client = true (and not deleted). A coach-private note NEVER reaches
// the client; flipping a note visible→false removes it from the client read.
//
// A coach attaches a package with a CLIENT-owned activity to client A's active
// relationship, then as the coach creates two notes on that activity:
//   - one PRIVATE (default visible_to_client = false)
//   - one VISIBLE (visible_to_client = true, action_required = true)
// As client A (GET /api/me/activities):
//   - the activity shows EXACTLY the visible note (body + action_required carried)
//   - the private note is ABSENT
// Then the coach flips the visible note → private (PUT visible_to_client:false):
//   - client read no longer shows it
// Flip back → it reappears.
//
// SAFETY: dev-ref guard (aborts on prod). Sign-in-able fixture coach + client A.
// Marker cleanup (engagement snapshot name = package name); notes cascade with the
// engagement. Checks scoped to this run.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   CLIENT_A_EMAIL=alex+test@example.com \
//   ENDPOINT_BASE=https://wrnsignal-api-staging.vercel.app \
//   node scripts/verify-activity-notes-privacy.mjs

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
const MARKER_REL = "__verify_notepriv_rel__"
const DELIV_NAME = "__notepriv_deliv__"
const PKG_NAME = "__notepriv_pkg__"
const ACT_CLIENT = "__notepriv_client__"
const TAG = "[verify-activity-notes-privacy]"

function abort(msg) { console.error(`✗ ${msg}`); process.exit(1) }
if (!SUPABASE_URL) abort("SUPABASE_URL is required")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL is PROD (${PROD_REF}). Dev only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must be dev (${DEV_REF}).`)
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
async function cleanup() {
  await sb.from("coach_client_engagements").delete().eq("name", PKG_NAME) // cascades activities + notes
  await sb.from("coach_packages").delete().eq("name", PKG_NAME)
  await sb.from("coach_milestones").delete().eq("name", DELIV_NAME)
  await sb.from("coach_clients").delete().eq("name", MARKER_REL)
}
const findAct = (engagement, name) =>
  (engagement?.deliverables || []).flatMap((d) => d.activities || []).find((a) => a.name === name)
// Find an activity (by id) in the client /api/me/activities response.
const meActivity = (meJson, id) =>
  (meJson?.groups || []).flatMap((g) => g.activities || []).find((a) => a.id === id)

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} A=${CLIENT_A_EMAIL} coach=${COACH_EMAIL}`)

  const coachId = await resolveProfileId(COACH_EMAIL)
  const aId = await resolveProfileId(CLIENT_A_EMAIL)

  await cleanup()
  const coachToken = await getToken(COACH_EMAIL)
  const aToken = await getToken(CLIENT_A_EMAIL)

  // ── Setup: client-owned activity attached to A's active relationship ──
  console.log("\nSetup: client-owned activity on A's active relationship")
  const mk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones`, { name: DELIV_NAME })
  check("create deliverable → 201", mk.status === 201, `status ${mk.status}`)
  const milestoneId = mk.json?.milestone?.id
  const am = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/milestones/${milestoneId}/activities`, { name: ACT_CLIENT, owner: "client" })
  check("add client-owned activity → 201", am.status === 201, `status ${am.status}`)
  const pk = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/packages`, { name: PKG_NAME, deliverable_ids: [milestoneId] })
  check("create package → 201", pk.status === 201, `status ${pk.status}`)
  const packageId = pk.json?.package?.id

  const relA = await getOrCreateRel(coachId, aId)
  await setRelStatus(relA.id, "active")
  const att = await http(coachToken, "POST", `${ENDPOINT_BASE}/api/coach/coach-clients/${relA.id}/engagements`, { package_id: packageId })
  check("attach to A → 201", att.status === 201, `status ${att.status} ${JSON.stringify(att.json).slice(0, 140)}`)
  const E = att.json?.engagement?.id
  const actId = findAct(att.json?.engagement, ACT_CLIENT)?.id
  check("captured engagement + activity id", !!(E && actId), `E=${E} actId=${actId}`)
  const notesBase = `${ENDPOINT_BASE}/api/coach/coach-clients/${relA.id}/engagements/${E}/activities/${actId}/notes`

  // ── Coach creates one PRIVATE + one VISIBLE note ──
  console.log("\nCoach creates a private note and a visible note")
  const priv = await http(coachToken, "POST", notesBase, { body: "PRIVATE note" })
  check("private note → 201, defaults visible=false", priv.status === 201 && priv.json?.note?.visible_to_client === false, `status ${priv.status}`)
  const Npriv = priv.json?.note?.id
  const vis = await http(coachToken, "POST", notesBase, { body: "VISIBLE note", visible_to_client: true, action_required: true })
  check("visible note → 201, visible=true action=true", vis.status === 201 && vis.json?.note?.visible_to_client === true && vis.json?.note?.action_required === true, `status ${vis.status}`)
  const Nvis = vis.json?.note?.id

  // ── PRIVACY WALL: client read shows ONLY the visible note ──
  console.log("\nClient read: ONLY the visible note (private absent)")
  let me = await http(aToken, "GET", ME)
  let act = meActivity(me.json, actId)
  const clientNotes = act?.notes || []
  check("client sees exactly one note on the activity", clientNotes.length === 1, `count ${clientNotes.length}`)
  check("the one note is the VISIBLE note", clientNotes[0]?.id === Nvis && clientNotes[0]?.body === "VISIBLE note", JSON.stringify(clientNotes[0]))
  check("client note carries action_required", clientNotes[0]?.action_required === true)
  check("PRIVATE note is ABSENT from client read", !clientNotes.some((n) => n.id === Npriv || n.body === "PRIVATE note"))

  // ── Flip the visible note → private: it must DISAPPEAR from the client read ──
  console.log("\nToggle visible→false: note disappears from client read")
  const hide = await http(coachToken, "PUT", `${notesBase}/${Nvis}`, { visible_to_client: false })
  check("PUT visible_to_client=false → 200", hide.status === 200, `status ${hide.status}`)
  me = await http(aToken, "GET", ME)
  act = meActivity(me.json, actId)
  check("client read now shows ZERO notes (both private)", (act?.notes || []).length === 0, `count ${(act?.notes || []).length}`)

  // ── Flip back → reappears ──
  console.log("\nToggle visible→true: note reappears")
  const show = await http(coachToken, "PUT", `${notesBase}/${Nvis}`, { visible_to_client: true })
  check("PUT visible_to_client=true → 200", show.status === 200, `status ${show.status}`)
  me = await http(aToken, "GET", ME)
  act = meActivity(me.json, actId)
  check("client read shows the note again", (act?.notes || []).some((n) => n.id === Nvis))

  if (!relA.created) await setRelStatus(relA.id, relA.prevStatus)
  await cleanup()
  console.log("\ncleanup: engagement (+ activities + notes cascaded) + package + milestone + created relationship cleared")
  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
