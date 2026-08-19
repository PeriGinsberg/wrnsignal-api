// lib/laneCommitment.ts
//
// Commitment types, and the translation between the two vocabularies that
// describe the same thing.
//
// THE PROFILE SAYS "Full-time". THE BOARD WANTS "Full Time". Measured against
// the live endpoint on "baseball operations baseball" (28 results):
//
//   commitmentTypes ["Full Time"]   ->  6   the six genuine full-time roles
//   commitmentTypes ["Full-time"]   ->  0   the profile's own spelling, no matches
//   commitmentTypes ["full time"]   ->  6   case-insensitive
//   commitmentTypes ["Nonsense"]    ->  0
//
// That last line is why this module exists rather than a pass-through. Unlike
// the industry filters — where an unrecognised term simply matches nothing
// inside an OR and the lane still returns its other results — an unrecognised
// commitment type filters the lane to ZERO. Handing job_type straight to
// searchState would not narrow a lane, it would switch it off, and the failure
// looks exactly like a quiet week on the board.
//
// So the vocabulary is closed here, the mapping is explicit, and anything that
// does not map is dropped rather than guessed at.

/** Exactly the values the board answers to. Observed across 380 stored results. */
export const BOARD_COMMITMENTS = [
  "Full Time",
  "Part Time",
  "Internship",
  "Contract",
  "Temporary",
  "Seasonal",
  "Volunteer",
] as const

export type BoardCommitment = (typeof BOARD_COMMITMENTS)[number]

const BY_LOWER = new Map(BOARD_COMMITMENTS.map((c) => [c.toLowerCase(), c]))

/**
 * The profile's job_type vocabulary (lib/jobType.ts) to the board's.
 *
 * "Any" maps to nothing on purpose: it means the client has not restricted
 * themselves, which is an EMPTY filter — not a filter listing every type. The
 * distinction matters if the board ever gains an eighth type.
 */
const FROM_JOB_TYPE: Record<string, BoardCommitment | null> = {
  "full-time": "Full Time",
  "part-time": "Part Time",
  internship: "Internship",
  contract: "Contract",
  any: null,
}

/**
 * Canonicalise a value that is meant to be a board commitment type. Returns
 * null for anything outside the closed set, so callers can reject rather than
 * send a value that would empty the lane.
 */
export function toBoardCommitment(value: string): BoardCommitment | null {
  return BY_LOWER.get(String(value || "").trim().toLowerCase()) ?? null
}

/**
 * Translate client_profiles.job_type into commitment types for a lane.
 *
 * job_type is multi-valued and comma-joined ("Part-time, Internship" occurs in
 * production), so this splits before mapping. Unmappable members are dropped;
 * an empty result means "no commitment filter", which is the correct reading of
 * both "Any" and a missing job_type.
 */
export function commitmentTypesFromJobType(jobType: string | null | undefined): BoardCommitment[] {
  const out: BoardCommitment[] = []
  for (const raw of String(jobType || "").split(",")) {
    const key = raw.trim().toLowerCase()
    if (!key) continue
    const mapped = FROM_JOB_TYPE[key] ?? toBoardCommitment(key)
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}
