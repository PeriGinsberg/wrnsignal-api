// The Prep Now playbook: static content, and the two rules that arrange it.
//
// EVERY user sees the same items. Nothing here is generated, scored or
// personalised — that is commit 3's job, and it lands in its own zone on the
// page. Keeping the static playbook genuinely static is what lets this ship
// standalone and work for an interview with no JobFit run behind it.
//
// GROUPED BY WHEN, NOT BY CATEGORY. "Research the company / Prepare answers /
// Logistics" is how someone who already knows the method would file it. A
// student opening this three days out has one question — what do I do now —
// and a category grouping makes them read all of it to answer that.

import { daysUntil, parseLocalDate } from "../../../lib/localDate"

export type PrepGroup = "this_week" | "day_before" | "day_of"

/** Which format an item applies to. `null` = applies to every interview. */
export type PrepFormat = "in_person" | "virtual"

export type PrepItem = {
  /**
   * The persistence key. A STABLE STRING, never an index: checklist_state is
   * stored as { [id]: true }, so an index would silently re-map every ticked
   * box the first time this list is reordered or an item is inserted.
   */
  id: string
  group: PrepGroup
  label: string
  /** Only shown when the interview's format matches, or when it is unknown. */
  onlyFor?: PrepFormat
}

export const PREP_GROUP_LABELS: Record<PrepGroup, string> = {
  this_week: "This week",
  day_before: "Day before",
  day_of: "Day of",
}

export const PREP_ITEMS: PrepItem[] = [
  { id: "week_research", group: "this_week", label: "Read their website and every press item from the last 6 months" },
  { id: "week_find_interviewers", group: "this_week", label: "Find your interviewers on LinkedIn" },
  { id: "week_follow", group: "this_week", label: "Follow them" },

  { id: "before_connect", group: "day_before", label: "Send a connection note to each interviewer" },
  { id: "before_outfit", group: "day_before", label: "Plan what you are wearing" },
  { id: "before_route", group: "day_before", label: "Check your route. Plan to arrive 10 minutes early", onlyFor: "in_person" },
  { id: "before_tech", group: "day_before", label: "Test camera, mic and connection on the actual platform", onlyFor: "virtual" },

  { id: "day_why_job", group: "day_of", label: "Have your answer to “Why this job” out loud, not in your head" },
  { id: "day_why_you", group: "day_of", label: "Same for “Why you”" },
]

/**
 * The items that apply to one interview.
 *
 * A NULL format keeps BOTH branches. The column exists but nothing writes it
 * yet, so null is the state of every interview today; hiding both branches
 * would empty the Day-before group, and guessing one would be worse than
 * showing two. The page says so in one line rather than asking anyone to go
 * and fix it.
 */
export function itemsFor(format: string | null | undefined): PrepItem[] {
  if (format !== "in_person" && format !== "virtual") return PREP_ITEMS
  return PREP_ITEMS.filter((i) => !i.onlyFor || i.onlyFor === format)
}

/** The groups in order, each with its applicable items. Empty groups dropped. */
export function groupedItems(format: string | null | undefined): { group: PrepGroup; items: PrepItem[] }[] {
  const order: PrepGroup[] = ["this_week", "day_before", "day_of"]
  return order
    .map((group) => ({ group, items: itemsFor(format).filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0)
}

/**
 * Is the interview close enough that the checklist should come first?
 *
 * Inside 24 hours the page reorders: the checklist jumps above the facts and
 * the generated zone, because at that point there is nothing to read and
 * everything to do.
 *
 * COARSE ON PURPOSE, and worth knowing: `interview_at` (timestamptz) is not
 * written by anything yet, so `when` is almost always a date-only
 * `interview_date`. Day granularity is therefore the real resolution — an
 * interview "today" cannot be told from one at 9am vs 5pm. That sharpens for
 * free once something writes interview_at; no code here changes.
 */
export function isImminent(when: string | null | undefined, now: Date = new Date()): boolean {
  const days = daysUntil(when, now)
  return days !== null && days >= 0 && days <= 1
}

/** The scheduled instant, preferring the newer column. Never parses inline. */
export function scheduledAt(interview: { interview_at?: string | null; interview_date?: string | null }): string | null {
  return interview.interview_at ?? interview.interview_date ?? null
}

/** Ticked items, from the stored jsonb. Absent key = unchecked. */
export function isChecked(state: Record<string, unknown> | null | undefined, id: string): boolean {
  return Boolean(state && state[id])
}

/** How many of the applicable items are done — for the "3 of 9" summary. */
export function progressFor(
  state: Record<string, unknown> | null | undefined,
  format: string | null | undefined,
): { done: number; total: number } {
  const items = itemsFor(format)
  return { done: items.filter((i) => isChecked(state, i.id)).length, total: items.length }
}

/** Guard so a malformed stored blob cannot crash the page. */
export function safeState(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === true) out[k] = true
  return out
}

/** Re-exported so callers never reach for a second date parser. */
export { parseLocalDate }
