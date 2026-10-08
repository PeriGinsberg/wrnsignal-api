#!/usr/bin/env tsx
// Resume Workshop, live check against the local dev server and the DEV database.
//
// Signs in as dev test accounts WITHOUT a password or an email: an admin
// sign-in link is generated and exchanged on the spot (nothing is sent). Then,
// over real HTTP: access control (no login, a client, another coach), start
// with entries from the resume, autosave and stale-save refusal, persistence on
// reload, Quick Capture copy and move, the Markdown export, the resume on file
// unchanged, and an existing workbook route still answering. The workshop it
// creates is deleted at the end.
//
// DEV ONLY: refuses any SUPABASE_URL but dev's. Credentials come from the
// environment; this file never reads a .env file.
//
//   node --use-system-ca --env-file=.env.local --env-file=.env.development.local \
//     node_modules/tsx/dist/cli.mjs tests/resume-workshop/live-smoke.ts

import { createHash } from "crypto"
import { createClient } from "@supabase/supabase-js"
import { TABS, TAB_LABEL } from "../../lib/resumeWorkshop/model"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000"
const COACH = "peri+democoach@workforcereadynow.com"
const OTHER_COACH = "peri+devcoach1@workforcereadynow.com"
const CLIENT = "peri+demojordan@workforcereadynow.com"

function need(name: string): string {
  const v = process.env[name]
  if (!v) { console.error(`${name} is not set.`); process.exit(1) }
  return v
}
const url = need("SUPABASE_URL")
if (!url.includes(DEV_REF)) { console.error("Refusing: SUPABASE_URL is not dev."); process.exit(1) }
const admin = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
const anon = createClient(url, need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } })

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

async function tokenFor(email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (error || !data?.properties?.hashed_token) return null
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token })
  if (e2) return null
  return s.session?.access_token ?? null
}

const api = (cc: string) => `${BASE}/api/coach/coach-clients/${cc}/resume-workshop`
async function call(token: string | null, path: string, body?: Record<string, unknown>) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let j: any = null
  try { j = JSON.parse(text) } catch { /* the export is Markdown */ }
  return { res, j, text }
}

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 12)

