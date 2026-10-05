// lib/prospects/automation.ts
//
// The prospect workflow's events for the automation engine. Each one names the
// prospect (coach_client_id) so a rule, or a waiting timer, can act on that
// prospect alone:
//
//   booking_form.submitted  starts the 3-day no-booking follow-up timer
//   consult.booked          cancels it (by the button or from Calendly)
//   prospect.lost           cancels it too (and the SOW follow-up)
//   sow.sent                starts the 3-day SOW follow-up timer; a re-send
//                           restarts it
//   sow.accepted            cancels it (Let's Go)
//
// Never fails the action that emitted it: the engine's queue keeps the event,
// and the half-hourly job applies it if the drain here does not.

import type { SupabaseClient } from "@supabase/supabase-js"
import { emitAndRun } from "../automation/run"

export type ProspectAutomationEvent = "booking_form.submitted" | "consult.booked" | "prospect.lost" | "sow.sent" | "sow.accepted"

export async function emitProspectEvent(
  db: SupabaseClient,
  eventKey: ProspectAutomationEvent,
  coachClientId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await emitAndRun(db, eventKey, { coach_client_id: coachClientId, ...extra }, null)
  } catch (e) {
    console.error(`[prospects/automation] ${eventKey} failed:`, e instanceof Error ? e.message : String(e))
  }
}
