// scripts/verify-milestones-api.mjs
//
// Smoke test for the Coach Deliverables (milestones) API. Runs against a
// DEPLOYED environment (default: staging). Verifies:
//   1. Coach A can create a milestone (POST 201).
//   2. Coach A sees it in their list (GET).
//   3. Coach B does NOT see it (server-side coach_profile_id scoping).
//
// ── IMPORTANT ENV CAVEAT ──────────────────────────────────────────────────
// coach_milestones currently exists on DEV Supabase only. The staging deploy
// (wrnsignal-api-staging) builds with PROD Supabase env, so pointing this at
// staging will hit PROD — where the table may not exist yet (and the two coach
// accounts must exist there). Point BASE_URL + SUPABASE_URL/anon at whichever
// environment actually has the table + the two coach accounts. The route reads
// the bearer token's user → client_profiles → is_coach, so the two accounts
// must be is_coach=true in that same Supabase project.
//
// Auth: signs in each coach via supabase-js (email+password) to mint a real
// access_token, then calls the API with `Authorization: Bearer <token>`.
//
// Required env (no secrets hardcoded):
//   BASE_URL                 default https://wrnsignal-api-staging.vercel.app
//   SUPABASE_URL             the Supabase project the BASE_URL deploy uses
//   SUPABASE_ANON_KEY        anon key for that project (for password sign-in)
//   COACH_A_EMAIL / COACH_A_PASSWORD
//   COACH_B_EMAIL / COACH_B_PASSWORD
// Optional cleanup:
//   SUPABASE_SERVICE_ROLE_KEY  if set, the created test row is deleted at the end.
//
// Run (this machine needs system CA for Supabase TLS):
//   NODE_OPTIONS=--use-system-ca \
//   BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   COACH_A_EMAIL=... COACH_A_PASSWORD=... COACH_B_EMAIL=... COACH_B_PASSWORD=... \
//   node scripts/verify-milestones-api.mjs

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

async function api(method, token, body) {
  const res = await fetch(`${BASE_URL}/api/coach/milestones`, {
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

// 1. Coach A creates a milestone (unique name so the assertion is unambiguous).
const testName = `__verify_milestone_${Date.now()}`
const created = await api("POST", tokenA, { name: testName, description: "verify-script row", category: "test" })
ok(created.status === 201, `POST returns 201 (got ${created.status})`)
ok(created.json?.ok === true && created.json?.milestone?.id, "POST returns { ok, milestone.id }")
const createdId = created.json?.milestone?.id
ok(created.json?.milestone?.name === testName, "created milestone name matches")
ok(typeof created.json?.milestone?.sort_order === "number", "created milestone has numeric sort_order")
ok(created.json?.milestone?.coach_profile_id === undefined, "POST response omits coach_profile_id (mapper)")

// 2. Coach A lists and sees it.
const listA = await api("GET", tokenA)
ok(listA.status === 200 && listA.json?.ok === true, `Coach A GET 200 ok (got ${listA.status})`)
const aHasIt = Array.isArray(listA.json?.milestones) && listA.json.milestones.some((m) => m.id === createdId)
ok(aHasIt, "Coach A sees the created milestone in their list")

// 3. Coach B must NOT see it (cross-coach isolation).
const listB = await api("GET", tokenB)
ok(listB.status === 200 && listB.json?.ok === true, `Coach B GET 200 ok (got ${listB.status})`)
const bHasIt = Array.isArray(listB.json?.milestones) && listB.json.milestones.some((m) => m.id === createdId)
ok(!bHasIt, "Coach B does NOT see Coach A's milestone")

// Optional cleanup (no DELETE endpoint yet → use service role if provided).
if (createdId && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { error } = await admin.from("coach_milestones").delete().eq("id", createdId)
  console.log(error ? `\nCleanup FAILED (manual delete needed, id=${createdId}): ${error.message}`
                    : `\nCleanup: deleted test row ${createdId}`)
} else if (createdId) {
  console.log(`\nNo SUPABASE_SERVICE_ROLE_KEY set — test row left behind: id=${createdId} (name=${testName}). Delete manually.`)
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
