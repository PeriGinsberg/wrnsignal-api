#!/usr/bin/env tsx
// Load the Release-step emails from docs/WRN Coaching Workflow Workbook.md
// (Part 4) into one coach's Settings > Services > Release emails.
//
// Each "#### R<n>. <step>" sheet with an "**Email body**" becomes the email for
// the library client step of that name ("(optional)" ignored). Sheets with no
// email body (R5, R12, R14, R16, and R10, which rides on the Share plan email)
// load nothing. On the way in:
//   {{contact.first_name}}              -> [First Name]
//   {{contact.client_drive_folder_link}} -> [Drive folder link]
//   the sheet's Booking link in the body -> [Scheduling link], and the link
//                                           itself is saved as the step's link
//   the closing "Best, Peri"            -> dropped (the coach's signature goes on at send)
//   Markdown escapes and bold           -> plain text; "* " bullets become "- "
//
// --parse-only shows what the workbook holds, with no database. Otherwise a dry
// run unless --apply. It refuses to replace an email the coach already has with
// different text unless --overwrite. Run after
// tests/package-seed/apply-workbook-library.ts, which gives the steps the
// workbook's names.
//
// USAGE:
//   npx tsx tests/release/load-release-emails.ts --parse-only
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... COACH_EMAIL=peri@workforcereadynow.com \
//   NODE_OPTIONS=--use-system-ca npx tsx tests/release/load-release-emails.ts [--apply] [--overwrite]
// Against prod, also set ALLOW_PROD=yes.
//
// Creds come from process.env only; this file never reads .env*.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { getReleaseSteps, saveReleaseTemplate } from "../../lib/release/service"

const PROD_REF = "ejhnokcnahauvrcbcmic" // DEVELOPMENT.md, "The mental model"
const DOC = "docs/WRN Coaching Workflow Workbook.md"

const parseOnly = process.argv.includes("--parse-only")
const apply = process.argv.includes("--apply")
const overwrite = process.argv.includes("--overwrite")

function req(name: string, alt?: string): string {
  const v = process.env[name] || (alt ? process.env[alt] : undefined)
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}

/** A step name as matched: case, spacing and a trailing "(optional)" ignored. */
export const stepKey = (s: string) => s.replace(/\(optional\)/i, "").trim().replace(/\s+/g, " ").toLowerCase()

export type Sheet = { code: string; step: string; subject: string | null; body: string | null; booking: string | null }

