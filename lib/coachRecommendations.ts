// lib/coachRecommendations.ts
//
// One vocabulary for coach_job_recommendations.client_status, shared by the
// client's response control and by every coach-facing surface that reports it.
//
// WHY THIS EXISTS. Until 2026-08-10 the only place a coach saw a client's
// response was `Client: {client_status}` — the raw enum, underscores and all.
// That was survivable while nothing wrote `not_for_me` from a considered
// control. Now that the per-job Interested / Not interested box does, and now
// that client_responded_at is set (so the coach's "Since last visit" strip
// reports responses for the first time), shipping `not_for_me` at a coach would
// half-land the feature.
//
// The CHECK constraint on the column is the authority for what may be stored:
//   new · interested · applying · applied · not_for_me · archived
// Anything not in that list is rejected by the database, which is what the
// deleted /api/coach/recommendations/[id]/respond route got wrong — it accepted
// `not_interested` and `passed`, neither of which the constraint allows.

/** Every value the CHECK constraint permits. Storage truth, not UI truth. */
export const CLIENT_STATUSES = [
  "new",
  "interested",
  "applying",
  "applied",
  "not_for_me",
  "archived",
] as const

export type ClientStatus = (typeof CLIENT_STATUSES)[number]

/**
 * The two a client can choose from the response box.
 *
 * The LABEL and the VALUE differ on purpose for the second one: "Not
 * interested" is what a person says, `not_for_me` is what the constraint
 * allows. Do not "fix" the mismatch by changing the stored value — that is the
 * bug the deleted route shipped.
 */
export const RESPONSE_CHOICES = [
  { value: "interested" as const, label: "Interested" },
  { value: "not_for_me" as const, label: "Not interested" },
]

/**
 * How one answer reads on the job's History timeline.
 *
 * `isChange` is true for every answer after the first on the same
 * recommendation. It exists because saying "Told your coach…" twice on one job
 * reads as two separate conversations rather than one reversal — and the
 * reversal is the interesting part, both to the client re-reading their own log
 * and to a coach wondering why a job went quiet.
 *
 * Pure, and separated from the route so the wording is pinned by a test rather
 * than only by a live database round-trip.
 */
export function responseEventLabel(clientStatus: string, isChange: boolean): string {
  const declined = clientStatus === "not_for_me"
  if (isChange) {
    return declined
      ? "Changed your mind — not interested after all"
      : "Changed your mind — interested after all"
  }
  return declined
    ? "Told your coach this one isn't for you"
    : "Told your coach you're interested"
}

const WORDS: Record<string, string> = {
  new: "No answer yet",
  interested: "Interested",
  applying: "Applying",
  applied: "Applied",
  not_for_me: "Not interested",
  archived: "Archived",
}

/**
 * Prose for one status, for anywhere a human reads it.
 *
 * Falls back to de-underscoring rather than returning the raw value, so a
 * status added to the constraint without being added here degrades to
 * "some new status" instead of `some_new_status`.
 */
export function describeClientStatus(s: string | null | undefined): string {
  if (!s) return "No answer yet"
  return WORDS[s] ?? s.replace(/_/g, " ")
}

/**
 * Did the client actually answer, as opposed to not having been asked yet?
 *
 * `new` is the only non-answer. Note that this cannot distinguish a considered
 * answer from the bulk "Mark all seen" dismissal that used to write
 * `interested` wholesale — see the 2026-08-10 migration, which reset those
 * rows precisely because that distinction was unrecoverable.
 *
 * This reads CURRENT state. For the sequence of answers — including a client
 * changing their mind — read coach_recommendation_responses, which is
 * append-only. This column is overwritten on every answer.
 */
export function hasResponded(s: string | null | undefined): boolean {
  return !!s && s !== "new"
}
