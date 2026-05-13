// lib/positioning/v2/runWriter.ts
//
// Write-side mutations against positioning_runs_v2 for the Stage 1b
// /api/positioning/v2/start handler. Three operations:
//
//   1. createPositioningRun — INSERT a new run with signal_application_id=null
//   2. linkSignalApplicationToRun — UPDATE signal_application_id, idempotent
//   3. appendPhase1Visit — read-modify-write phase_data.phase_1.visits
//
// FRD: docs/Features/positioning-phase1-frd.md
// Friction: Stage 1b F2 (self-heal pattern, simplified to two-write per DD-26)
// Types: lib/positioning/v2/types.ts (PositioningRunV2Row,
//        PositioningRunV2InsertPayload, Phase1Visit, etc.)
//
// Architectural notes (verified 2026-05-12):
//   - Only PK constraint on positioning_runs_v2 (no business UNIQUE). Concurrent
//     INSERTs for the same identity tuple can't conflict at the DB layer;
//     uniqueness is policy-enforced by the runLookup cascade upstream.
//   - public.set_updated_at() trigger fires on every UPDATE and sets
//     new.updated_at = now(). Partial UPDATEs (single-column) advance
//     updated_at deterministically, which is required for self-heal
//     observability per DD-26.
//   - Link is one-directional per DD-26: this module only writes
//     positioning_runs_v2.signal_application_id; it never writes
//     signal_applications.positioning_run_id (that column still FKs to v1
//     positioning_runs; out of scope).
//
// Self-heal pattern (F2):
//   The two-write sequence in route.ts is:
//     a) createPositioningRun(...)         → row with signal_application_id=null
//     b) findOrCreateSignalApplication(...) → returns signal_application id
//     c) linkSignalApplicationToRun(...)    → UPDATE step (a)'s row with that id
//   If (c) fails (transient DB error, request abort), the row sits with
//   signal_application_id=null until the next visit's runLookup picks it up
//   (outcome=resume) and route.ts re-runs (b)+(c). The UPDATE is idempotent:
//   calling linkSignalApplicationToRun on an already-linked row returns
//   success without mutating state.

import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  Phase1Data,
  Phase1Visit,
  PositioningRunV2InsertPayload,
  PositioningRunV2PhaseData,
  PositioningRunV2Row,
} from "./types"

// All 20 columns of PositioningRunV2Row. Mirrors runLookup.ts's SELECT_COLS;
// the two should stay in sync. We RETURNING the full row from INSERT so the
// caller has everything it needs (id, created_at, defaults applied, etc.)
// without a follow-up SELECT.
const SELECT_COLS =
  "id, profile_id, persona_id, jobfit_run_id, signal_application_id, " +
  "job_title, job_company, job_url, job_description, " +
  "case_assigned, case_reasoning, current_phase, phase_data, status, " +
  "fingerprint_hash, fingerprint_code, result_json, " +
  "created_at, updated_at, completed_at"

export type CreatePositioningRunResult = {
  row: PositioningRunV2Row | null
  error?: string
}

/**
 * Insert a new positioning_runs_v2 row. Per F2 self-heal contract, the caller
 * MUST pass signal_application_id=null (or omit it) at this step — the link
 * is filled in by a subsequent linkSignalApplicationToRun call after the
 * signal_applications row is located/created. Passing a non-null
 * signal_application_id here isn't rejected by the DB but breaks the
 * self-heal invariant; do it only if you've already linked upstream.
 *
 * Returns the fully-populated row (DB defaults applied: status='in_progress',
 * current_phase=1, created_at/updated_at=now()) on success.
 */
export async function createPositioningRun(
  supabase: SupabaseClient,
  payload: PositioningRunV2InsertPayload,
): Promise<CreatePositioningRunResult> {
  if (!payload.profile_id) return { row: null, error: "missing profile_id" }
  if (!payload.persona_id) return { row: null, error: "missing persona_id" }
  if (!payload.fingerprint_hash)
    return { row: null, error: "missing fingerprint_hash" }
  if (!payload.fingerprint_code)
    return { row: null, error: "missing fingerprint_code" }

  // signal_application_id defaults to null per F2 self-heal contract.
  // Other columns use DB defaults (status, current_phase) if omitted.
  const insertRow = {
    ...payload,
    signal_application_id: payload.signal_application_id ?? null,
  }

  const { data, error } = await supabase
    .from("positioning_runs_v2")
    .insert(insertRow)
    .select(SELECT_COLS)
    .single()

  if (error) return { row: null, error: error.message }
  if (!data) return { row: null, error: "INSERT returned no row" }

  // PositioningRunV2Row's exact shape is kept in lockstep with the column
  // list; cast via unknown matches the runLookup.ts convention.
  return { row: data as unknown as PositioningRunV2Row }
}

