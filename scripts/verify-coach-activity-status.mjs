// scripts/verify-coach-activity-status.mjs
//
// Smoke for engagement activity status tracking:
//   PATCH /api/coach/coach-clients/[id]/engagements/[engagement_id]/activities/[activity_id]
// Asserts status transitions persist, invalid → 400, the activity_completed event
// fires exactly once on the transition INTO complete (de-duped), siblings are
// untouched, and the DEEP cross-coach guard holds (B can't PATCH A's activity even
// by pairing it with B's own engagement + relationship).
//
// Seeds throwaway coach_clients via the service role (no API creates a bare
// relationship); builds catalog packages through the real API as the coaches.
//
// Required env:
//   BASE_URL  default https://wrnsignal-api-staging.vercel.app
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (dev)
//   COACH_A_EMAIL / COACH_A_PASSWORD ; COACH_B_EMAIL / COACH_B_PASSWORD
//
// Run (plain node):
//   NODE_OPTIONS=--use-system-ca BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... COACH_A_EMAIL=... COACH_A_PASSWORD=... \
//   COACH_B_EMAIL=... COACH_B_PASSWORD=... node scripts/verify-coach-activity-status.mjs

import { createClient } from "@supabase/supabase-js"

const BASE_URL = (process.env.BASE_URL || "https://wrnsignal-api-staging.vercel.app").replace(/\/$/, "")
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const A = { email: process.env.COACH_A_EMAIL, password: process.env.COACH_A_PASSWORD }
const B = { email: process.env.COACH_B_EMAIL, password: process.env.COACH_B_PASSWORD }

