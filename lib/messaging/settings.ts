// lib/messaging/settings.ts
//
// A coach's messaging settings (coach_messaging_settings): the address their
// messages come from, and their signature.
//
// THE SENDING ADDRESS IS NOT EDITABLE HERE. It is set by Peri in SQL, so a
// coach cannot make their messages come from someone else's address. A coach
// edits only their signature. Both belong to the coach who is signed in, not to
// a principal they are a delegate of: Erin's messages come from Erin.

import type { SupabaseClient } from "@supabase/supabase-js"
import { SIGNATURE_MAX } from "./compose"

/** The only domain messages may come from. Postmark has it verified. */
export const SENDING_DOMAIN = "workforcereadynow.com"

export function isAllowedSendingAddress(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+$/.test(e) && e.endsWith(`@${SENDING_DOMAIN}`)
}

export type MessagingSettings = {
  sending_email: string | null
  signature: string | null
  provider: string
}

export async function getMessagingSettings(db: SupabaseClient, coachProfileId: string): Promise<MessagingSettings> {
  const { data, error } = await db.from("coach_messaging_settings")
    .select("sending_email, signature, provider").eq("coach_profile_id", coachProfileId).maybeSingle()
  if (error) throw new Error(`Couldn't read messaging settings: ${error.message}`)
  const row = data as MessagingSettings | null
  return {
    sending_email: row?.sending_email?.trim() || null,
    signature: row?.signature ?? null,
    provider: row?.provider ?? "postmark",
  }
}

/** Save the signature. Creates the row (with no sending address) if there is none. */
export async function saveSignature(
  db: SupabaseClient,
  coachProfileId: string,
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const raw = (input as { signature?: unknown } | null)?.signature
  if (raw != null && typeof raw !== "string") return { ok: false, error: "The signature must be text.", status: 400 }
  const signature = String(raw ?? "").replace(/\r\n/g, "\n").trim()
  if (signature.length > SIGNATURE_MAX) {
    return { ok: false, error: `The signature can be at most ${SIGNATURE_MAX} characters.`, status: 400 }
  }
  const { data: existing } = await db.from("coach_messaging_settings").select("coach_profile_id").eq("coach_profile_id", coachProfileId).maybeSingle()
  const { error } = existing
    ? await db.from("coach_messaging_settings").update({ signature: signature || null }).eq("coach_profile_id", coachProfileId)
    : await db.from("coach_messaging_settings").insert({ coach_profile_id: coachProfileId, signature: signature || null })
  if (error) throw new Error(`Couldn't save the signature: ${error.message}`)
  return { ok: true }
}
