// scripts/verify-coach-client-events.mjs
//
// Smoke test for the Client Event Log — the best-effort logger
// (logCoachClientEvent) + the read API (GET /coach-clients/[id]/events).
//
// This script imports and calls the ACTUAL helper, so it must run under tsx
// (node can't import the .ts helper). The helper writes via its own service-role
// admin client (process.env.SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY); the GET
// hits the deployed API (BASE_URL → staging → the same dev Supabase). Both
// operate on the same project, so helper-written events are read back via the API.
//
// Required env:
//   BASE_URL                   default https://wrnsignal-api-staging.vercel.app
//   SUPABASE_URL               dev project (also what the helper writes to)
//   SUPABASE_ANON_KEY          anon key (password sign-in)
//   SUPABASE_SERVICE_ROLE_KEY  REQUIRED (helper writes + seed/cleanup of coach_clients)
//   COACH_A_EMAIL / COACH_A_PASSWORD
//   COACH_B_EMAIL / COACH_B_PASSWORD
//
// Run (note: tsx, not node):
//   NODE_OPTIONS=--use-system-ca \
//   BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   COACH_A_EMAIL=... COACH_A_PASSWORD=... COACH_B_EMAIL=... COACH_B_PASSWORD=... \
//   npx tsx scripts/verify-coach-client-events.mjs

import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { logCoachClientEvent } from "../app/api/_lib/coachClientEvents"

const BASE_URL = (process.env.BASE_URL || "https://wrnsignal-api-staging.vercel.app").replace(/\/$/, "")
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const A = { email: process.env.COACH_A_EMAIL, password: process.env.COACH_A_PASSWORD }
const B = { email: process.env.COACH_B_EMAIL, password: process.env.COACH_B_PASSWORD }

function need(label, v) { if (!v) { console.error(`MISSING env: ${label}`); process.exit(2) } return v }
need("SUPABASE_URL", SUPABASE_URL)
need("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
need("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
need("COACH_A_EMAIL", A.email); need("COACH_A_PASSWORD", A.password)
need("COACH_B_EMAIL", B.email); need("COACH_B_PASSWORD", B.password)

let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function signIn(who, creds) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error || !data?.session?.access_token) { console.error(`Sign-in failed for ${who}: ${error?.message || "no session"}`); process.exit(2) }
  return data.session.access_token
}
async function profileIdFor(email) {
  const { data, error } = await admin.from("client_profiles").select("id").eq("email", email.trim().toLowerCase()).maybeSingle()
  if (error || !data?.id) { console.error(`Could not resolve client_profiles.id for ${email}`); process.exit(2) }
  return data.id
}
async function seedCoachClient(coachProfileId) {
  const { data, error } = await admin.from("coach_clients").insert({ coach_profile_id: coachProfileId, name: "__verify_throwaway__" }).select("id").single()
  if (error || !data?.id) { console.error(`Seed coach_clients failed: ${error?.message}`); process.exit(2) }
  return data.id
}
async function api(method, token, path) {
  const res = await fetch(`${BASE_URL}/api/coach${path}`, { method, headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

console.log(`Target: ${BASE_URL}`)
console.log(`Supabase: ${SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1] ?? SUPABASE_URL}\n`)

const tokenA = await signIn("Coach A", A)
const tokenB = await signIn("Coach B", B)
const profileA = await profileIdFor(A.email)
const profileB = await profileIdFor(B.email)
const ccA = await seedCoachClient(profileA)
const ccB = await seedCoachClient(profileB)

// ── 1. KEY: best-effort proof — a bad coach_client_id (FK violation) must NOT throw ──
let threw = false
try {
  await logCoachClientEvent({ coachClientId: randomUUID(), eventType: "prospect_created", context: { name: "__verify_throwaway__" } })
} catch {
  threw = true
}
ok(!threw, "helper with FK-violating coach_client_id RESOLVES (does not throw) — failure swallowed")

// ── 2. Helper inserts real events on A's relationship (two, spaced for ordering) ──
await logCoachClientEvent({ coachClientId: ccA, eventType: "prospect_created", actorProfileId: profileA, context: { name: "__verify_throwaway__" } })
await sleep(1100) // guarantee a distinct created_at for the newest-first assertion
await logCoachClientEvent({ coachClientId: ccA, eventType: "invite_sent", actorProfileId: profileA })

// ── 3. GET via API returns them, newest first ──
const list = await api("GET", tokenA, `/coach-clients/${ccA}/events`)
ok(list.status === 200 && list.json?.ok === true, `GET events → 200 (got ${list.status})`)
const evs = list.json?.events || []
ok(evs.length === 2, `2 events returned (got ${evs.length})`)
ok(evs[0]?.event_type === "invite_sent" && evs[1]?.event_type === "prospect_created", "events newest-first (created_at DESC)")
ok(evs.some((e) => e.event_type === "prospect_created" && e.context?.name === "__verify_throwaway__"), "helper-inserted event present with jsonb context")
ok(evs[1]?.actor_profile_id === profileA, "actor_profile_id returned")
ok(evs.every((e) => e.id === undefined && e.coach_client_id === undefined), "mapper returns only event_type/actor/context/created_at (no id / coach_client_id)")

// ── 4. Cross-coach isolation ──
// B GET A's events → 404 (relationship not owned by B).
ok((await api("GET", tokenB, `/coach-clients/${ccA}/events`)).status === 404, "Coach B GET A's events → 404")
// NOTE: the events route is keyed by a single id (no nested resource), so "B via
// B's own coach_client id" is a legitimate 200 — but scoped to B's own events,
// so A's events never appear there. Proven below (200 + empty, no leak).
const bOwn = await api("GET", tokenB, `/coach-clients/${ccB}/events`)
ok(bOwn.status === 200 && (bOwn.json?.events || []).length === 0,
   "Coach B GET own relationship → 200 with 0 events (A's events never leak under B's id)")

// ── Cleanup (deleting coach_clients cascades coach_client_events) ──
for (const id of [ccA, ccB]) await admin.from("coach_clients").delete().eq("id", id)
console.log("\nCleanup: removed throwaway coach_clients (events cascaded) via service role")

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
