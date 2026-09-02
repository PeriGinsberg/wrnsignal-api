// lib/network-tracker/reminder-engine.ts
//
// The Network Tracker reminder engine — ONE pure function. Every action log or
// stage change calls computeNextDue() in the API route and saves the result.
// Never inline interval math elsewhere; never compute due dates in a component.
//
// v3 (reconciliation to WRN Tracker v3): the THREE-touch rule replaces the old
// four-touch ladder, there are TWO kinds of dormant, and the intervals are
// revised. See docs/network-tracker/network-tracker-reconciliation.md.
//
// Division of labor (locked): the engine's ONLY stage write is
//   sequence_active -> dormant_no_answer, after touch 3 goes unanswered.
// The declined case is a MANUAL move to dormant_declined; the engine never sets
// it (it only reads that stage to schedule the 90-day resurface).
//
// Intervals are platform-wide constants (not a table) in v1.

export type ContactStage =
  | "identified"
  | "intro_requested"
  | "sequence_active"
  | "replied"
  | "chat_scheduled"
  | "chat_done"
  | "nurture"
  | "ask_made"
  | "outcome"
  | "dormant_no_answer"
  | "dormant_declined";

export type NextDueReason =
  | "touch_2"
  | "touch_3"
  | "intro_chase"
  | "reply"
  | "thank_you"
  | "nurture_recurring"
  | "ask_followup"
  | "resurface_no_answer"
  | "resurface_declined"
  | "poke"
  | "manual";

// Authoritative intervals (reconciliation §4). Days.
export const STAGE_INTERVALS = {
  identified: { poke: 7 },                       // optional, OFF unless enabled
  intro_requested: { intro_chase: 7 },
  sequence_active: { touch_2: 7, touch_3: 5 },   // touch 2 at +7d, touch 3 at +5d, then dormant_no_answer
  replied: { reply: 1 },                         // spreadsheet: same day
  chat_done: { thank_you: 1 },
  nurture: { recurring: 42 },                    // 6 weeks (midpoint of 4-8)
  ask_made: { ask_followup: 14 },
  dormant_no_answer: { resurface: 35 },          // 4-6 weeks -> 35d
  dormant_declined: { resurface: 90 },           // 3 months
} as const;

export type EngineInput = {
  stage: ContactStage;
  createdAt: Date | string;
  lastActionAt: Date | string | null;
  reminderOverride: Date | string | null;
  dormantSince: Date | string | null;
  pokeEnabled: boolean;
  /**
   * This contact's logged actions. action_date is required for touch counting
   * whenever cycleStartedAt is set; callers must select it.
   *
   * `status` arrives because network_actions now also holds MESSAGES, and a
   * draft is not a thing that happened. Callers should select it; a row without
   * it is treated as a logged action, which is what every pre-message row is.
   */
  actions: { type: string; action_date?: Date | string | null; status?: string | null }[];
  /**
   * When the CURRENT outreach cycle began — stamped on any transition into
   * sequence_active. Only touches logged at/after this instant count toward the
   * touch_2/touch_3 sequence, so a contact worked a second time does not inherit
   * the first cycle's touches and flip straight to dormant. NULL counts all.
   */
  cycleStartedAt?: Date | string | null;
  /**
   * True when this call follows PIPELINE ACTIVITY — logging an action or
   * changing the stage. An override means "remind me on this date"; acting on
   * the contact satisfies it, so the override is consumed and the contact falls
   * back to its stage cadence. NOT set when the override itself is being edited
   * (the reminder route) — that would clear it on the way in.
   */
  pipelineActivity?: boolean;
};

