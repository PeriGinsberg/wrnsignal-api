// lib/positioning/v2/phase2/phase2RunLookup.ts
//
// Lookup helpers for phase2_runs. Mirrors the Phase 1 lib/positioning/v2/
// runLookup.ts precedent — small focused module for find-by-criteria
// queries used by Phase 2 endpoints.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.5.1 — POST /start uses findExistingPhase2Run for the 409 conflict path
//
// Types: ./types.ts (PhaseTwoRunRow)
//
// v0.1 scope: one helper (findExistingPhase2Run). Additional helpers added
// here as later Stage 2 endpoints surface lookup needs.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { PhaseTwoRunRow } from "./types"

export type FindExistingPhase2RunResult = {
  /** The in_progress row if one exists, else null. */
  row: PhaseTwoRunRow | null
  /** Supabase error message if the query itself failed. Null on success. */
  error: string | null
}

/**
 * Look up the in_progress phase2_run for a given (positioning_run_id,
 * persona_id) pair. Returns the most recently created in_progress row,
 * or null if none exists.
 *
 * Used by POST /api/positioning/v2/phase2/start for the 409 conflict
 * detection path (FRD §6.5.1): "if an in_progress phase2_run already
 * exists for this positioning_run + persona, return 409 with the
 * existing phase2_run_id."
 *
 * Duplicate-row handling (v0.1):
 *   POST /start in v0.1 does not use a UNIQUE constraint or transaction
 *   on (positioning_run_id, persona_id, status='in_progress'). A race
 *   between two near-simultaneous /start calls can produce two
 *   in_progress rows. This helper logs a warning if it detects more
 *   than one row and returns the most recently created. The 409 path
 *   then points the client at one of them; subsequent requests resolve
 *   consistently because the most-recent ordering is stable.
 *
 *   Per the Phase 2b plan: accept the race in v0.1, log if detected,
 *   add a UNIQUE constraint in v0.2 if observed in practice.
 *
 * @param supabase Supabase admin client
 * @param positioningRunId Parent positioning_run_v2.id
 * @param personaId The persona_id from the parent positioning_run
 * @returns { row, error } — row is the latest in_progress phase2_run
 *          for the (positioning_run, persona) pair, or null
 */
export async function findExistingPhase2Run(
  supabase: SupabaseClient,
  positioningRunId: string,
  personaId: string,
): Promise<FindExistingPhase2RunResult> {
  const { data, error } = await supabase
    .from("phase2_runs")
    .select("*")
    .eq("positioning_run_id", positioningRunId)
    .eq("persona_id", personaId)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })

  if (error) {
    return { row: null, error: error.message }
  }

  const rows = (data ?? []) as unknown as PhaseTwoRunRow[]

  if (rows.length > 1) {
    console.warn(
      `[positioning-v2/phase2/lookup] MULTIPLE_IN_PROGRESS positioningRunId=${positioningRunId} personaId=${personaId} count=${rows.length} — race detected; returning most recent`,
    )
  }

  return { row: rows[0] ?? null, error: null }
}
