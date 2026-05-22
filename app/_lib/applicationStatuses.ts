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
export const APP_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  saved: { bg: "rgba(255,255,255,0.07)", color: "#51ADE5" },
  applied: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  interviewing: { bg: "rgba(167,139,250,0.15)", color: "#a78bfa" },
  offer: { bg: "rgba(74,222,128,0.15)", color: "#4ade80" },
  rejected: { bg: "rgba(248,113,113,0.10)", color: "#f87171" },
  withdrawn: { bg: "rgba(255,255,255,0.05)", color: "#94a3b8" },
  coach_recommended: { bg: "rgba(0,245,212,0.10)", color: "#00F5D4" },
}
