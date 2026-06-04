// scripts/verify-coach-packages.mjs
//
// Smoke test for the Coach Packages API against a DEPLOYED environment
// (default: staging → DEV Supabase). Exercises:
//   create → link → read (pricing math incl. discount clamp + unpriced_count)
//   → idempotent re-link → unlink → delete, PLUS cross-coach isolation (a second
//   coach's package/milestone are invisible and unlinkable) and the milestones
//   409 delete-guard (a deliverable in a package can't be deleted).
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
//   SUPABASE_SERVICE_ROLE_KEY  if set, all test rows are removed at the end.
//
// Run (this machine needs system CA for Supabase TLS):
//   NODE_OPTIONS=--use-system-ca \
//   BASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   COACH_A_EMAIL=... COACH_A_PASSWORD=... COACH_B_EMAIL=... COACH_B_PASSWORD=... \
//   node scripts/verify-coach-packages.mjs

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
const cents = (dollars) => Math.round((dollars ?? 0) * 100) // compare money in integer cents

async function signIn(who, creds) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email: creds.email, password: creds.password })
  if (error || !data?.session?.access_token) {
    console.error(`Sign-in failed for ${who} (${creds.email}): ${error?.message || "no session"}`)
    process.exit(2)
  }
  return data.session.access_token
}

// path is the full sub-path under /api/coach (e.g. "/packages", "/milestones/<id>").
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

// Track created ids for cleanup.
const created = { packagesA: [], milestonesA: [], milestonesB: [] }
const stamp = Date.now()

// ── Coach A: three deliverables (priced, priced w/ decimals, unpriced) ──
async function makeMilestone(token, bucket, name, fee) {
  const r = await api("POST", token, "/milestones", { name, fee })
  if (r.status !== 201 || !r.json?.milestone?.id) {
    console.error(`setup: milestone create failed (${r.status}): ${JSON.stringify(r.json)}`); process.exit(2)
  }
  bucket.push(r.json.milestone.id)
  return r.json.milestone.id
}
const M1 = await makeMilestone(tokenA, created.milestonesA, `__verify_throwaway___pkg_M1_${stamp}`, 100)     // $100
const M2 = await makeMilestone(tokenA, created.milestonesA, `__verify_throwaway___pkg_M2_${stamp}`, 50.5)    // $50.50
const M3 = await makeMilestone(tokenA, created.milestonesA, `__verify_throwaway___pkg_M3_${stamp}`, null)    // unpriced

// ── 1. Create package with one deliverable + a discount ──
const pkgName = `__verify_throwaway___pkg_${stamp}`
const createdPkg = await api("POST", tokenA, "/packages", { name: pkgName, description: "verify", discount: 25, deliverable_ids: [M1] })
ok(createdPkg.status === 201, `POST /packages → 201 (got ${createdPkg.status})`)
const P = createdPkg.json?.package?.id
ok(!!P, "create returns package.id")
if (P) created.packagesA.push(P)
ok(createdPkg.json?.package?.deliverables?.length === 1, "create linked 1 deliverable")
ok(cents(createdPkg.json?.package?.discount) === cents(25), `create discount === 25 (got ${createdPkg.json?.package?.discount})`)
ok(createdPkg.json?.package?.discount_cents === undefined, "create response does NOT leak discount_cents")

// ── 2. Link the other two deliverables ──
const linked = await api("POST", tokenA, `/packages/${P}/deliverables`, { milestone_ids: [M2, M3] })
ok(linked.status === 200 && linked.json?.package?.deliverables?.length === 3, `link M2,M3 → 3 deliverables (got ${linked.json?.package?.deliverables?.length})`)

// ── 3. Read + pricing math (subtotal 150.50, unpriced 1, eff 25, total 125.50) ──
let read = await api("GET", tokenA, `/packages/${P}`)
ok(read.status === 200, `GET /packages/${"{id}"} → 200 (got ${read.status})`)
let pr = read.json?.package?.pricing
ok(cents(pr?.subtotal) === cents(150.5), `subtotal === 150.50 (got ${pr?.subtotal})`)
ok(pr?.unpriced_count === 1, `unpriced_count === 1 (got ${pr?.unpriced_count})`)
ok(cents(pr?.effective_discount) === cents(25), `effective_discount === 25 (got ${pr?.effective_discount})`)
ok(cents(pr?.total) === cents(125.5), `total === 125.50 (got ${pr?.total})`)
ok(pr?.discount_clamped === false, `discount_clamped === false (got ${pr?.discount_clamped})`)
ok((read.json?.package?.deliverables || []).every((d) => d.fee_cents === undefined), "deliverables expose fee (dollars), not fee_cents")

