// app/api/_lib/coachClientEvents.ts
//
// Per-relationship business event log (coach_client_events) — an append-only
// audit timeline on a coach_clients row. Two pieces:
//   1. logCoachClientEvent(...)  — BEST-EFFORT writer (never throws). Hooks call
//      it after a real action lands; a logging failure must never break that
//      action. Matches the swallow pattern of the "SIGNAL invite sent" note in
//      coach-clients/[id]/send-invite/route.ts.
//   2. listApiEvents(...) + toApiEvent — read side for the events GET route.
//
// The logger uses the shared service-role admin getter from ./coachAuth (the one
// canonical implementation). The read route injects its already-resolved admin
// client into listApiEvents.

import { type SupabaseClient } from "@supabase/supabase-js"
import { getSupabaseAdmin } from "./coachAuth"

// The event vocabulary — typed in code, never user input (so the table has no
// CHECK on event_type; this union is the source of truth).
export const COACH_CLIENT_EVENT_TYPES = [
  "prospect_created",
  "stage_changed",
  "converted_to_client",
  "proposal_sent",
  "proposal_approved",
  "proposal_declined",
  "engagement_attached",
  "engagement_detached",
  "invite_sent",
] as const
export type CoachClientEventType = (typeof COACH_CLIENT_EVENT_TYPES)[number]

// BEST-EFFORT, NEVER THROWS. Inserts one append-only event. Any failure (FK
// violation, missing env, network, …) is swallowed with a console.warn and the
// promise still resolves — a logging failure can never propagate to the caller.
// This is the whole safety contract.
export async function logCoachClientEvent(args: {
  coachClientId: string
  eventType: CoachClientEventType
  actorProfileId?: string | null
  context?: Record<string, unknown> | null
}): Promise<void> {
  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.from("coach_client_events").insert({
      coach_client_id: args.coachClientId,
      event_type: args.eventType,
      actor_profile_id: args.actorProfileId ?? null,
      context: args.context ?? null,
    })
    if (error) console.warn("[coach-client-events] insert failed:", error.message)
  } catch (e: any) {
    console.warn("[coach-client-events] insert threw:", e?.message || String(e))
  }
}

// ── Read side ──
export type CoachClientEventRow = {
  event_type: string
  actor_profile_id: string | null
  context: any
  created_at: string
}
// Only the four returned fields are selected — id / coach_client_id never leave.
const COACH_CLIENT_EVENT_SELECT = "event_type, actor_profile_id, context, created_at"

export function toApiEvent(r: CoachClientEventRow) {
  return {
    event_type: r.event_type,
    actor_profile_id: r.actor_profile_id,
    context: r.context,
    created_at: r.created_at,
  }
}

// List a relationship's events, newest first. The caller has already verified
// ownership of coachClientId and passes its admin client in.
export async function listApiEvents(supabase: SupabaseClient, coachClientId: string) {
  const { data, error } = await supabase
    .from("coach_client_events")
    .select(COACH_CLIENT_EVENT_SELECT)
    .eq("coach_client_id", coachClientId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Failed to read events: ${error.message}`)
  return (data as CoachClientEventRow[] ?? []).map(toApiEvent)
}
