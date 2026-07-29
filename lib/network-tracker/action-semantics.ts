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

/**
 * The stage an action implies, or null to leave the stage alone.
 *
 * ONE case, and it is deliberate: logging the first outreach against a contact
 * still sitting at `identified` moves them to `sequence_active`.
 *
 * The reminder engine will not do this. Its only stage write is the
 * sequence_active -> dormant_no_answer flip; it reads the stage and never
 * advances it. That left the contact record unable to record its own most
 * common event — `identified` has no due reason (pokeEnabled is false), so the
 * send box had no action to log, so the first message could not be sent from the
 * screen built for sending without first moving the stage by hand.
 *
 * So this is the one place the record LEADS the engine instead of following it:
 * "send the first outreach" is treated as the due action at `identified` even
 * though nothing is scheduled. It is applied BEFORE computeNextDue runs, so the
 * engine sees sequence_active and schedules touch 2 — running it against the old
 * stage would schedule nothing and leave the contact idle again.
 *
 * Only from `identified`, and only for touch_1: every later stage has its own
 * due reason and its own action, and re-entering a sequence is a decision the
 * user makes explicitly.
 */
export function stageAfterAction(currentStage: string, type: string): string | null {
  if (type === "touch_1" && currentStage === "identified") return "sequence_active"
  return null
}
