// scripts/verify-coach-engagements.mjs
//
// Smoke test for the Client Engagement API against a DEPLOYED environment
// (default: staging → DEV Supabase). Exercises:
//   attach a package → GET list + single (frozen pricing, clamp, unpriced_count,
//   nested activities w/ status) → DELETE detach; cross-coach isolation; and the
//   FREEZE PROOF at the API layer (attach, edit the catalog package price, re-GET
//   the engagement → pricing unchanged).
//
// Engagements are keyed by coach_clients.id and there is no API to create a bare
// coach_clients row, so this script REQUIRES the service role to seed throwaway
// coach_clients rows (and to clean everything up). Packages/deliverables/
// activities are created through the real coach API as the signed-in coaches.
//
// Required env:
//   BASE_URL                   default https://wrnsignal-api-staging.vercel.app
//   SUPABASE_URL               the project the BASE_URL deploy uses (dev)
//   SUPABASE_ANON_KEY          anon key (password sign-in)
//   SUPABASE_SERVICE_ROLE_KEY  REQUIRED here (seed + cleanup of coach_clients)
//   COACH_A_EMAIL / COACH_A_PASSWORD
//   COACH_B_EMAIL / COACH_B_PASSWORD
//
// Run (this machine needs system CA for Supabase TLS):
//   NODE_OPTIONS=--use-system-ca \
//   BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   COACH_A_EMAIL=... COACH_A_PASSWORD=... COACH_B_EMAIL=... COACH_B_PASSWORD=... \
//   node scripts/verify-coach-engagements.mjs

import { createClient } from "@supabase/supabase-js"

const BASE_URL = (process.env.BASE_URL || "https://wrnsignal-api-staging.vercel.app").replace(/\/$/, "")
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const A = { email: process.env.COACH_A_EMAIL, password: process.env.COACH_A_PASSWORD }
const B = { email: process.env.COACH_B_EMAIL, password: process.env.COACH_B_PASSWORD }

function need(label, v) {
  if (!v) { console.error(`MISSING env: ${label}`); process.exit(2) }
  return v
}
need("SUPABASE_URL", SUPABASE_URL)
need("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY)
need("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY) // required: seed coach_clients rows
need("COACH_A_EMAIL", A.email); need("COACH_A_PASSWORD", A.password)
need("COACH_B_EMAIL", B.email); need("COACH_B_PASSWORD", B.password)

let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++ }
const cents = (dollars) => Math.round((dollars ?? 0) * 100)

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

async function signIn(who, creds) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error || !data?.session?.access_token) {
    console.error(`Sign-in failed for ${who} (${creds.email}): ${error?.message || "no session"}`)
    process.exit(2)
  }
  return data.session.access_token
}

async function profileIdFor(email) {
  const { data, error } = await admin
    .from("client_profiles").select("id").eq("email", email.trim().toLowerCase()).maybeSingle()
  if (error || !data?.id) { console.error(`Could not resolve client_profiles.id for ${email}: ${error?.message || "not found"}`); process.exit(2) }
  return data.id
}

