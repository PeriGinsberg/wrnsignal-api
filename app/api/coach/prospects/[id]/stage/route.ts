// app/api/coach/prospects/[id]/stage/route.ts
//
// Per-prospect stage progress (configurable pipeline, build step 3).
// Spec: docs/Features/prospect-configurable-pipeline-spec.md §4, §5.3, §7.
//
// Route:
//   PATCH — advance a prospect to a stage. Body: { stage_key }.
//     - Validates stage_key belongs to this coach's ACTIVE pipeline.
//     - Writes/updates a prospect_stage_progress row (reached_at = now() if
//       newly reached; existing reached_at is preserved).
//     - Updates coach_clients.current_stage_key to the furthest-reached
//       non-terminal stage (highest sort_order among reached non-terminal
//       stages).
//     - TERMINAL HANDLING (§4): when the target stage is the coach's terminal
//       Convert stage, this does NOT just record progress — it triggers the
//       EXISTING conversion flow by invoking the sibling prospects PATCH
//       handler with { lifecycle_status: "Active" } (the exact transition
//       handleConvert performs today — reused, not reimplemented), then sets
//       prospect_status='won' and returns a redirect signal so the frontend
//       does the same post-convert redirect it does today.
//
// Auth: standard coach Bearer pattern (matches pipeline/route.ts and the
// sibling prospects/[id]/route.ts).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
// REUSE (not reimplementation): the existing conversion code path is the
// sibling prospects PATCH handler. The terminal stage invokes it directly so
// the lifecycle_status:"Active" flip, ownership checks, and validation all run
// through the one canonical implementation.
import { PATCH as convertProspectLifecycle } from "../route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Post-conversion surface the frontend redirects to today (mirrors
// handleConvert in app/dashboard/coach/prospects/[id]/page.tsx).
const CONVERT_REDIRECT_PREFIX = "/dashboard/coach/coach-clients/"

// ── Auth helpers (inlined per coach-route convention; copied from
//    pipeline/route.ts) ──
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, name, is_coach, coach_org")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, coach_org, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      const { user_id: _u, ...rest } = byEmail as any
      return rest
    }
  }
  return null
}

// Ownership: coach_clients.id = [id] AND coach_profile_id = caller AND
// status='active'. Single null-return for "doesn't exist" and "not owned"
// (existence-collapses-into-ownership — same pattern as the sibling route).
async function verifyProspectOwnership(coachClientId: string, coachProfileId: string, supabase: any) {
  const { data } = await supabase
    .from("coach_clients")
    .select("id, coach_profile_id, lifecycle_status, client_profile_id")
    .eq("id", coachClientId)
    .eq("coach_profile_id", coachProfileId)
    .eq("status", "active")
    .maybeSingle()
  return data ?? null
}

