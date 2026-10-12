// lib/email/clientEmailRead.ts
//
// The read side of the email log, shared by the Communications routes
// (app/api/coach/coach-clients/[id]/emails). Kept apart from clientEmailLog.ts
// so the routes do not load the writer.

import type { SupabaseClient } from "@supabase/supabase-js"

export const CLIENT_EMAIL_LIST_SELECT =
  "id, email_type, sent_at, from_email, to_email, cc_email, bcc_emails, delivered_to, redirected, subject, triggered_by, postmark_message_id, backfilled"

/** Adds sent_by_name: the coach who clicked, or null when SIGNAL sent it on its own. */
export async function withSenderNames<T extends { triggered_by: string | null }>(
  db: SupabaseClient,
  rows: T[],
): Promise<(T & { sent_by_name: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.triggered_by).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data } = await db.from("client_profiles").select("id, name, email").in("id", ids)
    for (const p of (data ?? []) as { id: string; name: string | null; email: string | null }[]) {
      names.set(p.id, p.name?.trim() || p.email || "A coach")
    }
  }
  return rows.map((r) => ({ ...r, sent_by_name: r.triggered_by ? names.get(r.triggered_by) ?? "A coach" : null }))
}
