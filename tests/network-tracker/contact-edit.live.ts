#!/usr/bin/env tsx
// Editing a contact's identity — as the client, and as a coach — against a
// RUNNING API.
//
// WHY THIS EXISTS. The bug was in two layers at once: the record offered no
// field for email / LinkedIn / phone, AND the PATCH route's allowlist dropped
// those keys if you sent them anyway. A unit test on the field rules cannot see
// either half. This drives the real route as two real people.
//
// It also pins the rules that only exist across a request boundary:
//   - a coach needs an ACTIVE link at FULL, same as the importer
//   - the row records WHO edited it, coach or client
//   - an email already used by another contact on the same board is refused
//     with a message naming who has it
//
// WHAT IT WRITES. One contact, created and deleted by this probe, plus a second
// contact to collide an email against. It rewrites the coach_clients row to
// drive access states and restores it in a finally.
//
// USAGE (dev only — it refuses to run against production):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   API_BASE=http://localhost:3000 \
//   COACH_LINKED=coach@x.com CLIENT_EMAIL=client@x.com \
//   npx tsx tests/network-tracker/contact-edit.live.ts
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
const CLIENT_EMAIL = req("CLIENT_EMAIL")

let pass = 0
const failures: string[] = []
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${label}`) }
  else { failures.push(label); console.error(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`) }
}
const refused = (s: number) => s === 401 || s === 403 || s === 404

