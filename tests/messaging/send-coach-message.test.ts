#!/usr/bin/env tsx
// The Message button's send: who it is from and to, the copies, the redirect
// outside production, the log row, and the delivery webhook.
// Run: npx tsx tests/messaging/send-coach-message.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { composeMessage } from "../../lib/messaging/compose"
import { isAllowedSendingAddress, saveSignature } from "../../lib/messaging/settings"
import { getMessageContext, sendCoachMessage } from "../../lib/messaging/sendCoachMessage"
import { checkBasicAuth, handlePostmarkEvent } from "../../lib/messaging/postmarkWebhook"
import type { MessageProvider, OutboundEmail } from "../../lib/messaging/types"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const PERI = "coach-peri"
const ERIN = "coach-erin"
const CC_ID = "cc-1"

function fakeProvider() {
  const sent: OutboundEmail[] = []
  let n = 0
  const provider: MessageProvider = {
    name: "postmark",
    async sendEmail(m) { sent.push(m); return { ok: true, providerMessageId: `pm-${++n}` } },
  }
  return { provider, sent }
}

function seed() {
  return makeFakeDb({
    coach_clients: [{
      id: CC_ID, coach_profile_id: PERI, name: "Alex Rivera", client_profile_id: "prof-alex",
      invited_email: null, parent_email: "parent@example.com", parent_name: "Pat Rivera", phone: null,
    }],
    client_profiles: [
      { id: PERI, email: "peri@workforcereadynow.com", name: "Peri" },
      { id: ERIN, email: "erin+coach@workforcereadynow.com", name: "Erin" },
      { id: "prof-alex", email: " alex@example.com ", name: "Alex", phone: "5551234567" },
    ],
    coach_messaging_settings: [
      { coach_profile_id: PERI, sending_email: "peri@workforcereadynow.com", signature: "Peri Ginsberg\nWorkforce Ready Now", provider: "postmark" },
      { coach_profile_id: ERIN, sending_email: "erin+coach@workforcereadynow.com", signature: null, provider: "postmark" },
    ],
    client_emails: [],
  })
}

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const old: Record<string, string | undefined> = {}
  for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k] }
  return fn().finally(() => { for (const k of Object.keys(old)) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k] } })
}
const PROD = { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "wrnsignal-api.vercel.app", SIGNAL_LIVE_EMAIL_HOST: undefined }
const LOCAL = { VERCEL_ENV: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined, SIGNAL_LIVE_EMAIL_HOST: undefined }

