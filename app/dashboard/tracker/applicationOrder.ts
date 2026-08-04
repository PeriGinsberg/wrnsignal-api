// What order the applications list renders in, and what each card is asking for.
//
// The server returns applications newest-created first, which is a filing order,
// not a working order. On a real board that buries a job with an interview on
// Thursday under six jobs saved yesterday and never touched. The card language
// is the same one the contacts list uses (active lifts, idle recedes), so a
// creation-ordered list stacks receded cards on top of live ones and a tester
// opens on a wall of grey.
//
// So the list re-ranks by NEED, the same principle as `contactOrder.ts`. The
// difference is that a contact's need is a due date the engine already computed,
// while an application's need has to be derived from status plus two dates.
// That derivation is here, once, and both the ordering and the card's action
// read it, so a card can never show "Follow up" while sorting as if nothing is
// due.

import { daysSince, daysUntil } from "../../../lib/localDate"

/** The shape this module needs. The API row has many more fields. */
export type TrackedApp = {
  id: string
  application_status: string
  applied_date: string | null
  created_at: string
}

/**
 * What this application wants from the student right now.
 *
 *   prep      an interview is scheduled and ahead: the only time-critical state
 *   followup  applied, and it has gone quiet long enough to be worth a nudge
 *   apply     saved but not sent. Worth doing, not urgent
 *   none      the ball is genuinely in their court, or the job is closed
 */
export type AppNeed = "prep" | "followup" | "apply" | "none"

/**
 * Days of silence before an applied job is worth chasing. From the build plan:
 * long enough that a fresh application is never nagged, short enough that a
 * dead one does not sit for a month.
 */
export const FOLLOW_UP_AFTER_DAYS = 14

/** Closed. Nothing is ever due on these, and they sort to the bottom. */
const CLOSED = new Set(["rejected", "withdrawn"])

/**
 * Whole days since the application went out.
 *
 * `applied_date` is user-entered and often blank on jobs auto-created by a
 * scoring run, so it falls back to when the row appeared. Without the fallback
 * every auto-created application would read as applied today, forever, and
 * never surface a follow-up.
 *
 * Both values go through `daysSince`, which parses a bare "2026-07-21" as LOCAL
 * midnight. The naive parse treats it as UTC and lands a day early everywhere
 * west of UTC, which would flip this threshold at the boundary.
 */
export function daysSinceApplied(a: TrackedApp, now: Date = new Date()): number | null {
  return daysSince(a.applied_date || a.created_at, now)
}

/**
 * `nextInterviewAt` is passed in rather than read off the application, because
 * interviews live in their own table and the page already loads them. Passing
 * it keeps this function pure and keeps the join in one place.
 */
export function needOf(
  a: TrackedApp,
  nextInterviewAt: string | null = null,
  now: Date = new Date(),
): AppNeed {
  if (CLOSED.has(a.application_status)) return "none"

  // A dated interview ahead outranks everything, in any status. An interview on
  // Thursday is the most time-critical thing a job seeker owns, and it is worth
  // surfacing even on a row someone forgot to move out of "applied". Today
  // counts as ahead: an interview this afternoon still needs prep this morning.
  const until = daysUntil(nextInterviewAt, now)
  if (until !== null && until >= 0) return "prep"

  if (a.application_status === "saved") return "apply"

  if (a.application_status === "applied") {
    const days = daysSinceApplied(a, now)
    return days !== null && days >= FOLLOW_UP_AFTER_DAYS ? "followup" : "none"
  }

  // interviewing without a dated interview, and offer. Both are live and both
  // are waiting on the company, so neither gets a button.
  return "none"
}

export type NeedRank = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Lower sorts higher.
 *
 *   0  an interview is coming up
 *   1  applied and gone quiet: follow up
 *   2  interviewing, no date set yet
 *   3  offer
 *   4  saved: apply
 *   5  applied recently: waiting
 *   6  rejected or withdrawn: closed
 *
 * Two orderings here are deliberate and worth stating.
 *
 * OFFER SITS BELOW FOLLOW-UP even though it is the best news on the board. The
 * list is ordered by what needs the student, and an offer is waiting on THEM
 * to respond, not on the student to act. It stays above saved because it is
 * live, and it is the one card with no action that still earns a lifted card.
 *
 * SAVED SITS BELOW WAITING-ON-INTERVIEWING but ABOVE recently-applied, because
 * a saved job is a real to-do the student has not done, while a fresh
 * application is done and quiet.
 */
export function needRank(
  a: TrackedApp,
  nextInterviewAt: string | null = null,
  now: Date = new Date(),
): NeedRank {
  if (CLOSED.has(a.application_status)) return 6

  const need = needOf(a, nextInterviewAt, now)
  if (need === "prep") return 0
  if (need === "followup") return 1
  if (a.application_status === "interviewing") return 2
  if (a.application_status === "offer") return 3
  if (need === "apply") return 4
  return 5
}

/**
 * Re-rank for need, preserving the server's order inside each band.
 *
 * STABLE, like the contacts list: the API's newest-first order is meaningful
 * within a band, so ties keep it and the list does not reshuffle when two jobs
 * are equally urgent. Applied once at load and then frozen by the caller, so a
 * refetch cannot move a card out from under a pointer.
 */
export function sortForNeed<T extends TrackedApp>(
  rows: T[],
  nextInterviewFor: (a: T) => string | null,
  now: Date = new Date(),
): T[] {
  return rows
    .map((a, i) => ({ a, i, rank: needRank(a, nextInterviewFor(a), now) }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.a)
}
