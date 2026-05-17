// app/api/positioning/v2/phase2/start/route.ts
//
// POST /api/positioning/v2/phase2/start
//
// Phase 2 entry point — turns a positioning_run_id into a phase2_runs row
// with state.items populated via itemPopulator. Mirrors the architectural
// pattern of POST /api/positioning/v2/start (Phase 1) but with Phase 2-
// specific semantics:
//   - Persona is resolved from positioning_run.persona_id (not request body)
//   - Case A and Case C positioning_runs are gated with 400 in v0.1
//   - 409 returned if an in_progress phase2_run already exists for the
//     (positioning_run, persona) pair
//
// FRD: docs/Features/positioning-phase2-frd.md (§6.5.1)
//
// Architectural references:
//   - lib/positioning/v2/phase2/phase2RunLookup.ts (findExistingPhase2Run)
//   - lib/positioning/v2/phase2/itemPopulator.ts (populateItems — stub in
//     v0.1; returns [])
//   - lib/positioning/v2/jobfitLookup.ts (getJobfitRunById)
//   - lib/positioning/v2/caseSpecific.ts (generateCaseSpecific — regenerated
//     per Phase 1 cache_hit pattern; case_specific is not stored on the
//     positioning_run row)
//   - lib/candidateTargeting.ts (getCandidateTargeting, resolveCareerStage)
//
// Failure-mode policy (matches Phase 1):
//   - INSERT failure → 500 (no row, can't recover)
//   - current_phase advancement failure → 200 + warn (observability gap only)
//   - Lookup failures upstream of INSERT → appropriate non-200
//
// v0.1 race policy: no UNIQUE constraint on (positioning_run_id, persona_id,
// in_progress). findExistingPhase2Run logs if it detects duplicates. Per
// Phase 2b plan, accept the race in v0.1; add UNIQUE in v0.2 if observed.
//
// Log markers (grep-friendly):
//   [positioning-v2/phase2/start] CREATED                phase2RunId=… positioningRunId=…
//   [positioning-v2/phase2/start] CONFLICT_EXISTING      positioningRunId=… existingPhase2RunId=…
//   [positioning-v2/phase2/start] CASE_NOT_SUPPORTED     positioningRunId=… case=…
//   [positioning-v2/phase2/start] ADVANCE_PHASE_FAILED   positioningRunId=…

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getAuthedProfileText } from "../../../../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

import {
  getCandidateTargeting,
  resolveCareerStage,
} from "@/lib/candidateTargeting"

import { getJobfitRunById } from "@/lib/positioning/v2/jobfitLookup"
import { generateCaseSpecific } from "@/lib/positioning/v2/caseSpecific"
import type {
  Case,
  CaseInputs,
  PositioningRunV2Row,
} from "@/lib/positioning/v2/types"

import { findExistingPhase2Run } from "@/lib/positioning/v2/phase2/phase2RunLookup"
import { populateItems } from "@/lib/positioning/v2/phase2/itemPopulator"
import type {
  PhaseTwoRunInsertPayload,
  PhaseTwoRunStatus,
  PhaseTwoState,
} from "@/lib/positioning/v2/phase2/types"

// ============================================================================
// Supabase admin client (service role)
// ============================================================================

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "positioning-v2/phase2/start: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient
}

// ============================================================================
// CORS preflight
// ============================================================================

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request.headers.get("origin"))
}

// ============================================================================
// POST handler
// ============================================================================

