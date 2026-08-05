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

/**
 * A COMPLETION SLOT: one thing that has to be done, which may be satisfiable by
 * more than one item.
 *
 * This exists to fix a checklist nobody could finish. With an unknown format
 * both the in-person and the virtual item are shown, but they are mutually
 * exclusive in reality — you cannot both check your route and test your camera
 * for the same interview. Counting them as two separate obligations made "Day
 * before" impossible to complete, so the group could never reach its done
 * state and the overall count could never reach its total.
 *
 * Folding them into ONE either-or slot makes ticking either enough. Both stay
 * visible and both stay tickable; only the arithmetic changes. When the format
 * IS known, one branch is filtered out entirely and every slot is a single
 * item, so this collapses to the obvious behaviour.
 */
export type PrepSlot = { id: string; group: PrepGroup; itemIds: string[] }

export function slotsFor(format: string | null | undefined): PrepSlot[] {
  const items = itemsFor(format)
  const known = format === "in_person" || format === "virtual"
  if (known) return items.map((i) => ({ id: i.id, group: i.group, itemIds: [i.id] }))

  const out: PrepSlot[] = []
  const emitted = new Set<PrepGroup>()
  for (const i of items) {
    if (!i.onlyFor) {
      out.push({ id: i.id, group: i.group, itemIds: [i.id] })
      continue
    }
    // The first branch item in a group emits the combined slot, IN PLACE, so
    // the slot keeps its position in the sequence. Later branch items in the
    // same group fold into it rather than emitting their own.
    if (emitted.has(i.group)) continue
    emitted.add(i.group)
    out.push({
      id: `${i.group}__either`,
      group: i.group,
      itemIds: items.filter((x) => x.group === i.group && x.onlyFor).map((x) => x.id),
    })
  }
  return out
}

/** A slot is done when ANY of its items is ticked. */
export function isSlotDone(state: Record<string, unknown> | null | undefined, slot: PrepSlot): boolean {
  return slot.itemIds.some((id) => isChecked(state, id))
}

/**
 * Progress, counted in SLOTS rather than items — so an unknown format reads
 * "0 of 8" against nine visible boxes, because one of those nine pairs is an
 * either-or. The page marks the pair with an "or" so the arithmetic is visible
 * rather than mysterious.
 */
export function progressFor(
  state: Record<string, unknown> | null | undefined,
  format: string | null | undefined,
): { done: number; total: number } {
  const slots = slotsFor(format)
  return { done: slots.filter((s) => isSlotDone(state, s)).length, total: slots.length }
}

/**
 * Which group is the one to act on now.
 *
 *   more than 7 days out   this_week
 *   2 to 7 days            day_before
 *   today or tomorrow      day_of
 *   already happened       null — nothing "needs you" any more
 *   no date at all         this_week — you can always start researching
 */
export function liveGroup(when: string | null | undefined, now: Date = new Date()): PrepGroup | null {
  const days = daysUntil(when, now)
  if (days === null) return "this_week"
  if (days < 0) return null
  if (days <= 1) return "day_of"
  if (days <= 7) return "day_before"
  return "this_week"
}

export type GroupState = "complete" | "live" | "receded"

/**
 * How a group card presents itself.
 *
 * COMPLETE OUTRANKS LIVE, deliberately. Coral means "something needs you"; once
 * every slot in a group is done that is no longer true, and a coral rail on a
 * finished list would be saying something false. Teal wins.
 *
 * `receded` is de-emphasis, never disablement — the card stays readable and
 * every item stays tickable. Same distinction the action rule makes elsewhere:
 * the absence of emphasis, not a greyed-out control.
 */
export function groupState(
  group: PrepGroup,
  state: Record<string, unknown> | null | undefined,
  format: string | null | undefined,
  when: string | null | undefined,
  now: Date = new Date(),
): GroupState {
  const slots = slotsFor(format).filter((s) => s.group === group)
  if (slots.length > 0 && slots.every((s) => isSlotDone(state, s))) return "complete"
  return liveGroup(when, now) === group ? "live" : "receded"
}

/**
 * The order the group cards render in.
 *
 * Natural sequence, EXCEPT inside 24 hours when `day_of` jumps to the front.
 * The sequence carries meaning, so it only breaks when the urgency demands it.
 */
export function orderedGroups(when: string | null | undefined, now: Date = new Date()): PrepGroup[] {
  const natural: PrepGroup[] = ["this_week", "day_before", "day_of"]
  if (!isImminent(when, now)) return natural
  return ["day_of", ...natural.filter((g) => g !== "day_of")]
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
