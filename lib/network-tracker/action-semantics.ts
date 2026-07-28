// lib/network-tracker/action-semantics.ts
// Which action types count as PIPELINE ACTIVITY, and which are inert.
//
// This is domain vocabulary, not engine logic — reminder-engine.ts is untouched
// and still knows nothing about notes. It lives here rather than in the route
// because a Next `route.ts` may only export route members, and because the
// distinction is a fact about the domain that more than one caller may need.
//
// THE DISTINCTION THAT MATTERS
//   'note'         standalone note. INERT. Recording an observation is not
//                  working the contact, so it must not consume
//                  reminder_override, must not move last_action_at, and must
//                  not recompute next_due_at.
//   'note_logged'  PIPELINE. Carries the four due reasons the worklist and the
//                  inline Log button fire — reply, nurture_recurring,
//                  ask_followup, manual (see vocab.ts REASON_TO_ACTION). These
//                  ARE the user acting. Making this inert would leave every
//                  reply / check-in / manual reminder permanently overdue.
//
// The two look similar and behave oppositely, which is exactly why the
// distinction is a schema value and not a request flag.
// See supabase/migrations/20260727_network_note_action_type.sql.

export const ACTION_TYPES = new Set([
  "touch_1", "touch_2", "touch_3", "intro_request", "thank_you",
  "connection_request", "engage_on_post", "chat_scheduled", "chat_done",
  "ask", "note_logged", "note", "other",
])

const INERT_TYPES = new Set(["note"])

export function isPipelineAction(type: string): boolean {
  return !INERT_TYPES.has(type)
}
