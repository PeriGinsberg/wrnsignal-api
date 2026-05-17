// app/api/positioning/v2/phase2/[id]/draft/route.ts
//
// POST /api/positioning/v2/phase2/[id]/draft
//
// Generates AI-drafted content (headline options, reframed bullet, or
// gap response) for a specific item. Writes drafts back to
// state.items[item_id].draft_options (Pattern A) or .draft (Patterns B/C)
// so subsequent calls return cached results without re-invoking AI.
//
// FRD: docs/Features/positioning-phase2-frd.md (§6.5.3, §6.6, §6.7-6.9)
//
// Architectural references:
//   - lib/positioning/v2/phase2/phase2RunLookup.ts (findPhase2RunByIdForProfile)
//   - lib/positioning/v2/phase2/aiClient.ts (3 generation paths; STUB v0.1)
//   - lib/positioning/v2/phase2/groundingValidator.ts (validateDraftGrounding)
//   - lib/positioning/v2/phase2/draftCache.ts (shouldUseCachedDrafts,
//     getCachedDrafts)
//   - lib/positioning/v2/phase2/costPolicy.ts (COST_CENTS_PER_ATTEMPT,
//     MAX_COST_CENTS)
//   - app/api/positioning/v2/phase2/[id]/decide/route.ts (sibling Phase 2
//     endpoint; same auth + error pattern)
//
// Race policy (v0.1): no optimistic locking. Two concurrent /draft calls
// on the same item are last-write-wins; matches /decide policy.
//
// Behavior:
//   - 200: returns drafts + item_id + generated_at
//          • Cached path: cache hit, no AI call, no cost incurred
//          • Fresh path: AI called, validated, persisted, cost incremented
//   - 400: invalid request (missing item_id, missing user_input for B/C,
//          draft_type mismatch with item.type)
//   - 404: phase2_run_not_found (F11) OR item_not_found
//   - 409: item_already_decided (matches /decide; protective check —
//          FRD doesn't specify but calling /draft on a decided item is
//          a frontend bug; refusing pre-empts wasted AI cost)
//   - 422: grounding_failed after 1 retry → frontend transitions to
//          manual-entry mode per FRD §6.9.1. Cost is incremented for
//          the failed attempts (tokens were spent).
//   - 429: cost_cap_exceeded (ai_cost_cents >= MAX_COST_CENTS per FRD §6.12)
//
// Cap check timing: pre-check only. The current /draft call may take the
// cumulative cost ABOVE the cap; the NEXT call returns 429. Acceptable
// v0.1 behavior; tight pre-check would require projected-cost arithmetic
// per FRD §6.6 pseudocode.
//
// Log markers (grep-friendly):
//   [positioning-v2/phase2/draft] CACHED             phase2RunId=… itemId=… draftCount=…
//   [positioning-v2/phase2/draft] GENERATED          phase2RunId=… itemId=… attempts=… costCents=…
//   [positioning-v2/phase2/draft] COST_CAPPED        phase2RunId=… currentCents=…
//   [positioning-v2/phase2/draft] GROUNDING_REJECTED phase2RunId=… itemId=… attempt=…
//   [positioning-v2/phase2/draft] GROUNDING_FAILED   phase2RunId=… itemId=… (after retry)
//   [positioning-v2/phase2/draft] LOOKUP_FAILED      phase2RunId=… error=…
//   [positioning-v2/phase2/draft] UPDATE_FAILED      phase2RunId=… error=…
//   [positioning-v2/phase2/draft] COST_WRITE_FAILED  phase2RunId=… error=… (422 path)
//   [positioning-v2/phase2/draft] AI_CALL_FAILED     phase2RunId=… itemId=… error=…

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getAuthedProfileText } from "../../../../../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"

import { findPhase2RunByIdForProfile } from "@/lib/positioning/v2/phase2/phase2RunLookup"
import {
  generateHeadlineOptions,
  generateBulletReframe,
  generateGapResponse,
  type GenerateResult,
} from "@/lib/positioning/v2/phase2/aiClient"
import { isAcceptableAiResult } from "@/lib/positioning/v2/phase2/groundingValidator"
import {
  shouldUseCachedDrafts,
  getCachedDrafts,
} from "@/lib/positioning/v2/phase2/draftCache"
import {
  COST_CENTS_PER_ATTEMPT,
  MAX_COST_CENTS,
} from "@/lib/positioning/v2/phase2/costPolicy"
import type {
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
  PhaseTwoItem,
  PhaseTwoState,
} from "@/lib/positioning/v2/phase2/types"

// ============================================================================
// Constants
// ============================================================================

/** Max attempts including retry. 1 retry after first failure → 2 total. */
const MAX_ATTEMPTS = 2

// ============================================================================
// Supabase admin client
// ============================================================================

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "positioning-v2/phase2/[id]/draft: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient
}

// ============================================================================
// Request body validation
// ============================================================================

type DraftRequestBody = {
  item_id: string
  draft_type: "headline" | "bullet" | "gap"
  user_input?: string
  regenerate?: boolean
}

type ValidationResult =
  | { ok: true; body: DraftRequestBody }
  | { ok: false; error: string }