type StageDef = { stage_key: string; sort_order: number; is_terminal: boolean; active: boolean }

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ════════════════════════════════════════════════════════════════
// PATCH /api/coach/prospects/[id]/stage — advance to a stage
// ════════════════════════════════════════════════════════════════
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    const body = await req.json().catch(() => null)
    const stageKey = body && typeof body === "object" ? (body as any).stage_key : undefined
    if (typeof stageKey !== "string" || !stageKey.trim()) {
      return withCorsJson(req, { ok: false, error: "stage_key is required" }, 400)
    }

    const supabase = getSupabaseAdmin()

    const prospect = await verifyProspectOwnership(id, coachProfileId, supabase)
    if (!prospect) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // Load the coach's pipeline (the source of truth for which stages exist,
    // their order, terminality, and active flag).
    const { data: pipelineData, error: pipeErr } = await supabase
      .from("coach_pipeline_stages")
      .select("stage_key, sort_order, is_terminal, active")
      .eq("coach_profile_id", coachProfileId)
    if (pipeErr) return withCorsJson(req, { ok: false, error: `Failed to read pipeline: ${pipeErr.message}` }, 500)
    const pipeline = (pipelineData || []) as StageDef[]
    if (pipeline.length === 0) {
      return withCorsJson(req, { ok: false, error: "No pipeline configured — GET /api/coach/pipeline first" }, 409)
    }
    const pipelineByKey = new Map(pipeline.map((s) => [s.stage_key, s]))

    // Validate: stage_key must exist + be active in this coach's pipeline.
    const target = pipelineByKey.get(stageKey)
    if (!target) {
      return withCorsJson(req, { ok: false, error: `stage_key not in your pipeline: ${stageKey}` }, 400)
    }
    if (!target.active) {
      return withCorsJson(req, { ok: false, error: `stage_key is not an active stage: ${stageKey}` }, 400)
    }

    const nowIso = new Date().toISOString()

    // ── TERMINAL stage (§4): reuse the existing conversion flow ──
    if (target.is_terminal) {
      // 1. Reuse: invoke the sibling prospects PATCH handler with the same
      //    lifecycle flip handleConvert performs today. No duplication of the
      //    conversion logic — auth/ownership/validation/flip all run there.
      // DELIBERATE REUSE: this calls the canonical convert handler, not a copy.
      const convertRes = await convertProspectLifecycle(
        new Request(req.url, {
          method: "PATCH",
          headers: {
            authorization: req.headers.get("authorization") || "",
            "content-type": "application/json",
          },
          body: JSON.stringify({ lifecycle_status: "Active" }),
        }) as unknown as NextRequest,
        { params: Promise.resolve({ id }) },
      )
      if (!convertRes.ok) {
        const detail = await convertRes.json().catch(() => ({}))
        return withCorsJson(
          req,
          { ok: false, error: `Conversion failed: ${(detail as any)?.error || convertRes.status}` },
          convertRes.status === 401 ? 401 : 502,
        )
      }

      // 2. Set prospect_status='won' automatically (§4). This is a NEW column
      //    the conversion handler does not manage — set it here, only after the
      //    conversion succeeded. lifecycle_status is NOT touched here (§5.3).
      const { error: wonErr } = await supabase
        .from("coach_clients")
        .update({ prospect_status: "won" })
        .eq("id", id)
        .eq("coach_profile_id", coachProfileId)
      if (wonErr) return withCorsJson(req, { ok: false, error: `Converted, but failed to set won: ${wonErr.message}` }, 500)

      // 3. Record reaching the terminal stage (audit / timestamp spine).
      //    current_stage_key is deliberately left at the furthest non-terminal
      //    stage (§5.2 — terminal is not a "current stage").
      const { data: existingTerminal } = await supabase
        .from("prospect_stage_progress")
        .select("id")
        .eq("coach_client_id", id)
        .eq("stage_key", stageKey)
        .maybeSingle()
      if (!existingTerminal) {
        await supabase
          .from("prospect_stage_progress")
          .insert({ coach_client_id: id, stage_key: stageKey, reached_at: nowIso })
      }

      return withCorsJson(req, {
        ok: true,
        converted: true,
        prospect_status: "won",
        redirect_to: `${CONVERT_REDIRECT_PREFIX}${id}`,
      })
    }

    // ── Non-terminal stage: record progress + recompute current_stage_key ──

    // Read existing progress to (a) preserve reached_at on re-touch and (b)
    // recompute the furthest-reached non-terminal stage afterwards.
    const { data: progressData, error: progErr } = await supabase
      .from("prospect_stage_progress")
      .select("stage_key, reached_at")
      .eq("coach_client_id", id)
    if (progErr) return withCorsJson(req, { ok: false, error: `Failed to read progress: ${progErr.message}` }, 500)
    const progress = (progressData || []) as { stage_key: string; reached_at: string | null }[]
    const alreadyReached = progress.some((p) => p.stage_key === stageKey)

    let reachedAt = nowIso
    if (!alreadyReached) {
      const { error: insErr } = await supabase
        .from("prospect_stage_progress")
        .insert({ coach_client_id: id, stage_key: stageKey, reached_at: nowIso })
      if (insErr) return withCorsJson(req, { ok: false, error: `Failed to record stage: ${insErr.message}` }, 500)
    } else {
      reachedAt = progress.find((p) => p.stage_key === stageKey)?.reached_at ?? nowIso
    }

    // Furthest-reached non-terminal stage = highest sort_order among reached
    // stage_keys that map to an active non-terminal pipeline stage.
    const reachedKeys = new Set(progress.map((p) => p.stage_key))
    reachedKeys.add(stageKey)
    let furthest: StageDef | null = null
    for (const key of reachedKeys) {
      const def = pipelineByKey.get(key)
      if (!def || def.is_terminal || !def.active) continue
      if (!furthest || def.sort_order > furthest.sort_order) furthest = def
    }
    const currentStageKey = furthest?.stage_key ?? stageKey

    const { error: updErr } = await supabase
      .from("coach_clients")
      .update({ current_stage_key: currentStageKey })
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
    if (updErr) return withCorsJson(req, { ok: false, error: `Failed to update current stage: ${updErr.message}` }, 500)

    return withCorsJson(req, {
      ok: true,
      converted: false,
      stage_key: stageKey,
      reached_at: reachedAt,
      current_stage_key: currentStageKey,
    })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