export async function POST(request: NextRequest) {
  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch (e) {
    return withCorsJson(
      request,
      { error: "server_misconfigured", detail: (e as Error).message },
      500,
    )
  }

  // ── 1. Parse body ───────────────────────────────────────────────────────
  let body: { positioning_run_id?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return withCorsJson(request, { error: "invalid_json" }, 400)
  }
  const positioningRunId = (body.positioning_run_id ?? "").trim()
  if (!positioningRunId) {
    return withCorsJson(
      request,
      { error: "missing_positioning_run_id" },
      400,
    )
  }

  // ── 2. Auth ─────────────────────────────────────────────────────────────
  // Note: no personaId in the request body. Persona is derived from the
  // positioning_run.persona_id in step 3 below.
  let authed: Awaited<ReturnType<typeof getAuthedProfileText>>
  try {
    authed = await getAuthedProfileText(request)
  } catch (e) {
    return withCorsJson(
      request,
      { error: "unauthorized", detail: (e as Error).message },
      401,
    )
  }
  const profileId = authed.profileId

  // ── 3. Fetch positioning_run + ownership check (F11) ────────────────────
  const { data: posRow, error: posErr } = await supabaseAdmin
    .from("positioning_runs_v2")
    .select("*")
    .eq("id", positioningRunId)
    .maybeSingle<PositioningRunV2Row>()

  if (posErr) {
    return withCorsJson(
      request,
      { error: "positioning_run_lookup_failed", detail: posErr.message },
      500,
    )
  }
  if (!posRow) {
    return withCorsJson(
      request,
      { error: "positioning_run_not_found" },
      404,
    )
  }
  if (posRow.profile_id !== profileId) {
    // F11 — same 404 envelope as non-existent; don't leak existence.
    return withCorsJson(
      request,
      { error: "positioning_run_not_found" },
      404,
    )
  }

  const personaId = posRow.persona_id
  const caseAssigned: Case = posRow.case_assigned

  // ── 4. Case A/C gate (v0.1 only — FRD §6.5.1 explicit) ──────────────────
  if (caseAssigned === "A" || caseAssigned === "C") {
    console.warn(
      `[positioning-v2/phase2/start] CASE_NOT_SUPPORTED positioningRunId=${positioningRunId} case=${caseAssigned}`,
    )
    return withCorsJson(
      request,
      {
        error: "case_not_supported",
        detail: `Phase 2 v0.1 supports Case B only; this positioning_run is Case ${caseAssigned}.`,
      },
      400,
    )
  }

  // ── 5. Check for existing in_progress phase2_run (409 conflict) ─────────
  const existing = await findExistingPhase2Run(
    supabaseAdmin,
    positioningRunId,
    personaId,
  )
  if (existing.error) {
    return withCorsJson(
      request,
      { error: "phase2_run_lookup_failed", detail: existing.error },
      500,
    )
  }
  if (existing.row) {
    console.log(
      `[positioning-v2/phase2/start] CONFLICT_EXISTING positioningRunId=${positioningRunId} existingPhase2RunId=${existing.row.id}`,
    )
    return withCorsJson(
      request,
      {
        error: "in_progress_phase2_run_exists",
        phase2_run_id: existing.row.id,
      },
      409,
    )
  }

  // ── 6. Fetch jobfit + Foundation dependencies for case_specific ─────────
  if (!posRow.jobfit_run_id) {
    return withCorsJson(
      request,
      {
        error: "positioning_run_missing_jobfit",
        detail: "Cannot populate Phase 2 items without source jobfit_run",
      },
      500,
    )
  }

  const jf = await getJobfitRunById(supabaseAdmin, posRow.jobfit_run_id)
  if (jf.error) {
    return withCorsJson(
      request,
      { error: "jobfit_lookup_failed", detail: jf.error },
      500,
    )
  }
  if (!jf.row) {
    return withCorsJson(
      request,
      { error: "jobfit_not_found" },
      500,
    )
  }

  const { row: targeting } = await getCandidateTargeting(
    supabaseAdmin,
    profileId,
  )
  const careerStage = await resolveCareerStage(profileId, supabaseAdmin)

  // ── 7. Regenerate case_specific (not stored on row; matches Phase 1
  //      cache_hit fallback path) ─────────────────────────────────────────
  const caseInputs: CaseInputs = {
    jobfit: jf.row.result_json,
    targeting: targeting
      ? {
          primary_lane: targeting.primary_lane,
          primary_sublane: targeting.primary_sublane,
        }
      : null,
    careerStage,
  }
  const caseSpecific = generateCaseSpecific(caseInputs, caseAssigned)

  // ── 8. Populate items + build initial state ─────────────────────────────
  // populateItems is a stub in v0.1 (returns []). Items array will be empty
  // until Stage 2b implements per FRD §6.2. Endpoint structure is wired
  // correctly — only the items themselves are placeholder.
  const items = populateItems(posRow, jf.row.result_json, caseSpecific)

  const initialState: PhaseTwoState = {
    items,
    current_section_id: null,
    selection_screen_seen: false,
    completion_offered: false,
    completion_decision: null,
  }

  // ── 9. INSERT phase2_run ────────────────────────────────────────────────
  const insertPayload: PhaseTwoRunInsertPayload = {
    positioning_run_id: positioningRunId,
    profile_id: profileId,
    persona_id: personaId,
    case_letter: caseAssigned,
    state: initialState,
  }

  const { data: insertedRow, error: insertErr } = await supabaseAdmin
    .from("phase2_runs")
    .insert(insertPayload)
    .select("id, state, status")
    .single<{
      id: string
      state: PhaseTwoState
      status: PhaseTwoRunStatus
    }>()

  if (insertErr || !insertedRow) {
    return withCorsJson(
      request,
      {
        error: "create_phase2_run_failed",
        detail: insertErr?.message ?? "no row returned",
      },
      500,
    )
  }

  console.log(
    `[positioning-v2/phase2/start] CREATED phase2RunId=${insertedRow.id} positioningRunId=${positioningRunId} profileId=${profileId}`,
  )

  // ── 10. Best-effort: advance parent positioning_run.current_phase ──────
  // Only update if current < 2 (don't clobber if user is already past
  // Phase 2 — defensive for forward compat as later phases ship).
  if (posRow.current_phase < 2) {
    const { error: phaseErr } = await supabaseAdmin
      .from("positioning_runs_v2")
      .update({ current_phase: 2 })
      .eq("id", positioningRunId)
    if (phaseErr) {
      console.warn(
        `[positioning-v2/phase2/start] ADVANCE_PHASE_FAILED positioningRunId=${positioningRunId} error=${phaseErr.message}`,
      )
    }
  }

  // ── 11. Return ──────────────────────────────────────────────────────────
  return withCorsJson(
    request,
    {
      phase2_run_id: insertedRow.id,
      state: insertedRow.state,
      status: insertedRow.status,
    },
    200,
  )
}
