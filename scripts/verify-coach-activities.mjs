// scripts/verify-coach-activities.mjs
//
// Smoke test for the Deliverable Activities API against a DEPLOYED environment
// (default: staging → DEV Supabase). Exercises:
//   create → patch → reorder (sort_order) → delete on the coach's own
//   deliverable; GET /milestones/[id] returns activities ordered by sort_order;
//   GET /milestones list shows activity_count; owner validation (400); PLUS
//   cross-coach isolation — coach B cannot create/patch/delete an activity on
//   coach A's deliverable (404), and cannot patch coach A's activity by passing
//   B's OWN deliverable id in the path (404).
//
// Auth: signs in each coach via supabase-js (email+password) to mint a real
// access_token, then calls the API with `Authorization: Bearer <token>`.
//
// Required env (no secrets hardcoded):
//   BASE_URL                 default https://wrnsignal-api-staging.vercel.app
//   SUPABASE_URL             the Supabase project the BASE_URL deploy uses (dev)
//   SUPABASE_ANON_KEY        anon key for that project (for password sign-in)
//   COACH_A_EMAIL / COACH_A_PASSWORD
//   COACH_B_EMAIL / COACH_B_PASSWORD
// Optional cleanup:
//   SUPABASE_SERVICE_ROLE_KEY  if set, test deliverables are removed at the end
//                              (activities cascade via the FK).
//
// Run (this machine needs system CA for Supabase TLS):
//   NODE_OPTIONS=--use-system-ca \
//   BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   COACH_A_EMAIL=... COACH_A_PASSWORD=... COACH_B_EMAIL=... COACH_B_PASSWORD=... \
//   node scripts/verify-coach-activities.mjs

import { createClient } from "@supabase/supabase-js"

const BASE_URL = (process.env.BASE_URL || "https://wrnsignal-api-staging.vercel.app").replace(/\/$/, "")
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const A = { email: process.env.COACH_A_EMAIL, password: process.env.COACH_A_PASSWORD }
const B = { email: process.env.COACH_B_EMAIL, password: process.env.COACH_B_PASSWORD }

function need(label, v) {
  if (!v) { console.error(`MISSING env: ${label}`); process.exit(2) }
  return v
}
need("SUPABASE_URL", SUPABASE_URL)
need("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
need("COACH_A_EMAIL", A.email); need("COACH_A_PASSWORD", A.password)
need("COACH_B_EMAIL", B.email); need("COACH_B_PASSWORD", B.password)

let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++ }

async function signIn(who, creds) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error || !data?.session?.access_token) {
    console.error(`Sign-in failed for ${who} (${creds.email}): ${error?.message || "no session"}`)
    process.exit(2)
  }
  return data.session.access_token
}

