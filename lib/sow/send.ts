// lib/sow/send.ts
//
// Sending a client their SOW. In order:
//
//   1. check the SOW and the email
//   2. freeze the SOW as it is now and make a new private link; only the
//      link's SHA-256 is stored, so the link exists in the email alone, and any
//      earlier link for this package stops working
//   3. withdraw another package's SOW that is out (one sent SOW per client):
//      its link stops working and its package goes back to Draft
//   4. send the email (Postmark, the signal-client layout adds the signature)
//   5. if the email fails, put 2 and 3 back exactly as they were
//   6. record it: package to Sent, a prospect to the SOW sent stage, History,
//      and the sow.sent event that starts the 3-day follow-up timer
//
// The email sender is passed in so the rules run against the fake database.

import { createHash, randomBytes } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sendToClient, type SendResult } from "../email/send"
import { advanceIfPresent } from "../prospects/stages"
import { logProspectEvent } from "../prospects/history"
import { emitProspectEvent } from "../prospects/automation"
import { checkPayment } from "./build"
import { loadForSend, type SowRow } from "./client"
import {
  SOW_EMAIL_BODY_MAX,
  SOW_EMAIL_SUBJECT_MAX,
  SOW_EMAIL_TEMPLATE,
  SOW_LINK_TOKEN,
  hasSowLink,
  renderSowEmail,
} from "./email"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

export type SendEmail = (args: Parameters<typeof sendToClient>[0]) => Promise<SendResult>

