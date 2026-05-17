// app/api/positioning/v2/phase2/[id]/route.ts
//
// GET /api/positioning/v2/phase2/[id]
//
// Idempotent read of a phase2_run by id. No state mutation, no side
// effects. The 11-field response is a subset of PhaseTwoRunRow —
// omits profile_id (security: don't expose FKs) and ai_cost_cents
// (internal accounting).
//
// FRD: docs/Features/positioning-phase2-frd.md (§6.5.2)
//
// Architectural references:
//   - lib/positioning/v2/phase2/phase2RunLookup.ts (findPhase2RunByIdForProfile)
//   - app/api/positioning/v2/phase2/start/route.ts (sibling Phase 2 endpoint;
//     same auth + error pattern)
//
// Behavior:
//   - 200: 11-field response per FRD §6.5.2
//   - 404 phase2_run_not_found: F11 — same envelope for not-found AND
//     wrong-owner. Don't leak existence.
//   - state.selection_screen_seen is NOT mutated by GET per FRD note.
//     That flag updates only on /draft and /decide (when the user
//     demonstrably interacts with an item).
//
// Malformed UUID handling: pass-through. Supabase surfaces a Postgres
// `invalid input syntax for type uuid` error which we report as 500
// with `phase2_run_lookup_failed`. Matches Phase 1 precedent — frontend
// sources UUIDs from /start responses; invalid UUIDs are anomalous.
//
// Log markers (grep-friendly):
//   [positioning-v2/phase2/get] LOOKUP_FAILED phase2RunId=… error=…

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getAuthedProfileText } from "../../../../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

import { findPhase2RunByIdForProfile } from "@/lib/positioning/v2/phase2/phase2RunLookup"

// ============================================================================
// Supabase admin client (service role)
// ============================================================================

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "positioning-v2/phase2/[id]: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
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
// GET handler
// ============================================================================

export async function GET(
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

  // ── 1. Extract id from URL params ───────────────────────────────────────
  const { id } = await params
  const phase2RunId = (id ?? "").trim()
  if (!phase2RunId) {
    return withCorsJson(
      request,
      { error: "missing_phase2_run_id" },
      400,
    )
  }

  // ── 2. Auth ─────────────────────────────────────────────────────────────
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

  // ── 3. Fetch phase2_run with F11 ownership collapse ─────────────────────
  const result = await findPhase2RunByIdForProfile(
    supabaseAdmin,
    phase2RunId,
    profileId,
  )
  if (result.error) {
    console.warn(
      `[positioning-v2/phase2/get] LOOKUP_FAILED phase2RunId=${phase2RunId} error=${result.error}`,
    )
    return withCorsJson(
      request,
      { error: "phase2_run_lookup_failed", detail: result.error },
      500,
    )
  }
  if (!result.row) {
    // F11 — same 404 envelope for not-found AND wrong-owner.
    return withCorsJson(
      request,
      { error: "phase2_run_not_found" },
      404,
    )
  }

  // ── 4. Build response (11 fields per FRD §6.5.2) ────────────────────────
  // Subset of PhaseTwoRunRow. Omits:
  //   - profile_id: security (don't expose FKs)
  //   - ai_cost_cents: internal accounting (not user-relevant)
  // Renames id → phase2_run_id (matches POST /start response).
  const row = result.row
  return withCorsJson(
    request,
    {
      phase2_run_id: row.id,
      positioning_run_id: row.positioning_run_id,
      persona_id: row.persona_id,
      case_letter: row.case_letter,
      state: row.state,
      revised_resume_text: row.revised_resume_text,
      status: row.status,
      new_persona_id: row.new_persona_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    },
    200,
  )
}
