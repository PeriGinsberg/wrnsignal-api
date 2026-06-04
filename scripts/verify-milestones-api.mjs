// scripts/verify-milestones-api.mjs
//
// Smoke test for the Coach Deliverables (milestones) API. Runs against a
// DEPLOYED environment (default: staging, which is wired to DEV Supabase).
// Covers list/create AND per-row edit/delete with cross-coach isolation:
//   1. Coach A POST → 201, response omits coach_profile_id.
//   2. Coach A GET lists it.
//   3. Coach B GET does NOT see it (read isolation).
//   4. Coach A PATCH (rename + active:false) → 200; GET shows the change.
//   5. Coach B PATCH on Coach A's id → 404 (write isolation).
//   6. Coach B DELETE on Coach A's id → 404 (write isolation).
//   7. Coach A DELETE → 200 { deleted }; GET confirms it's gone.
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
//   SUPABASE_SERVICE_ROLE_KEY  if set, any straggler test row is deleted at the end.
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

// path = "" for the collection, or "/<id>" for a single row.
async function api(method, token, path, body) {
  const res = await fetch(`${BASE_URL}/api/coach/milestones${path}`, {
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

// 1. Coach A creates a milestone (unique name so assertions are unambiguous).
const testName = `__verify_milestone_${Date.now()}`
const created = await api("POST", tokenA, "", { name: testName, description: "verify-script row", category: "test" })
ok(created.status === 201, `POST returns 201 (got ${created.status})`)
ok(created.json?.ok === true && created.json?.milestone?.id, "POST returns { ok, milestone.id }")
const id = created.json?.milestone?.id
ok(created.json?.milestone?.name === testName, "created milestone name matches")
ok(created.json?.milestone?.coach_profile_id === undefined, "POST response omits coach_profile_id (mapper)")

// 2. Coach A lists and sees it.
let listA = await api("GET", tokenA, "")
ok(listA.status === 200 && listA.json?.ok === true, `Coach A GET 200 ok (got ${listA.status})`)
ok((listA.json?.milestones || []).some((m) => m.id === id), "Coach A sees the created milestone")

// 3. Coach B must NOT see it (read isolation).
const listB = await api("GET", tokenB, "")
ok(listB.status === 200 && listB.json?.ok === true, `Coach B GET 200 ok (got ${listB.status})`)
ok(!(listB.json?.milestones || []).some((m) => m.id === id), "Coach B does NOT see Coach A's milestone (read isolation)")

// 4. Coach A PATCH — rename + deactivate; GET reflects it.
const newName = `${testName}_edited`
const patched = await api("PATCH", tokenA, `/${id}`, { name: newName, active: false })
ok(patched.status === 200 && patched.json?.ok === true, `Coach A PATCH 200 ok (got ${patched.status})`)
ok(patched.json?.milestone?.name === newName, "PATCH updated name")
ok(patched.json?.milestone?.active === false, "PATCH set active=false")
ok(patched.json?.milestone?.coach_profile_id === undefined, "PATCH response omits coach_profile_id (mapper)")
listA = await api("GET", tokenA, "")
const aRow = (listA.json?.milestones || []).find((m) => m.id === id)
ok(!!aRow && aRow.name === newName && aRow.active === false, "Coach A GET reflects the edit")

// 5. Coach B PATCH on Coach A's id → 404 (write isolation).
const patchB = await api("PATCH", tokenB, `/${id}`, { name: "hijacked" })
ok(patchB.status === 404, `Coach B PATCH on A's id → 404 (got ${patchB.status})`)

// 6. Coach B DELETE on Coach A's id → 404 (write isolation).
const delB = await api("DELETE", tokenB, `/${id}`)
ok(delB.status === 404, `Coach B DELETE on A's id → 404 (got ${delB.status})`)

// 6b. Confirm B's failed write/delete didn't touch the row.
listA = await api("GET", tokenA, "")
ok((listA.json?.milestones || []).some((m) => m.id === id && m.name === newName),
   "Row intact after Coach B's blocked write/delete")

// 7. Coach A DELETE → 200; GET confirms gone.
const delA = await api("DELETE", tokenA, `/${id}`)
ok(delA.status === 200 && delA.json?.ok === true && delA.json?.deleted === id,
   `Coach A DELETE → 200 { deleted } (got ${delA.status})`)
listA = await api("GET", tokenA, "")
ok(!(listA.json?.milestones || []).some((m) => m.id === id), "Coach A GET confirms milestone is gone")

// Cleanup — Coach A's DELETE should have removed it; service-role nukes any
// straggler (e.g. if a check failed mid-run).
if (id && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { error } = await admin.from("coach_milestones").delete().eq("id", id)
  console.log(error ? `\nCleanup note: ${error.message}` : `\nCleanup: ensured test row ${id} is gone`)
} else if (id) {
  console.log(`\nNo SUPABASE_SERVICE_ROLE_KEY set — if any check failed, delete straggler id=${id} manually.`)
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
