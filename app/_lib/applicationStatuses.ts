// app/_lib/applicationStatuses.ts
//
// Single source of truth for the user-pickable subset of
// signal_applications.application_status. Used by:
//   - app/dashboard/tracker/page.tsx               client status edit
//   - app/dashboard/coach/clients/[clientId]/*     coach status edit
//                                                  (Phase 3 Commit 3.1)
//   - app/api/coach/clients/[clientId]/applications/[applicationId]/status
//                                                  server validation
//
// The DB CHECK constraint on signal_applications.application_status
// (supabase/migrations/20260413_coach_client_system.sql:162) accepts
// 7 values: the 6 below PLUS 'coach_recommended'. We deliberately
// exclude 'coach_recommended' from this list because it's a
// system-set state (written by /api/coach/recommend-job when a coach
// sources a job for a client), not a user-pickable option. A coach
// editing a coach_recommended-status app via the dropdown picks one
// of the 6 below to transition the app forward — the original
// coach_recommended state is preserved in
// signal_applications_status_history for audit.

export const APP_STATUSES = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const

export type ApplicationStatus = (typeof APP_STATUSES)[number]

export function isValidApplicationStatus(s: unknown): s is ApplicationStatus {
  return typeof s === "string" && (APP_STATUSES as readonly string[]).includes(s)
}

// Canonical pill colors for each status value. Includes 'coach_recommended'
// since some cards display that state even though it's not user-pickable
// in the dropdowns. Previously duplicated in:
//   - app/dashboard/tracker/page.tsx                STATUS_STYLE
//   - app/dashboard/coach/applications-recent/page.tsx  APP_STATUS_STYLE
// Both now import from here.
//
// LIGHT VALUES, BECAUSE EVERY SURFACE THAT RENDERS THESE IS LIGHT NOW.
//
// These were the dark-theme pills: a white 7% wash carrying #51ADE5, and so on
// down the list. Dropped on a white card they became pale ink on almost
// nothing. Measured on /dashboard/coach/applications-recent: `applied` 1.66:1,
// `interviewing` 2.38, `saved` 2.48, `withdrawn` 2.56, over three hundred
// elements on one screen. The tracker renders the same map on the same white
// and had the same problem.
//
// They are PLAIN VALUES rather than var(--sig-*) indirection, and that is a
// decision rather than an oversight. The indirection works by sitting inside a
// [data-coach-surface] subtree, and the tracker is not in one: it would have
// kept the dark fallbacks and stayed broken. All four consumers are light, so
// light is simply what the map is. IF THE COACHES CENTER EVER GOES BACK TO
// DARK, this map is one of the things that has to come back with it.
//
// Each is a pale tint of its own hue carrying an ink dark enough to read on it,
// the same shape as the lifecycle pills in LIGHT_COACH_EXTRAS.
export const APP_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  saved: { bg: "#DCEDF9", color: "#00569A" },
  // Peach fill, NAVY word. The word was the darkened orange, which is brown,
  // and brown is not in the palette. The fill is what says "applied".
  applied: { bg: "#FFEEDC", color: "#08203F" },
  interviewing: { bg: "#EDE4F9", color: "#5B3392" },
  // TEAL, NOT GREEN. An offer is the success state and success is teal.
  offer: { bg: "#D6EFEC", color: "#00757A" },
  rejected: { bg: "#FBE3E2", color: "#C0322F" },
  withdrawn: { bg: "#E9EEF4", color: "#3D5878" },
  // Ice fill, navy word: the same ground as `saved` but a different ink, since
  // the two never mean the same thing and the label already says which.
  coach_recommended: { bg: "#DCEDF9", color: "#08203F" },
}
