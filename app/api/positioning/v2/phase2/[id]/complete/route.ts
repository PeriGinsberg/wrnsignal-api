// app/api/positioning/v2/phase2/[id]/complete/route.ts
//
// POST /api/positioning/v2/phase2/[id]/complete
//
// Final endpoint of Phase 2b. Finalizes a phase2_run (status →
// completed); optionally creates a new client_personas row from the
// revised resume text.
//
// FRD: docs/Features/positioning-phase2-frd.md (§6.5.5)
//
// Architectural references:
//   - lib/positioning/v2/phase2/phase2RunLookup.ts (findPhase2RunByIdForProfile)
//   - app/api/personas/route.ts POST (canonical persona INSERT pattern;
//     10-persona cap + is_default + display_order conventions)
//   - app/api/positioning/v2/phase2/[id]/decide/route.ts (sibling Phase 2
//     endpoint; same auth + error pattern)
//
// Race policy (v0.1, narrowed for /complete): optimistic transition
// check. Two concurrent /complete calls — the first wins (UPDATE
// WHERE status='in_progress' transitions; the second's UPDATE affects
// 0 rows → 409 with no orphan persona created).
//
// Execution order (CRITICAL for race safety):
//   1. All pre-write validations (persona_name, accepted items, cap)
//   2. UPDATE status='in_progress' → 'completed' (atomic transition)
//   3. If race lost (0 rows updated): re-fetch and 409
//   4. If race won AND save_as_persona=true: INSERT persona (with re-query
//      of count for cross-tab CAP_RACE detection)
//   5. UPDATE phase2_runs.new_persona_id (if persona created)
//   6. Best-effort: UPDATE positioning_runs_v2.phase_data.phase_2
//
// Behavior:
//   - 200: status='completed' + new_persona_id (or null) + revised_resume_text
//   - 400: invalid body OR persona_name_required (save_as_persona=true,
//          missing/empty/too-long) OR no_changes_to_save (save_as_persona=true,
//          zero accepted items) OR persona_cap_exceeded (profile at 10 max
//          AT VALIDATION TIME)
//   - 404 phase2_run_not_found: F11 (not found OR wrong owner)
//   - 409 phase2_run_already_finalized: status + completed_at in response
//
// revised_resume_text source: prefer existing phase2_run.revised_resume_text;
// fallback to persona.resume_text if null (matches "no items accepted →
// use original resume" semantics per FRD §6.10). The optimistic UPDATE
// writes the resolved string back to the row so the response field is
// always non-null per FRD §6.5.5.
//
// positioning_runs_v2.current_phase: NOT advanced on /complete. Phase 3
// (when it ships) will advance from its own /start. The
// phase2_runs.status='completed' is the Phase 2-specific completion signal.
//
// Persona save failure modes (all return 200 + new_persona_id=null +
// warn-log; user can manually create persona later via /api/personas):
//   - PERSONA_INSERT_FAILED: DB error during INSERT after status transition
//   - CAP_RACE: parallel /api/personas write crossed the 10-cap between
//     validation (step 6b) and INSERT (step 9)
//   - LINK_PERSONA_FAILED: persona INSERT succeeded but UPDATE of
//     phase2_runs.new_persona_id failed (persona exists, link is soft-
//     inconsistent; phase_data.phase_2.new_persona_id also surfaces it)
//
// Log markers (grep-friendly):
//   [positioning-v2/phase2/complete] COMPLETED              phase2RunId=… personaSaved=…
//   [positioning-v2/phase2/complete] PERSONA_CREATED        phase2RunId=… newPersonaId=…
//   [positioning-v2/phase2/complete] PERSONA_INSERT_FAILED  phase2RunId=… error=…
//   [positioning-v2/phase2/complete] CAP_RACE               phase2RunId=… currentCount=…
//   [positioning-v2/phase2/complete] LINK_PERSONA_FAILED    phase2RunId=… newPersonaId=… error=…
//   [positioning-v2/phase2/complete] PHASE_DATA_READ_FAILED phase2RunId=… error=…
//   [positioning-v2/phase2/complete] PHASE_DATA_WRITE_FAILED phase2RunId=… error=…
//   [positioning-v2/phase2/complete] RACE_LOST              phase2RunId=… currentStatus=…
//   [positioning-v2/phase2/complete] LOOKUP_FAILED          phase2RunId=… error=…
//   [positioning-v2/phase2/complete] UPDATE_FAILED          phase2RunId=… error=…

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getAuthedProfileText } from "../../../../../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"

