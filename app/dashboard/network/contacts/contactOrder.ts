// What order the contacts list renders in.
//
// The server sorts no-activity first (route.ts orders on last_action_at), which
// was the right heuristic for a spreadsheet: an untouched contact reads as
// "sort me" and belongs at the top of a triage table. In the redesigned list it
// is exactly wrong. The card language is built on active pops, idle recedes, so
// a no-activity-first order puts every receded card above every live one and
// buries the things that need the student three screens down. Measured on a real
// dev account: 38 untouched contacts stacked above all 27 live ones.
//
// So the list re-ranks client-side by ATTENTION, the same priority the Dashboard
// nudges use: what is due now, then what is scheduled, then what is waiting on
// them, then what has never been started, then what has stopped.
//
// Ordering is applied once at load and then frozen by the caller, so a refetch
// cannot reshuffle the list under a pointer.

import type { Contact } from "./ContactRow"

export type AttentionRank = 0 | 1 | 2 | 3 | 4 | 5

/** Stages that mean the thread has stopped rather than progressed. */
const RESTING = new Set(["dormant_no_answer", "dormant_declined"])

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/**
 * Lower is more urgent.
 *
 *   0  overdue, something was due and the day has passed
 *   1  due today
 *   2  due later, a real commitment exists but not yet
 *   3  worked, nothing due: waiting on them
 *   4  never started
 *   5  resting: no answer, or declined
 *
 * `identified` outranks `resting` deliberately. A contact nobody has written to
 * is potential; one who declined is closed. Potential should sit higher.
 */
export function attentionRank(c: Contact, now: Date = new Date()): AttentionRank {
  if (RESTING.has(c.stage)) return 5

  if (c.next_due_at) {
    const due = startOfDay(new Date(c.next_due_at))
    const today = startOfDay(now)
    if (due < today) return 0
    if (due === today) return 1
    return 2
  }

  // A due REASON with no date still means the engine flagged this one. Treat it
  // as due today rather than dropping it in with the untouched.
  if (c.next_due_reason) return 1

  if (c.stage === "identified") return 4
  return 3
}

/**
 * Re-rank for attention, preserving the server's order inside each band.
 *
 * The server's ordering is meaningful within a band (most recent activity), so
 * this is a STABLE sort over the incoming array rather than a re-sort from
 * scratch. Ties therefore keep whatever the API decided, which keeps the list
 * from reshuffling when two contacts are equally urgent.
 */
export function sortForAttention(rows: Contact[], now: Date = new Date()): Contact[] {
  return rows
    .map((c, i) => ({ c, i, rank: attentionRank(c, now) }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((x) => x.c)
}