function need(label, v) { if (!v) { console.error(`MISSING env: ${label}`); process.exit(2) } return v }
need("SUPABASE_URL", SUPABASE_URL); need("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
need("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
need("COACH_A_EMAIL", A.email); need("COACH_A_PASSWORD", A.password)
need("COACH_B_EMAIL", B.email); need("COACH_B_PASSWORD", B.password)

let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++ }
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function signIn(who, creds) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error || !data?.session?.access_token) { console.error(`Sign-in failed for ${who}: ${error?.message || "no session"}`); process.exit(2) }
  return data.session.access_token
}
async function profileIdFor(email) {
  const { data } = await admin.from("client_profiles").select("id").eq("email", email.trim().toLowerCase()).maybeSingle()
  if (!data?.id) { console.error(`No client_profiles.id for ${email}`); process.exit(2) }
  return data.id
}
async function seedCoachClient(coachProfileId) {
  const { data, error } = await admin.from("coach_clients").insert({ coach_profile_id: coachProfileId, name: "__verify_throwaway__" }).select("id").single()
  if (error || !data?.id) { console.error(`Seed coach_clients failed: ${error?.message}`); process.exit(2) }
  return data.id
}
async function api(method, token, path, body) {
  const res = await fetch(`${BASE_URL}/api/coach${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
async function completedCount(token, cc) {
  const r = await api("GET", token, `/coach-clients/${cc}/events`)
  return (r.json?.events || []).filter((e) => e.event_type === "activity_completed")
}

console.log(`Target: ${BASE_URL}`)
console.log(`Supabase: ${SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1] ?? SUPABASE_URL}\n`)

const tokenA = await signIn("Coach A", A)
const tokenB = await signIn("Coach B", B)
const profileA = await profileIdFor(A.email)
const profileB = await profileIdFor(B.email)
const ccA = await seedCoachClient(profileA)
const ccB = await seedCoachClient(profileB)
const stamp = Date.now()
const cleanup = { milestones: [], packages: [], coachClients: [ccA, ccB] }

async function makeMilestoneWithActivity(token, mName, actName) {
  const m = await api("POST", token, "/milestones", { name: mName, fee: 100 })
  if (m.status !== 201 || !m.json?.milestone?.id) { console.error(`milestone create failed (${m.status})`); process.exit(2) }
  const mid = m.json.milestone.id; cleanup.milestones.push(mid)
  const a = await api("POST", token, `/milestones/${mid}/activities`, { name: actName, owner: "coach" })
  if (a.status !== 201) { console.error(`activity create failed (${a.status})`); process.exit(2) }
  return mid
}
async function makePackage(token, name, deliverableIds) {
  const p = await api("POST", token, "/packages", { name, deliverable_ids: deliverableIds })
  if (p.status !== 201 || !p.json?.package?.id) { console.error(`package create failed (${p.status})`); process.exit(2) }
  cleanup.packages.push(p.json.package.id)
  return p.json.package.id
}

// ── Coach A: two deliverables (each with one activity) → a package → attach ──
const M1 = await makeMilestoneWithActivity(tokenA, `__verify_throwaway___as_M1_${stamp}`, "Kickoff")
const M2 = await makeMilestoneWithActivity(tokenA, `__verify_throwaway___as_M2_${stamp}`, "Review")
const pkgName = `__verify_throwaway___as_P_${stamp}`
const P = await makePackage(tokenA, pkgName, [M1, M2])
const attach = await api("POST", tokenA, `/coach-clients/${ccA}/engagements`, { package_id: P })
ok(attach.status === 201 && attach.json?.engagement?.id, `attach package → 201 (got ${attach.status})`)
const E = attach.json?.engagement?.id

// Resolve the two snapshot activity ids from the engagement.
const get0 = await api("GET", tokenA, `/coach-clients/${ccA}/engagements/${E}`)
const delivs = get0.json?.engagement?.deliverables || []
const A1 = delivs[0]?.activities?.[0]?.id
const A2 = delivs[1]?.activities?.[0]?.id
ok(!!A1 && !!A2, `engagement has 2 deliverables each with an activity (A1=${!!A1}, A2=${!!A2})`)
ok(delivs[0]?.activities?.[0]?.status === "not_started", "snapshot activity starts not_started")

const actBase = `/coach-clients/${ccA}/engagements/${E}/activities`

// ── status transitions ──
let r = await api("PATCH", tokenA, `${actBase}/${A1}`, { status: "in_progress" })
ok(r.status === 200, `PATCH → in_progress → 200 (got ${r.status})`)
let g = await api("GET", tokenA, `/coach-clients/${ccA}/engagements/${E}`)
ok(g.json?.engagement?.deliverables?.[0]?.activities?.[0]?.status === "in_progress", "GET reflects in_progress")

r = await api("PATCH", tokenA, `${actBase}/${A1}`, { status: "complete" })
ok(r.status === 200, `PATCH → complete → 200 (got ${r.status})`)
g = await api("GET", tokenA, `/coach-clients/${ccA}/engagements/${E}`)
ok(g.json?.engagement?.deliverables?.[0]?.activities?.[0]?.status === "complete", "GET reflects complete")
ok(g.json?.engagement?.deliverables?.[1]?.activities?.[0]?.status === "not_started", "sibling activity unchanged (still not_started)")

// event: exactly one activity_completed, with context
let evs = await completedCount(tokenA, ccA)
ok(evs.length === 1, `activity_completed logged exactly once (got ${evs.length})`)
ok(evs[0]?.context?.name === "Kickoff" && evs[0]?.context?.engagement_name === pkgName, "event context { name, engagement_name }")

// invalid status
ok((await api("PATCH", tokenA, `${actBase}/${A1}`, { status: "done" })).status === 400, "PATCH status=done → 400")

// re-complete (already complete) → no new event
r = await api("PATCH", tokenA, `${actBase}/${A1}`, { status: "complete" })
ok(r.status === 200, `re-PATCH complete → 200 (got ${r.status})`)
ok((await completedCount(tokenA, ccA)).length === 1, "re-complete logs NO second event (de-dup)")

// → not_started, → in_progress: no event
await api("PATCH", tokenA, `${actBase}/${A1}`, { status: "not_started" })
await api("PATCH", tokenA, `${actBase}/${A1}`, { status: "in_progress" })
ok((await completedCount(tokenA, ccA)).length === 1, "non-complete transitions log NO event")

// ── DEEP cross-coach isolation ──
// B owns nothing on ccA.
ok((await api("PATCH", tokenB, `${actBase}/${A1}`, { status: "complete" })).status === 404, "Coach B PATCH A's activity → 404")
// Build B's own engagement, then attempt the deeper-guard attack: B's own [id]/[engagement_id] + A's activity_id.
const MB = await makeMilestoneWithActivity(tokenB, `__verify_throwaway___as_MB_${stamp}`, "BTask")
const PB = await makePackage(tokenB, `__verify_throwaway___as_PB_${stamp}`, [MB])
const attachB = await api("POST", tokenB, `/coach-clients/${ccB}/engagements`, { package_id: PB })
const EB = attachB.json?.engagement?.id
ok(attachB.status === 201 && !!EB, `setup: Coach B has their own engagement (got ${attachB.status})`)
const deep = await api("PATCH", tokenB, `/coach-clients/${ccB}/engagements/${EB}/activities/${A1}`, { status: "complete" })
ok(deep.status === 404, `DEEP GUARD: B pairing A's activity with B's own engagement/relationship → 404 (got ${deep.status})`)
// And A's activity is still intact (B's attack changed nothing).
ok((await api("GET", tokenA, `/coach-clients/${ccA}/engagements/${E}`)).json?.engagement?.deliverables?.[0]?.activities?.[0]?.status === "in_progress",
   "A's activity unchanged after B's blocked attack")

// ── Cleanup (deleting coach_clients cascades engagements/activities/events) ──
for (const id of cleanup.coachClients) await admin.from("coach_clients").delete().eq("id", id)
for (const id of cleanup.packages) await admin.from("coach_packages").delete().eq("id", id)
for (const id of cleanup.milestones) await admin.from("coach_milestones").delete().eq("id", id)
console.log("\nCleanup: removed throwaway coach_clients (engagements/activities/events cascaded), packages, milestones via service role")

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