import { findPhase2RunByIdForProfile } from "@/lib/positioning/v2/phase2/phase2RunLookup"
import type { PhaseTwoRunStatus } from "@/lib/positioning/v2/phase2/types"
import type { PositioningRunV2PhaseData } from "@/lib/positioning/v2/types"

// ============================================================================
// Constants
// ============================================================================

/** Max personas per profile (matches /api/personas POST). */
const MAX_PERSONAS_PER_PROFILE = 10

/** Max characters allowed in user-supplied persona_name (FRD §6.5.5). */
const MAX_PERSONA_NAME_LENGTH = 80

// ============================================================================
// Supabase admin client
// ============================================================================

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "positioning-v2/phase2/[id]/complete: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient
}

// ============================================================================
// Request body validation
// ============================================================================

type CompleteRequestBody = {
  save_as_persona: boolean
  persona_name?: string
}

type ValidationResult =
  | { ok: true; body: CompleteRequestBody }
  | { ok: false; error: string; detail?: string }

function validateBody(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_body" }
  }
  const b = raw as Record<string, unknown>

  if (typeof b.save_as_persona !== "boolean") {
    return { ok: false, error: "invalid_save_as_persona" }
  }

  if (b.persona_name !== undefined && typeof b.persona_name !== "string") {
    return { ok: false, error: "invalid_persona_name" }
  }

  // persona_name required if save_as_persona=true
  if (b.save_as_persona === true) {
    const name = (b.persona_name ?? "") as string
    const trimmed = name.trim()
    if (!trimmed) {
      return { ok: false, error: "persona_name_required" }
    }
    if (trimmed.length > MAX_PERSONA_NAME_LENGTH) {
      return {
        ok: false,
        error: "persona_name_too_long",
        detail: `Maximum ${MAX_PERSONA_NAME_LENGTH} characters.`,
      }
    }
  }

  return {
    ok: true,
    body: {
      save_as_persona: b.save_as_persona,
      persona_name:
        typeof b.persona_name === "string" ? b.persona_name.trim() : undefined,
    },
  }
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // ── 1. Extract id from URL ─────────────────────────────────────────────
  const { id } = await params
  const phase2RunId = (id ?? "").trim()
  if (!phase2RunId) {
    return withCorsJson(request, { error: "missing_phase2_run_id" }, 400)
  }

  // ── 2. Parse + validate body ───────────────────────────────────────────
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return withCorsJson(request, { error: "invalid_json" }, 400)
  }
  const validation = validateBody(rawBody)
  if (!validation.ok) {
    return withCorsJson(
      request,
      validation.detail
        ? { error: validation.error, detail: validation.detail }
        : { error: validation.error },
      400,
    )
  }
  const body = validation.body

  // ── 3. Auth ────────────────────────────────────────────────────────────
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

  // ── 4. Fetch phase2_run with F11 ownership ─────────────────────────────
  const lookup = await findPhase2RunByIdForProfile(
    supabaseAdmin,
    phase2RunId,
    profileId,
  )
  if (lookup.error) {
    console.warn(
      `[positioning-v2/phase2/complete] LOOKUP_FAILED phase2RunId=${phase2RunId} error=${lookup.error}`,
    )
    return withCorsJson(
      request,
      { error: "phase2_run_lookup_failed", detail: lookup.error },
      500,
    )
  }
  if (!lookup.row) {
    return withCorsJson(request, { error: "phase2_run_not_found" }, 404)
  }
  const phase2Run = lookup.row

  // ── 5. Defensive status check (409 if already finalized) ───────────────
  // The optimistic UPDATE in step 8 also catches this via 0-rows-affected,
  // but checking early avoids the cap-check + persona-fetch work.
  if (phase2Run.status !== "in_progress") {
    return withCorsJson(
      request,
      {
        error: "phase2_run_already_finalized",
        status: phase2Run.status,
        completed_at: phase2Run.completed_at,
      },
      409,
    )
  }

  // ── 6. Save-as-persona prerequisite checks (BEFORE state transition) ──
  if (body.save_as_persona) {
    // 6a. At least one accepted item (no_changes_to_save)
    const anyAccepted = phase2Run.state.items.some((i) => i.accepted)
    if (!anyAccepted) {
      return withCorsJson(
        request,
        {
          error: "no_changes_to_save",
          detail:
            "Cannot save a persona without any accepted item. Accept at least one recommendation or complete with save_as_persona=false.",
        },
        400,
      )
    }

    // 6b. Persona cap check (10 max per profile)
    const { count: personaCount, error: countErr } = await supabaseAdmin
      .from("client_personas")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
    if (countErr) {
      return withCorsJson(
        request,
        { error: "persona_count_failed", detail: countErr.message },
        500,
      )
    }
    if ((personaCount ?? 0) >= MAX_PERSONAS_PER_PROFILE) {
      return withCorsJson(
        request,
        {
          error: "persona_cap_exceeded",
          current: personaCount,
          max: MAX_PERSONAS_PER_PROFILE,
        },
        400,
      )
    }
  }

  // ── 7. Resolve revised_resume_text (existing OR persona.resume_text) ──
  // Per FRD §6.5.5 the response field is non-nullable. If /decide was
  // never called (no accepted items), phase2_run.revised_resume_text is
  // null — fall back to persona.resume_text so the row + response carry
  // a string. Matches "no items accepted → original resume" semantics
  // per FRD §6.10.
  let revisedResumeText = phase2Run.revised_resume_text
  if (revisedResumeText === null) {
    const { data: persona, error: personaErr } = await supabaseAdmin
      .from("client_personas")
      .select("resume_text")
      .eq("id", phase2Run.persona_id)
      .maybeSingle<{ resume_text: string | null }>()
    if (personaErr) {
      return withCorsJson(
        request,
        { error: "persona_lookup_failed", detail: personaErr.message },
        500,
      )
    }
    revisedResumeText = persona?.resume_text ?? ""
  }

  // ── 8. Optimistic status transition (atomic race-safe completion) ──────
  // UPDATE WHERE status='in_progress' ensures only one concurrent
  // /complete call wins. The race loser's UPDATE affects 0 rows; we
  // re-fetch and return 409 with the current state.
  const completedAtIso = new Date().toISOString()
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("phase2_runs")
    .update({
      status: "completed",
      completed_at: completedAtIso,
      revised_resume_text: revisedResumeText,
    })
    .eq("id", phase2RunId)
    .eq("status", "in_progress")
    .select("id, status, completed_at, revised_resume_text")
    .maybeSingle<{
      id: string
      status: PhaseTwoRunStatus
      completed_at: string | null
      revised_resume_text: string | null
    }>()

  if (updateErr) {
    console.warn(
      `[positioning-v2/phase2/complete] UPDATE_FAILED phase2RunId=${phase2RunId} error=${updateErr.message}`,
    )
    return withCorsJson(
      request,
      { error: "phase2_run_update_failed", detail: updateErr.message },
      500,
    )
  }

  if (!updated) {
    // Race lost OR status changed between step 5 and step 8. Re-fetch
    // for accurate 409 response.
    const { data: current } = await supabaseAdmin
      .from("phase2_runs")
      .select("status, completed_at")
      .eq("id", phase2RunId)
      .maybeSingle<{ status: PhaseTwoRunStatus; completed_at: string | null }>()
    console.warn(
      `[positioning-v2/phase2/complete] RACE_LOST phase2RunId=${phase2RunId} currentStatus=${current?.status ?? "unknown"}`,
    )
    return withCorsJson(
      request,
      {
        error: "phase2_run_already_finalized",
        status: current?.status ?? "completed",
        completed_at: current?.completed_at ?? null,
      },
      409,
    )
  }

  // ── 9. INSERT persona (if save_as_persona=true) ─────────────────────────
  let newPersonaId: string | null = null
  if (body.save_as_persona) {
    // Re-query persona count for is_default + display_order computation
    // AND cross-tab CAP_RACE detection. The step 6b cap check ran before
    // status transition; a parallel /api/personas write could have
    // crossed the cap between then and now.
    const { count: currentCount } = await supabaseAdmin
      .from("client_personas")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
    const c = currentCount ?? 0

    if (c >= MAX_PERSONAS_PER_PROFILE) {
      // Cross-tab race breached the cap between validation and INSERT.
      // Status transition already happened — log + continue without
      // persona save. User keeps the completed phase2_run and the
      // revised resume text; they can delete a persona and manually
      // create via /api/personas later.
      console.warn(
        `[positioning-v2/phase2/complete] CAP_RACE phase2RunId=${phase2RunId} currentCount=${c}`,
      )
    } else {
      const { data: newPersona, error: insertErr } = await supabaseAdmin
        .from("client_personas")
        .insert({
          profile_id: profileId,
          name: body.persona_name!,
          resume_text: revisedResumeText,
          is_default: c === 0,
          display_order: c + 1,
        })
        .select("id")
        .single<{ id: string }>()
      if (insertErr || !newPersona) {
        // Persona INSERT failed AFTER status transition succeeded. Log +
        // continue. User can manually create the persona later via
        // /api/personas; the revised resume text is preserved in
        // phase2_runs.revised_resume_text.
        console.warn(
          `[positioning-v2/phase2/complete] PERSONA_INSERT_FAILED phase2RunId=${phase2RunId} error=${insertErr?.message ?? "no row"}`,
        )
      } else {
        newPersonaId = newPersona.id
        console.log(
          `[positioning-v2/phase2/complete] PERSONA_CREATED phase2RunId=${phase2RunId} newPersonaId=${newPersonaId}`,
        )

        // Link the persona back to the phase2_run for analytics + future
        // lookup. Best-effort; failure leaves new_persona_id null on the
        // phase2_runs row but the persona exists and is reachable via
        // client_personas.profile_id. Soft inconsistency, self-healing
        // (the new_persona_id is also written to phase_data.phase_2 in
        // step 10 so it's not lost).
        const { error: linkErr } = await supabaseAdmin
          .from("phase2_runs")
          .update({ new_persona_id: newPersonaId })
          .eq("id", phase2RunId)
        if (linkErr) {
          console.warn(
            `[positioning-v2/phase2/complete] LINK_PERSONA_FAILED phase2RunId=${phase2RunId} newPersonaId=${newPersonaId} error=${linkErr.message}`,
          )
        }
      }
    }
  }

  // ── 10. Best-effort: write phase_data.phase_2 to positioning_runs_v2 ───
  // Read-modify-write of phase_data JSONB. Race window between read and
  // write; acceptable for v0.1 since phase_data is analytics-only and
  // /start writes the only other concurrent phase_data key (phase_1).
  const { data: posRun, error: posReadErr } = await supabaseAdmin
    .from("positioning_runs_v2")
    .select("phase_data")
    .eq("id", phase2Run.positioning_run_id)
    .maybeSingle<{ phase_data: PositioningRunV2PhaseData | null }>()
  if (posReadErr) {
    console.warn(
      `[positioning-v2/phase2/complete] PHASE_DATA_READ_FAILED phase2RunId=${phase2RunId} error=${posReadErr.message}`,
    )
  } else {
    const existingPhaseData = posRun?.phase_data ?? {}
    const newPhaseData = {
      ...existingPhaseData,
      phase_2: {
        completed_at: completedAtIso,
        persona_save_decision: body.save_as_persona ? "saved" : "discarded",
        new_persona_id: newPersonaId,
      },
    }
    const { error: phaseWriteErr } = await supabaseAdmin
      .from("positioning_runs_v2")
      .update({ phase_data: newPhaseData })
      .eq("id", phase2Run.positioning_run_id)
    if (phaseWriteErr) {
      console.warn(
        `[positioning-v2/phase2/complete] PHASE_DATA_WRITE_FAILED phase2RunId=${phase2RunId} error=${phaseWriteErr.message}`,
      )
    }
  }

  console.log(
    `[positioning-v2/phase2/complete] COMPLETED phase2RunId=${phase2RunId} personaSaved=${newPersonaId !== null}`,
  )

  // ── 11. Return ─────────────────────────────────────────────────────────
  return withCorsJson(
    request,
    {
      phase2_run_id: phase2RunId,
      status: "completed",
      new_persona_id: newPersonaId,
      revised_resume_text: updated.revised_resume_text ?? revisedResumeText,
    },
    200,
  )
}