export type LinkSignalApplicationResult = {
  ok: boolean
  error?: string
}

/**
 * Set positioning_runs_v2.signal_application_id on an existing run.
 * Idempotent — calling with the same (runId, signalApplicationId) twice
 * returns ok=true both times without mutating state.
 *
 * The idempotency contract:
 *   - If the row already has signal_application_id == signalApplicationId,
 *     this is a no-op success (still issues the UPDATE — set_updated_at
 *     fires either way; that's acceptable observability noise, not state
 *     drift).
 *   - If the row has signal_application_id == null, UPDATE fills it in.
 *   - If the row has signal_application_id == some_other_id, this OVERWRITES
 *     it. That's a sign of upstream confusion (two different signal_apps
 *     resolved for the same run) but we treat the latest caller as
 *     authoritative rather than failing — caller is responsible for not
 *     hitting this case via the runLookup cascade.
 *   - If the run doesn't exist, returns ok=false + error. (The UPDATE
 *     affects 0 rows; PostgREST returns no error in that case, so we
 *     follow up with a SELECT to confirm existence.)
 */
export async function linkSignalApplicationToRun(
  supabase: SupabaseClient,
  runId: string,
  signalApplicationId: string,
): Promise<LinkSignalApplicationResult> {
  if (!runId) return { ok: false, error: "missing runId" }
  if (!signalApplicationId)
    return { ok: false, error: "missing signalApplicationId" }

  const { data, error } = await supabase
    .from("positioning_runs_v2")
    .update({ signal_application_id: signalApplicationId })
    .eq("id", runId)
    .select("id, signal_application_id")
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: "run not found" }

  // Defensive — the UPDATE+select returned the row, but verify the link
  // actually landed. Should never trigger; if it does, something is wrong
  // with the FK or column write path.
  if (data.signal_application_id !== signalApplicationId) {
    return {
      ok: false,
      error: `UPDATE did not persist: expected ${signalApplicationId}, got ${data.signal_application_id ?? "null"}`,
    }
  }
  return { ok: true }
}

export type AppendPhase1VisitResult = {
  ok: boolean
  error?: string
}

/**
 * Append a Phase1Visit entry to phase_data.phase_1.visits on an existing run.
 * Read-modify-write pattern (not a JSONB-operator UPDATE) because Supabase
 * JS client doesn't expose jsonb_set / array append at the query builder
 * layer in a portable way, and the phase_data shape is small enough that
 * RMW is fine for Phase 1 traffic levels.
 *
 * Behavior:
 *   - If phase_data.phase_1 is absent, this is an error — Phase 1 data must
 *     be initialized by the INSERT path. We don't auto-create it here to
 *     avoid masking upstream bugs where the run was created without
 *     phase_1.case_assigned_at.
 *   - If phase_data.phase_1.visits is absent (undefined / null), we
 *     initialize it as [visit].
 *   - If phase_data.phase_1.visits is a non-empty array, we append.
 *
 * Race note: two concurrent calls for the same run will race. The second
 * write's read may not see the first write's visit, so the first visit
 * could be lost. Phase 1's traffic model is single-user-single-session;
 * concurrent visit appends are not expected. If that assumption breaks,
 * replace with a Postgres function using jsonb operators atomically.
 */
export async function appendPhase1Visit(
  supabase: SupabaseClient,
  runId: string,
  visit: Phase1Visit,
): Promise<AppendPhase1VisitResult> {
  if (!runId) return { ok: false, error: "missing runId" }
  if (!visit || !visit.visited_at || !visit.action) {
    return { ok: false, error: "invalid visit (visited_at + action required)" }
  }

  // Read current phase_data.
  const { data: current, error: readErr } = await supabase
    .from("positioning_runs_v2")
    .select("id, phase_data")
    .eq("id", runId)
    .maybeSingle()

  if (readErr) return { ok: false, error: readErr.message }
  if (!current) return { ok: false, error: "run not found" }

  const phaseData = (current.phase_data ?? {}) as PositioningRunV2PhaseData
  const phase1 = phaseData.phase_1
  if (!phase1) {
    return {
      ok: false,
      error: "phase_data.phase_1 not initialized — INSERT path must set case_assigned_at",
    }
  }

  const existingVisits = Array.isArray(phase1.visits) ? phase1.visits : []
  const nextPhase1: Phase1Data = {
    ...phase1,
    visits: [...existingVisits, visit],
  }
  const nextPhaseData: PositioningRunV2PhaseData = {
    ...phaseData,
    phase_1: nextPhase1,
  }

  const { error: writeErr } = await supabase
    .from("positioning_runs_v2")
    .update({ phase_data: nextPhaseData })
    .eq("id", runId)

  if (writeErr) return { ok: false, error: writeErr.message }
  return { ok: true }
}
