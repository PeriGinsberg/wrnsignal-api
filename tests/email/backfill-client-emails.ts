#!/usr/bin/env tsx
// tests/email/backfill-client-emails.ts
//
// One-time: load the client emails Postmark still remembers (roughly the last
// 45 days) into the email log, so the Communications tab is not empty on day
// one. Everything sent from now on is logged at send time by sendToClient.
//
// WHAT IT LOADS
//   - the signal-client stream: every email sent through sendToClient
//   - the old stream: only the SIGNAL invite ("Your SIGNAL account is ready")
//   - real sends only: a test send redirected to Peri ("[staging -> ...]") is
//     skipped
//   - only emails whose recipient matches exactly one client or prospect
//
// Each row is marked backfilled. The type comes from the subject or from the
// message id SIGNAL already recorded; who sent it is the actor on the matching
// History line within 10 minutes, or left empty. Private links are replaced,
// exactly as at send time (lib/email/clientEmailLog.ts).
//
// DRY RUN BY DEFAULT. --apply writes. Re-runnable: rows are keyed on the
// Postmark message id, so a second run adds nothing.
//
// Credentials come from the shell, never a .env file:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POSTMARK_API_KEY
//   (optional) POSTMARK_MESSAGE_STREAM, the old stream, default "outbound"
//
//   npx tsx tests/email/backfill-client-emails.ts --target dev
//   npx tsx tests/email/backfill-client-emails.ts --target dev --apply
//   (--verbose lists every skipped email and why)
//
// --target must match the database: dev is zydrqckpwidipwbhrfgd, prod is
// ejhnokcnahauvrcbcmic (DEVELOPMENT.md). A mismatch aborts.

import { createClient } from "@supabase/supabase-js"
import { redactRow, type ClientEmailRow, type ClientEmailType } from "../../lib/email/clientEmailLog"

const REFS = { dev: "zydrqckpwidipwbhrfgd", prod: "ejhnokcnahauvrcbcmic" } as const
const target = process.argv[process.argv.indexOf("--target") + 1] as keyof typeof REFS
const apply = process.argv.includes("--apply")
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const pmKey = process.env.POSTMARK_API_KEY
if (!process.argv.includes("--target") || !REFS[target]) throw new Error("Pass --target dev or --target prod")
if (!url || !key || !pmKey) throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and POSTMARK_API_KEY")
if (!url.includes(REFS[target])) throw new Error(`--target ${target} but SUPABASE_URL is ${url}. Aborting.`)

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const CLIENT_STREAM = process.env.POSTMARK_STREAM_CLIENT ?? "signal-client"
const OLD_STREAM = process.env.POSTMARK_MESSAGE_STREAM ?? "outbound"