async function main() {
  const { data: coachRow } = await admin.from("client_profiles").select("id").ilike("email", COACH).maybeSingle()
  if (!coachRow) { console.error(`No ${COACH} in dev.`); process.exit(1) }

  // A client of the demo coach with a resume on file and no workshop yet.
  const { data: ccs } = await admin.from("coach_clients").select("id, name, client_profile_id").eq("coach_profile_id", coachRow.id).eq("status", "active")
  let target: { id: string; name: string; client_profile_id: string } | null = null
  for (const c of (ccs ?? []) as { id: string; name: string; client_profile_id: string | null }[]) {
    if (!c.client_profile_id) continue
    const { data: ws } = await admin.from("resume_workshops").select("id").eq("coach_client_id", c.id).maybeSingle()
    if (ws) continue
    const { data: ps } = await admin.from("client_personas").select("resume_text").eq("profile_id", c.client_profile_id).is("archived_at", null)
    if ((ps ?? []).some((p: { resume_text: string | null }) => p.resume_text?.trim())) { target = c as typeof target; break }
  }
  if (!target) { console.error("No demo-coach client with a resume and no workshop."); process.exit(1) }
  console.log(`Testing on ${target.name} (relationship ${target.id})\n`)
  const resumeBefore = sha([
    (await admin.from("client_personas").select("id, resume_text, updated_at").eq("profile_id", target.client_profile_id)).data,
    (await admin.from("client_profiles").select("resume_text, profile_text").eq("id", target.client_profile_id)).data,
  ])

  const coach = await tokenFor(COACH)
  const other = await tokenFor(OTHER_COACH)
  const client = await tokenFor(CLIENT)
  ok("signed in as the coach (no password, no email)", !!coach)
  if (!coach) process.exit(1)

  console.log("\naccess")
  ok("no login: refused", (await call(null, api(target.id))).res.status === 401)
  if (client) {
    const r = await call(client, api(target.id))
    ok("a client: refused", r.res.status >= 400 && r.res.status < 500, String(r.res.status))
    ok("a client cannot export", (await call(client, `${api(target.id)}/export`)).res.status >= 400)
  } else console.log("  skip  client account not available")
  if (other) {
    const r = await call(other, api(target.id))
    ok("another coach: not found", r.res.status === 403 || r.res.status === 404, String(r.res.status))
    ok("another coach cannot write", (await call(other, api(target.id), { action: "start" })).res.status >= 400)
  } else console.log("  skip  second coach account not available")

  console.log("\nstart and entries from the resume")
  let r = await call(coach, api(target.id))
  ok("before the first open there is no workshop", r.res.ok && r.j.workshop === null)
  r = await call(coach, api(target.id), { action: "start" })
  ok("started", r.res.ok && r.j.ok)
  r = await call(coach, api(target.id))
  const prefilled = r.j.entries.length
  ok("resume shown beside the notes", !!r.j.resume?.text, r.j.resume?.label)
  console.log(`        entries from the resume: ${prefilled} (${r.j.entries.map((e: any) => e.tab).join(", ") || "none: no recognised headings"})`)

  console.log("\nautosave")
  const add = await call(coach, api(target.id), { action: "add_entry", tab: "experience" })
  ok("added an entry", add.res.ok && add.j.ok)
  const id = add.j.data.id
  const s1 = await call(coach, api(target.id), { action: "save_entry", entry_id: id, field: "notes", value: "Led launch of 3 products.\nGrew list 40% (estimate).", base_version: 0 })
  ok("saved notes", s1.res.ok && s1.j.data.notes_version === 1)
  const stale = await call(coach, api(target.id), { action: "save_entry", entry_id: id, field: "notes", value: "STALE", base_version: 0 })
  ok("a stale save is refused with the current text", stale.res.status === 409 && stale.j.current?.notes?.startsWith("Led launch"))
  await call(coach, api(target.id), { action: "save_entry", entry_id: id, field: "title", value: "Acme Corp, Marketing Intern", base_version: 0 })
  const g = await call(coach, api(target.id), { action: "general", value: "Strong leadership stories.", base_version: 0 })
  ok("general notes saved", g.res.ok)
  r = await call(coach, api(target.id))
  const e = r.j.entries.find((x: any) => x.id === id)
  ok("a fresh load (a refresh) has every saved value", e?.notes.startsWith("Led launch") && e?.title === "Acme Corp, Marketing Intern" && r.j.workshop.general_notes === "Strong leadership stories.")

  console.log("\nQuick Capture")
  const c1 = await call(coach, api(target.id), { action: "add_capture", body: "UNASSIGNED: mentioned a podcast" })
  const c2 = await call(coach, api(target.id), { action: "add_capture", body: "MOVE ME: won the case competition" })
  const c3 = await call(coach, api(target.id), { action: "add_capture", body: "COPY ME: manager praised her" })
  ok("notes captured", c1.res.ok && c2.res.ok && c3.res.ok)
  const mv = await call(coach, api(target.id), { action: "capture_to_entry", capture_id: c2.j.data.id, entry_id: id, mode: "move" })
  const cp = await call(coach, api(target.id), { action: "capture_to_entry", capture_id: c3.j.data.id, entry_id: id, mode: "copy" })
  ok("moved and copied into the entry", mv.res.ok && cp.res.ok && cp.j.data.entry.notes.includes("MOVE ME") && cp.j.data.entry.notes.includes("COPY ME"))
  r = await call(coach, api(target.id))
  ok("captures persist with their state", r.j.captures.length === 3 && r.j.captures.some((c: any) => c.moved_to_entry_id === id) && r.j.captures.some((c: any) => c.copied_to_entry_id === id))

  console.log("\nexport")
  const ex = await call(coach, `${api(target.id)}/export`)
  const md = ex.text
  ok("downloads as Markdown", ex.res.ok && (ex.res.headers.get("content-type") ?? "").includes("text/markdown") && /attachment; filename="Resume-Workshop-.+\.md"/.test(ex.res.headers.get("content-disposition") ?? ""))
  ok("every tab is in it", TABS.every((t, i) => md.includes(`## ${i + 1}. ${TAB_LABEL[t]}`)))
  ok("notes word for word", md.includes("Led launch of 3 products.\nGrew list 40% (estimate)."))
  ok("all Quick Capture notes, including unassigned", ["UNASSIGNED: mentioned a podcast", "MOVE ME", "COPY ME"].every((t) => md.includes(t)) && md.includes("### Unassigned"))
  ok("general notes and the entry title", md.includes("Strong leadership stories.") && md.includes("### Acme Corp, Marketing Intern"))
  ok(`entries from the resume are labelled (${prefilled})`, prefilled === 0 || md.includes("From the original resume (imported, not coach notes)"))

  console.log("\nthe resume on file")
  const resumeAfter = sha([
    (await admin.from("client_personas").select("id, resume_text, updated_at").eq("profile_id", target.client_profile_id)).data,
    (await admin.from("client_profiles").select("resume_text, profile_text").eq("id", target.client_profile_id)).data,
  ])
  ok("personas and profile resume unchanged", resumeBefore === resumeAfter)

  console.log("\nworkbooks still answer")
  const wb = await call(coach, `${BASE}/api/coach/clients/${target.client_profile_id}/workbooks`)
  ok("the client's workbook list loads", wb.res.ok, String(wb.res.status))

  // Clean up the test workshop (cascade removes its rows).
  const { error } = await admin.from("resume_workshops").delete().eq("coach_client_id", target.id)
  console.log(error ? `\nCLEANUP FAILED: ${error.message}` : "\nTest workshop removed.")

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
