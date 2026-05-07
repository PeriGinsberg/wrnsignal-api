// app/api/_lib/applicationStatusHistory.ts
//
// Append-only log of signal_applications.application_status transitions.
// Called by every writer that creates or updates an application row's
// status. Powers the Requires Action heuristics on the coach Home page
// (rules that need to know "moved to X N days ago").
//
// Writer audit (2026-05-07) — 4 INSERT sites + 4 UPDATE sites all call
// this helper:
//   INSERTS  (from_status = null):
//     - app/api/applications/route.ts                 (POST)
//     - app/api/jobfit/route.ts                       (×2 sites)
//     - app/api/coach/recommend-job/route.ts          (POST)
//   UPDATES  (from_status = previous value):
//     - app/api/applications/[id]/route.ts            (PUT)
//     - app/api/coach/recommendations/[id]/respond/route.ts
//     - app/api/coach/my-recommendations/[id]/respond/route.ts
//     - app/api/interviews/route.ts                   (auto-promote to interviewing)
//
// Adding a new application_status writer? Call logStatusChange() from
// the same code path that writes the new value. Missing a writer means
// missed events on the coach home page.

import type { SupabaseClient } from "@supabase/supabase-js"

export async function logStatusChange(
  supabase: SupabaseClient,
  applicationId: string,
  fromStatus: string | null,
  toStatus: string,
  changedBy: string | null
): Promise<void> {
  // No-op when the status didn't actually change. Lets callers safely
  // pass "current → maybe-new" without a pre-check.
  if (fromStatus === toStatus) return

  const { error } = await supabase
    .from("signal_applications_status_history")
    .insert({
      application_id: applicationId,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: changedBy,
    })

  if (error) {
    // Non-fatal: status is already in client_profiles, history is for
    // analytics + heuristics. Surface the error in logs but don't fail
    // the parent operation.
    console.warn("[status_history] log failed:", error.message, {
      applicationId,
      fromStatus,
      toStatus,
    })
  }
}
