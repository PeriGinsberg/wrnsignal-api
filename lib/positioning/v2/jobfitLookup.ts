// lib/positioning/v2/jobfitLookup.ts
//
// JobFit run lookup helpers for Phase 1's /api/positioning/v2/start endpoint.
// Read-only — no writes, no side effects.
//
// FRD: docs/Features/positioning-phase1-frd.md (section 4.2 endpoint behavior step 4)
// Types: lib/positioning/v2/types.ts (JobfitResultJson)
//
// Two paths per Stage 1b plan:
//   - getJobfitRunById: primary path. Called when /start receives an explicit
//     jobfit_run_id from the request. Direct PK lookup.
//   - findLatestJobfitRunForJob: fallback path. Called when /start has only
//     company + title. Goes via signal_applications because jobfit_runs has
//     no company/job_title columns of its own (schema verified pre-D2).
//
// Schema notes (verified 2026-05-12):
//   - jobfit_runs.client_profile_id (NOT profile_id) — historical naming
//   - jobfit_runs.application_id → signal_applications.id (FK confirmed)
//   - jobfit_runs.client_profile_id has NO FK constraint (historical quirk;
//     enforced at app layer via getAuthedProfileText ownership check)
//   - jobfit_runs.verdict is TEXT NOT NULL; the denormalized top-level
//     decision value. result_json holds the full V5 payload.
//
// Ownership check: this module does NOT verify that the row's
// client_profile_id matches the authenticated user. Callers (route.ts)
// MUST perform that check before using the returned row's contents.
// Returning the unfiltered row keeps the lookup deterministic for callers
// that want to handle the "not owned" case differently (404 vs 403).

import type { SupabaseClient } from "@supabase/supabase-js"
import type { JobfitResultJson } from "./types"

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal subset of a jobfit_runs row that Phase 1 reads. Mirrors the
 * actual schema (note: client_profile_id, NOT profile_id). result_json
 * is typed as JobfitResultJson — the V5 shape consumers expect.
 */
export type JobfitRunRow = {
  id: string
  client_profile_id: string
  application_id: string | null
  verdict: string
  result_json: JobfitResultJson
  /** ISO8601 timestamp. */
  created_at: string
}

const SELECT_COLS =
  "id, client_profile_id, application_id, verdict, result_json, created_at"

// ============================================================================
// Primary path: by ID
// ============================================================================

/**
 * Look up a single jobfit_run by its primary key.
 *
 * Returns:
 *   - {row: JobfitRunRow}      — found
 *   - {row: null}              — not found (no error)
 *   - {row: null, error: ...}  — guard rejection or DB error
 *
 * Does NOT verify ownership. Caller must compare row.client_profile_id
 * to the authed profile id before using row.result_json or trusting
 * row.application_id.
 */
export async function getJobfitRunById(
  supabase: SupabaseClient,
  jobfitRunId: string,
): Promise<{ row: JobfitRunRow | null; error?: string }> {
  if (!jobfitRunId) return { row: null, error: "missing jobfitRunId" }

  const { data, error } = await supabase
    .from("jobfit_runs")
    .select(SELECT_COLS)
    .eq("id", jobfitRunId)
    .maybeSingle()

  if (error) return { row: null, error: error.message }
  return { row: (data as JobfitRunRow | null) ?? null }
}

// ============================================================================
// Fallback path: by (profile, company, title)
// ============================================================================

/**
 * Resolve the most recent successful jobfit_run for a (profile, company,
 * job_title) tuple. Used when /start was called without an explicit
 * jobfit_run_id.
 *
 * Path B algorithm (jobfit_runs has no company/job_title columns):
 *   1. SELECT id FROM signal_applications
 *      WHERE profile_id = $1 AND company_name ILIKE $2 AND job_title ILIKE $3
 *      ORDER BY created_at DESC LIMIT 1
 *   2. If no application matches → return {row: null}
 *   3. SELECT * FROM jobfit_runs
 *      WHERE application_id = (from step 1) AND verdict != 'error'
 *      ORDER BY created_at DESC LIMIT 1
 *   4. Return the row (or null if no jobfit_run for the application)
 *
 * Matching semantics:
 *   - Both company AND title must ILIKE-match (case-insensitive substring
 *     would not — this is ILIKE without wildcards, so it's case-insensitive
 *     equality unless the caller passes wildcards). Caller is responsible
 *     for trimming inputs; no internal trim() to keep behavior predictable.
 *   - Latest-by-created_at wins when multiple signal_applications happen
 *     to match (rare given JobFit's findOrCreate de-duplication).
 *   - Latest non-error jobfit_run wins when an application has many runs
 *     (user re-ran JobFit on the same job).
 *
 * Data quality note (Foundation KI-01): some prod signal_applications
 * rows have garbage company_name / job_title from empty-JD fallback
 * (e.g., "(Unknown Company)"). Requiring BOTH ILIKE matches mitigates
 * accidental collisions — a user pasting a real job is extremely unlikely
 * to ILIKE-match both garbage strings simultaneously.
 */
export async function findLatestJobfitRunForJob(
  supabase: SupabaseClient,
  profileId: string,
  company: string,
  jobTitle: string,
): Promise<{ row: JobfitRunRow | null; error?: string }> {
  if (!profileId) return { row: null, error: "missing profileId" }
  if (!company) return { row: null, error: "missing company" }
  if (!jobTitle) return { row: null, error: "missing jobTitle" }

  // Step 1: find the signal_applications row
  const { data: apps, error: appErr } = await supabase
    .from("signal_applications")
    .select("id")
    .eq("profile_id", profileId)
    .ilike("company_name", company)
    .ilike("job_title", jobTitle)
    .order("created_at", { ascending: false })
    .limit(1)

  if (appErr) return { row: null, error: appErr.message }
  if (!apps || apps.length === 0) return { row: null }
  const appId = apps[0].id

  // Step 2: latest non-error jobfit_run for that application
  const { data: jrs, error: jrErr } = await supabase
    .from("jobfit_runs")
    .select(SELECT_COLS)
    .eq("application_id", appId)
    .neq("verdict", "error")
    .order("created_at", { ascending: false })
    .limit(1)

  if (jrErr) return { row: null, error: jrErr.message }
  if (!jrs || jrs.length === 0) return { row: null }
  return { row: jrs[0] as JobfitRunRow }
}
