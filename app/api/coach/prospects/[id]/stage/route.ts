// app/api/coach/prospects/[id]/stage/route.ts
//
// Per-prospect stage progress (configurable pipeline, build step 3).
// Spec: docs/Features/prospect-configurable-pipeline-spec.md §4, §5.3, §7.
//
// Route:
//   PATCH — advance a prospect to a stage. Body: { stage_key }.
//     With { stage_key, direction: "back" } it MOVES BACK to an earlier stage
//     the prospect has reached instead: every later stage is un-reached and
//     History records the move (moveProspectBack, lib/prospects/stages.ts).
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
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"
import { clientLink } from "@/lib/tasks/links"
import { createTask } from "@/lib/tasks/service"
import { resolveDelegation } from "@/lib/collab/delegation"
import { moveProspectBack } from "@/lib/prospects/stages"
import { getAuthedUser, getProfileRowOrNull } from "@/lib/collab/identity"
import { errorStatus } from "@/app/api/_lib/routeError"

// Who is calling: the shared lookup (lib/collab/identity.ts). The caller's
// profile, or null when they have none. A login whose email is on another
// live login's profile is refused (ForbiddenError, 403), never matched.
const getCoachProfile = (userId: string, email: string | null) =>
  getProfileRowOrNull(userId, email, "id, name, is_coach, coach_org")


export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Post-conversion surface the frontend redirects to today (mirrors
// handleConvert in app/dashboard/coach/prospects/[id]/page.tsx).
const CONVERT_REDIRECT_PREFIX = "/dashboard/coach/coach-clients/"

// On conversion, auto-create a "Send SIGNAL invite" action item so the coach is
// reminded to invite the new client. Action items are coach_client_notes rows
// (type='action_item'); 'this_week' matches the default priority used by the
// notes create path (DEFAULT_ACTION_ITEM_PRIORITY). The fixed prefix is the
// idempotency key — at most one live invite item per client.
const INVITE_ACTION_PREFIX = "Send SIGNAL invite to "
const INVITE_ACTION_PRIORITY = "this_week"

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

// Ownership: coach_clients.id = [id] AND coach_profile_id = caller AND
// status='active'. Single null-return for "doesn't exist" and "not owned"
// (existence-collapses-into-ownership — same pattern as the sibling route).
async function verifyProspectOwnership(coachClientId: string, coachProfileId: string, supabase: any) {
  const { data } = await supabase
    .from("coach_clients")
    .select("id, coach_profile_id, name, lifecycle_status, client_profile_id")
    .eq("id", coachClientId)
    .in("coach_profile_id", (await resolveDelegation(supabase, coachProfileId)).actingIds)
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

    // ── Moving back (Phase 1) ──
    if ((body as any)?.direction === "back") {
      const r = await moveProspectBack(supabase, {
        coachClientId: id,
        actingIds: (await resolveDelegation(supabase, coachProfileId)).actingIds,
        stageKey,
        actor: coachProfileId,
      })
      if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
      return withCorsJson(req, { ok: true, moved_back: true, ...r.data })
    }

    // Load the coach's pipeline (the source of truth for which stages exist,
    // their order, terminality, and active flag).
    const { data: pipelineData, error: pipeErr } = await supabase
      .from("coach_pipeline_stages")
      .select("stage_key, sort_order, is_terminal, active")
      .in("coach_profile_id", (await resolveDelegation(supabase, coachProfileId)).actingIds)
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
        .in("coach_profile_id", (await resolveDelegation(supabase, coachProfileId)).actingIds)
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

      // 4. Auto-create a "Send SIGNAL invite" task so the coach is reminded
      //    to invite the new client. It surfaces on the dashboard Action
      //    Items card and the Tasks list.
      //
      //    THIS USED TO WRITE coach_client_notes WITH type='action_item'.
      //    Those two surfaces read coach_tasks since 2026-09-26, so a note
      //    written here would now be invisible to the coach it is reminding.
      //
      //    source is 'auto' and created_by is left null: a rule made this,
      //    not the coach who happened to click Convert, and the lightning
      //    icon on the row says so.
      //
      //    Idempotency: skip if a live invite task already exists for this
      //    client (guards a double-convert). Best-effort, because the
      //    conversion has already succeeded and must not fail on a reminder.
      try {
        const { data: existingInvite } = await supabase
          .from("coach_tasks")
          .select("id")
          .eq("coach_client_id", id)
          .eq("status", "open")
          .is("deleted_at", null)
          .ilike("title", `${INVITE_ACTION_PREFIX}%`)
          .maybeSingle()
        if (!existingInvite) {
          const inviteName = (prospect.name as string | null)?.trim() || "this client"
          // Through createTask, so the audit event and History line are
          // written like any other task's. The actor is the converting coach,
          // which is also the assignee, so no email tells them what they just
          // did; createTask still leaves created_by null because source is auto.
          const made = await createTask(supabase, {
            coach_client_id: id,
            client_profile_id: prospect.client_profile_id,
            assignee_profile_id: coachProfileId,
            title: `${INVITE_ACTION_PREFIX}${inviteName}`,
            source: "auto",
            // The client record. Re-send invite is a button on its header, so
            // this is the exact screen even though it is not a tab. A prospect
            // converted before it has a SIGNAL account has no client record
            // yet: its invite lives on the post-conversion page, which is where
            // this route redirects the coach. That used to be /clients/null.
            link: prospect.client_profile_id
              ? clientLink(prospect.client_profile_id)
              : `${CONVERT_REDIRECT_PREFIX}${id}`,
            // Tomorrow, matching the default offset a task template carries.
            due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            due_has_time: false,
          }, coachProfileId)
          if (!made.ok) console.error("[prospects/stage] invite task not created:", made.error)
        }
      } catch {
        // Swallow: the invite reminder is a nicety, not part of the convert.
      }
      // Best-effort event log — TERMINAL path logs ONLY converted_to_client
      // (this branch returns, so the non-terminal stage_changed below can never
      // also fire for the convert).
      await logCoachClientEvent({
        coachClientId: id,
        eventType: "converted_to_client",
        actorProfileId: coachProfileId,
      })

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
      .in("coach_profile_id", (await resolveDelegation(supabase, coachProfileId)).actingIds)
    if (updErr) return withCorsJson(req, { ok: false, error: `Failed to update current stage: ${updErr.message}` }, 500)

    // Best-effort event log — NON-TERMINAL stage change only (terminal converts
    // returned above and logged converted_to_client instead).
    await logCoachClientEvent({
      coachClientId: id,
      eventType: "stage_changed",
      actorProfileId: coachProfileId,
      context: { stage_key: stageKey },
    })

    return withCorsJson(req, {
      ok: true,
      converted: false,
      stage_key: stageKey,
      reached_at: reachedAt,
      current_stage_key: currentStageKey,
    })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = errorStatus(msg)
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
