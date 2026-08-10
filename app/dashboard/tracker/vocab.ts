// The words and the colours the Job Tracker shows, in one place.
//
// Same contract as the networking `vocab.ts`: the KEYS are database values and
// never change; only the labels do. Rewording is then a one-file edit that
// cannot desync a status pill from a filter chip from a dropdown, which is
// exactly how the old tracker ended up rendering the raw `not_scheduled` in one
// place and "not scheduled" in another.
//
// The meanings map into the light Surface tokens rather than carrying their own
// hexes. The old tracker held four separate colour maps (STATUS_STYLE,
// DECISION_STYLE, ANNOTATION_PRIORITY_STYLE, INTERVIEW_GRADIENT), all dark-theme
// and all invented locally.

import type { MeaningKey } from "../../../lib/theme/surfaces"

// ── Application status ──────────────────────────────────────────────────────

// `coach_recommended` WAS here, labelled "From your coach" with the sequence
// meaning, and it was unreachable: the CHECK constraint permits the value but
// nothing writes it. app/api/coach/recommend-job creates coach-sourced jobs as
// `saved`, and 0 of 1,039 production applications and 0 of 248 dev ones carried
// the status (measured 2026-08-10). A plausible-looking hook that no path can
// reach sends the next person down the wrong road — which is exactly what it
// did: "which jobs came from my coach" looks answered by this map and is not.
// The real signal is a row in coach_job_recommendations pointing at the
// application; see COACH_SOURCED_FILTER below.
//
// If a row ever does appear with that status, statusLabel falls back to
// de-underscoring ("coach recommended") and statusMeaning to `idle` — degraded,
// not broken. The coach-side surfaces keep their own map in
// app/_lib/applicationStatuses.ts and are unaffected.
export const STATUS_LABELS: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "No offer",
  withdrawn: "Withdrawn",
}

/**
 * `saved` is idle ON PURPOSE. A saved job is one nobody has acted on, and it
 * should recede exactly like an untouched contact does. `offer` is gold, the
 * "achieved" meaning, per the build plan. Rejected and withdrawn share dormant:
 * both mean the thread stopped, and neither is an error.
 */
export const STATUS_MEANING: Record<string, MeaningKey> = {
  saved: "idle",
  applied: "progress",
  interviewing: "replied",
  offer: "done",
  rejected: "dormant",
  withdrawn: "dormant",
}

export function statusLabel(s: string | null | undefined): string {
  if (!s) return "Saved"
  return STATUS_LABELS[s] ?? s.replace(/_/g, " ")
}

export function statusMeaning(s: string | null | undefined): MeaningKey {
  if (!s) return "idle"
  return STATUS_MEANING[s] ?? "idle"
}

/** The filter row, in board order. `withdrawn` is reachable by status edit but
 *  is not a chip: it is rare, and a sixth chip costs more than it returns. */
export const STATUS_FILTERS = ["saved", "applied", "interviewing", "offer"] as const

/**
 * The one chip that is not a status.
 *
 * Every other chip filters on `application_status === value`. This one filters
 * on whether a coach_job_recommendations row points at the application, which
 * is a different question about the same job — a coach-sourced job also has a
 * status, and moving it to Applied must not stop it being coach-sourced.
 *
 * A SENTINEL RATHER THAN A STATUS. The value is deliberately not a member of
 * the application_status vocabulary, so `application_status === COACH_SOURCED_FILTER`
 * can never accidentally be true and the branch that handles it cannot be
 * reached by a real status. It is also why the previous attempt at this — the
 * `coach_recommended` status removed above — was the wrong shape: it made a
 * durable fact about a job into a transient state it would lose on first move.
 */
export const COACH_SOURCED_FILTER = "from_coach" as const

/** Used by the chip, and by the row indicator, so the two can never disagree. */
export const COACH_SOURCED_LABEL = "From your coach"

/**
 * Coral — the `attention` meaning. A job your coach picked out for you is
 * something to look at, which is what coral says on every other surface.
 *
 * NOT PEACH, and structurally so: peach lives in `action`, not in `meaning`, so
 * a status lookup cannot return it. Coral was chosen for `attention` on
 * 2026-08-04 precisely because the amber it replaced shared peach's hue, and
 * "act on this" and "press this" read alike; coral sits 21.8 dE away.
 *
 * WHAT THE PIXELS ACTUALLY ARE. `status()` renders both the dot and the text
 * from the meaning's INK — #884133 — not from its accent #F26B52. The accent is
 * for rails and fills. That is not a downgrade of the request: #F26B52 measures
 * 3.00 against white, which is fine for an 8px dot and below the 4.5 floor for
 * text, while the ink measures 7.37 and is the same coral family. Hardcoding
 * the accent as text would be the one thing this token system exists to stop.
 */
