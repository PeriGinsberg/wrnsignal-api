#!/usr/bin/env tsx
// Sending a client's SOW: the email, the frozen copy and its link, withdrawing
// another, undo on a failed email, and what gets recorded.
// Run: npx tsx tests/sow/send-sow.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { DEFAULT_SOW_EMAIL_BODY, defaultSowEmailBody, renderSowEmail } from "../../lib/sow/email"
import { getClientSow } from "../../lib/sow/client"
import { getSowByToken } from "../../lib/sow/public"
import { sendClientSow, type SendEmail } from "../../lib/sow/send"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CC = "cc-1"
const APP = "https://app.example"

function seed(over: { email?: string | null; parent?: string | null; lifecycle?: string; proposal?: string } = {}) {
  return makeFakeDb({
    coach_clients: [{
      id: CC, coach_profile_id: COACH, name: "Aiden Park", client_profile_id: null,
      invited_email: over.email === undefined ? "aiden@example.com" : over.email,
      parent_email: over.parent === undefined ? "mom@example.com" : over.parent,
      lifecycle_status: over.lifecycle ?? "Prospect", current_stage_key: "consult_completed",
    }],
    client_profiles: [{ id: COACH, coach_org: "Workforce Ready Now" }],
    coach_packages: [],
    coach_client_engagements: [
      { id: "eng-1", coach_client_id: CC, name: "Run the Search", discount_cents: null, source_package_id: null, proposal_status: over.proposal ?? "draft" },
      { id: "eng-2", coach_client_id: CC, name: "Foundations", discount_cents: null, source_package_id: null, proposal_status: "sent" },
    ],
    coach_client_engagement_deliverables: [
      { id: "d1", engagement_id: "eng-1", name: "Resume", phase_id: "ph-build", not_needed: false, sort_order: 1, fee_cents: 50000, source_milestone_id: null },
      { id: "d2", engagement_id: "eng-2", name: "Resume", phase_id: "ph-build", not_needed: false, sort_order: 1, fee_cents: 50000, source_milestone_id: null },
    ],
    coach_milestones: [],
    coach_phases: [{ id: "ph-build", coach_profile_id: COACH, label: "Build", sow_subtitle: "Foundations", sow_note: null, sort_order: 2 }],
    coach_sow_lines: [],
    coach_sow_settings: [],
    client_sows: [],
    coach_client_events: [],
    coach_pipeline_stages: ["consult_completed", "sow_drafted", "sow_sent", "sow_executed"].map((k, i) => ({
      coach_profile_id: COACH, stage_key: k, label: k, sort_order: i + 1, is_terminal: false, active: true,
    })),
    prospect_stage_progress: [{ coach_client_id: CC, stage_key: "consult_completed", reached_at: "2026-10-01" }],
    coach_automation_events: [],
    coach_automation_rules: [],
    coach_automation_timers: [],
  })
}

type Sent = Parameters<SendEmail>[0]
function mailer(result: "ok" | "fail" = "ok") {
  const sent: Sent[] = []
  const send: SendEmail = async (a) => {
    sent.push(a)
    return result === "ok" ? { ok: true, to: a.to, redirected: true, messageId: `msg-${sent.length}` } : { ok: false, error: "Postmark is down" }
  }
  return { sent, send }
}
const linkOf = (s: Sent) => String((s.model as any).body_text).match(/https:\/\/app\.example\/sow\/([A-Za-z0-9_-]{43})/)?.[1] ?? ""
const body = defaultSowEmailBody("Aiden Park", "Run the Search")
const go = (db: ReturnType<typeof seed>, send: SendEmail, over: Record<string, unknown> = {}, engagementId = "eng-1") =>
  sendClientSow(db.client as any, {
    coachClientId: CC, engagementId, actingIds: [COACH], actor: COACH, appUrl: APP, send,
    subject: "Your plan with Workforce Ready Now", body, ccParent: false, ...over,
  })