// path = full sub-path under /api/coach (e.g. "/milestones", "/milestones/<id>/activities").
async function api(method, token, path, body) {
  const res = await fetch(`${BASE_URL}/api/coach${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

console.log(`Target: ${BASE_URL}`)
console.log(`Supabase: ${SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1] ?? SUPABASE_URL}\n`)

const tokenA = await signIn("Coach A", A)
const tokenB = await signIn("Coach B", B)

const created = { milestonesA: [], milestonesB: [] }
const stamp = Date.now()

async function makeDeliverable(token, bucket, who) {
  const r = await api("POST", token, "/milestones", { name: `__verify_throwaway___act_${who}_${stamp}` })
  if (r.status !== 201 || !r.json?.milestone?.id) {
    console.error(`setup: deliverable create failed (${r.status}): ${JSON.stringify(r.json)}`); process.exit(2)
  }
  bucket.push(r.json.milestone.id)
  return r.json.milestone.id
}

// Coach A's deliverable (the one under test) + Coach B's own deliverable (for isolation).
const D = await makeDeliverable(tokenA, created.milestonesA, "A")
const DB = await makeDeliverable(tokenB, created.milestonesB, "B")

// ── 1. Create two activities (sort_order auto-assigned 1, then 2) ──
const c1 = await api("POST", tokenA, `/milestones/${D}/activities`, { name: "Kickoff", owner: "coach" })
ok(c1.status === 201 && c1.json?.activity?.id, `POST activity → 201 (got ${c1.status})`)
const A1 = c1.json?.activity?.id
ok(c1.json?.activity?.sort_order === 1, `first activity sort_order auto = 1 (got ${c1.json?.activity?.sort_order})`)
ok(c1.json?.activity?.owner === "coach", "create owner = coach")
const c2 = await api("POST", tokenA, `/milestones/${D}/activities`, { name: "Review", owner: "client" })
ok(c2.status === 201, `POST 2nd activity → 201 (got ${c2.status})`)
const A2 = c2.json?.activity?.id
ok(c2.json?.activity?.sort_order === 2, `second activity sort_order auto = 2 (got ${c2.json?.activity?.sort_order})`)

// ── 2. owner validation: 'manager' rejected at the edge (400, not 500) ──
const badCreate = await api("POST", tokenA, `/milestones/${D}/activities`, { name: "Bad", owner: "manager" })
ok(badCreate.status === 400, `POST owner=manager → 400 (got ${badCreate.status})`)
const badPatch = await api("PATCH", tokenA, `/milestones/${D}/activities/${A1}`, { owner: "manager" })
ok(badPatch.status === 400, `PATCH owner=manager → 400 (got ${badPatch.status})`)

// ── 3. Patch fields (name + owner) ──
const p1 = await api("PATCH", tokenA, `/milestones/${D}/activities/${A1}`, { name: "Kickoff call", owner: "both" })
ok(p1.status === 200 && p1.json?.activity?.name === "Kickoff call" && p1.json?.activity?.owner === "both",
   `PATCH updates name+owner (got ${p1.json?.activity?.name} / ${p1.json?.activity?.owner})`)

// ── 4. Reorder via sort_order (A1→5, A2→1) ──
await api("PATCH", tokenA, `/milestones/${D}/activities/${A1}`, { sort_order: 5 })
await api("PATCH", tokenA, `/milestones/${D}/activities/${A2}`, { sort_order: 1 })

// ── 5. GET deliverable → activities ordered by sort_order ──
const getD = await api("GET", tokenA, `/milestones/${D}`)
ok(getD.status === 200 && Array.isArray(getD.json?.milestone?.activities), `GET /milestones/[id] returns activities[] (got ${getD.status})`)
const acts = getD.json?.milestone?.activities || []
ok(acts.length === 2, `deliverable has 2 activities (got ${acts.length})`)
ok(acts[0]?.id === A2 && acts[1]?.id === A1, "activities ordered by sort_order (A2 then A1 after reorder)")
ok(acts.every((a) => typeof a.owner === "string"), "each activity carries name/owner/sort_order")

// ── 6. List shows activity_count (lean — count only, no array) ──
const list = await api("GET", tokenA, "/milestones")
const row = (list.json?.milestones || []).find((m) => m.id === D)
ok(row?.activity_count === 2, `list activity_count === 2 (got ${row?.activity_count})`)
ok(row?.activities === undefined, "list does NOT embed the full activities array (lean)")

// ── 7. Cross-coach isolation ──
// B creates on A's deliverable → 404 (parent not owned).
ok((await api("POST", tokenB, `/milestones/${D}/activities`, { name: "x", owner: "coach" })).status === 404,
   "Coach B create activity on A's deliverable → 404")
// B patches A's activity (correct path) → 404.
ok((await api("PATCH", tokenB, `/milestones/${D}/activities/${A1}`, { name: "hijack" })).status === 404,
   "Coach B PATCH A's activity → 404")
// B deletes A's activity → 404.
ok((await api("DELETE", tokenB, `/milestones/${D}/activities/${A1}`)).status === 404,
   "Coach B DELETE A's activity → 404")
// The critical one: B patches A's activity by pairing it with B's OWN deliverable id.
const crossPair = await api("PATCH", tokenB, `/milestones/${DB}/activities/${A1}`, { name: "hijack-via-own-deliverable" })
ok(crossPair.status === 404, `Coach B PATCH A's activity via B's own deliverable id → 404 (got ${crossPair.status})`)
// Confirm A1 is untouched by all of B's attempts.
const reread = await api("GET", tokenA, `/milestones/${D}`)
const a1now = (reread.json?.milestone?.activities || []).find((a) => a.id === A1)
ok(a1now?.name === "Kickoff call", "A's activity unchanged after Coach B's blocked writes")

// ── 8. Delete one activity (owner's own) ──
const del = await api("DELETE", tokenA, `/milestones/${D}/activities/${A2}`)
ok(del.status === 200 && del.json?.deleted === A2, `DELETE activity → 200 { deleted } (got ${del.status})`)
const after = await api("GET", tokenA, `/milestones/${D}`)
ok((after.json?.milestone?.activities || []).length === 1, "deliverable has 1 activity after delete")
ok((await api("DELETE", tokenA, `/milestones/${D}/activities/${A2}`)).status === 404, "DELETE already-deleted activity → 404")

// ── Cleanup (deleting deliverables cascades their activities) ──
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  for (const id of [...created.milestonesA, ...created.milestonesB]) await admin.from("coach_milestones").delete().eq("id", id)
  console.log("\nCleanup: removed test deliverables (activities cascaded) via service role")
} else {
  console.log(`\nNo SUPABASE_SERVICE_ROLE_KEY — clean up manually: deliverables=${JSON.stringify([...created.milestonesA, ...created.milestonesB])}`)
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
