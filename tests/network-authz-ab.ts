#!/usr/bin/env tsx
// Network Tracker cross-account authorization smoke.
//
// WHY THIS EXISTS. The network routes reach Supabase with the SERVICE ROLE
// (getSupabaseAdmin), which bypasses RLS entirely. The RLS policies in
// 20260723_network_tracker_v3_reconcile.sql therefore never fire for any
// request the app makes. What actually keeps one client's contacts away from
// another is route code:
//
//   getAuthedUser   -> verifies the bearer token via supabase.auth.getUser
//   resolveCaller   -> maps it to a client_profiles.id
//   then either assertBoardAccess(caller, target, level)     [board routes]
//        or       fetch row, compare client_profile_id, 403  [id routes]
//
// So this test signs in as two REAL users and has A attempt to read and write
// B's data through the running API. It is the test that matches the actual
// boundary; an RLS test would pass while proving nothing.
//
// USAGE (dev only — never point this at prod):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   API_BASE=http://localhost:3000 USER_A=a@x.com USER_B=b@x.com \
//   npx tsx tests/network-authz-ab.ts
//
// Creds come from process.env only — this file never reads .env*.
//
// A is expected NOT to be a coach of B. If a coach_clients link exists,
// assertBoardAccess legitimately grants reads and the read assertions below
// are wrong rather than the code being wrong; the preflight checks for that.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const URL_ = req("SUPABASE_URL")
const SERVICE = req("SUPABASE_SERVICE_ROLE_KEY")
const ANON = req("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const API = process.env.API_BASE || "http://localhost:3000"
const EMAIL_A = req("USER_A")
const EMAIL_B = req("USER_B")

function req(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}`)
    process.exit(2)
  }
  return v
}

let pass = 0
const failures: string[] = []
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    failures.push(label)
    console.error(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`)
  }
}

// A refusal is 401/403/404. Anything else — including 200 and 400 — is not a
// pass: a 400 means the request died on body validation before authorization
// was ever consulted, which tells us nothing about the gate.
function refused(label: string, status: number, body: string) {
  ok(
    `${label} -> refused (${status})`,
    status === 401 || status === 403 || status === 404,
    `got ${status} ${body.slice(0, 120)}`,
  )
}

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, text: await res.text() }
}

// Mint a real session without touching the account's password: generate a
// magic link with the service role, then redeem its hashed token as the anon
// client. This is the same token the browser would carry.
async function sessionFor(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (error) throw new Error(`generateLink(${email}): ${error.message}`)
  const hashed = (data as any)?.properties?.hashed_token
  if (!hashed) throw new Error(`no hashed_token for ${email}`)

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
  for (const type of ["magiclink", "email"] as const) {
    const r = await anon.auth.verifyOtp({ token_hash: hashed, type })
    if (r.data?.session?.access_token) return r.data.session.access_token
    if (type === "email") throw new Error(`verifyOtp(${email}): ${r.error?.message}`)
  }
  throw new Error("unreachable")
}