/** The SHA-256 of a link code: what is stored, and what a visit is looked up by. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

const ROW_RESTORE = ["status", "token_hash", "sent_at", "sent_by", "sent_snapshot", "sent_to", "sent_cc", "send_count", "sent_message_id"] as const

export async function sendClientSow(
  db: SupabaseClient,
  args: {
    coachClientId: string
    engagementId: string
    actingIds: string[]
    actor: string
    subject: unknown
    body: unknown
    ccParent: unknown
    appUrl: string
    send?: SendEmail
  },
): Promise<Result<{ sent_at: string; to: string; cc: string | null; redirected: boolean }>> {
  const x = await loadForSend(db, args.coachClientId, args.engagementId)
  if (!x) return fail("Package not found", 404)
  const { sow, engagement, client } = x

  // ── 1. Checks ──
  if (engagement.proposal_status === "approved" || engagement.proposal_status === "declined") {
    return fail(`This package is ${engagement.proposal_status}; its SOW can't be sent.`, 409)
  }
  if (x.row?.status === "accepted") return fail("This SOW has already been accepted.", 409)
  if (!x.email) return fail("This prospect has no email address. Add one to their record first.")
  if (!sow.document.stages.length) return fail("Every deliverable is Not needed, so the SOW has nothing in it.")
  if (sow.total_cents <= 0) return fail("The SOW's total is $0. Set a price for this client or fees on the deliverables.")
  const pay = checkPayment(sow.payment, sow.total_cents)
  if (!pay.ok) return fail(pay.error)
  const subject = typeof args.subject === "string" ? args.subject.trim() : ""
  const body = typeof args.body === "string" ? args.body.trim() : ""
  if (!subject) return fail("The email needs a subject.")
  if (subject.length > SOW_EMAIL_SUBJECT_MAX) return fail(`The subject can be at most ${SOW_EMAIL_SUBJECT_MAX} characters.`)
  if (!body) return fail("The email needs a message.")
  if (body.length > SOW_EMAIL_BODY_MAX) return fail(`The message can be at most ${SOW_EMAIL_BODY_MAX} characters.`)
  if (!hasSowLink(body)) return fail(`The message must include ${SOW_LINK_TOKEN}, where the link to their SOW goes.`)
  const cc = args.ccParent === true ? (client.parent_email?.trim() || null) : null
  if (args.ccParent === true && !cc) return fail("There is no parent email on this record to copy.")

  // An unsaved SOW is saved as shown (its defaults) before it is frozen.
  let row: SowRow | null = x.row
  if (!row) {
    const { data, error } = await db.from("client_sows").insert({
      coach_client_id: args.coachClientId, engagement_id: args.engagementId, status: "draft", send_count: 0,
      opening: sow.opening, price_override_cents: null, payment: sow.payment, updated_by: args.actor,
    }).select("*").single()
    if (error || !data) return fail(`Failed to save the SOW: ${error?.message ?? "unknown error"}`, 500)
    row = data as SowRow
  }

  // ── 2 and 3. Freeze, new link, withdraw any other ──
  const token = randomBytes(32).toString("base64url")
  const now = new Date().toISOString()
  const before = { ...Object.fromEntries(ROW_RESTORE.map((k) => [k, (row as Record<string, unknown>)[k] ?? null])), send_count: row.send_count ?? 0 }
  const { error: upErr } = await db.from("client_sows").update({
    status: "sent", token_hash: hashToken(token), sent_at: now, sent_by: args.actor, sent_snapshot: sow.document,
    sent_to: x.email, sent_cc: cc, send_count: (row.send_count ?? 0) + 1, sent_message_id: null,
  }).eq("id", row.id)
  if (upErr) return fail(`Failed to freeze the SOW: ${upErr.message}`, 500)

  const { data: outs } = await db.from("client_sows").select("id, engagement_id, status, token_hash")
    .eq("coach_client_id", args.coachClientId).eq("status", "sent")
  const withdrawn = ((outs ?? []) as { id: string; engagement_id: string; status: string; token_hash: string | null }[])
    .filter((o) => o.id !== row!.id)
  for (const o of withdrawn) {
    await db.from("client_sows").update({ status: "draft", token_hash: null }).eq("id", o.id)
  }

  // ── 4. The email ──
  const url = `${args.appUrl.replace(/\/+$/, "")}/sow/${token}`
  const rendered = renderSowEmail(body, url)
  const result = await (args.send ?? sendToClient)({
    to: x.email,
    cc,
    templateAlias: SOW_EMAIL_TEMPLATE,
    model: { subject, body_html: rendered.html, body_text: rendered.text },
  })

  // ── 5. Undo on failure ──
  if (!result.ok) {
    await db.from("client_sows").update(before).eq("id", row.id)
    for (const o of withdrawn) await db.from("client_sows").update({ status: o.status, token_hash: o.token_hash }).eq("id", o.id)
    return fail(`The email did not send, so nothing changed: ${result.error}`, 502)
  }

  // ── 6. Record it ──
  await db.from("client_sows").update({ sent_message_id: result.messageId }).eq("id", row.id)
  if (withdrawn.length) {
    const { data: es } = await db.from("coach_client_engagements").select("id, name, proposal_status")
      .in("id", withdrawn.map((o) => o.engagement_id))
    for (const e of (es ?? []) as { id: string; name: string; proposal_status: string }[]) {
      if (e.proposal_status === "sent") await db.from("coach_client_engagements").update({ proposal_status: "draft" }).eq("id", e.id)
      await logProspectEvent(db, {
        coachClientId: args.coachClientId, eventType: "sow_withdrawn", actor: args.actor,
        context: { name: e.name, engagement_id: e.id, replaced_by: engagement.name },
      })
    }
  }
  if (engagement.proposal_status !== "sent") {
    await db.from("coach_client_engagements").update({ proposal_status: "sent" }).eq("id", engagement.id)
    await logProspectEvent(db, { coachClientId: args.coachClientId, eventType: "proposal_sent", actor: args.actor, context: { name: engagement.name } })
  }
  const count = (row.send_count ?? 0) + 1
  await logProspectEvent(db, {
    coachClientId: args.coachClientId, eventType: "sow_sent", actor: args.actor,
    context: { name: engagement.name, engagement_id: engagement.id, to: x.email, cc, send: count, subject },
  })
  if (client.lifecycle_status === "Prospect") {
    await advanceIfPresent(db, { coachClientId: args.coachClientId, actingIds: args.actingIds, stageKey: "sow_sent", actor: args.actor })
  }
  await emitProspectEvent(db, "sow.sent", args.coachClientId, { engagement_id: engagement.id })

  return { ok: true, data: { sent_at: now, to: x.email, cc, redirected: result.redirected } }
}
