// lib/lanePostingWindow.ts
//
// How far back a lane looks, as a closed set of choices.
//
// The window was 29 days, hardcoded in lib/laneRunner.ts and copied into the
// CLI and the discovery route. Three copies of a number nobody could change is
// the shape this file exists to remove: the lane stores the choice, and every
// place that needs the vocabulary reads it here.
//
// CLOSED, like the dismissal reasons and the commitment types, and for the same
// reason: the value is offered as five choices, each one reasoned about. An
// arbitrary integer lets a lane sit at 400 days without anyone having decided
// that, and the board would accept it in silence.
//
// Must stay in step with the search_lanes_days_posted_valid CHECK constraint
// (supabase/migrations/20260827_lane_posting_window.sql).

export const POSTING_WINDOWS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: "24 hours" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
]

export const POSTING_WINDOW_DAYS: ReadonlySet<number> = new Set(POSTING_WINDOWS.map((w) => w.days))

/**
 * What a lane gets when nobody chooses. Two weeks is the window where a posting
 * is still worth applying to; a month of backlog is mostly filled roles, and
 * they are the rows that make a queue feel like work.
 *
 * Enforced by the column DEFAULT, not by the create path, so a lane inserted by
 * a script gets the same answer as one created from the dashboard.
 */
export const DEFAULT_POSTING_WINDOW_DAYS = 14

/**
 * What a lane ran at before the window was configurable.
 *
 * Kept as the code-side fallback ONLY. The column is NOT NULL, so a lane
 * arriving here without a window means a select that forgot to ask for the
 * field, and falling back to the old behaviour is the answer that changes
 * nothing while the missing column is found. It is deliberately not one of the
 * five choices: nothing recorded why it was 29 rather than 30.
 */
export const LEGACY_POSTING_WINDOW_DAYS = 29

/** How a window reads on screen. Unknown values print as themselves. */
export function postingWindowLabel(days: number | null | undefined): string {
  if (days == null) return `${LEGACY_POSTING_WINDOW_DAYS} days`
  return POSTING_WINDOWS.find((w) => w.days === days)?.label ?? `${days} days`
}
