// lib/messaging/sendCoachMessage.ts
//
// A coach's own email to a client or prospect: the Message button.
//
// What the server decides, never the browser:
//   From      the signed-in coach's sending address (coach_messaging_settings),
//             which only Peri can set. No address, no send.
//   Reply-To  the same address, so replies land in the coach's own inbox.
//   To        the record's email: the invited email, else the client's profile
//             email (the order the SOW uses).
//   CC        the parent's email, only when the coach ticks it.
//   BCC       the coach who sent it, so they have a copy in their inbox. Not
//             the client's main coach.
//
// Unlike sendToClient (lib/email/send.ts) there is no layout and no WRN
// signature: the coach's own plain-text signature goes on the end instead.
// The non-production redirect is the same one: outside production the email
// goes to NON_PROD_REDIRECT only, with who it was meant for in the subject.
//
// A failed send writes nothing and the coach keeps their draft. A sent one is
// saved to client_emails as email_type 'coach_message', status 'sent'; the
// Postmark webhook (./postmarkWebhook.ts) moves it on to delivered or bounced.

import type { SupabaseClient } from "@supabase/supabase-js"
import { environmentLabel, isProduction, NON_PROD_REDIRECT } from "../email/send"
import { logClientEmail } from "../email/clientEmailLog"
import { composeMessage, MESSAGE_BODY_MAX, MESSAGE_SUBJECT_MAX } from "./compose"
import { getMessagingSettings, isAllowedSendingAddress } from "./settings"
import { providerFor } from "./providers"
import type { MessageProvider } from "./types"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400) => ({ ok: false as const, error, status })

export type MessageContext = {
  /** Who it goes to. Null when the record has no email. */
  to: string | null
  client_name: string | null
  parent_email: string | null
  parent_name: string | null
  /** Whether SMS would have a number to go to. */
  has_phone: boolean
  /** The signed-in coach's sending address. Null until Peri sets one. */
  from: string | null
  signature: string | null
  /** Which provider carries this coach's mail (types.ts). */
  provider: string
}

const clean = (s: string | null | undefined) => String(s ?? "").trim() || null

/** Everything the Message panel shows before the coach types. */
export async function getMessageContext(db: SupabaseClient, coachClientId: string, actor: string): Promise<MessageContext | null> {
  const { data: c, error } = await db.from("coach_clients")
    .select("id, name, client_profile_id, invited_email, parent_email, parent_name, phone")
    .eq("id", coachClientId).maybeSingle()
  if (error) throw new Error(`Couldn't read the client: ${error.message}`)
  const cc = c as {
    name: string | null; client_profile_id: string | null; invited_email: string | null
    parent_email: string | null; parent_name: string | null; phone: string | null
  } | null
  if (!cc) return null
  let name = clean(cc.name)
  let to = clean(cc.invited_email)
  let phone = clean(cc.phone)
  if (cc.client_profile_id && (!name || !to || !phone)) {
    const { data: p } = await db.from("client_profiles").select("name, email, phone").eq("id", cc.client_profile_id).maybeSingle()
    const prof = p as { name: string | null; email: string | null; phone: string | null } | null
    name = name || clean(prof?.name)
    to = to || clean(prof?.email)
    phone = phone || clean(prof?.phone)
  }
  const settings = await getMessagingSettings(db, actor)
  return {
    to,
    client_name: name,
    parent_email: clean(cc.parent_email),
    parent_name: clean(cc.parent_name),
    has_phone: !!phone,
    from: isAllowedSendingAddress(settings.sending_email) ? settings.sending_email : null,
    signature: settings.signature,
    provider: settings.provider,
  }
}

export async function sendCoachMessage(
  db: SupabaseClient,
  args: {
    coachClientId: string
    /** The signed-in coach. */
    actor: string
    input: unknown
    /** Tests pass a fake; otherwise the coach's own provider. */
    provider?: MessageProvider
  },
): Promise<Result<{ message_id: string; to: string; redirected: boolean; sent_at: string }>> {
  const input = (args.input ?? {}) as { channel?: unknown; subject?: unknown; body?: unknown; cc_parent?: unknown }
  if (input.channel != null && input.channel !== "email") return fail("Only email can be sent for now.")
  const subject = typeof input.subject === "string" ? input.subject.replace(/[\r\n]+/g, " ").trim() : ""
  const body = typeof input.body === "string" ? input.body.trim() : ""
  if (!subject) return fail("The message needs a subject.")
  if (subject.length > MESSAGE_SUBJECT_MAX) return fail(`The subject can be at most ${MESSAGE_SUBJECT_MAX} characters.`)
  if (!body) return fail("The message is empty.")
  if (body.length > MESSAGE_BODY_MAX) return fail(`The message can be at most ${MESSAGE_BODY_MAX} characters.`)

  const ctx = await getMessageContext(db, args.coachClientId, args.actor)
  if (!ctx) return fail("Client relationship not found", 404)
  if (!ctx.to) return fail("This record has no email address. Add one first.")
  if (!ctx.from) return fail("You don't have a sending address yet. Ask Peri to set one up.", 409)
  const cc = input.cc_parent === true ? ctx.parent_email : null
  if (input.cc_parent === true && !cc) return fail("There is no parent email on this record to copy.")

  const from = ctx.from
  const norm = (e: string | null) => (e ?? "").toLowerCase()
  const bcc = [from].filter((e) => norm(e) !== norm(ctx.to) && norm(e) !== norm(cc))

  const production = isProduction()
  const deliveredTo = production ? ctx.to : NON_PROD_REDIRECT
  const copies = [cc ? `cc ${cc}` : "", bcc.length ? `bcc ${bcc.join(", ")}` : ""].filter(Boolean).join(", ")
  const sentSubject = production ? subject : `[${environmentLabel()} -> ${ctx.to}${copies ? `, ${copies}` : ""}] ${subject}`
  const { html, text } = composeMessage(body, ctx.signature)

  const provider = args.provider ?? providerFor(ctx.provider)
  const res = await provider.sendEmail({
    from,
    replyTo: from,
    to: deliveredTo,
    cc: production ? cc : null,
    bcc: production ? bcc : [],
    subject: sentSubject,
    html,
    text,
    tag: "coach_message",
  })
  if (!res.ok) return fail(`The message did not send: ${res.error}`, 502)

  const sentAt = new Date().toISOString()
  await logClientEmail(db, {
    coach_client_id: args.coachClientId,
    email_type: "coach_message",
    sent_at: sentAt,
    from_email: from,
    to_email: ctx.to,
    cc_email: cc,
    bcc_emails: bcc,
    delivered_to: deliveredTo,
    redirected: !production,
    subject: sentSubject,
    text_body: text,
    html_body: html,
    triggered_by: args.actor,
    postmark_message_id: provider.name === "postmark" ? res.providerMessageId : null,
    channel: "email",
    direction: "outbound",
    provider: provider.name,
    provider_message_id: res.providerMessageId,
    reply_to_email: from,
  })
  return { ok: true, data: { message_id: res.providerMessageId, to: deliveredTo, redirected: !production, sent_at: sentAt } }
}
