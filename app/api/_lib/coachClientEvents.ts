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

// The event vocabulary lives in lib/coach/clientEventTypes.ts, so the History
// tab and its coverage test can read it without loading this module's
// service-role client. Re-exported here because every writer imports from here.
export { COACH_CLIENT_EVENT_TYPES, type CoachClientEventType } from "@/lib/coach/clientEventTypes"
import { type CoachClientEventType as EventType } from "@/lib/coach/clientEventTypes"

// BEST-EFFORT, NEVER THROWS. Inserts one append-only event. Any failure (FK
// violation, missing env, network, …) is swallowed with a console.warn and the
// promise still resolves — a logging failure can never propagate to the caller.
// This is the whole safety contract.
export async function logCoachClientEvent(args: {
  coachClientId: string
  eventType: EventType
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

export function toApiEvent(r: CoachClientEventRow, actorName?: string | null) {
  return {
    event_type: r.event_type,
    actor_profile_id: r.actor_profile_id,
    // WHO DID IT. A null actor is the system acting on its own (a webhook, a
    // scheduled job); the tab says "System". Anything else is a person, and
    // with delegate coaches in a practice "which of us" is the whole question
    // the timeline is asked.
    actor_name: r.actor_profile_id ? actorName ?? null : null,
    actor_is_system: r.actor_profile_id === null,
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
  const rows = (data as CoachClientEventRow[]) ?? []

  // One lookup for every distinct actor, not one per row.
  const ids = [...new Set(rows.map((r) => r.actor_profile_id).filter(Boolean) as string[])]
  const names = new Map<string, string | null>()
  if (ids.length) {
    const { data: people, error: peopleErr } = await supabase
      .from("client_profiles").select("id, name, email").in("id", ids)
    // A name we cannot resolve must not cost the whole timeline: the rows still
    // render, just without a name on the ones affected.
    if (peopleErr) console.warn("[coach-client-events] actor lookup failed:", peopleErr.message)
    for (const p of people ?? []) names.set(p.id as string, (p.name as string) || (p.email as string) || null)
  }
  return rows.map((r) => toApiEvent(r, r.actor_profile_id ? names.get(r.actor_profile_id) ?? null : null))
}