async function pm(path: string): Promise<any> {
  const res = await fetch("https://api.postmarkapp.com" + path, {
    headers: { Accept: "application/json", "X-Postmark-Server-Token": pmKey! },
  })
  if (!res.ok) throw new Error(`Postmark ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function listStream(stream: string): Promise<any[]> {
  const out: any[] = []
  for (let offset = 0; offset < 10000; offset += 500) {
    const page = await pm(`/messages/outbound?count=500&offset=${offset}&messagestream=${encodeURIComponent(stream)}`)
    out.push(...(page.Messages ?? []))
    if ((page.Messages ?? []).length < 500) break
  }
  return out
}

/** History lines that record each kind of send, in the order to trust them. */
const EVENTS: Record<ClientEmailType, string[]> = {
  sow: ["sow_sent"],
  welcome: ["welcome_email_sent"],
  invite: ["invite_sent"],
  practice_round: ["practice_round_sent"],
  practice_feedback: ["practice_feedback_sent"],
  networking_plan: ["networking_plan_shared", "client_email_sent"],
}

function typeFromSubject(subject: string): ClientEmailType | null {
  if (/^Your SIGNAL account is ready/i.test(subject)) return "invite"
  if (/sent you a practice round$/i.test(subject)) return "practice_round"
  if (/left feedback on your practice round$/i.test(subject)) return "practice_feedback"
  if (/^Your networking plan is ready$/i.test(subject)) return "networking_plan"
  return null
}

async function main() {
  // Who each address belongs to.
  const { data: ccs, error: ccErr } = await db.from("coach_clients").select("id, invited_email, client_profile_id, status")
  if (ccErr) throw new Error(ccErr.message)
  const profIds = (ccs ?? []).map((c: any) => c.client_profile_id).filter(Boolean)
  const profEmail = new Map<string, string>()
  for (let i = 0; i < profIds.length; i += 200) {
    const { data, error } = await db.from("client_profiles").select("id, email").in("id", profIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const p of data ?? []) if (p.email) profEmail.set(p.id, p.email)
  }
  const byEmail = new Map<string, { id: string; status: string }[]>()
  for (const c of (ccs ?? []) as any[]) {
    for (const e of new Set([c.invited_email, profEmail.get(c.client_profile_id)].filter(Boolean).map((x: string) => x.trim().toLowerCase()))) {
      byEmail.set(e, [...(byEmail.get(e) ?? []), { id: c.id, status: c.status }])
    }
  }
  const owner = (email: string): string | null => {
    const all = byEmail.get(email.trim().toLowerCase()) ?? []
    const active = all.filter((c) => c.status === "active")
    const pick = active.length ? active : all
    return pick.length === 1 ? pick[0].id : null
  }

  // Message ids SIGNAL already recorded.
  const { data: sows } = await db.from("client_sows").select("sent_message_id").not("sent_message_id", "is", null)
  const sowIds = new Set((sows ?? []).map((s: any) => s.sent_message_id))
  const { data: welcomes } = await db.from("coach_client_events").select("context").eq("event_type", "welcome_email_sent")
  const welcomeIds = new Set((welcomes ?? []).map((w: any) => w.context?.message_id).filter(Boolean))

  const messages = [
    ...(await listStream(CLIENT_STREAM)).map((m) => ({ ...m, _stream: CLIENT_STREAM })),
    ...(await listStream(OLD_STREAM)).map((m) => ({ ...m, _stream: OLD_STREAM })),
  ]
  console.log(`Postmark: ${messages.length} messages on ${CLIENT_STREAM} + ${OLD_STREAM}`)

  const skipped: Record<string, number> = {}
  const verbose = process.argv.includes("--verbose")
  const skip = (why: string, m?: any) => {
    skipped[why] = (skipped[why] ?? 0) + 1
    if (verbose && m) console.log(`  skip  ${why}: ${m.Subject} -> ${(m.Recipients ?? [])[0] ?? "?"}`)
  }
  const rows: ClientEmailRow[] = []

  for (const m of messages) {
    const subject: string = m.Subject ?? ""
    if (/^\[[^\]]*->[^\]]*\]/.test(subject)) { skip("test send redirected to Peri"); continue }
    const type: ClientEmailType | null =
      sowIds.has(m.MessageID) ? "sow"
      : welcomeIds.has(m.MessageID) ? "welcome"
      : typeFromSubject(subject)
    if (!type) { skip(m._stream === CLIENT_STREAM ? "client stream, type not recognised" : "old stream, not an invite", m._stream === CLIENT_STREAM ? m : undefined); continue }
    if (m._stream === OLD_STREAM && type !== "invite") { skip("old stream, not an invite"); continue }
    const to = (m.Recipients ?? m.To?.map((t: any) => t.Email) ?? [])[0]
    const ccId = to ? owner(to) : null
    if (!ccId) { skip("recipient is not exactly one client or prospect", m); continue }

    const d = await pm(`/messages/outbound/${m.MessageID}/details`)
    const sentAt: string = new Date(d.ReceivedAt).toISOString()

    // Who clicked: the actor on the matching History line within 10 minutes.
    const lo = new Date(Date.parse(sentAt) - 10 * 60_000).toISOString()
    const hi = new Date(Date.parse(sentAt) + 10 * 60_000).toISOString()
    const { data: evs } = await db.from("coach_client_events").select("event_type, actor_profile_id, created_at")
      .eq("coach_client_id", ccId).in("event_type", EVENTS[type]).gte("created_at", lo).lte("created_at", hi)
    const actor = ((evs ?? []) as any[])
      .filter((e) => e.actor_profile_id)
      .sort((a, b) => Math.abs(Date.parse(a.created_at) - Date.parse(sentAt)) - Math.abs(Date.parse(b.created_at) - Date.parse(sentAt)))[0]?.actor_profile_id ?? null

    rows.push(redactRow({
      coach_client_id: ccId,
      email_type: type,
      sent_at: sentAt,
      from_email: String(d.From ?? "").replace(/^.*<([^>]+)>.*$/, "$1"),
      to_email: to,
      cc_email: (d.Cc ?? []).map((c: any) => c.Email).join(", ") || null,
      bcc_emails: [],
      delivered_to: to,
      redirected: false,
      subject,
      text_body: d.TextBody ?? null,
      html_body: d.HtmlBody ?? null,
      triggered_by: actor,
      postmark_message_id: m.MessageID,
      backfilled: true,
    }))
  }

  for (const r of rows) {
    console.log(`  ${r.sent_at?.slice(0, 16)}  ${r.email_type.padEnd(17)} ${r.to_email.padEnd(36)} sender ${r.triggered_by ? "found" : "unknown"}  ${r.subject}`)
  }
  console.log(`\n${rows.length} to load. Skipped: ${JSON.stringify(skipped)}`)
  const leaks = rows.filter((r) => /\/sow\/[A-Za-z0-9_-]{20,}|\/auth\/v1\/verify\?/.test(`${r.text_body}${r.html_body}`))
  if (leaks.length) throw new Error(`${leaks.length} row(s) still carry a private link. Nothing written.`)

  if (!apply) { console.log("Dry run. Re-run with --apply to write."); return }
  const { error } = await db.from("client_emails").upsert(rows, { onConflict: "postmark_message_id", ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  console.log(`Wrote up to ${rows.length} rows to ${target} (existing message ids left alone).`)
}

main().catch((e) => { console.error(e); process.exit(1) })
