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
 * The rank, said out loud.
 *
 * The list has been sorted by attention for a while and NOTHING ON SCREEN SAID
 * SO. A tester looking at a correctly-ordered board answered "no" to "would you
 * know who to contact first" — the answer was row one, and the board never
 * claimed it. Elapsed time cannot carry that on its own: "three weeks ago" is
 * fine for a nurture contact and alarming for someone who owed a reply on
 * Tuesday, and the row looked identical either way.
 *
 * One label per rank, so a band can never disagree with the sort that produced
 * it. Wording is about the PERSON, not the mechanism: "Waiting on them", not
 * "no next_due_at".
 */
export const BAND_LABELS: Record<AttentionRank, string> = {
  0: "Overdue",
  1: "Due today",
  2: "Due later",
  3: "Waiting on them",
  4: "Not started",
  5: "Resting",
}

/**
 * Order WITHIN a band. The rank says which group you are in; this says where you
 * sit in it, and a band whose insides are arbitrary is only half-sorted — the
 * top of Overdue is the single most useful row on the screen and it was
 * whatever the server happened to return.
 *
 * Not one rule for all six, because the bands do not mean the same thing:
 *
 *   0 Overdue          oldest due first — 10 days over outranks 5
 *   1 Due today        all the same day; nothing to order by, keep server order
 *   2 Due later        soonest first, so the next commitment is at the top
 *   3 Waiting on them  longest wait first — you acted, they did not, and the
 *                      one that has sat longest is the one going cold
 *   4 Not started      no dates at all; keep server order
 *   5 Resting          soonest to resurface first, since that is the only
 *                      thing that will happen to them
 *
 * Returns null where there is nothing meaningful to sort by, and the caller
 * falls back to the incoming order.
 */
function withinBandKey(c: Contact, rank: AttentionRank): number | null {
  switch (rank) {
    case 0:
    case 2:
    case 5:
      return c.next_due_at ? new Date(c.next_due_at).getTime() : null
    case 3:
      return c.last_action_at ? new Date(c.last_action_at).getTime() : null
    default:
      return null
  }
}

/**
 * Re-rank for attention, then order inside each band.
 *
 * Still STABLE where there is no key: ties keep whatever the API decided, which
 * keeps the list from reshuffling when two contacts are equally urgent.
 */
export function sortForAttention(rows: Contact[], now: Date = new Date()): Contact[] {
  return rows
    .map((c, i) => {
      const rank = attentionRank(c, now)
      return { c, i, rank, key: withinBandKey(c, rank) }
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      // Ascending on every keyed band: oldest-due first for overdue, soonest
      // first for future, longest-waiting first for band 3. One direction,
      // because in each case the smaller timestamp is the more urgent fact.
      if (a.key !== null && b.key !== null && a.key !== b.key) return a.key - b.key
      return a.i - b.i
    })
    .map((x) => x.c)
}
