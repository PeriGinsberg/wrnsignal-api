#!/usr/bin/env tsx
// Client Library + shared-documents authorization probe, against a RUNNING API.
//
// WHY THIS EXISTS. app/api/_lib/coachClientDocuments.test.ts proves the LADDER;
// this proves the ROUTES stand on it, and it covers the one rule a unit test
// cannot see at all: that a client stops seeing shared links the moment the
// coaching relationship stops being active. That rule spans two routes and a
// join, so only a real request shows it.
//
// Three findings are pinned here:
//   1. library writes required only row ownership, so 'view' could write
//   2. library reads and writes ignored coach_clients.status entirely
//   3. /api/me/documents never checked the relationship, so a revoked coach's
//      links stayed on the client's Coaching Hub forever
//
// WHAT IT WRITES. One library document, created through the API at 'full' and
// deleted at the end. It rewrites the coach_clients row's status/access_level to
// drive the states and restores the originals in a finally. It asserts the
// client's visible document count returns to its starting value.
//
// USAGE (dev only — it refuses to run against production):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   API_BASE=http://localhost:3000 \
//   COACH_LINKED=coach@x.com COACH_UNLINKED=other-coach@x.com CLIENT_EMAIL=client@x.com \
//   npx tsx tests/coach-library/library-authz.live.ts
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

async function call(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* html or empty */ }
  return { status: res.status, json, text: text.slice(0, 160) }
}

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
    .from("client_profiles").select("id, email").in("email", [COACH_LINKED, COACH_UNLINKED, CLIENT_EMAIL])
  const linked = profs?.find((p) => p.email === COACH_LINKED)
  const unlinked = profs?.find((p) => p.email === COACH_UNLINKED)
  const client = profs?.find((p) => p.email === CLIENT_EMAIL)
  if (!linked || !unlinked || !client) throw new Error("could not resolve all three profiles")

  const { data: link } = await admin
    .from("coach_clients").select("id, status, access_level")
    .eq("coach_profile_id", linked.id).eq("client_profile_id", client.id).maybeSingle()
  if (!link) throw new Error(`${COACH_LINKED} has no coach_clients row for ${CLIENT_EMAIL}`)

  const coachT = await sessionFor(admin, COACH_LINKED)
  const otherT = await sessionFor(admin, COACH_UNLINKED)
  const clientT = await sessionFor(admin, CLIENT_EMAIL)

  const DOCS = `/api/coach/coach-clients/${link.id}/documents`
  const setLink = async (over: { status?: string; access_level?: string }) => {
    const { error } = await admin.from("coach_clients").update(over).eq("id", link.id)
    if (error) throw new Error(`could not set ${JSON.stringify(over)}: ${error.message}`)
  }
  const clientDocCount = async () => {
    const r = await call("/api/me/documents", clientT)
    if (r.status !== 200) return -1
    return (r.json?.groups ?? []).reduce((n: number, g: any) => n + (g.documents?.length ?? 0), 0)
  }

  const startingCount = await clientDocCount()
  console.log(`client currently sees ${startingCount} shared document(s)\n`)
  let docId: string | null = null

  try {
    console.log("control: an active 'full' coach runs the library")
    await setLink({ status: "active", access_level: "full" })
    const list = await call(DOCS, coachT)
    ok("GET documents succeeds", list.status === 200, `got ${list.status} ${list.text}`)
    const made = await call(DOCS, coachT, {
      method: "POST",
      body: JSON.stringify({ title: "Authz probe link", url: "https://example.com/authz-probe", visible_to_client: true }),
    })
    ok("POST creates a document", made.status === 201 || made.status === 200, `got ${made.status} ${made.text}`)
    docId = made.json?.document?.id ?? made.json?.id ?? null
    ok("the created document has an id", Boolean(docId), made.text)

    console.log("\nthe client sees a shared document while the relationship is active")
    ok("client's visible count went up by one", (await clientDocCount()) === startingCount + 1)

    console.log("\na coach with NO link to this client")
    const otherList = await call(DOCS, otherT)
    ok("GET refuses an unlinked coach", refused(otherList.status), `got ${otherList.status}`)
    const otherPost = await call(DOCS, otherT, { method: "POST", body: JSON.stringify({ title: "nope", url: "https://example.com/nope" }) })
    ok("POST refuses an unlinked coach", refused(otherPost.status), `got ${otherPost.status}`)

    for (const level of ["view", "annotate"] as const) {
      console.log(`\nan active link at '${level}'`)
      await setLink({ status: "active", access_level: level })
      const r = await call(DOCS, coachT)
      ok(`GET is allowed at '${level}'`, r.status === 200, `got ${r.status} ${r.text}`)
      const p = await call(DOCS, coachT, { method: "POST", body: JSON.stringify({ title: "nope", url: "https://example.com/nope" }) })
      ok(`POST refuses '${level}'`, refused(p.status), `got ${p.status} ${p.text}`)
      if (docId) {
        const patch = await call(`${DOCS}/${docId}`, coachT, { method: "PATCH", body: JSON.stringify({ title: "renamed" }) })
        ok(`PATCH refuses '${level}'`, refused(patch.status), `got ${patch.status} ${patch.text}`)
        const del = await call(`${DOCS}/${docId}`, coachT, { method: "DELETE" })
        ok(`DELETE refuses '${level}'`, refused(del.status), `got ${del.status} ${del.text}`)
      }
    }

    for (const status of ["pending", "paused", "revoked"] as const) {
      console.log(`\na '${status}' link (access_level still 'full')`)
      await setLink({ status, access_level: "full" })
      const r = await call(DOCS, coachT)
      ok(`GET refuses a '${status}' link`, refused(r.status), `got ${r.status} ${r.text}`)
      const p = await call(DOCS, coachT, { method: "POST", body: JSON.stringify({ title: "nope", url: "https://example.com/nope" }) })
      ok(`POST refuses a '${status}' link`, refused(p.status), `got ${p.status} ${p.text}`)
      // The finding that spans both sides: the client must stop seeing the link.
      ok(`the client no longer sees the shared document while '${status}'`, (await clientDocCount()) === startingCount)
    }

    console.log("\nand it comes back when the relationship is active again")
    await setLink({ status: "active", access_level: "full" })
    ok("client sees it again", (await clientDocCount()) === startingCount + 1)
  } finally {
    await admin.from("coach_clients")
      .update({ status: "active", access_level: "full" }).eq("id", link.id)
    if (docId) await admin.from("coach_client_documents").delete().eq("id", docId)
    await admin.from("coach_clients")
      .update({ status: link.status, access_level: link.access_level }).eq("id", link.id)
    const { data: restored } = await admin.from("coach_clients").select("status, access_level").eq("id", link.id).single()
    console.log(`\nrestored coach_clients -> ${restored?.status}/${restored?.access_level}, probe document removed`)
  }

  ok(`the client's library is back where it started (${startingCount})`, (await clientDocCount()) === startingCount)

  console.log(`\n${pass} passed, ${failures.length} failed`)
  if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