// ── 3b. Discount clamp: set discount above subtotal → total floors at 0 ──
const clampPatch = await api("PATCH", tokenA, `/packages/${P}`, { discount: 200 })
pr = clampPatch.json?.package?.pricing
ok(clampPatch.status === 200 && cents(pr?.effective_discount) === cents(150.5), `clamp: effective_discount === 150.50 (got ${pr?.effective_discount})`)
ok(cents(pr?.total) === 0, `clamp: total === 0 (got ${pr?.total})`)
ok(pr?.discount_clamped === true, `clamp: discount_clamped === true (got ${pr?.discount_clamped})`)
await api("PATCH", tokenA, `/packages/${P}`, { discount: 25 }) // restore

// ── 4. Idempotent re-link: linking M1 again is a no-op ──
const relink = await api("POST", tokenA, `/packages/${P}/deliverables`, { milestone_ids: [M1] })
ok(relink.status === 200 && relink.json?.package?.deliverables?.length === 3, `re-link M1 idempotent → still 3 (got ${relink.json?.package?.deliverables?.length})`)

// ── 5. Cross-coach isolation ──
const MB = await makeMilestone(tokenB, created.milestonesB, `__verify_throwaway___pkg_MB_${stamp}`, 999) // Coach B's deliverable
const listB = await api("GET", tokenB, "/packages")
ok(!(listB.json?.packages || []).some((p) => p.id === P), "Coach B does NOT see Coach A's package (list isolation)")
ok((await api("GET", tokenB, `/packages/${P}`)).status === 404, "Coach B GET A's package → 404")
ok((await api("PATCH", tokenB, `/packages/${P}`, { name: "hijack" })).status === 404, "Coach B PATCH A's package → 404")
ok((await api("POST", tokenB, `/packages/${P}/deliverables`, { milestone_ids: [MB] })).status === 404, "Coach B link to A's package → 404")
// The critical dual-ownership case: A tries to link B's deliverable to A's package.
const crossLink = await api("POST", tokenA, `/packages/${P}/deliverables`, { milestone_ids: [MB] })
ok(crossLink.status === 404, `Coach A linking Coach B's deliverable → 404 (got ${crossLink.status})`)
read = await api("GET", tokenA, `/packages/${P}`)
ok((read.json?.package?.deliverables || []).length === 3, "cross-coach link did NOT attach (still 3 deliverables)")
ok((await api("DELETE", tokenB, `/packages/${P}/deliverables/${M1}`)).status === 404, "Coach B unlink from A's package → 404")

// ── 6. 409 delete-guard: M1 is in package P → can't delete the milestone ──
const guard = await api("DELETE", tokenA, `/milestones/${M1}`)
ok(guard.status === 409, `DELETE deliverable in a package → 409 (got ${guard.status})`)
ok(typeof guard.json?.error === "string" && guard.json.error.includes(pkgName), "409 message names the referencing package")
const stillThere = await api("GET", tokenA, "/milestones")
ok((stillThere.json?.milestones || []).some((m) => m.id === M1), "guarded milestone still exists after 409")

// ── 7. Unlink one → 2 deliverables, unpriced_count back to 0 ──
const unlink = await api("DELETE", tokenA, `/packages/${P}/deliverables/${M3}`)
ok(unlink.status === 200 && unlink.json?.package?.deliverables?.length === 2, `unlink M3 → 2 deliverables (got ${unlink.json?.package?.deliverables?.length})`)
ok(unlink.json?.package?.pricing?.unpriced_count === 0, `after unlink unpriced_count === 0 (got ${unlink.json?.package?.pricing?.unpriced_count})`)
ok((await api("DELETE", tokenA, `/packages/${P}/deliverables/${M3}`)).status === 404, "unlink already-unlinked → 404")

// ── 8. Delete package (CASCADE clears joins) → milestone now deletable ──
const delPkg = await api("DELETE", tokenA, `/packages/${P}`)
ok(delPkg.status === 200 && delPkg.json?.deleted === P, `DELETE /packages → 200 { deleted } (got ${delPkg.status})`)
created.packagesA = created.packagesA.filter((x) => x !== P)
ok((await api("GET", tokenA, `/packages/${P}`)).status === 404, "GET deleted package → 404")
const delM1 = await api("DELETE", tokenA, `/milestones/${M1}`)
ok(delM1.status === 200, `DELETE formerly-linked milestone after package gone → 200 (got ${delM1.status})`)
created.milestonesA = created.milestonesA.filter((x) => x !== M1)

// ── Cleanup ──
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  for (const id of created.packagesA) await admin.from("coach_packages").delete().eq("id", id) // cascade clears joins
  for (const id of [...created.milestonesA, ...created.milestonesB]) await admin.from("coach_milestones").delete().eq("id", id)
  console.log("\nCleanup: removed all remaining test packages/milestones via service role")
} else {
  console.log(`\nNo SUPABASE_SERVICE_ROLE_KEY — clean up manually: packages=${JSON.stringify(created.packagesA)} milestones=${JSON.stringify([...created.milestonesA, ...created.milestonesB])}`)
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