async function call(path: string, token: string, init: RequestInit = {}, subject?: string) {
  const url = `${API}${path}${subject ? `${path.includes("?") ? "&" : "?"}client_profile_id=${subject}` : ""}`
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text: text.slice(0, 200) }
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
  const { data: profs } = await admin.from("client_profiles").select("id, email").in("email", [COACH_LINKED, CLIENT_EMAIL])
  const coach = profs?.find((p) => p.email === COACH_LINKED)
  const client = profs?.find((p) => p.email === CLIENT_EMAIL)
  if (!coach || !client) throw new Error("could not resolve both profiles")

  const { data: link } = await admin.from("coach_clients").select("id, status, access_level")
    .eq("coach_profile_id", coach.id).eq("client_profile_id", client.id).maybeSingle()
  if (!link) throw new Error("no coach_clients row for that pair")

  const coachT = await sessionFor(admin, COACH_LINKED)
  const clientT = await sessionFor(admin, CLIENT_EMAIL)
  const setLink = async (over: { status?: string; access_level?: string }) => {
    const { error } = await admin.from("coach_clients").update(over).eq("id", link.id)
    if (error) throw new Error(error.message)
  }

  // Two contacts: the one we edit, and one holding an address to collide with.
  const { data: seeded, error: seedErr } = await admin.from("network_contacts").insert([
    { client_profile_id: client.id, first_name: "Edit", last_name: "Probe", email: "edit.probe@probe.test" },
    { client_profile_id: client.id, first_name: "Taken", last_name: "Address", email: "taken.address@probe.test" },
  ]).select("id, first_name")
  if (seedErr) throw new Error(`seed failed: ${seedErr.message}`)
  const target = seeded!.find((r) => r.first_name === "Edit")!.id
  const ids = seeded!.map((r) => r.id)
  const PATH = `/api/network/contacts/${target}`
  const row = async () => (await admin.from("network_contacts")
    .select("first_name, last_name, title, email, linkedin_url, phone, company_id, edited_by_role, edited_by_id")
    .eq("id", target).single()).data as any

  try {
    console.log("\nthe CLIENT edits their own contact")
    await setLink({ status: "active", access_level: "full" })
    const asClient = await call(PATH, clientT, {
      method: "PATCH",
      body: JSON.stringify({
        first_name: "Edited", last_name: "ByClient", title: "Head of Design",
        company: "Probe Co", email: "edited.byclient@probe.test",
        linkedin_url: "linkedin.com/in/editedbyclient", phone: "+1 (312) 555-0148",
      }),
    })
    ok("client PATCH succeeds", asClient.status === 200, `got ${asClient.status} ${asClient.text}`)
    let r = await row()
    ok("...email saved", r.email === "edited.byclient@probe.test", r.email)
    ok("...linkedin normalized to https", r.linkedin_url === "https://linkedin.com/in/editedbyclient", r.linkedin_url)
    ok("...phone saved as typed", r.phone === "+1 (312) 555-0148", String(r.phone))
    ok("...title saved", r.title === "Head of Design", String(r.title))
    ok("...name saved", r.first_name === "Edited" && r.last_name === "ByClient")
    ok("...company attached", Boolean(r.company_id))
    ok("...recorded as a CLIENT edit", r.edited_by_role === "client", String(r.edited_by_role))

    console.log("\nthe COACH edits the same contact at 'full'")
    const asCoach = await call(PATH, coachT, {
      method: "PATCH",
      body: JSON.stringify({ title: "VP Design", phone: "312.555.0148 x22" }),
    }, client.id)
    ok("coach PATCH succeeds", asCoach.status === 200, `got ${asCoach.status} ${asCoach.text}`)
    r = await row()
    ok("...title updated", r.title === "VP Design", String(r.title))
    ok("...phone updated", r.phone === "312.555.0148 x22", String(r.phone))
    ok("...recorded as a COACH edit", r.edited_by_role === "coach", String(r.edited_by_role))
    ok("...attributed to the coach's profile", r.edited_by_id === coach.id)

    console.log("\na duplicate email is refused, and says who has it")
    const clash = await call(PATH, clientT, { method: "PATCH", body: JSON.stringify({ email: "taken.address@probe.test" }) })
    ok("409 on a duplicate email", clash.status === 409, `got ${clash.status} ${clash.text}`)
    ok("...the message names the other contact", String(clash.json?.error ?? "").includes("Taken Address"), clash.text)
    ok("...and the address did not change", (await row()).email === "edited.byclient@probe.test")

    console.log("\nbad values are refused")
    for (const [field, value] of [["email", "not-an-email"], ["linkedin_url", "javascript:alert(1)"], ["phone", "call her"]] as const) {
      const bad = await call(PATH, clientT, { method: "PATCH", body: JSON.stringify({ [field]: value }) })
      ok(`400 on a bad ${field}`, bad.status === 400, `got ${bad.status} ${bad.text}`)
    }
    const noName = await call(PATH, clientT, { method: "PATCH", body: JSON.stringify({ first_name: "", last_name: "" }) })
    ok("400 when both names are cleared", noName.status === 400, `got ${noName.status} ${noName.text}`)

    console.log("\na coach without full access cannot edit")
    for (const level of ["view", "annotate"] as const) {
      await setLink({ status: "active", access_level: level })
      const r2 = await call(PATH, coachT, { method: "PATCH", body: JSON.stringify({ title: `nope-${level}` }) }, client.id)
      ok(`PATCH refuses '${level}'`, refused(r2.status), `got ${r2.status} ${r2.text}`)
    }
    for (const status of ["pending", "paused", "revoked"] as const) {
      await setLink({ status, access_level: "full" })
      const r3 = await call(PATH, coachT, { method: "PATCH", body: JSON.stringify({ title: `nope-${status}` }) }, client.id)
      ok(`PATCH refuses a '${status}' link`, refused(r3.status), `got ${r3.status} ${r3.text}`)
    }
    ok("none of the refusals changed the row", (await row()).title === "VP Design")

    console.log("\nclearing a field is allowed")
    await setLink({ status: "active", access_level: "full" })
    const cleared = await call(PATH, clientT, { method: "PATCH", body: JSON.stringify({ phone: "", linkedin_url: "" }) })
    ok("PATCH with empty strings succeeds", cleared.status === 200, cleared.text)
    r = await row()
    ok("...phone cleared to null", r.phone === null)
    ok("...linkedin cleared to null", r.linkedin_url === null)
  } finally {
    await admin.from("coach_clients").update({ status: link.status, access_level: link.access_level }).eq("id", link.id)
    await admin.from("network_contacts").delete().in("id", ids)
    await admin.from("network_companies").delete().eq("client_profile_id", client.id).eq("name", "Probe Co")
    console.log("\ncleaned up: probe contacts removed, coach_clients restored")
  }

  console.log(`\n${pass} passed, ${failures.length} failed`)
  if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
