// lib/prospects/history.ts
//
// A History line, written through the caller's client. Same contract as
// logCoachClientEvent (app/api/_lib/coachClientEvents.ts): best-effort, never
// throws, because losing a History line must not fail the action it records.
// It takes the client it is given rather than making its own, so the prospect
// logic can be tested against the in-memory database.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CoachClientEventType } from "../coach/clientEventTypes"

export async function logProspectEvent(
  db: SupabaseClient,
  args: { coachClientId: string; eventType: CoachClientEventType; actor: string | null; context?: Record<string, unknown> },
): Promise<void> {
  try {
    const { error } = await db.from("coach_client_events").insert({
      coach_client_id: args.coachClientId,
      event_type: args.eventType,
      actor_profile_id: args.actor,
      context: args.context ?? null,
    })
    if (error) console.warn("[prospects/history] insert failed:", error.message)
  } catch (e: any) {
    console.warn("[prospects/history] insert threw:", e?.message || String(e))
  }
}