async function main() {
  console.log(`API:      ${API}`)
  console.log(`Supabase: ${URL_.replace(/^https:\/\//, "").split(".")[0]}`)
  if (/ejhnokcnahauvrcbcmic/.test(URL_)) {
    console.error("\nREFUSING TO RUN: that is the PRODUCTION Supabase project.")
    process.exit(2)
  }

  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })

  // ── Preflight: identities, and the fixtures A will try to reach ──
  const { data: profs } = await admin
    .from("client_profiles")
    .select("id, email, is_coach")
    .in("email", [EMAIL_A, EMAIL_B])
  const A = profs?.find((p) => p.email === EMAIL_A)
  const B = profs?.find((p) => p.email === EMAIL_B)
  if (!A || !B) throw new Error("could not resolve both profiles")

  const { data: link } = await admin
    .from("coach_clients")
    .select("id, status")
    .eq("coach_profile_id", A.id)
    .eq("client_profile_id", B.id)
    .maybeSingle()
  if (link) {
    console.error(`\nABORT: A is linked to B as a coach (${link.status}). Reads would be legitimate.`)
    process.exit(2)
  }

  const { data: bContact } = await admin
    .from("network_contacts")
    .select("id, first_name, last_name, stage, client_profile_id")
    .eq("client_profile_id", B.id)
    .limit(1)
    .maybeSingle()
  const { data: bCompany } = await admin
    .from("network_companies")
    .select("id, name")
    .eq("client_profile_id", B.id)
    .limit(1)
    .maybeSingle()
  if (!bContact || !bCompany) throw new Error("B has no contact/company to target")

  const { count: bCountBefore } = await admin
    .from("network_contacts")
    .select("id", { count: "exact", head: true })
    .eq("client_profile_id", B.id)

  // Snapshot the CALLER's own row too. A test that quietly mutates the account
  // it is authenticating as is a test that damages data while reporting success.
  const { data: aProfBefore } = await admin
    .from("network_client_profile")
    .select("elevator_pitch")
    .eq("client_profile_id", A.id)
    .maybeSingle()

  console.log(`A: ${A.id} (${EMAIL_A})`)
  console.log(`B: ${B.id} (${EMAIL_B})  contacts=${bCountBefore}  target=${bContact.id}\n`)

  const tokenA = await sessionFor(admin, EMAIL_A)

  // ── 0. Control. If these fail the whole run is meaningless. ──
  console.log("— control: A can use its own board —")
  {
    const r = await call("GET", "/api/network/contacts", tokenA)
    ok("A reads own contacts -> 200", r.status === 200, `got ${r.status}`)
    const n = (JSON.parse(r.text || "{}")?.contacts ?? []).length
    ok("A's own board is non-empty (test has teeth)", n > 0, `got ${n} contacts`)
  }

  // ── 1. Unauthenticated ──
  console.log("\n— unauthenticated —")
  {
    const r1 = await call("GET", "/api/network/contacts", null)
    refused("no token", r1.status, r1.text)
    const r2 = await call("GET", "/api/network/contacts", "not-a-real-jwt")
    refused("garbage token", r2.status, r2.text)
  }

  // ── 2. A reads B's board (assertBoardAccess path) ──
  console.log("\n— A tries to READ B's data —")
  for (const p of [
    `/api/network/contacts?client_profile_id=${B.id}`,
    `/api/network/companies?client_profile_id=${B.id}`,
    `/api/network/worklist?client_profile_id=${B.id}`,
    `/api/network/templates?client_profile_id=${B.id}`,
    `/api/network/profile?client_profile_id=${B.id}`,
  ]) {
    const r = await call("GET", p, tokenA)
    refused(`GET ${p.split("?")[0]}`, r.status, r.text)
  }
  {
    const r = await call("GET", `/api/network/contacts/${bContact.id}`, tokenA)
    refused("GET contacts/{B-contact}", r.status, r.text)
    // Only assert on names that actually exist. A null last_name must not
    // collapse into a placeholder that trivially appears in every response —
    // that would fail the assertion for a reason unrelated to leaking.
    const names = [bContact.first_name, bContact.last_name].filter(Boolean) as string[]
    ok(
      "B's contact name does not leak in the refusal body",
      names.length > 0 && names.every((n) => !r.text.includes(n)),
      r.text.slice(0, 120),
    )
  }

  // ── 3. A writes to B's data (fetch-then-compare path) ──
  console.log("\n— A tries to WRITE to B's data —")
  const writes: Array<[string, string, string, unknown?]> = [
    ["PATCH contact", "PATCH", `/api/network/contacts/${bContact.id}`, { first_name: "PWNED" }],
    ["DELETE contact", "DELETE", `/api/network/contacts/${bContact.id}`],
    ["POST action", "POST", `/api/network/contacts/${bContact.id}/actions`, { type: "touch_1" }],
    ["POST stage", "POST", `/api/network/contacts/${bContact.id}/stage`, { stage: "outcome" }],
    ["POST reminder", "POST", `/api/network/contacts/${bContact.id}/reminder`, { reminder_override: "2027-01-01" }],
    ["PATCH company", "PATCH", `/api/network/companies/${bCompany.id}`, { name: "PWNED" }],
    ["DELETE company", "DELETE", `/api/network/companies/${bCompany.id}`],
    // NOTE: profile PATCH takes its target from the BODY, not the query string.
    // Sending it as ?client_profile_id= makes the route fall back to the
    // caller's own id — so the request succeeds against A's OWN row and proves
    // nothing about the gate. Cost the first time round: it overwrote A's real
    // elevator_pitch. Target goes in the body.
    ["PATCH profile", "PATCH", `/api/network/profile`, { client_profile_id: B.id, elevator_pitch: "PWNED" }],
    // Must be a REAL template id ("IN", from template-defaults.ts). The route
    // checks isKnownTemplateId BEFORE assertBoardAccess, so an invented id
    // returns 404 for the wrong reason and the gate is never reached.
    //
    // And note the asymmetry, which caught this test out: on this ONE route
    // file, PATCH takes client_profile_id from the BODY and DELETE takes it
    // from the QUERY STRING. Send it in the wrong place and the route quietly
    // falls back to the caller's own id, returns 200, and you have tested
    // nothing. Both forms are sent below so neither can silently no-op.
    ["PATCH template", "PATCH", `/api/network/templates/IN`, { client_profile_id: B.id, body: "PWNED" }],
    ["DELETE template", "DELETE", `/api/network/templates/IN?client_profile_id=${B.id}`],
  ]
  for (const [label, method, path, body] of writes) {
    const r = await call(method, path, tokenA, body)
    refused(label, r.status, r.text)
  }

  // contacts/delete is SCOPED, not gated: it filters on client_profile_id, so a
  // request carrying another board's ids matches nothing. It returns 200. The
  // assertion that matters is that the row survives, not the status code.
  {
    const r = await call("POST", "/api/network/contacts/delete", tokenA, { ids: [bContact.id] })
    console.log(`  note  batch-delete of B's id returned ${r.status} (scoped, not gated — survival checked below)`)
  }

  // ── 4. Did anything actually change? ──
  console.log("\n— post-state: B's data must be untouched —")
  const { data: after } = await admin
    .from("network_contacts")
    .select("id, first_name, stage")
    .eq("id", bContact.id)
    .maybeSingle()
  ok("B's contact still exists", !!after)
  ok("B's contact name unchanged", after?.first_name === bContact.first_name, `now ${after?.first_name}`)
  ok("B's contact stage unchanged", after?.stage === bContact.stage, `now ${after?.stage}`)

  const { data: coAfter } = await admin
    .from("network_companies")
    .select("id, name")
    .eq("id", bCompany.id)
    .maybeSingle()
  ok("B's company still exists", !!coAfter)
  ok("B's company name unchanged", coAfter?.name === bCompany.name, `now ${coAfter?.name}`)

  const { count: bCountAfter } = await admin
    .from("network_contacts")
    .select("id", { count: "exact", head: true })
    .eq("client_profile_id", B.id)
  ok("B's contact count unchanged", bCountAfter === bCountBefore, `${bCountBefore} -> ${bCountAfter}`)

  const { count: actionsInjected } = await admin
    .from("network_actions")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", bContact.id)
    .eq("author_id", A.id)
  ok("no action authored by A on B's contact", (actionsInjected ?? 0) === 0, `found ${actionsInjected}`)

  const { data: aProfAfter } = await admin
    .from("network_client_profile")
    .select("elevator_pitch")
    .eq("client_profile_id", A.id)
    .maybeSingle()
  ok(
    "the test did not mutate A's own profile either",
    (aProfAfter?.elevator_pitch ?? null) === (aProfBefore?.elevator_pitch ?? null),
    `${aProfBefore?.elevator_pitch} -> ${aProfAfter?.elevator_pitch}`,
  )

  console.log(`\n${pass} passed, ${failures.length} failed`)
  if (failures.length) {
    console.error("\nFAILED:")
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`)
  process.exit(2)
})
