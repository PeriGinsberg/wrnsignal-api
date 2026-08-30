// lib/lanePostingWindow.ts
//
// How far back a lane looks, as a closed set of choices.
//
// READ THIS BEFORE CHANGING A NUMBER HERE. `dateFetchedPastNDays` is not a
// count of days, despite the name. It is a TOKEN from a closed list the board
// defines, and the board's own Date Posted control offers exactly these:
//
//     All time -1     3 weeks   29     4 months 151
//     24 hours  2     1 month   61     5 months 181
//     3 days    4     2 months  91     6 months 211
//     1 week   14     3 months 121     1 year   750
//     2 weeks  21                      2 years 1080, 3 years 1440
//
// Read out of the board's own bundle (chunk 2a1cf151, the `ls` array behind the
// "Date Posted" filter) and confirmed against the live endpoint on 2026-08-30:
// each token narrows the result set monotonically, 2 → 54 results, 4 → 1828,
// 14 → 7303, 21 → 9448, 29 → 11235, 61 → 15999.
//
// A VALUE OUTSIDE THAT LIST IS NOT REJECTED. The board answers HTTP 200 and
// applies NO DATE FILTER AT ALL — byte-identical to sending -1, "All time".
// Measured the same day: 1, 3, 7 and 30 each returned 28101 results reaching
// back 1447 days, against 7303 for the token 14. There is no error, no warning
// and no empty page; a lane simply starts returning more, which is the one
// failure mode nobody reports. It cost us every lane in the database between
// 2026-08-27 and 2026-08-30, and it is why buildSearchState() now throws on a
// token it does not recognise rather than passing it through.
//
// Must stay in step with the search_lanes_days_posted_valid CHECK constraint
// (supabase/migrations/20260830_lane_posting_window_board_tokens.sql).

export const POSTING_WINDOWS: ReadonlyArray<{
  /** The board's token. Sent verbatim as dateFetchedPastNDays. */
  value: number
  /** The board's own label for that token. What we show, so the two agree. */
  label: string
  /**
   * How far back the token actually reaches, in days, for arithmetic we do
   * ourselves on stored rows.
   *
   * Deliberately token - 1, which is what the oldest publish date in a page
   * measured at every token: 2 → 1 day, 4 → 3, 14 → 13, 21 → 20, 61 → 59. It
   * is an upper bound, so a cutoff built from it never drops a row the board
   * would still have returned. Do NOT read the label as a day count: "1 week"
   * is the board's name for a token that reaches back a fortnight.
   */
  approxDays: number
}> = [
  { value: 2, label: "24 hours", approxDays: 1 },
  { value: 4, label: "3 days", approxDays: 3 },
  { value: 14, label: "1 week", approxDays: 13 },
  { value: 21, label: "2 weeks", approxDays: 20 },
  { value: 61, label: "1 month", approxDays: 60 },
]

export const POSTING_WINDOW_VALUES: ReadonlySet<number> = new Set(POSTING_WINDOWS.map((w) => w.value))

/**
 * What a lane gets when nobody chooses. Two weeks is the window where a posting
 * is still worth applying to; a month of backlog is mostly filled roles, and
 * they are the rows that make a queue feel like work.
 *
 * Enforced by the column DEFAULT, not by the create path, so a lane inserted by
 * a script gets the same answer as one created from the dashboard.
 */
export const DEFAULT_POSTING_WINDOW = 21

/**
 * What a lane ran at before the window was configurable.
 *
 * The 29 hardcoded in laneRunner was never arbitrary, whatever the note in the
 * 2026-08-27 migration said: it is the board's token for "3 weeks", and someone
 * reading it as "29 days" is how the five choices came to be day counts. It is
 * not one of the five because "3 weeks" is not a window anyone asked to be
 * offered, only the one we happened to ship.
 *
 * Kept as the code-side fallback ONLY. The column is NOT NULL, so a lane
 * arriving here without a window means a select that forgot to ask for the
 * field, and falling back to the old behaviour is the answer that changes
 * nothing while the missing column is found.
 */
export const LEGACY_POSTING_WINDOW = 29

/** Every token the board honours, including the ones we do not offer. */
const BOARD_TOKENS: ReadonlyMap<number, string> = new Map([
  [-1, "All time"],
  [2, "24 hours"],
  [4, "3 days"],
  [14, "1 week"],
  [21, "2 weeks"],
  [29, "3 weeks"],
  [61, "1 month"],
  [91, "2 months"],
  [121, "3 months"],
  [151, "4 months"],
  [181, "5 months"],
  [211, "6 months"],
  [750, "1 year"],
  [1080, "2 years"],
  [1440, "3 years"],
])

/**
 * Is this a token the board will actually act on?
 *
 * Wider than POSTING_WINDOW_VALUES on purpose: the five we offer are a product
 * decision, and this is the board's capability. The CLI's --days override and
 * the proposal probe are allowed the full vocabulary; a lane is not.
 */
export const isBoardPostingWindow = (value: number): boolean => BOARD_TOKENS.has(value)

/** How a window reads on screen. An unknown token is named as the fault it is. */
export function postingWindowLabel(value: number | null | undefined): string {
  if (value == null) return BOARD_TOKENS.get(LEGACY_POSTING_WINDOW) ?? "3 weeks"
  return BOARD_TOKENS.get(value) ?? `unrecognised window (${value})`
}

/**
 * How far back a token reaches, in days, for cutoffs we compute ourselves.
 *
 * An unknown token answers with the legacy window rather than with the number
 * itself: reading a token as a day count is the mistake this file exists to
 * stop, and 30 would answer "30 days" while the board answered "all time".
 */
export function postingWindowApproxDays(value: number | null | undefined): number {
  if (value == null) return LEGACY_POSTING_WINDOW - 1
  const known = POSTING_WINDOWS.find((w) => w.value === value)
  if (known) return known.approxDays
  return BOARD_TOKENS.has(value) ? value - 1 : LEGACY_POSTING_WINDOW - 1
}
