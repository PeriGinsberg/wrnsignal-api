// lib/email/clientEmailLog.ts
//
// The email log: every email SIGNAL sends to a client or prospect, saved as it
// went out, for the Communications tab. Written by sendToClient (./send.ts)
// and by the one-time backfill (tests/email/backfill-client-emails.ts), never
// by a request.
//
// PRIVATE LINKS ARE NEVER SAVED. A SOW link accepts the SOW and a Supabase
// sign-in link logs the client in, and anyone who can open the Communications
// tab could use either. They are replaced before the row is written, by
// pattern, so a new email that carries one is covered without remembering to
// list it.
//
// BEST-EFFORT, NEVER THROWS. By the time a row is written the email has left;
// a logging failure must not turn a sent email into an error.

import type { SupabaseClient } from "@supabase/supabase-js"

export const CLIENT_EMAIL_TYPES = [
  "sow",
  "welcome",
  "invite",
  "practice_round",
  "practice_feedback",
  "networking_plan",
  "coach_message",
] as const
export type ClientEmailType = (typeof CLIENT_EMAIL_TYPES)[number]

export const CLIENT_EMAIL_TYPE_LABEL: Record<ClientEmailType, string> = {
  sow: "Statement of Work",
  welcome: "Welcome",
  invite: "SIGNAL invite",
  practice_round: "Practice round",
  practice_feedback: "Practice feedback",
  networking_plan: "Networking plan",
  coach_message: "Message",
}

export const PRIVATE_SOW_LINK = "[private SOW link]"
export const PRIVATE_SIGN_IN_LINK = "[private sign-in link]"

// A URL runs to the next space, quote or angle bracket. In HTML an & inside it
// is &amp;, which this still matches.
const URL_TAIL = `[^\\s"'<>]*`
const PRIVATE_LINKS: { re: string; label: string }[] = [
  // /sow/<token>: the token is 43 characters of base64url (lib/sow/send.ts).
  { re: `https?://[^\\s"'<>/]+/sow/[A-Za-z0-9_-]{20,}${URL_TAIL}`, label: PRIVATE_SOW_LINK },
  // A Supabase magic link: <project>.supabase.co/auth/v1/verify?token=...
  { re: `https?://[^\\s"'<>/]+/auth/v1/verify\\?${URL_TAIL}`, label: PRIVATE_SIGN_IN_LINK },
]

/**
 * The text with every private link replaced by its label. In HTML a link's
 * href becomes "#" first, so the saved button goes nowhere rather than to a
 * relative path named "[private SOW link]"; any other copy of the URL (the
 * "paste this link" line) becomes the label.
 */
export function redactPrivateLinks(s: string, opts: { html?: boolean } = {}): string {
  let out = s
  for (const { re, label } of PRIVATE_LINKS) {
    if (opts.html) out = out.replace(new RegExp(`href=(["'])${re}\\1`, "gi"), `href="#"`)
    out = out.replace(new RegExp(re, "gi"), label)
  }
  return out
}

const norm = (e: string | null | undefined) => String(e ?? "").trim().toLowerCase()

/**
 * Who gets a blind copy. The coach who clicked, and the client's coach if that
 * is someone else (a delegate or a co-coach sending on their behalf). An
 * automatic send, with nobody clicking, copies the client's coach. Nobody is
 * copied twice, and nobody already on the To or CC line is copied at all.
 */
export async function coachBccFor(
  db: SupabaseClient,
  args: { coachClientId: string | null; actor: string | null; exclude: (string | null)[] },
): Promise<string[]> {
  const ids: string[] = []
  if (args.actor) ids.push(args.actor)
  if (args.coachClientId) {
    const { data } = await db.from("coach_clients").select("coach_profile_id").eq("id", args.coachClientId).maybeSingle()
    const owner = (data as { coach_profile_id: string | null } | null)?.coach_profile_id
    if (owner && !ids.includes(owner)) ids.push(owner)
  }
  if (!ids.length) return []
  const { data: profs } = await db.from("client_profiles").select("id, email").in("id", ids)
  const byId = new Map(((profs ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]))
  const skip = new Set(args.exclude.map(norm).filter(Boolean))
  const out: string[] = []
  for (const id of ids) {
    const e = String(byId.get(id) ?? "").trim()
    if (!e || skip.has(norm(e))) continue
    skip.add(norm(e))
    out.push(e)
  }
  return out
}

export type ClientEmailRow = {
  coach_client_id: string | null
  email_type: ClientEmailType
  sent_at?: string
  from_email: string
  to_email: string
  cc_email: string | null
  bcc_emails: string[]
  delivered_to: string
  redirected: boolean
  subject: string
  text_body: string | null
  html_body: string | null
  triggered_by: string | null
  postmark_message_id: string | null
  backfilled?: boolean
  // The conversation fields (20261018_coach_messages). Left out, the columns'
  // defaults apply: an outbound email carried by Postmark, status 'sent'.
  channel?: "email" | "sms"
  direction?: "outbound" | "inbound"
  provider?: string
  provider_message_id?: string | null
  reply_to_email?: string | null
}

/** The row as it may be stored: private links out of every readable field. */
export function redactRow(row: ClientEmailRow): ClientEmailRow {
  return {
    ...row,
    subject: redactPrivateLinks(row.subject),
    text_body: row.text_body == null ? null : redactPrivateLinks(row.text_body),
    html_body: row.html_body == null ? null : redactPrivateLinks(row.html_body, { html: true }),
  }
}

/** Save one sent email. Never throws; a failure is a console line. */
export async function logClientEmail(db: SupabaseClient, row: ClientEmailRow): Promise<void> {
  try {
    // provider_message_id is what the delivery webhook looks a message up by.
    const withId = { ...row, provider_message_id: row.provider_message_id ?? row.postmark_message_id }
    const { error } = await db.from("client_emails").insert(redactRow(withId))
    if (error) console.warn("[client-emails] insert failed:", error.message)
  } catch (e: any) {
    console.warn("[client-emails] insert threw:", e?.message ?? String(e))
  }
}