async function seedCoachClient(coachProfileId) {
  const { data, error } = await admin
    .from("coach_clients").insert({ coach_profile_id: coachProfileId, name: "__verify_throwaway__" }).select("id").single()
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

console.log(`Target: ${BASE_URL}`)
console.log(`Supabase: ${SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1] ?? SUPABASE_URL}\n`)

const tokenA = await signIn("Coach A", A)
const tokenB = await signIn("Coach B", B)
const profileA = await profileIdFor(A.email)
const profileB = await profileIdFor(B.email)

const stamp = Date.now()
const created = { coachClients: [], milestonesA: [], milestonesB: [], packagesA: [], packagesB: [] }

// Seed coach_clients rows (no API creates a bare relationship).
const ccA = await seedCoachClient(profileA); created.coachClients.push(ccA)
const ccB = await seedCoachClient(profileB); created.coachClients.push(ccB)

// Helper: create a milestone (optionally with one activity) and return its id.
async function makeMilestone(token, bucket, name, fee) {
  const r = await api("POST", token, "/milestones", { name, fee })
  if (r.status !== 201 || !r.json?.milestone?.id) { console.error(`milestone create failed (${r.status}): ${JSON.stringify(r.json)}`); process.exit(2) }
  bucket.push(r.json.milestone.id)
  return r.json.milestone.id
}
async function makePackage(token, bucket, name, discount, deliverableIds) {
  const r = await api("POST", token, "/packages", { name, discount, deliverable_ids: deliverableIds })
  if (r.status !== 201 || !r.json?.package?.id) { console.error(`package create failed (${r.status}): ${JSON.stringify(r.json)}`); process.exit(2) }
  bucket.push(r.json.package.id)
  return r.json.package.id
}

// ── Coach A catalog: M1 ($150.50 + 1 activity), M2 (unpriced); package PA (discount $25) ──
const M1 = await makeMilestone(tokenA, created.milestonesA, `__verify_throwaway___eng_M1_${stamp}`, 150.5)
const M2 = await makeMilestone(tokenA, created.milestonesA, `__verify_throwaway___eng_M2_${stamp}`, null)
const actCreate = await api("POST", tokenA, `/milestones/${M1}/activities`, { name: "Kickoff", owner: "client" })
ok(actCreate.status === 201, `setup: activity on M1 → 201 (got ${actCreate.status})`)
const PA = await makePackage(tokenA, created.packagesA, `__verify_throwaway___eng_PA_${stamp}`, 25, [M1, M2])

// ── 1. Attach PA to A's relationship ──
const attach = await api("POST", tokenA, `/coach-clients/${ccA}/engagements`, { package_id: PA })
ok(attach.status === 201 && attach.json?.engagement?.id, `POST attach → 201 (got ${attach.status})`)
const E1 = attach.json?.engagement?.id

// ── 2. GET single — frozen pricing + nested activities w/ status ──
let single = await api("GET", tokenA, `/coach-clients/${ccA}/engagements/${E1}`)
ok(single.status === 200, `GET single → 200 (got ${single.status})`)
let pr = single.json?.engagement?.pricing
ok(cents(pr?.subtotal) === cents(150.5), `subtotal === 150.50 (got ${pr?.subtotal})`)
ok(pr?.unpriced_count === 1, `unpriced_count === 1 (got ${pr?.unpriced_count})`)
ok(cents(pr?.effective_discount) === cents(25), `effective_discount === 25 (got ${pr?.effective_discount})`)
ok(cents(pr?.total) === cents(125.5), `total === 125.50 (got ${pr?.total})`)
ok(pr?.discount_clamped === false, `discount_clamped === false (got ${pr?.discount_clamped})`)
const delivs = single.json?.engagement?.deliverables || []
ok(delivs.length === 2, `engagement has 2 deliverables (got ${delivs.length})`)
ok(delivs.every((d) => d.fee_cents === undefined), "deliverables expose fee (dollars), not fee_cents")
const priced = delivs.find((d) => cents(d.fee) === cents(150.5))
ok(!!priced && Array.isArray(priced.activities) && priced.activities.length === 1, "priced deliverable carries 1 nested activity")
ok(!!priced && priced.activities[0]?.owner === "client" && priced.activities[0]?.status === "not_started",
   `nested activity owner=client status=not_started (got ${priced?.activities?.[0]?.owner} / ${priced?.activities?.[0]?.status})`)

// ── 3. GET list shows it ──
const list = await api("GET", tokenA, `/coach-clients/${ccA}/engagements`)
ok(list.status === 200 && (list.json?.engagements || []).some((e) => e.id === E1), "GET list includes the engagement")

// ── 4. FREEZE PROOF: edit the catalog package price; engagement pricing unchanged ──
await api("PATCH", tokenA, `/packages/${PA}`, { discount: 999 }) // catalog discount way up
await api("PATCH", tokenA, `/milestones/${M1}`, { fee: 1 })       // catalog fee way down
single = await api("GET", tokenA, `/coach-clients/${ccA}/engagements/${E1}`)
pr = single.json?.engagement?.pricing
ok(cents(pr?.subtotal) === cents(150.5) && cents(pr?.total) === cents(125.5) && cents(single.json?.engagement?.discount) === cents(25),
   `FREEZE: engagement pricing unchanged after catalog edits (subtotal ${pr?.subtotal}, total ${pr?.total}, discount ${single.json?.engagement?.discount})`)

// ── 5. Clamp (frozen): a package whose discount exceeds its subtotal → total floors at $0 ──
const M3 = await makeMilestone(tokenA, created.milestonesA, `__verify_throwaway___eng_M3_${stamp}`, 50)
const PAclamp = await makePackage(tokenA, created.packagesA, `__verify_throwaway___eng_PAc_${stamp}`, 999, [M3])
const attach2 = await api("POST", tokenA, `/coach-clients/${ccA}/engagements`, { package_id: PAclamp })
const E2 = attach2.json?.engagement?.id
const pr2 = attach2.json?.engagement?.pricing
ok(attach2.status === 201 && cents(pr2?.subtotal) === cents(50) && cents(pr2?.effective_discount) === cents(50) && cents(pr2?.total) === 0 && pr2?.discount_clamped === true,
   `clamp: subtotal 50, eff 50, total 0, clamped true (got ${pr2?.subtotal}/${pr2?.effective_discount}/${pr2?.total}/${pr2?.discount_clamped})`)

// ── 6. Cross-coach isolation ──
const PB = await makePackage(tokenB, created.packagesB, `__verify_throwaway___eng_PB_${stamp}`, null, [])
// B can't attach A's package (RPC package gate via B's own relationship).
ok((await api("POST", tokenB, `/coach-clients/${ccB}/engagements`, { package_id: PA })).status === 404,
   "Coach B attach A's package → 404")
// A can't attach B's package to A's relationship (RPC package gate).
ok((await api("POST", tokenA, `/coach-clients/${ccA}/engagements`, { package_id: PB })).status === 404,
   "Coach A attach B's package → 404")
// B can't GET/DELETE A's engagement (relationship not owned by B).
ok((await api("GET", tokenB, `/coach-clients/${ccA}/engagements/${E1}`)).status === 404, "Coach B GET A's engagement → 404")
ok((await api("DELETE", tokenB, `/coach-clients/${ccA}/engagements/${E1}`)).status === 404, "Coach B DELETE A's engagement → 404")
// The critical case: B reaches A's engagement via B's OWN relationship id → dual check fails.
ok((await api("GET", tokenB, `/coach-clients/${ccB}/engagements/${E1}`)).status === 404,
   "Coach B GET A's engagement via B's own coach_client id → 404")

// ── 7. DELETE detach ──
const del = await api("DELETE", tokenA, `/coach-clients/${ccA}/engagements/${E1}`)
ok(del.status === 200 && del.json?.deleted === E1, `DELETE detach → 200 { deleted } (got ${del.status})`)
ok((await api("GET", tokenA, `/coach-clients/${ccA}/engagements/${E1}`)).status === 404, "GET detached engagement → 404")
ok(!((await api("GET", tokenA, `/coach-clients/${ccA}/engagements`)).json?.engagements || []).some((e) => e.id === E1),
   "list no longer includes the detached engagement")

// ── Cleanup ──
for (const id of created.coachClients) await admin.from("coach_clients").delete().eq("id", id) // cascades engagements
for (const id of [...created.packagesA, ...created.packagesB]) await admin.from("coach_packages").delete().eq("id", id)
for (const id of [...created.milestonesA, ...created.milestonesB]) await admin.from("coach_milestones").delete().eq("id", id)
console.log("\nCleanup: removed throwaway coach_clients (engagements cascaded), packages, milestones via service role")

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
