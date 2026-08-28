// lib/laneReasons.ts
//
// The dismissal taxonomy, in one place.
//
// It was in three: a CHECK constraint in the database, a Set in
// app/api/lanes/results/route.ts, and a labelled array in the dashboard. The
// route's own comment admitted the duplication was deliberate — the database
// rejects a bad value regardless, and the Set only turns a constraint violation
// into a clean 400. That reasoning holds for the DB copy, which cannot import
// TypeScript. It does not hold for the other two, and adding a seventh reason
// to two lists by hand is how they drift.
//
// WHY A REASON HAS A KIND. The reasons exist to be counted: forty
// wrong_function dismissals mean the lane's titles are wrong, forty
// wrong_industry mean its keyword or filters are. But "already applied" is not
// a complaint about the lane at all — it means the lane found a job the client
// had already found for themselves, which is the lane working. Counting it
// beside the misses would make a well-aimed lane look badly aimed, and the
// louder the signal the worse the advice.
//
// So every reason declares its KIND. A MISS means the lane pointed at the wrong
// thing. A HIT means the lane was right and the row leaves the queue for a
// reason that is not the lane's fault. UNCLASSIFIED means the dismissal says
// nothing about the lane either way, which is true of exactly one value and has
// to be sayable: counting an escape hatch as a miss would indict a lane on the
// strength of dismissals nobody could categorise.
//
// Any future analysis reads `kind` rather than hard-coding a list it will
// forget to update.

export type ReasonKind = "miss" | "hit" | "unclassified"

export const LANE_REASONS: ReadonlyArray<{
  value: string
  label: string
  kind: ReasonKind
  /** Does this reason mean nothing without a note? Enforced by API and column. */
  requiresNote?: true
}> = [
  // The level is wrong, in either direction. Kept as two values rather than one
  // "wrong level" because they call for opposite corrections: too_senior means
  // the titles reach above the client, too_junior means the band or the titles
  // are set for someone earlier in their career.
  { value: "too_senior", label: "Too senior", kind: "miss" },
  { value: "too_junior", label: "Too junior", kind: "miss" },
  { value: "wrong_function", label: "Wrong function", kind: "miss" },
  { value: "wrong_industry", label: "Wrong industry", kind: "miss" },
  { value: "wrong_location", label: "Wrong location", kind: "miss" },
  { value: "right_employer_wrong_level", label: "Right employer, wrong level", kind: "miss" },
  { value: "doesnt_meet_requirements", label: "Doesn't meet requirements", kind: "miss" },
  // The lane found something good. Dismissed only because the client got there
  // first — which is a hit, not a targeting failure.
  { value: "already_applied", label: "Already applied", kind: "hit" },
  // The escape hatch, last in the list because it should be the last thing
  // tried. Its whole value is that it keeps unclassifiable dismissals OUT of the
  // targeting counts, so it is neither a miss nor a hit, and it is useless
  // without the note that says what actually happened.
  { value: "other", label: "Other (note required)", kind: "unclassified", requiresNote: true },
]

/** Must stay in step with lane_results_reason_valid. */
export const REASON_VALUES: ReadonlySet<string> = new Set(LANE_REASONS.map((r) => r.value))

/**
 * Did the lane do its job, despite the row being dismissed?
 *
 * Unknown values are treated as NOT a hit on purpose: a reason nobody has
 * classified is more likely to be a new complaint than a new kind of success,
 * and under-reporting hits fails towards examining the lane rather than towards
 * congratulating it.
 */
export function countsAsHit(reason: string | null | undefined): boolean {
  if (!reason) return false
  return LANE_REASONS.find((r) => r.value === reason)?.kind === "hit"
}

/** Reasons that are meaningless without a note. Checked by the API and the column. */
export const REASONS_REQUIRING_NOTE: ReadonlySet<string> = new Set(
  LANE_REASONS.filter((r) => r.requiresNote).map((r) => r.value)
)

/** The reasons that indict the lane's targeting. What analysis should count. */
export const TARGETING_MISS_REASONS: ReadonlyArray<string> = LANE_REASONS.filter((r) => r.kind === "miss").map((r) => r.value)
