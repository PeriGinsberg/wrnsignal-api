#!/usr/bin/env tsx
// Load docs/WRN_Welcome_Emails.md into one coach's Settings > Services >
// Welcome emails: the subject and message of each of the four templates.
//
// The scheduling links are NOT in the doc (it names the Calendly session, not
// its address), so they are never written here: a template keeps the link it
// has, and a new one starts without. Paste them in Settings.
//
// --parse-only shows what the doc holds, with no database. Otherwise a dry run
// unless --apply. It refuses to replace a template the coach already has with
// different text unless --overwrite.
//
// USAGE:
//   npx tsx tests/welcome/load-welcome-emails.ts --parse-only
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... COACH_EMAIL=peri@workforcereadynow.com \
//   NODE_OPTIONS=--use-system-ca npx tsx tests/welcome/load-welcome-emails.ts [--apply] [--overwrite]
// Against prod, also set ALLOW_PROD=yes.
//
// Creds come from process.env only; this file never reads .env*.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { WELCOME_START_LABEL, WELCOME_STARTS, type WelcomeStart } from "../../lib/welcome/model"
import { getWelcomeTemplates, saveWelcomeTemplate } from "../../lib/welcome/service"

const PROD_REF = "ejhnokcnahauvrcbcmic" // DEVELOPMENT.md, "The mental model"
const DOC = "docs/WRN_Welcome_Emails.md"

const parseOnly = process.argv.includes("--parse-only")
const apply = process.argv.includes("--apply")
const overwrite = process.argv.includes("--overwrite")

function req(name: string, alt?: string): string {
  const v = process.env[name] || (alt ? process.env[alt] : undefined)
  if (!v) { console.error(`Missing ${name}`); process.exit(2) }
  return v
}
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()

type Parsed = { start: WelcomeStart; subject: string; body: string; calendly: string | null }

/** "## 1. Starts with Your SIGNAL DNA" sections; "**Subject:**" then the message up to "---". */
export function parse(md: string): Parsed[] {
  const byLabel = new Map(WELCOME_STARTS.map((k) => [norm(WELCOME_START_LABEL[k]), k]))
  const out: Parsed[] = []
  let cur: (Parsed & { lines: string[]; inBody: boolean }) | null = null
  const finish = () => {
    if (!cur) return
    cur.body = cur.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
    if (!cur.subject) throw new Error(`${WELCOME_START_LABEL[cur.start]}: no **Subject:** line`)
    if (!cur.body) throw new Error(`${WELCOME_START_LABEL[cur.start]}: no message`)
    out.push({ start: cur.start, subject: cur.subject, body: cur.body, calendly: cur.calendly })
    cur = null
  }
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const h = line.match(/^##\s+\d+\.\s+Starts with\s+(.+)$/i)
    if (h) {
      finish()
      const start = byLabel.get(norm(h[1]))
      if (!start) throw new Error(`Unknown starting point: ${h[1]}`)
      cur = { start, subject: "", body: "", calendly: null, lines: [], inBody: false }
      continue
    }
    if (!cur) continue
    if (line.trim() === "---") { finish(); continue }
    if (!cur.inBody) {
      const s = line.match(/^\*\*Subject:\*\*\s*(.+)$/)
      if (s) { cur.subject = s[1].trim(); cur.inBody = true; continue }
      const c = line.match(/^Scheduling link:\s*(.+)$/i)
      if (c) cur.calendly = c[1].trim()
      continue
    }
    cur.lines.push(line.trim())
  }
  finish()
  const missing = WELCOME_STARTS.filter((k) => !out.some((p) => p.start === k))
  if (missing.length) throw new Error(`The doc has no template for: ${missing.map((k) => WELCOME_START_LABEL[k]).join(", ")}`)
  return out
}

async function main() {
  const doc = parse(readFileSync(DOC, "utf8"))
  for (const p of doc) {
    console.log(`\n${WELCOME_START_LABEL[p.start]}  (Calendly session: ${p.calendly ?? "not named"})`)
    console.log(`  subject: ${p.subject}`)
    console.log(p.body.split("\n").map((l) => `  | ${l}`).join("\n"))
  }
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

  const current = await getWelcomeTemplates(db as any, coachId) // throws if migration 20261013 is missing
  const plan = doc.map((p) => {
    const have = current.find((c) => c.start_key === p.start)
    const same = !!have && have.subject === p.subject && have.body === p.body
    return { p, have, verdict: !have ? "new" : same ? "already loaded" : "different" }
  })
  for (const x of plan) console.log(`  ${WELCOME_START_LABEL[x.p.start].padEnd(16)} ${x.verdict}${x.have?.scheduling_link ? `  (keeps link ${x.have.scheduling_link})` : "  (no scheduling link yet)"}`)
  if (plan.some((x) => x.verdict === "different") && !overwrite) {
    throw new Error("Nothing written; this coach already has different text for a template above (re-run with --overwrite to replace it).")
  }
  if (!apply) { console.log("\nDry run: nothing written. Re-run with --apply."); return }

  for (const x of plan) {
    if (x.verdict === "already loaded") continue
    const r = await saveWelcomeTemplate(db as any, coachId, {
      start_key: x.p.start, subject: x.p.subject, body: x.p.body, scheduling_link: x.have?.scheduling_link ?? null,
    })
    if (!r.ok) throw new Error(`${WELCOME_START_LABEL[x.p.start]}: ${r.error}`)
  }
  const after = await getWelcomeTemplates(db as any, coachId)
  for (const p of doc) {
    const a = after.find((t) => t.start_key === p.start)
    if (!a || a.subject !== p.subject || a.body !== p.body) throw new Error(`read-back does not match the doc for ${WELCOME_START_LABEL[p.start]}`)
  }
  console.log("\nAll four welcome emails loaded and verified. Add each scheduling link in Settings > Services > Welcome emails.")
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("tests/welcome/load-welcome-emails.ts")) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
