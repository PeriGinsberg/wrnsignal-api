#!/usr/bin/env tsx
// Coach-run contacts import — authorization probe against a RUNNING API.
//
// WHY THIS EXISTS, given lib/collab/scope.test.ts already proves the ladder.
// That test proves the LADDER; this one proves the IMPORT ROUTES are actually
// standing on it. The two import routes were owner-only until the coach-run
// importer shipped (docs/network-tracker/coach-contacts-import.md), and the
// reversal is the kind of change whose failure mode is silent: a route that
// resolved the subject but forgot to require "write" would answer 200 and
// deposit a client's contacts wherever it was pointed. Only a real request can
// show which scope the route asked for.
//
// It also covers the three link states a unit test cannot distinguish from the
// outside: a coach with NO row, a `pending` row, and a `revoked` row.
//
// WHAT IT WRITES. Nothing, on the happy path: the only 200 it asks for is a
// preview, which is read-only by construction. It does temporarily rewrite the
// coach_clients row's status/access_level to drive the states, and restores the
// original values in a finally block. It asserts the board's contact count is
// identical at the end.
//
// USAGE (dev only — it refuses to run against production):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   API_BASE=http://localhost:3000 \
//   COACH_LINKED=coach@x.com COACH_UNLINKED=other-coach@x.com CLIENT_EMAIL=client@x.com \
//   npx tsx tests/network-tracker/import-authz.live.ts
//
// Creds come from process.env only — this file never reads .env*.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

function req(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(2) }
  return v
}

const URL_ = req("SUPABASE_URL")
const SERVICE = req("SUPABASE_SERVICE_ROLE_KEY")
const ANON = req("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const API = process.env.API_BASE || "http://localhost:3000"
const COACH_LINKED = req("COACH_LINKED")
const COACH_UNLINKED = req("COACH_UNLINKED")
const CLIENT_EMAIL = req("CLIENT_EMAIL")

let pass = 0
const failures: string[] = []
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${label}`) }
  else { failures.push(label); console.error(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`) }
}
const refused = (status: number) => status === 401 || status === 403 || status === 404

// A tiny in-memory workbook, so this probe carries no real contact data and
// needs no fixture file. One row is enough: the question is who may POST it.
const CSV = [
  "Company,First Name,Last Name,Title,Email,LinkedIn,Domain",
  "Probe Co,Authz,Probe,Tester,authz.probe@probe-co.test,https://linkedin.com/in/authzprobe,probe-co.test",
].join("\n")
const MAPPING = JSON.stringify(["company", "first_name", "last_name", "title", "email", "linkedin_url", "company_domain"])

function body(extra: Record<string, string> = {}) {
  const f = new FormData()
  f.append("file", new Blob([CSV], { type: "text/csv" }), "probe.csv")
  for (const [k, v] of Object.entries(extra)) f.append(k, v)
  return f
}