export type EngineResult = {
  nextDueAt: Date | null;
  nextDueReason: NextDueReason | null;
  // Set ONLY on the sequence_active -> dormant_no_answer flip:
  stage?: ContactStage;
  dormantSince?: Date;
  /** True when the caller must also null out reminder_override (see pipelineActivity). */
  clearOverride?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

/**
 * Compute a contact's next due date + reason from its current state.
 *
 * Rules (locked, v3):
 *  0. pipelineActivity CONSUMES any override: the user acted on the contact, so
 *     fall through to the stage rules and tell the caller to clear reminder_override.
 *  1. Otherwise reminderOverride wins over EVERYTHING (even outcome) -> "manual".
 *  2. By stage:
 *     - identified:        +7d "poke" if pokeEnabled, else no due (null).
 *     - intro_requested:   intro_chase @ +7d.
 *     - sequence_active:   count touch_2/touch_3 in the current cycle.
 *                          0 -> touch_2 @ +7d, 1 -> touch_3 @ +5d,
 *                          >=2 -> FLIP to dormant_no_answer (dormantSince=base), resurface @ +35d.
 *     - replied:           reply @ +1d.
 *     - chat_scheduled:    no due (null) — nothing until the chat happens.
 *     - chat_done:         thank_you @ +1d.
 *     - nurture:           nurture_recurring @ +42d (reschedules each write).
 *     - ask_made:          ask_followup @ +14d.
 *     - outcome:           no due (null).
 *     - dormant_no_answer: resurface_no_answer @ dormantSince+35d.
 *     - dormant_declined:  resurface_declined @ dormantSince+90d.
 *
 * Interval base is lastActionAt (falling back to createdAt when no action yet).
 */
export function computeNextDue(input: EngineInput): EngineResult {
  // 0/1. An override normally wins over everything — but any pipeline activity
  // satisfies it, so it is consumed rather than obeyed.
  const override = toDate(input.reminderOverride);
  const overrideConsumed = Boolean(override) && input.pipelineActivity === true;
  if (override && !overrideConsumed) return { nextDueAt: override, nextDueReason: "manual" };

  const created = toDate(input.createdAt) ?? new Date(0);
  const base = toDate(input.lastActionAt) ?? created;

  // Every stage branch returns through this, so the clear-override signal rides
  // along with whatever due date the stage rules produced.
  const out = (r: EngineResult): EngineResult => (overrideConsumed ? { ...r, clearOverride: true } : r);

  switch (input.stage) {
    case "identified":
      return out(
        input.pokeEnabled
          ? { nextDueAt: addDays(base, STAGE_INTERVALS.identified.poke), nextDueReason: "poke" }
          : { nextDueAt: null, nextDueReason: null },
      );

    case "intro_requested":
      return out({ nextDueAt: addDays(base, STAGE_INTERVALS.intro_requested.intro_chase), nextDueReason: "intro_chase" });

    case "sequence_active": {
      // Only this cycle's follow-up touches count. With no cycle stamp, count
      // all (pre-existing / never re-engaged). With a stamp, a touch needs a
      // parseable action_date at/after it — an undated action is excluded, since
      // over-counting is what causes a premature flip to dormant.
      const cycleStart = toDate(input.cycleStartedAt);
      const touches = input.actions.filter((a) => {
        // A DRAFT IS NOT A TOUCH. network_actions holds messages now, and a
        // draft carries a real type (touch_2, say) because it is the outreach
        // it will become. Counting it would advance the sequence for a message
        // nobody sent, and then flip the contact to dormant for silence in
        // response to nothing.
        //
        // FILTERED HERE, NOT AT THE CALL SITES, deliberately. Three routes feed
        // this function and each selects its own columns; putting the rule in
        // any of them means the next one has to remember it. A pure function
        // that ignores drafts cannot be called wrongly.
        if (a.status === "draft") return false;
        if (a.type !== "touch_2" && a.type !== "touch_3") return false;
        if (!cycleStart) return true;
        const at = toDate(a.action_date);
        return at !== null && at.getTime() >= cycleStart.getTime();
      }).length;

      if (touches <= 0)
        return out({ nextDueAt: addDays(base, STAGE_INTERVALS.sequence_active.touch_2), nextDueReason: "touch_2" });
      if (touches === 1)
        return out({ nextDueAt: addDays(base, STAGE_INTERVALS.sequence_active.touch_3), nextDueReason: "touch_3" });

      // >=2 follow-up touches: touch 3 sent, no answer -> the only stage write the engine makes.
      const dormantSince = base;
      return out({
        stage: "dormant_no_answer",
        dormantSince,
        nextDueAt: addDays(dormantSince, STAGE_INTERVALS.dormant_no_answer.resurface),
        nextDueReason: "resurface_no_answer",
      });
    }

    case "replied":
      return out({ nextDueAt: addDays(base, STAGE_INTERVALS.replied.reply), nextDueReason: "reply" });

    case "chat_scheduled":
      return out({ nextDueAt: null, nextDueReason: null });

    case "chat_done":
      return out({ nextDueAt: addDays(base, STAGE_INTERVALS.chat_done.thank_you), nextDueReason: "thank_you" });

    case "nurture":
      return out({ nextDueAt: addDays(base, STAGE_INTERVALS.nurture.recurring), nextDueReason: "nurture_recurring" });

    case "ask_made":
      return out({ nextDueAt: addDays(base, STAGE_INTERVALS.ask_made.ask_followup), nextDueReason: "ask_followup" });

    case "outcome":
      return out({ nextDueAt: null, nextDueReason: null });

    case "dormant_no_answer": {
      const since = toDate(input.dormantSince) ?? base;
      return out({ nextDueAt: addDays(since, STAGE_INTERVALS.dormant_no_answer.resurface), nextDueReason: "resurface_no_answer" });
    }

    case "dormant_declined": {
      const since = toDate(input.dormantSince) ?? base;
      return out({ nextDueAt: addDays(since, STAGE_INTERVALS.dormant_declined.resurface), nextDueReason: "resurface_declined" });
    }
  }
}