async function main() {
  console.log("compose")
  const c = composeMessage("Hi Alex,\r\n\r\nSee https://example.com/a?b=1&c=2.\nThanks <3", "Peri\nWRN")
  ok("text ends with the signature", c.text === "Hi Alex,\n\nSee https://example.com/a?b=1&c=2.\nThanks <3\n\nPeri\nWRN\n", JSON.stringify(c.text))
  ok("HTML escapes the coach's text", c.html.includes("Thanks &lt;3") && !c.html.includes("<3"))
  ok("link made, trailing period left out", c.html.includes(`href="https://example.com/a?b=1&amp;c=2"`) && c.html.includes("c=2</a>."), c.html)
  ok("single line break kept", c.html.includes(".<br>Thanks"))
  ok("signature lines kept", c.html.includes("Peri<br>WRN"))
  ok("no signature, no trailing block", composeMessage("Hi", null).text === "Hi\n")

  console.log("sending address")
  ok("verified domain allowed", isAllowedSendingAddress("erin+coach@workforcereadynow.com"))
  ok("other domain refused", !isAllowedSendingAddress("peri@gmail.com"))
  ok("look-alike domain refused", !isAllowedSendingAddress("x@evilworkforcereadynow.com"))

  console.log("context")
  {
    const db = seed()
    const ctx = await getMessageContext(db.client, CC_ID, ERIN)
    ok("To falls back to the profile email, trimmed", ctx?.to === "alex@example.com", ctx?.to ?? "")
    ok("From is the signed-in coach's, not the owner's", ctx?.from === "erin+coach@workforcereadynow.com")
    ok("phone found on the profile", ctx?.has_phone === true)
    ok("parent offered", ctx?.parent_email === "parent@example.com" && ctx?.parent_name === "Pat Rivera")
  }

  console.log("send, production")
  await withEnv(PROD, async () => {
    const db = seed()
    const { provider, sent } = fakeProvider()
    const r = await sendCoachMessage(db.client, {
      coachClientId: CC_ID, actor: ERIN, provider,
      input: { channel: "email", subject: "Next steps", body: "Hi Alex", cc_parent: true, from: "peri@workforcereadynow.com", to: "someone@else.com" },
    })
    ok("sent", r.ok, JSON.stringify(r))
    const m = sent[0]
    ok("From and Reply-To are Erin's, whatever the request said", m?.from === "erin+coach@workforcereadynow.com" && m?.replyTo === m?.from)
    ok("To is the record's", m?.to === "alex@example.com")
    ok("parent CC'd when ticked", m?.cc === "parent@example.com")
    ok("BCC is only the sender", JSON.stringify(m?.bcc) === JSON.stringify(["erin+coach@workforcereadynow.com"]), JSON.stringify(m?.bcc))
    ok("subject unprefixed", m?.subject === "Next steps")
    ok("no signature set, body alone", m?.text === "Hi Alex\n")
    const row = db.tables.client_emails[0]
    ok("logged once", db.tables.client_emails.length === 1)
    ok("log: coach_message, outbound email via postmark", row?.email_type === "coach_message" && row?.channel === "email" && row?.direction === "outbound" && row?.provider === "postmark")
    ok("log: provider id in both id columns", row?.provider_message_id === "pm-1" && row?.postmark_message_id === "pm-1")
    ok("log: sent by Erin, not redirected", row?.triggered_by === ERIN && row?.redirected === false && row?.delivered_to === "alex@example.com")
    ok("log: reply-to saved", row?.reply_to_email === "erin+coach@workforcereadynow.com")

    const noCc = await sendCoachMessage(db.client, { coachClientId: CC_ID, actor: PERI, provider, input: { subject: "S", body: "B" } })
    ok("parent not CC'd unless ticked", noCc.ok && sent[1]?.cc === null)
    ok("Peri's signature appended", sent[1]?.text === "B\n\nPeri Ginsberg\nWorkforce Ready Now\n")
  })

  console.log("send, not production")
  await withEnv(LOCAL, async () => {
    const db = seed()
    const { provider, sent } = fakeProvider()
    const r = await sendCoachMessage(db.client, { coachClientId: CC_ID, actor: PERI, provider, input: { subject: "Hello", body: "Hi", cc_parent: true } })
    const m = sent[0]
    ok("redirected to Peri only", r.ok && m?.to === "peri@workforcereadynow.com" && m?.cc === null && m?.bcc.length === 0, JSON.stringify(m))
    ok("subject names who it was for", m?.subject === "[local -> alex@example.com, cc parent@example.com, bcc peri@workforcereadynow.com] Hello", m?.subject)
    const row = db.tables.client_emails[0]
    ok("log keeps the intended To and marks the redirect", row?.to_email === "alex@example.com" && row?.redirected === true && row?.delivered_to === "peri@workforcereadynow.com")
  })

  console.log("refusals")
  await withEnv(PROD, async () => {
    const db = seed()
    const { provider, sent } = fakeProvider()
    const send = (actor: string, input: unknown) => sendCoachMessage(db.client, { coachClientId: CC_ID, actor, provider, input })
    ok("no subject", (await send(PERI, { body: "x" })).ok === false)
    ok("no body", (await send(PERI, { subject: "x", body: "  " })).ok === false)
    ok("SMS refused", (await send(PERI, { channel: "sms", subject: "x", body: "x" })).ok === false)
    db.tables.coach_messaging_settings[1].sending_email = "erin@gmail.com"
    const bad = await send(ERIN, { subject: "x", body: "x" })
    ok("off-domain sending address refused", !bad.ok && bad.status === 409)
    db.tables.coach_messaging_settings = db.tables.coach_messaging_settings.filter((s) => s.coach_profile_id !== ERIN)
    ok("no settings row refused", (await send(ERIN, { subject: "x", body: "x" })).ok === false)
    db.tables.coach_clients[0].parent_email = null
    ok("CC parent with no parent email refused", (await send(PERI, { subject: "x", body: "x", cc_parent: true })).ok === false)
    db.tables.client_profiles[2].email = null
    ok("no client email refused", (await send(PERI, { subject: "x", body: "x" })).ok === false)
    ok("nothing went out", sent.length === 0)
    ok("nothing logged", db.tables.client_emails.length === 0)

    const failing: MessageProvider = { name: "postmark", async sendEmail() { return { ok: false, error: "Inactive recipient" } } }
    db.tables.client_profiles[2].email = "alex@example.com"
    const f = await sendCoachMessage(db.client, { coachClientId: CC_ID, actor: PERI, provider: failing, input: { subject: "x", body: "x" } })
    ok("provider failure is a 502 and logs nothing", !f.ok && f.status === 502 && db.tables.client_emails.length === 0)
  })

  console.log("signature")
  {
    const db = seed()
    ok("saves", (await saveSignature(db.client, ERIN, { signature: "  Erin\r\nCoach  " })).ok && db.tables.coach_messaging_settings[1].signature === "Erin\nCoach")
    ok("does not touch the sending address", db.tables.coach_messaging_settings[1].sending_email === "erin+coach@workforcereadynow.com")
    ok("too long refused", !(await saveSignature(db.client, ERIN, { signature: "x".repeat(2001) })).ok)
    ok("creates a row without an address", (await saveSignature(db.client, "coach-new", { signature: "Hi" })).ok
      && db.tables.coach_messaging_settings.some((s) => s.coach_profile_id === "coach-new" && !s.sending_email))
  }

  console.log("webhook")
  {
    const auth = "Basic " + Buffer.from("postmark:s3cret").toString("base64")
    ok("right password accepted", checkBasicAuth(auth, "s3cret"))
    ok("wrong password refused", !checkBasicAuth(auth, "other"))
    ok("missing header refused", !checkBasicAuth(null, "s3cret"))

    const db = makeFakeDb({ client_emails: [{ id: "e1", provider: "postmark", provider_message_id: "pm-9", delivered_to: "alex@example.com", status: "sent" }] })
    const row = () => db.tables.client_emails[0]
    let r = await handlePostmarkEvent(db.client, { RecordType: "Delivery", MessageID: "pm-9", Recipient: "erin+coach@workforcereadynow.com" })
    ok("BCC copy's delivery ignored", r.outcome === "ignored: not the To recipient" && row().status === "sent")
    r = await handlePostmarkEvent(db.client, { RecordType: "Bounce", MessageID: "pm-9", Email: "parent@example.com", Type: "HardBounce" })
    ok("CC's bounce ignored", row().status === "sent")
    r = await handlePostmarkEvent(db.client, { RecordType: "Bounce", MessageID: "pm-9", Email: "Alex@Example.com", Type: "HardBounce", Description: "Address does not exist", BouncedAt: "2026-10-15T10:00:00Z" })
    ok("To's bounce recorded", row().status === "bounced" && row().status_detail === "HardBounce: Address does not exist" && row().status_at === "2026-10-15T10:00:00Z", JSON.stringify(row()))
    r = await handlePostmarkEvent(db.client, { RecordType: "Delivery", MessageID: "pm-9", Recipient: "alex@example.com" })
    ok("later delivery does not hide the bounce", row().status === "bounced" && r.outcome === "kept bounced")
    r = await handlePostmarkEvent(db.client, { RecordType: "Delivery", MessageID: "unknown" })
    ok("unknown message acknowledged", r.status === 200 && r.outcome === "ignored: unknown message")
    r = await handlePostmarkEvent(db.client, { RecordType: "Open", MessageID: "pm-9" })
    ok("other record types ignored", r.status === 200)

    const db2 = makeFakeDb({ client_emails: [{ id: "e2", provider: "postmark", provider_message_id: "pm-10", delivered_to: "alex@example.com", status: "sent" }] })
    await handlePostmarkEvent(db2.client, { RecordType: "Delivery", MessageID: "pm-10", Recipient: "alex@example.com", DeliveredAt: "2026-10-15T09:00:00Z" })
    ok("delivery recorded", db2.tables.client_emails[0].status === "delivered" && db2.tables.client_emails[0].status_detail === null)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
