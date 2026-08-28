// lib/laneSeniority.ts
//
// The seniority bands a lane may search.
//
// These are the exact strings hiring.cafe filters on. Anything else silently
// matches nothing, which is the failure mode that makes a lane look like it is
// simply having a quiet week, so the vocabulary is closed and validated in one
// place rather than typed at a call site.
//
// It lives here rather than in lib/hiringcafe.ts because the lane setup screens
// need it, and hiringcafe carries the whole LOCATIONS payload table and the
// fetch layer with it. hiringcafe imports and re-exports these so there is still
// exactly one definition.
//
// Must stay in step with the search_lanes_seniority_valid CHECK constraint
// (supabase/migrations/20260828_lane_seniority.sql).

export const SENIORITY_LEVELS = [
  "No Prior Experience Required",
  "Entry Level",
  "Mid Level",
  "Senior Level",
] as const

export const SENIORITY_VALUES: ReadonlySet<string> = new Set(SENIORITY_LEVELS)

/**
 * What every lane searched before the band was configurable, and what a new lane
 * still gets: everything through Mid Level.
 *
 * Worth knowing what that means in practice. It is three bands wide, so a lane
 * built for a mid-career client has always also been returning entry-level and
 * no-experience postings, and no setting existed to stop it. That is the reason
 * a queue fills with work beneath the client, and the reason "too junior" was a
 * dismissal you could record but not act on.
 */
export const DEFAULT_SENIORITY_BANDS: readonly string[] = SENIORITY_LEVELS.slice(0, 3)

/**
 * A lane must search at least one band.
 *
 * Empty is refused rather than treated as "no restriction", which is how the
 * other board filters read an empty list. buildSearchState always sends
 * seniorityLevel, so an empty array would go to the board as a filter matching
 * nothing rather than as an absent one, and a lane that returns zero jobs every
 * night is indistinguishable from a lane nobody is posting for.
 */
export function invalidSeniority(bands: unknown): string | null {
  if (!Array.isArray(bands)) return "seniority must be an array of band names"
  if (!bands.length) return "a lane must search at least one seniority band"
  const bad = bands.filter((b) => typeof b !== "string" || !SENIORITY_VALUES.has(b))
  if (bad.length) {
    return `unknown seniority band(s): ${bad.join(", ")}. Use one of ${SENIORITY_LEVELS.join(", ")}.`
  }
  return null
}

/** Board order, not selection order, so the chips never reshuffle as you click. */
export function orderSeniority(bands: string[]): string[] {
  return SENIORITY_LEVELS.filter((l) => bands.includes(l))
}
