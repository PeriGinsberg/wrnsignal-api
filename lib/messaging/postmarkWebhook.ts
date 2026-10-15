// lib/messaging/postmarkWebhook.ts
//
// Postmark's delivery, bounce and spam-complaint webhook for the coach
// message stream (app/api/webhooks/postmark). It moves a saved message's
// status on: sent -> delivered, or to bounced / complained.
//
// ONLY THE TO ADDRESS COUNTS. Postmark reports each recipient separately, so
// the coach's own BCC copy and a parent's CC produce events too; a bounce on
// the coach's copy must not mark the client's email bounced. An event for any
// other recipient is acknowledged and ignored.
//
// Delivered never overwrites bounced or complained: the events can arrive in
// any order, and a bounce is the one worth seeing.
//
// Every request must carry HTTP Basic auth whose password is
// POSTMARK_WEBHOOK_SECRET (set on the webhook by
// tests/messaging/setup-coach-stream.ts).

import { timingSafeEqual } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export type PostmarkEvent = {
  RecordType?: string
  MessageID?: string
  /** Delivery */
  Recipient?: string
  DeliveredAt?: string
  /** Bounce and SpamComplaint */
  Email?: string
  BouncedAt?: string
  Type?: string
  Description?: string
}

export function checkBasicAuth(header: string | null, secret: string): boolean {
  const m = /^Basic\s+(.+)$/i.exec(header ?? "")
  if (!m) return false
  const decoded = Buffer.from(m[1], "base64").toString("utf8")
  const password = decoded.slice(decoded.indexOf(":") + 1)
  const a = Buffer.from(password)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

const STATUS_FOR: Record<string, "delivered" | "bounced" | "complained"> = {
  Delivery: "delivered",
  Bounce: "bounced",
  SpamComplaint: "complained",
}

export async function handlePostmarkEvent(
  db: SupabaseClient,
  ev: PostmarkEvent,
): Promise<{ status: number; outcome: string }> {
  const next = STATUS_FOR[ev.RecordType ?? ""]
  if (!next) return { status: 200, outcome: "ignored: record type" }
  const messageId = String(ev.MessageID ?? "").trim()
  if (!messageId) return { status: 400, outcome: "no MessageID" }

  const { data, error } = await db.from("client_emails")
    .select("id, delivered_to, status")
    .eq("provider", "postmark").eq("provider_message_id", messageId).maybeSingle()
  if (error) return { status: 500, outcome: `lookup failed: ${error.message}` }
  const row = data as { id: string; delivered_to: string; status: string } | null
  // Not ours (another environment's database, or a message sent before the log).
  if (!row) return { status: 200, outcome: "ignored: unknown message" }

  const recipient = String(ev.Recipient ?? ev.Email ?? "").trim().toLowerCase()
  if (recipient && recipient !== row.delivered_to.trim().toLowerCase()) {
    return { status: 200, outcome: "ignored: not the To recipient" }
  }
  if (next === "delivered" && row.status !== "sent") return { status: 200, outcome: `kept ${row.status}` }

  const at = (next === "delivered" ? ev.DeliveredAt : ev.BouncedAt) || new Date().toISOString()
  const detail = next === "delivered" ? null : [ev.Type, ev.Description].filter(Boolean).join(": ") || null
  const { error: uErr } = await db.from("client_emails")
    .update({ status: next, status_at: at, status_detail: detail }).eq("id", row.id)
  if (uErr) return { status: 500, outcome: `update failed: ${uErr.message}` }
  return { status: 200, outcome: next }
}
