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

/**
 * THE STAGE PATH, in order. The nine stages that are steps of progress.
 *
 * The two dormant stages are deliberately absent: they are where a thread
 * stops, not somewhere you advance to. WhereThingsStand draws exactly this list
 * and used to hold its own copy; it imports this one now, because a stepper and
 * an "is this ahead?" test that disagree about the order is a bug nobody would
 * spot until a prompt offered a move backwards.
 */
export const STAGE_PATH = [
  "identified",
  "intro_requested",
  "sequence_active",
  "replied",
  "chat_scheduled",
  "chat_done",
  "nurture",
  "ask_made",
  "outcome",
] as const

/** Position on the path, or -1 for the dormant stages and anything unknown. */
export function stageIndex(stage: string): number {
  return (STAGE_PATH as readonly string[]).indexOf(stage)
}

/**
 * The stage an action IMPLIES — the thing the record can offer to do, never
 * something it does on its own.
 *
 * WHY THIS EXISTS. Actions and stages described the same events and did not
 * respond to each other: logging "Chat done" left the stage reading "Message
 * sent", and a tester reported the two systems as contradicting each other. She
 * was right. The fix is not to make the stage a function of the log — people
 * under-log, and a coach has to be able to say "this one is parked" with nothing
 * logged at all — so the stage stays a fact you ASSERT. This table only lets the
 * record notice the gap and offer to close it.
 *
 * SIX ACTIONS IMPLY NOTHING, and each for a reason:
 *   thank_you           it is the due action AT chat_done — you are already there
 *   connection_request  connecting is not outreach
 *   engage_on_post      warming, not contact
 *   note_logged         covers four different due reasons (reply, nurture,
 *                       ask-followup, manual); it cannot imply one stage
 *   note                inert, never reaches the engine at all
 *   other               unknown by definition
 *
 * FIVE STAGES ARE NOT IMPLIED BY ANYTHING: replied, nurture, outcome, and both
 * dormant stages. `replied` is the notable one — a reply is something THEY do,
 * and there is no action type for it — so it can only ever be set by hand. That
 * is consistent with the stage being an assertion, but it does mean the manual
 * path stays first-class and cannot be treated as a fallback.
 */
export const IMPLIED_STAGE: Record<string, string> = {
  touch_1: "sequence_active",
  touch_2: "sequence_active",
  touch_3: "sequence_active",
  intro_request: "intro_requested",
  chat_scheduled: "chat_scheduled",
  chat_done: "chat_done",
  ask: "ask_made",
}

/**
 * The stage to OFFER after logging `type`, or null for no offer.
 *
 * Only ever forwards, and only from somewhere on the path:
 *   - a backdated action implying a stage you are past offers nothing
 *   - re-logging where you already are offers nothing
 *   - a dormant contact offers nothing: resurfacing is a decision, and the
 *     dormant stages are off the path so "ahead" is not even defined
 */
export function impliedStageAhead(currentStage: string, type: string): string | null {
  const implied = IMPLIED_STAGE[type]
  if (!implied) return null
  const from = stageIndex(currentStage)
  if (from < 0) return null
  return stageIndex(implied) > from ? implied : null
}
