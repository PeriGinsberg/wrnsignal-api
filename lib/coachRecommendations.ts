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

import type { MeaningKey } from "./theme/surfaces"

// ── "From your coach" — the Job Tracker marker ──────────────────────────────
//
// These lived in app/dashboard/tracker/vocab.ts until 2026-08-10, when they
// moved here alongside COACH_SOURCED_FILTER — a filter that keys off
// coach_job_recommendations rather than application_status, so it never belonged
// in the status vocabulary.
//
// ONE AREA READS THEM, and that is the point. The Coaching Hub briefly carried
// the same marker on its My Plan rows; it came off the same day, because every
// plan activity comes from the coach and marking a subset implied the rest did
// not. The marker means something on the tracker precisely because coach-sourced
// jobs sit there among jobs the client added themselves. Before putting it on a
// third surface, check that surface has the same mix.

/**
 * The one tracker chip that is not a status.
 *
 * Every other chip filters on `application_status === value`. This one filters
 * on whether a coach_job_recommendations row points at the application, which
 * is a different question about the same job — a coach-sourced job also has a
 * status, and moving it to Applied must not stop it being coach-sourced.
 *
 * A SENTINEL RATHER THAN A STATUS. The value is deliberately not a member of
 * the application_status vocabulary, so `application_status === COACH_SOURCED_FILTER`
 * can never accidentally be true and the branch that handles it cannot be
 * reached by a real status. It is also why the previous attempt at this — a
 * `coach_recommended` application_status, since removed — was the wrong shape:
 * it made a durable fact about a job into a transient state it would lose on
 * first move.
 */
export const COACH_SOURCED_FILTER = "from_coach" as const

/** One label for the tracker chip and the tracker row. */
export const COACH_SOURCED_LABEL = "From your coach"

/**
 * Coral — the `attention` meaning. A job your coach picked out is something to
 * look at, which is what coral says on every other surface.
 *
 * NOT PEACH, and structurally so: peach lives in `action`, not in `meaning`, so
 * a status lookup cannot return it. Coral was chosen for `attention` on
 * 2026-08-04 precisely because the amber it replaced shared peach's hue, and
 * "act on this" and "press this" read alike; coral sits 21.8 dE away.
 *
 * WHAT THE PIXELS ACTUALLY ARE. `status()` renders both the dot and the text
 * from the meaning's INK — #884133 — not from its accent #F26B52. The accent is
 * for rails and fills. #F26B52 measures 3.00 against white, fine for an 8px dot
 * and below the 4.5 floor for text; the ink measures 7.37 and is the same coral
 * family.
 */
export const COACH_SOURCED_MEANING: MeaningKey = "attention"

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