/** Markdown escapes off: \[ \] \_ \* and friends. */
const unescape = (s: string) => s.replace(/\\([[\]_*#()`>~|-])/g, "$1")

function toPlain(lines: string[], booking: string | null): string {
  let text = lines
    .map((l) => unescape(l.trimEnd()).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*[*]\s+/, "- "))
    .join("\n")
    .replace(/\{\{\s*contact\.first_name\s*\}\}/gi, "[First Name]")
    .replace(/\{\{\s*contact\.client_drive_folder_link\s*\}\}/gi, "[Drive folder link]")
  if (booking) text = text.split(booking).join("[Scheduling link]")
  text = text.replace(/\n{3,}/g, "\n\n").trim()
  // The sign-off: the coach's signature goes on at send.
  return text.replace(/\n+Best,\s*Peri\.?\s*$/i, "").trim()
}

/** Part 4's R sheets, in order. A sheet with no "**Email body**" has body null. */
export function parseWorkbook(md: string): Sheet[] {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+Part 4\b/i.test(l))
  if (start < 0) throw new Error("The workbook has no Part 4.")
  const endRel = lines.slice(start + 1).findIndex((l) => /^##\s+Part \d+\b/i.test(l))
  const part = lines.slice(start + 1, endRel < 0 ? undefined : start + 1 + endRel)

  const out: Sheet[] = []
  let cur: (Sheet & { bodyLines: string[] | null }) | null = null
  const finish = () => {
    if (!cur) return
    const body = cur.bodyLines ? toPlain(cur.bodyLines, cur.booking) : null
    if (body !== null && !cur.subject) throw new Error(`${cur.code}: an email body but no Subject`)
    out.push({ code: cur.code, step: cur.step, subject: cur.subject ? unescape(cur.subject) : null, body: body || null, booking: cur.booking })
    cur = null
  }
  for (const raw of part) {
    const line = raw.trimEnd()
    const h = line.match(/^####\s+(R\d+)\.\s+(.+)$/)
    if (h) { finish(); cur = { code: h[1], step: unescape(h[2].trim()), subject: null, body: null, booking: null, bodyLines: null }; continue }
    if (/^#{2,4}\s/.test(line)) { finish(); continue } // a W sheet or a phase heading ends the sheet
    if (!cur) continue
    if (cur.bodyLines) { cur.bodyLines.push(line); continue }
    if (/^\*\*Email body\*\*\s*$/i.test(line.trim())) { cur.bodyLines = []; continue }
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/)
    if (row) {
      if (/^booking link$/i.test(row[1])) cur.booking = row[2].trim() || null
      if (/^subject$/i.test(row[1])) cur.subject = row[2].trim() || null
    }
  }
  finish()
  return out
}

async function main() {
  const sheets = parseWorkbook(readFileSync(DOC, "utf8"))
  for (const s of sheets) {
    console.log(`\n${s.code}. ${s.step}${s.body ? "" : "  (no email)"}`)
    if (!s.body) continue
    console.log(`  subject: ${s.subject}`)
    console.log(`  link:    ${s.booking ?? "none"}`)
    console.log(s.body.split("\n").map((l) => `  | ${l}`).join("\n"))
  }
  const withEmail = sheets.filter((s) => s.body)
  console.log(`\n${withEmail.length} emails, ${sheets.length - withEmail.length} steps with none (${sheets.filter((s) => !s.body).map((s) => s.code).join(", ")}).`)
  if (parseOnly) return

  const url = req("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
  const ref = new URL(url).hostname.split(".")[0]
  const email = req("COACH_EMAIL").trim().toLowerCase()
  if (ref === PROD_REF && process.env.ALLOW_PROD !== "yes") {
    console.error("This is PROD. Set ALLOW_PROD=yes to run against it.")
    process.exit(2)
  }
  const db = createClient(url, req("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
  console.log(`\nProject: ${ref}${ref === PROD_REF ? " (PROD)" : ""}   Mode: ${apply ? "APPLY" : "dry run"}${overwrite ? " +overwrite" : ""}`)

  const { data: profiles, error } = await db.from("client_profiles").select("id, email, is_coach").ilike("email", `%${email}%`)
  if (error) throw new Error(`client_profiles: ${error.message}`)
  const coach = ((profiles ?? []) as { id: string; email: string; is_coach: boolean }[]).filter((p) => p.email.trim().toLowerCase() === email)
  if (coach.length !== 1 || !coach[0].is_coach) throw new Error(`expected one coach profile for ${email}, found ${coach.length}`)
  const coachId = coach[0].id
  console.log(`Coach: ${email}  ${coachId}`)

  const steps = await getReleaseSteps(db as any, coachId) // throws if migration 20261019 is missing
  const plan = withEmail.map((s) => {
    const matches = steps.filter((x) => stepKey(x.name) === stepKey(s.step))
    const have = matches[0]?.template ?? null
    const same = !!have && have.subject === s.subject && have.body === s.body && (have.scheduling_link ?? null) === s.booking
    const verdict = matches.length === 0 ? "NO STEP" : matches.length > 1 ? "AMBIGUOUS" : !have ? "new" : same ? "already loaded" : "different"
    return { s, step: matches[0] ?? null, verdict }
  })
  for (const x of plan) console.log(`  ${x.s.code.padEnd(4)} ${x.s.step.padEnd(42)} ${x.verdict}${x.step ? `  (${x.step.deliverable})` : ""}`)
  if (plan.some((x) => x.verdict === "NO STEP" || x.verdict === "AMBIGUOUS")) {
    throw new Error("Nothing written: a sheet above matches no client step in this coach's library, or more than one. Run apply-workbook-library.ts first.")
  }
  if (plan.some((x) => x.verdict === "different") && !overwrite) {
    throw new Error("Nothing written; this coach already has different text for a step above (re-run with --overwrite to replace it).")
  }
  if (!apply) { console.log("\nDry run: nothing written. Re-run with --apply."); return }

  for (const x of plan) {
    if (x.verdict === "already loaded") continue
    const r = await saveReleaseTemplate(db as any, coachId, {
      activity_id: x.step!.activity_id, subject: x.s.subject, body: x.s.body, scheduling_link: x.s.booking,
    })
    if (!r.ok) throw new Error(`${x.s.code}: ${r.error}`)
  }
  const after = await getReleaseSteps(db as any, coachId)
  for (const x of plan) {
    const t = after.find((a) => a.activity_id === x.step!.activity_id)?.template
    if (!t || t.subject !== x.s.subject || t.body !== x.s.body) throw new Error(`read-back does not match the workbook for ${x.s.code}`)
  }
  console.log(`\nAll ${plan.length} release emails loaded and verified.`)
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tests/release/load-release-emails.ts")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
