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
// Helpers in this module:
//   - findExistingPhase2Run: 409 conflict detection for POST /start
//   - findPhase2RunByIdForProfile: id+ownership lookup for GET/POST [id]
//     endpoints (reused by /draft, /decide, /complete as those ship)

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

export type FindPhase2RunByIdResult = {
  /**
   * The row if found AND owned by profileId, else null.
   * F11 collapse: callers cannot distinguish "not found" from "wrong
   * owner" — both surface as null, both should yield 404 at the route
   * layer. Don't leak existence-with-wrong-owner.
   */
  row: PhaseTwoRunRow | null
  /** Supabase error message if the query itself failed. Null on success. */
  error: string | null
}

/**
 * Fetch a phase2_run by id, scoped to ownership by profileId. Used by
 * all per-id Phase 2 endpoints (GET /[id], POST /[id]/draft, POST
 * /[id]/decide, POST /[id]/complete) to enforce the F11 pattern:
 * not-found and wrong-owner produce identical responses at the route
 * layer (both 404 with the same error code).
 *
 * Malformed UUIDs in `phase2RunId` cause Supabase to return a Postgres
 * error (`invalid input syntax for type uuid`). This helper surfaces
 * that error via the `error` field; callers should treat it as 500
 * (matches Phase 1 precedent of not pre-validating UUID format).
 *
 * @param supabase Supabase admin client
 * @param phase2RunId The phase2_runs.id to fetch
 * @param profileId The authenticated profile's id; rows owned by other
 *                  profiles are returned as null
 * @returns { row, error } — row is the phase2_run if found+owned, else
 *          null. error is non-null only on query-level failure.
 */
export async function findPhase2RunByIdForProfile(
  supabase: SupabaseClient,
  phase2RunId: string,
  profileId: string,
): Promise<FindPhase2RunByIdResult> {
  const { data, error } = await supabase
    .from("phase2_runs")
    .select("*")
    .eq("id", phase2RunId)
    .maybeSingle<PhaseTwoRunRow>()

  if (error) {
    return { row: null, error: error.message }
  }

  if (!data) {
    // Not found — return null (F11: same shape as wrong-owner).
    return { row: null, error: null }
  }

  if (data.profile_id !== profileId) {
    // Wrong owner — collapse to null (F11: don't leak existence).
    return { row: null, error: null }
  }

  return { row: data, error: null }
}