export const COACH_SOURCED_MEANING: MeaningKey = "attention"

// ── The action a card offers, worded for a student ──────────────────────────

export const NEED_LABELS: Record<string, string> = {
  prep: "Prep",
  followup: "Follow up",
  apply: "Apply",
}

// ── Interviews ──────────────────────────────────────────────────────────────

export const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  not_scheduled: "Not scheduled yet",
  scheduled: "Scheduled",
  awaiting_feedback: "Awaiting feedback",
  offer_extended: "Offer",
  rejected: "No offer",
  ghosted: "No answer",
}

export const INTERVIEW_STATUS_MEANING: Record<string, MeaningKey> = {
  not_scheduled: "idle",
  scheduled: "progress",
  awaiting_feedback: "replied",
  offer_extended: "done",
  rejected: "dormant",
  ghosted: "dormant",
}

export function interviewStatusLabel(s: string | null | undefined): string {
  if (!s) return "Not scheduled yet"
  return INTERVIEW_STATUS_LABELS[s] ?? s.replace(/_/g, " ")
}

export function interviewStatusMeaning(s: string | null | undefined): MeaningKey {
  if (!s) return "idle"
  return INTERVIEW_STATUS_MEANING[s] ?? "idle"
}

/**
 * The stage of a round. `ai_hirevue` is the one entry that cannot round-trip
 * through the generic underscore-to-space rendering, because the slash has to
 * survive, so the whole set is spelled out rather than half-derived.
 */
export const INTERVIEW_STAGE_LABELS: Record<string, string> = {
  hr_screening: "HR screening",
  phone: "Phone screen",
  zoom: "Video call",
  ai_hirevue: "AI / HireVue",
  in_person: "In person",
  take_home: "Take-home",
  final_round: "Final round",
  other: "Other",
}

export function interviewStageLabel(s: string | null | undefined): string {
  if (!s) return "Interview"
  return INTERVIEW_STAGE_LABELS[s] ?? s.replace(/_/g, " ")
}

/** The order the stage dropdown offers, roughly the order they happen in. */
export const INTERVIEW_STAGES = [
  "hr_screening", "phone", "zoom", "ai_hirevue", "in_person", "take_home", "final_round", "other",
] as const

export const INTERVIEW_STATUSES = [
  "not_scheduled", "scheduled", "awaiting_feedback", "offer_extended", "rejected", "ghosted",
] as const

/**
 * HOW you attend, which is a different question from what round it is. The
 * stage list already carries `in_person` and `take_home` and the overlap is
 * real but not redundant: a final round can be in person or on video, and the
 * prep is different either way. Format is what Prep Now branches on.
 *
 * NULL is a legitimate value and stays one. Every interview created before
 * this column existed has no format, and Prep Now shows both the in-person and
 * the video items rather than guessing — an unset format is honest, a guessed
 * one sends someone to the wrong building.
 */
export const INTERVIEW_FORMAT_LABELS: Record<string, string> = {
  in_person: "In person",
  virtual: "Video call",
  phone: "Phone",
  take_home: "Take-home",
}

export function interviewFormatLabel(f: string | null | undefined): string {
  if (!f) return "Not set"
  return INTERVIEW_FORMAT_LABELS[f] ?? f.replace(/_/g, " ")
}

/** Matches the CHECK constraint on signal_interviews.interview_format. */
export const INTERVIEW_FORMATS = ["in_person", "virtual", "phone", "take_home"] as const

// ── JobFit decision bands, for History ──────────────────────────────────────

/**
 * The four decisions the scoring engine emits, as meanings. Priority Apply and
 * Apply share teal: the band tile answers "is this worth my time", and both
 * answers are yes. The exact decision is still printed under the score.
 */
export const DECISION_MEANING: Record<string, MeaningKey> = {
  "Priority Apply": "replied",
  Apply: "replied",
  Review: "progress",
  Pass: "idle",
}

export function decisionMeaning(d: string | null | undefined): MeaningKey {
  if (!d) return "idle"
  return DECISION_MEANING[d] ?? "idle"
}

// ── Where a job was found ───────────────────────────────────────────────────

export const APP_LOCATIONS = [
  "Company Website", "LinkedIn", "Indeed", "Handshake", "Referral", "Other",
] as const