function validateBody(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_body" }
  }
  const b = raw as Record<string, unknown>

  if (typeof b.item_id !== "string" || !b.item_id.trim()) {
    return { ok: false, error: "missing_item_id" }
  }
  if (
    b.draft_type !== "headline" &&
    b.draft_type !== "bullet" &&
    b.draft_type !== "gap"
  ) {
    return { ok: false, error: "invalid_draft_type" }
  }
  if (b.user_input !== undefined && typeof b.user_input !== "string") {
    return { ok: false, error: "invalid_user_input" }
  }
  if (b.regenerate !== undefined && typeof b.regenerate !== "boolean") {
    return { ok: false, error: "invalid_regenerate" }
  }
  return {
    ok: true,
    body: {
      item_id: b.item_id.trim(),
      draft_type: b.draft_type,
      user_input: b.user_input as string | undefined,
      regenerate: b.regenerate as boolean | undefined,
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
    return withCorsJson(request, { error: validation.error }, 400)
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
      `[positioning-v2/phase2/draft] LOOKUP_FAILED phase2RunId=${phase2RunId} error=${lookup.error}`,
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

  // ── 5. Find item in state.items ────────────────────────────────────────
  const itemIdx = phase2Run.state.items.findIndex(
    (i) => i.id === body.item_id,
  )
  if (itemIdx === -1) {
    return withCorsJson(request, { error: "item_not_found" }, 404)
  }
  const item = phase2Run.state.items[itemIdx]

  // ── 6. draft_type matches item.type ────────────────────────────────────
  if (item.type !== body.draft_type) {
    return withCorsJson(
      request,
      {
        error: "type_mismatch",
        detail: `draft_type (${body.draft_type}) does not match item.type (${item.type})`,
      },
      400,
    )
  }

  // ── 7. user_input required for bullet/gap (Patterns B/C) ───────────────
  if (
    (body.draft_type === "bullet" || body.draft_type === "gap") &&
    (body.user_input === undefined || body.user_input.trim() === "")
  ) {
    return withCorsJson(request, { error: "user_input_required" }, 400)
  }

  // ── 8. Check item not already decided (409 — protective; FRD §6.5.3
  //      doesn't specify but pre-empts wasted AI cost on frontend bugs) ──
  if (item.accepted || item.declined || item.skipped) {
    const decisionKind = item.accepted
      ? "accept"
      : item.declined
        ? "decline"
        : "skip"
    return withCorsJson(
      request,
      {
        error: "item_already_decided",
        decided_at: item.decided_at,
        decision_kind: decisionKind,
      },
      409,
    )
  }

  // ── 9. Cache check (return cached if !regenerate && cache present) ─────
  if (shouldUseCachedDrafts(item, body.regenerate)) {
    const cachedDrafts = getCachedDrafts(item)
    console.log(
      `[positioning-v2/phase2/draft] CACHED phase2RunId=${phase2RunId} itemId=${body.item_id} draftCount=${cachedDrafts.length}`,
    )
    return withCorsJson(
      request,
      {
        drafts: cachedDrafts,
        item_id: body.item_id,
        generated_at: new Date().toISOString(),
      },
      200,
    )
  }

  // ── 10. Pre-cap check (current call may exceed; next call returns 429) ─
  if (phase2Run.ai_cost_cents >= MAX_COST_CENTS) {
    console.warn(
      `[positioning-v2/phase2/draft] COST_CAPPED phase2RunId=${phase2RunId} currentCents=${phase2Run.ai_cost_cents}`,
    )
    return withCorsJson(
      request,
      {
        error: "cost_cap_exceeded",
        current_cents: phase2Run.ai_cost_cents,
        cap_cents: MAX_COST_CENTS,
      },
      429,
    )
  }

  // ── 11. Fetch persona.resume_text + positioning_run.job_description ───
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
  const resumeText = persona?.resume_text ?? ""

  const { data: posRun, error: posErr } = await supabaseAdmin
    .from("positioning_runs_v2")
    .select("job_description")
    .eq("id", phase2Run.positioning_run_id)
    .maybeSingle<{ job_description: string | null }>()
  if (posErr) {
    return withCorsJson(
      request,
      { error: "positioning_run_lookup_failed", detail: posErr.message },
      500,
    )
  }
  const jobDescription = posRun?.job_description ?? ""

  // ── 12. Generation attempt loop (max 2: 1 + 1 retry on grounding fail) ─
  let result: GenerateResult | null = null
  let attempts = 0
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt
    const isRetry = attempt > 1
    let aiResult: GenerateResult
    try {
      if (item.type === "headline") {
        aiResult = await generateHeadlineOptions({
          resumeText,
          jobDescription,
          item: item as PhaseTwoHeadlineItem,
          isRetry,
        })
      } else if (item.type === "bullet") {
        aiResult = await generateBulletReframe({
          resumeText,
          jobDescription,
          item: item as PhaseTwoBulletItem,
          userResponse: body.user_input!,
          isRetry,
        })
      } else {
        aiResult = await generateGapResponse({
          resumeText,
          jobDescription,
          item: item as PhaseTwoGapItem,
          userResponse: body.user_input!,
          isRetry,
        })
      }
    } catch (e) {
      console.warn(
        `[positioning-v2/phase2/draft] AI_CALL_FAILED phase2RunId=${phase2RunId} itemId=${body.item_id} attempt=${attempt} error=${(e as Error).message}`,
      )
      return withCorsJson(
        request,
        { error: "ai_call_failed", detail: (e as Error).message },
        500,
      )
    }

    // Validate AI result: rejects empty drafts (Claude refused with
    // insufficient_source_evidence) AND drafts that fail grounding.
    // Both failure modes count as failed attempts and trigger retry.
    const allowedSources: string[] = (() => {
      if (item.type === "headline") return [resumeText]
      if (item.type === "bullet") {
        return [item.original_bullet, body.user_input ?? ""]
      }
      // gap
      return [item.gap_description, body.user_input ?? ""]
    })()

    const validation = isAcceptableAiResult(aiResult.drafts, allowedSources)

    if (validation.ok) {
      result = aiResult
      break
    }

    // Distinguish failure modes for §11 telemetry tuning
    if (validation.reason === "empty_drafts") {
      console.warn(
        `[positioning-v2/phase2/draft] INSUFFICIENT_EVIDENCE phase2RunId=${phase2RunId} itemId=${body.item_id} attempt=${attempt}`,
      )
    } else {
      console.warn(
        `[positioning-v2/phase2/draft] GROUNDING_REJECTED phase2RunId=${phase2RunId} itemId=${body.item_id} attempt=${attempt} ungrounded=${JSON.stringify(validation.ungrounded_entities ?? [])}`,
      )
    }
  }

  // ── 12b. 422 path: cost increment for failed attempts ──────────────────
  // Per Decision 4 (2026-05-17): tokens were spent on the failed attempts
  // (AI was called `attempts` times), so increment ai_cost_cents before
  // returning 422. Separate UPDATE since no state mutation is needed in
  // the 422 path (drafts were not generated; cache untouched).
  if (!result) {
    const costDelta = attempts * COST_CENTS_PER_ATTEMPT
    const newCostCents = phase2Run.ai_cost_cents + costDelta
    const { error: costErr } = await supabaseAdmin
      .from("phase2_runs")
      .update({ ai_cost_cents: newCostCents })
      .eq("id", phase2RunId)
    if (costErr) {
      // Cost write failure is non-fatal for the 422 response — log + continue.
      // The user still gets the 422 → manual-entry mode flow; the unaccounted
      // cost just doesn't tick the cap. Acceptable degraded behavior.
      console.warn(
        `[positioning-v2/phase2/draft] COST_WRITE_FAILED phase2RunId=${phase2RunId} error=${costErr.message}`,
      )
    }
    console.warn(
      `[positioning-v2/phase2/draft] GROUNDING_FAILED phase2RunId=${phase2RunId} itemId=${body.item_id}`,
    )
    return withCorsJson(
      request,
      {
        error: "grounding_failed",
        detail: "AI generated ungrounded content. Use manual-entry mode.",
      },
      422,
    )
  }

  // ── 13. Build new state with drafts persisted ──────────────────────────
  const updatedItem: PhaseTwoItem = (() => {
    if (item.type === "headline") {
      return {
        ...item,
        draft_options: result.drafts,
      }
    }
    if (item.type === "bullet") {
      return {
        ...item,
        draft: result.drafts[0],
        question_asked: result.questionAsked ?? item.question_asked,
        user_response: body.user_input!,
      }
    }
    // gap
    return {
      ...item,
      draft: result.drafts[0],
      question_asked: result.questionAsked ?? item.question_asked,
      user_response: body.user_input!,
    }
  })()

  const newItems = [...phase2Run.state.items]
  newItems[itemIdx] = updatedItem

  const newState: PhaseTwoState = {
    ...phase2Run.state,
    items: newItems,
    selection_screen_seen: true,
  }

  // ── 14. UPDATE phase2_run: state + ai_cost_cents increment atomically ──
  const costDelta = attempts * COST_CENTS_PER_ATTEMPT
  const newCostCents = phase2Run.ai_cost_cents + costDelta

  const { error: updateErr } = await supabaseAdmin
    .from("phase2_runs")
    .update({
      state: newState,
      ai_cost_cents: newCostCents,
    })
    .eq("id", phase2RunId)

  if (updateErr) {
    console.warn(
      `[positioning-v2/phase2/draft] UPDATE_FAILED phase2RunId=${phase2RunId} error=${updateErr.message}`,
    )
    return withCorsJson(
      request,
      { error: "phase2_run_update_failed", detail: updateErr.message },
      500,
    )
  }

  console.log(
    `[positioning-v2/phase2/draft] GENERATED phase2RunId=${phase2RunId} itemId=${body.item_id} attempts=${attempts} costCents=${costDelta} totalCents=${newCostCents}`,
  )

  // ── 15. Return ─────────────────────────────────────────────────────────
  return withCorsJson(
    request,
    {
      drafts: result.drafts,
      item_id: body.item_id,
      generated_at: new Date().toISOString(),
    },
    200,
  )
}