async function post(path: string, tokenValue: string, subject: string, extra: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}?client_profile_id=${encodeURIComponent(subject)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenValue}` },
    body: body(extra),
  })
  return { status: res.status, text: (await res.text()).slice(0, 200) }
}

// Mint a real session without touching the account's password: generate a magic
// link with the service role, then redeem its hashed token as the anon client.
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

  const { data: profs } = await admin
    .from("client_profiles").select("id, email, is_coach")
    .in("email", [COACH_LINKED, COACH_UNLINKED, CLIENT_EMAIL])
  const linked = profs?.find((p) => p.email === COACH_LINKED)
  const unlinked = profs?.find((p) => p.email === COACH_UNLINKED)
  const client = profs?.find((p) => p.email === CLIENT_EMAIL)
  if (!linked || !unlinked || !client) throw new Error("could not resolve all three profiles")

  const { data: link } = await admin
    .from("coach_clients").select("id, status, access_level")
    .eq("coach_profile_id", linked.id).eq("client_profile_id", client.id).maybeSingle()
  if (!link) throw new Error(`${COACH_LINKED} has no coach_clients row for ${CLIENT_EMAIL}`)

  const { data: strayLink } = await admin
    .from("coach_clients").select("id")
    .eq("coach_profile_id", unlinked.id).eq("client_profile_id", client.id).maybeSingle()
  if (strayLink) {
    console.error(`\nABORT: ${COACH_UNLINKED} IS linked to the client. A refusal would prove nothing.`)
    process.exit(2)
  }

  const countContacts = async () => {
    const { count } = await admin.from("network_contacts")
      .select("id", { count: "exact", head: true }).eq("client_profile_id", client.id)
    return count ?? 0
  }
  const before = await countContacts()
  console.log(`Client board holds ${before} contacts before the probe\n`)

  const tokenLinked = await sessionFor(admin, COACH_LINKED)
  const tokenUnlinked = await sessionFor(admin, COACH_UNLINKED)
  const setLink = async (over: { status?: string; access_level?: string }) => {
    const { error } = await admin.from("coach_clients").update(over).eq("id", link.id)
    if (error) throw new Error(`could not set ${JSON.stringify(over)}: ${error.message}`)
  }

  try {
    // Control. If this does not pass, every refusal below is meaningless
    // because the setup, not the authorization, would explain them.
    console.log("control: the linked coach at 'full'")
    await setLink({ status: "active", access_level: "full" })
    const control = await post("/api/network/import/preview", tokenLinked, client.id, { mapping: MAPPING, headerRow: "0" })
    ok("preview succeeds for an active 'full' coach", control.status === 200, `got ${control.status} ${control.text}`)

    console.log("\na coach with NO link to this client")
    for (const route of ["preview", "commit"] as const) {
      const r = await post(`/api/network/import/${route}`, tokenUnlinked, client.id, { mapping: MAPPING, headerRow: "0", confirmName: "irrelevant" })
      ok(`${route} refuses an unlinked coach`, refused(r.status), `got ${r.status} ${r.text}`)
    }

    for (const status of ["pending", "revoked", "paused"] as const) {
      console.log(`\na '${status}' link (access_level still 'full')`)
      await setLink({ status, access_level: "full" })
      for (const route of ["preview", "commit"] as const) {
        const r = await post(`/api/network/import/${route}`, tokenLinked, client.id, { mapping: MAPPING, headerRow: "0", confirmName: "irrelevant" })
        ok(`${route} refuses a '${status}' link`, refused(r.status), `got ${r.status} ${r.text}`)
      }
    }

    for (const level of ["annotate", "view"] as const) {
      console.log(`\nan active link at '${level}'`)
      await setLink({ status: "active", access_level: level })
      for (const route of ["preview", "commit"] as const) {
        const r = await post(`/api/network/import/${route}`, tokenLinked, client.id, { mapping: MAPPING, headerRow: "0", confirmName: "irrelevant" })
        ok(`${route} refuses '${level}'`, refused(r.status), `got ${r.status} ${r.text}`)
      }
    }

    console.log("\nthe confirmation is checked, not decorative")
    await setLink({ status: "active", access_level: "full" })
    const noName = await post("/api/network/import/commit", tokenLinked, client.id, { mapping: MAPPING, headerRow: "0" })
    ok("commit without a confirmed name is refused", noName.status === 400, `got ${noName.status} ${noName.text}`)
    const wrongName = await post("/api/network/import/commit", tokenLinked, client.id, { mapping: MAPPING, headerRow: "0", confirmName: "Not The Client" })
    ok("commit with the wrong client name is refused", wrongName.status === 409, `got ${wrongName.status} ${wrongName.text}`)
  } finally {
    await admin.from("coach_clients")
      .update({ status: link.status, access_level: link.access_level }).eq("id", link.id)
    const { data: restored } = await admin.from("coach_clients").select("status, access_level").eq("id", link.id).single()
    console.log(`\nrestored coach_clients -> ${restored?.status}/${restored?.access_level}`)
  }

  const after = await countContacts()
  ok(`the board is unchanged (${before} contacts before and after)`, after === before, `before ${before}, after ${after}`)

  console.log(`\n${pass} passed, ${failures.length} failed`)
  if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