const row = (db: ReturnType<typeof seed>, eng: string) => db.tables.client_sows.find((r) => r.engagement_id === eng)!
const events = (db: ReturnType<typeof seed>, type: string) => db.tables.coach_client_events.filter((e) => e.event_type === type)

async function main() {
  console.log("the email")
  {
    ok("default body fills the first name and package, keeps [SOW link]",
      body.startsWith("Hi Aiden,") && body.includes("I recommend the Run the Search for your engagement") && body.includes("[SOW link]") && !body.includes("[package name]"))
    ok("the default has the phone number and the closing line", DEFAULT_SOW_EMAIL_BODY.includes("(561) 843-6269") && DEFAULT_SOW_EMAIL_BODY.endsWith("I'm looking forward to working with you."))
    const r = renderSowEmail("Hi <Aiden> & co,\n\n[SOW link]\n\nSee [sow link] too.", "https://x/sow/abc")
    ok("a paragraph that is only [SOW link] becomes the button", r.html.includes("View your Statement of Work") && r.html.includes('href="https://x/sow/abc"'))
    ok("the coach's text is escaped", r.html.includes("Hi &lt;Aiden&gt; &amp; co,") && !r.html.includes("<Aiden>"))
    ok("an inline [SOW link] becomes a link", (r.html.match(/href="https:\/\/x\/sow\/abc"/g) ?? []).length === 2)
    ok("the plain-text version carries the URL", r.text.includes("https://x/sow/abc") && !r.text.includes("[SOW link]"))
  }

  console.log("\nsending")
  {
    const db = seed()
    const m = mailer()
    const r = await go(db, m.send, { ccParent: true })
    ok("sends", r.ok, r.ok ? "" : r.error)
    const s = m.sent[0]
    ok("to the prospect, cc the parent, on the sow-ready template", s.to === "aiden@example.com" && s.cc === "mom@example.com" && s.templateAlias === "sow-ready")
    ok("with the subject and both bodies", (s.model as any).subject === "Your plan with Workforce Ready Now" && String((s.model as any).body_html).includes("View your Statement of Work"))
    const token = linkOf(s)
    ok("the link is on the app address with a 43-character code", token.length === 43)
    const sw = row(db, "eng-1")
    ok("the SOW is frozen and sent; only the code's hash is stored", sw.status === "sent" && !!sw.sent_snapshot && !!sw.token_hash && sw.token_hash !== token)
    ok("who it went to is recorded", sw.sent_to === "aiden@example.com" && sw.sent_cc === "mom@example.com" && sw.send_count === 1 && sw.sent_message_id === "msg-1")
    const pub = await getSowByToken(db.client as any, token)
    ok("the link opens the frozen copy", !!pub && pub.status === "sent" && pub.document.package_name === "Run the Search")
    ok("the package is Sent, with History", db.tables.coach_client_engagements.find((e) => e.id === "eng-1")!.proposal_status === "sent"
      && events(db, "proposal_sent").length === 1 && events(db, "sow_sent")[0].context.to === "aiden@example.com")
    ok("the prospect moves to SOW sent, through SOW drafted", db.tables.coach_clients[0].current_stage_key === "sow_sent"
      && db.tables.prospect_stage_progress.map((p) => p.stage_key).join() === "consult_completed,sow_drafted,sow_sent")
    ok("the sow.sent event is emitted for the follow-up timer", db.tables.coach_automation_events.some((e) => e.event_key === "sow.sent"))

    const sowNow = await getClientSow(db.client as any, CC, "eng-1")
    ok("the panel shows it sent, unchanged", sowNow.ok && !!sowNow.data.sent && sowNow.data.sent.to === "aiden@example.com" && !sowNow.data.changed_since_sent)
    db.tables.coach_client_engagement_deliverables.find((d) => d.id === "d1")!.fee_cents = 60000
    const changed = await getClientSow(db.client as any, CC, "eng-1")
    ok("a change after sending is flagged, and the link still shows what was sent", changed.ok && changed.data.changed_since_sent
      && (await getSowByToken(db.client as any, token))!.document.payment.total_cents === 50000)

    const m2 = mailer()
    const again = await go(db, m2.send)
    const token2 = linkOf(m2.sent[0])
    ok("re-sending makes a new link", again.ok && token2.length === 43 && token2 !== token)
    ok("the old link stops working; the new one shows the new copy", !(await getSowByToken(db.client as any, token))
      && (await getSowByToken(db.client as any, token2))!.document.payment.total_cents === 60000)
    ok("History says re-sent; no cc this time", events(db, "sow_sent").length === 2 && events(db, "sow_sent")[1].context.send === 2 && row(db, "eng-1").sent_cc === null)
  }

  console.log("\none sent SOW per client")
  {
    const db = seed()
    await go(db, mailer().send, {}, "eng-2")
    const first = row(db, "eng-2")
    ok("Foundations' SOW is out", first.status === "sent")
    const before = await getClientSow(db.client as any, CC, "eng-1")
    ok("the other package's panel names it", before.ok && before.data.other_sent?.package_name === "Foundations")
    const m = mailer()
    await go(db, m.send)
    ok("sending Run the Search withdraws Foundations: back to draft, link dead", row(db, "eng-2").status === "draft" && row(db, "eng-2").token_hash === null)
    ok("and Foundations' package goes back to Draft", db.tables.coach_client_engagements.find((e) => e.id === "eng-2")!.proposal_status === "draft")
    ok("History records the withdrawal", events(db, "sow_withdrawn")[0]?.context.replaced_by === "Run the Search")
  }

  console.log("\na failed email changes nothing")
  {
    const db = seed()
    await go(db, mailer().send, {}, "eng-2")
    const outBefore = { ...row(db, "eng-2") }
    const m = mailer("fail")
    const r = await go(db, m.send)
    ok("reports the failure", !r.ok && r.status === 502)
    ok("this SOW is not marked sent and has no link", row(db, "eng-1").status === "draft" && row(db, "eng-1").token_hash === null && row(db, "eng-1").send_count === 0)
    ok("the other SOW is still out, its link intact", row(db, "eng-2").status === "sent" && row(db, "eng-2").token_hash === outBefore.token_hash)
    ok("nothing recorded: package still Draft, no History, no stage move", db.tables.coach_client_engagements.find((e) => e.id === "eng-1")!.proposal_status === "draft"
      && events(db, "sow_sent").length === 1 && db.tables.coach_clients[0].current_stage_key === "sow_sent")
  }

  console.log("\nrefused")
  {
    const bad = async (label: string, db: ReturnType<typeof seed>, over: Record<string, unknown> = {}) => {
      const m = mailer()
      const r = await go(db, m.send, over)
      ok(label, !r.ok && m.sent.length === 0 && db.tables.client_sows.every((s) => s.status !== "sent"))
    }
    await bad("no email on the record", seed({ email: null }))
    await bad("a message without [SOW link]", seed(), { body: "Hi Aiden, here it is." })
    await bad("an empty subject", seed(), { subject: "  " })
    await bad("cc the parent with no parent email", seed({ parent: null }), { ccParent: true })
    await bad("an approved package", seed({ proposal: "approved" }))
    const db = seed()
    db.tables.coach_client_engagement_deliverables.find((d) => d.id === "d1")!.not_needed = true
    await bad("a SOW with nothing in it", db)
  }

  console.log("\na client (not a prospect)")
  {
    const db = seed({ lifecycle: "Active" })
    const r = await go(db, mailer().send)
    ok("sends, and moves no stage", r.ok && db.tables.coach_clients[0].current_stage_key === "consult_completed")
  }

  console.log("\nthe link")
  {
    const db = seed()
    ok("a malformed code finds nothing", (await getSowByToken(db.client as any, "abc")) === null && (await getSowByToken(db.client as any, null)) === null)
    ok("an unknown code finds nothing", (await getSowByToken(db.client as any, "A".repeat(43))) === null)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
