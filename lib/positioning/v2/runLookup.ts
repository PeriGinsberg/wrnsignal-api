// lib/positioning/v2/runLookup.ts
//
// Cache-cascade lookup for positioning_runs_v2 — the "is there an existing
// run we should resume or cache-hit, or do we create a new one?" decision.
// Read-only — no writes.
//
// FRD: docs/Features/positioning-phase1-frd.md (section 4.6 save-and-return)
// Friction: Stage 1b F3 (cascade simplified from FRD's two-check pattern)
// Types: lib/positioning/v2/types.ts (PositioningRunV2Row)
//
// Schema verified 2026-05-12 — 20 columns matching the Stage 1a migration.
//
// Cascade (per Stage 1b F3):
//   1. SELECT positioning_runs_v2 WHERE (profile_id, persona_id, jobfit_run_id)
//      ORDER BY created_at DESC
//   2. Filter out status='abandoned' rows (excluded from cascade entirely)
//   3. If any remaining row has status='in_progress' → outcome='resume',
//      return the latest in_progress row
//   4. Else if latest completed row's fingerprint_hash matches the expected
//      hash → outcome='cache_hit', return that row
//   5. Else → outcome='new', return null
//
// Why in_progress wins regardless of fingerprint: the user is mid-session.
// Even if targeting changed between visits, resuming is the right user
// experience — they were in the middle of a workflow. The fingerprint check
// is only meaningful for completed runs (where result_json represents the
// final output the user saw last time).
//
// Why we don't search history beyond latest completed: if the latest
// completed has a stale fingerprint, the right behavior is to start fresh.
// Returning an older matching-fingerprint run would surface an older case
// determination that the user has presumably moved past.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PositioningRunV2Row } from "./types"

// All 20 columns of PositioningRunV2Row — full row needed because the
// caller may use result_json (cache hit), phase_data (resume), case_*
// (response building), etc.
const SELECT_COLS =
  "id, profile_id, persona_id, jobfit_run_id, signal_application_id, " +
  "job_title, job_company, job_url, job_description, " +
  "case_assigned, case_reasoning, current_phase, phase_data, status, " +
  "fingerprint_hash, fingerprint_code, result_json, " +
  "created_at, updated_at, completed_at"

export type FindExistingOutcome = "new" | "resume" | "cache_hit"

export type FindExistingResult = {
  outcome: FindExistingOutcome
  row: PositioningRunV2Row | null
  error?: string
}

/**
 * Look up an existing positioning_runs_v2 row for the given identity tuple
 * and decide whether to resume it, cache-hit on it, or create a new run.
 *
 * Returns:
 *   - outcome='resume' + row: in-progress run found; caller should continue it
 *   - outcome='cache_hit' + row: completed run with matching fingerprint;
 *     caller should return result_json verbatim
 *   - outcome='new' + row=null: no usable existing run; caller should
 *     create a fresh one
 *   - outcome='new' + row=null + error: guard rejection or DB error;
 *     caller should treat as 'new' but log the error
 *
 * Note: this function does NOT use the fingerprint to filter the SQL query
 * — the cache key is the (profile_id, persona_id, jobfit_run_id) tuple.
 * The expectedFingerprintHash is compared against the LATEST completed row
 * after the query returns. Mismatch falls through to 'new'.
 */
export async function findExistingPositioningRun(
  supabase: SupabaseClient,
  profileId: string,
  personaId: string,
  jobfitRunId: string,
  expectedFingerprintHash: string,
): Promise<FindExistingResult> {
  if (!profileId) return { outcome: "new", row: null, error: "missing profileId" }
  if (!personaId) return { outcome: "new", row: null, error: "missing personaId" }
  if (!jobfitRunId)
    return { outcome: "new", row: null, error: "missing jobfitRunId" }
  if (!expectedFingerprintHash)
    return {
      outcome: "new",
      row: null,
      error: "missing expectedFingerprintHash",
    }

  const { data, error } = await supabase
    .from("positioning_runs_v2")
    .select(SELECT_COLS)
    .eq("profile_id", profileId)
    .eq("persona_id", personaId)
    .eq("jobfit_run_id", jobfitRunId)
    .order("created_at", { ascending: false })

  if (error) return { outcome: "new", row: null, error: error.message }
  if (!data || data.length === 0) return { outcome: "new", row: null }

  // Supabase's complex SELECT string returns a generic type that doesn't
  // unify cleanly with PositioningRunV2Row's exact shape; cast via unknown
  // since the column list and types.ts are kept in lockstep (verified by
  // pre-D3 schema check).
  const rows = data as unknown as PositioningRunV2Row[]

  // Filter out abandoned rows — not part of the cascade. They sit in DB
  // as historical record but never resume or cache-hit.
  const liveRows = rows.filter((r) => r.status !== "abandoned")
  if (liveRows.length === 0) return { outcome: "new", row: null }

  // Cascade rule 3: any in_progress row → resume (latest if multiple).
  // Multiple in_progress for the same identity tuple is anomalous — it
  // suggests a race in the create logic or a manual DB intervention.
  // We pick the latest defensively and log so anomalies surface.
  const inProgress = liveRows.filter((r) => r.status === "in_progress")
  if (inProgress.length > 0) {
    if (inProgress.length > 1) {
      console.warn(
        `[runLookup] anomaly: ${inProgress.length} in_progress positioning_runs_v2 ` +
          `for (profile=${profileId}, persona=${personaId}, jobfit=${jobfitRunId}); ` +
          `picking latest by created_at`,
      )
    }
    return { outcome: "resume", row: inProgress[0] }
  }

  // Cascade rule 4: LATEST completed row only; fingerprint must match.
  // We deliberately don't search older completed rows — a stale latest
  // means start fresh, not surface a deeper history.
  const completed = liveRows.filter((r) => r.status === "completed")
  if (completed.length > 0 && completed[0].fingerprint_hash === expectedFingerprintHash) {
    return { outcome: "cache_hit", row: completed[0] }
  }

  return { outcome: "new", row: null }
}
