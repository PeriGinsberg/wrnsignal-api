// lib/sow/public.ts
//
// A client opening their SOW link. The link's code is never stored, only its
// SHA-256, so a visit is looked up by hashing the code it brings. A link works
// while its SOW is sent (or accepted); a re-send or a withdrawal clears the
// hash, so an old link finds nothing.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { SowDocument } from "./build"
import { hashToken } from "./send"

export type PublicSow = {
  status: "sent" | "accepted"
  document: SowDocument
  accepted_at: string | null
  accepted_name: string | null
}

// randomBytes(32) in base64url is 43 characters of [A-Za-z0-9_-].
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export async function getSowByToken(db: SupabaseClient, token: unknown): Promise<PublicSow | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null
  const { data, error } = await db.from("client_sows")
    .select("status, sent_snapshot, accepted_at, accepted_name").eq("token_hash", hashToken(token)).maybeSingle()
  if (error || !data) return null
  const row = data as { status: string; sent_snapshot: SowDocument | null; accepted_at: string | null; accepted_name: string | null }
  if ((row.status !== "sent" && row.status !== "accepted") || !row.sent_snapshot) return null
  return { status: row.status, document: row.sent_snapshot, accepted_at: row.accepted_at, accepted_name: row.accepted_name }
}
