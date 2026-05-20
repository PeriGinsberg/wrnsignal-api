// app/api/positioning/v2/phase2/[id]/decide/route.ts
//
// POST /api/positioning/v2/phase2/[id]/decide
//
// User accepts, declines, edits, or skips a Phase 2 item. After every
// successful call, the server recomposes revised_resume_text from
// state.items via composeRevisedResume (FRD §6.10) and writes the new
// state + revised_resume_text atomically.
//
// FRD: docs/Features/positioning-phase2-frd.md (§6.5.4)
//
// Architectural references:
//   - lib/positioning/v2/phase2/phase2RunLookup.ts (findPhase2RunByIdForProfile)
//   - lib/positioning/v2/phase2/decisionResolver.ts (resolveFinalText — pure
//     function with the resolution-precedence rules; unit-tested in isolation)
//   - lib/positioning/v2/phase2/resumeComposer.ts (composeRevisedResume —
//     stub in v0.1; returns originalResumeText unchanged)
//   - app/api/positioning/v2/phase2/start/route.ts (sibling Phase 2 endpoint;
//     same auth + error pattern)
//
// Race policy (v0.1): no optimistic locking. Two near-simultaneous /decide
// calls on the same item (double-click) result in "last write wins."
// Double-click of the same accept button is idempotent in effect (same
// final_text written twice). Different-content races (impossible from UI;
// only via direct API misuse) are accepted. Add optimistic locking in
// v0.2 if observed in production.
//
// Behavior:
//   - 200: returns updated state + recomposed revised_resume_text
//   - 400: invalid request body OR resolveFinalText returned an error
//          (selected_draft_index_out_of_range, missing_selection,
//          missing_draft_or_edit, etc. — see decisionResolver.ts).
//          C1 adds: compositional_outcome_required (gap accept missing
//          outcome), target_bullet_text_required (gap accept with
//          reword outcome missing the bullet text), target_bullet_not_
//          verbatim (gap accept with reword outcome whose
//          target_bullet_text is not a substring of persona.resume_text).
//          validateBody also adds: invalid_compositional_outcome,
//          invalid_target_bullet_text.
//   - 404 phase2_run_not_found: F11 (not found OR wrong owner)
//   - 404 item_not_found: phase2_run exists but item_id is not in state.items
//   - 409 item_already_decided: item already has accept/decline/skip set;
//          response includes decided_at + decision_kind for frontend UX
//   - completion_offered auto-flips to true when all items now decided
//     (atomic with the state write)
//
// Log markers (grep-friendly):
//   [positioning-v2/phase2/decide] DECIDED            phase2RunId=… itemId=… decision=…
//   [positioning-v2/phase2/decide] LOOKUP_FAILED      phase2RunId=… error=…
//   [positioning-v2/phase2/decide] UPDATE_FAILED      phase2RunId=… error=…
//   [positioning-v2/phase2/decide] COMPLETION_OFFERED phase2RunId=…
//   [positioning-v2/phase2/decide] PERSONA_EMPTY      phase2RunId=… personaId=…

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getAuthedProfileText } from "../../../../../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"

import { findPhase2RunByIdForProfile } from "@/lib/positioning/v2/phase2/phase2RunLookup"
import {
  resolveFinalText,
  VALID_OUTCOMES,
  type CompositionalOutcome,
  type DecideRequestFields,
} from "@/lib/positioning/v2/phase2/decisionResolver"
import { composeRevisedResume } from "@/lib/positioning/v2/phase2/resumeComposer"
import type {
  PhaseTwoItem,
  PhaseTwoState,
} from "@/lib/positioning/v2/phase2/types"

// ============================================================================
// Supabase admin client
// ============================================================================

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "positioning-v2/phase2/[id]/decide: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient
}

// ============================================================================
// Request body validation
// ============================================================================

type DecideRequestBody = DecideRequestFields & { item_id: string }

type ValidationResult =
  | { ok: true; body: DecideRequestBody }
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
    b.decision !== "accept" &&
    b.decision !== "decline" &&
    b.decision !== "skip"
  ) {
    return { ok: false, error: "invalid_decision" }
  }
  if (b.edited_text !== undefined && typeof b.edited_text !== "string") {
    return { ok: false, error: "invalid_edited_text" }
  }
  if (b.selected_draft_index !== undefined) {
    if (
      typeof b.selected_draft_index !== "number" ||
      !Number.isInteger(b.selected_draft_index) ||
      b.selected_draft_index < 0
    ) {
      return { ok: false, error: "invalid_selected_draft_index" }
    }
  }
  if (b.manual_entry !== undefined && typeof b.manual_entry !== "boolean") {
    return { ok: false, error: "invalid_manual_entry" }
  }

  // C1: gap compositional outcome fields (validated semantically by
  // resolveFinalText; here we only check primitive type shape).
  // C2: literal-set lookup against VALID_OUTCOMES (9-value set exported
  // from decisionResolver.ts). Unknown strings → invalid_compositional_
  // outcome 400, same error code as C1.
  if (b.compositional_outcome !== undefined) {
    if (
      typeof b.compositional_outcome !== "string" ||
      !VALID_OUTCOMES.has(b.compositional_outcome as CompositionalOutcome)
    ) {
      return { ok: false, error: "invalid_compositional_outcome" }
    }
  }
  if (b.target_bullet_text !== undefined && typeof b.target_bullet_text !== "string") {
    return { ok: false, error: "invalid_target_bullet_text" }
  }

  return {
    ok: true,
    body: {
      item_id: b.item_id.trim(),
      decision: b.decision,
      edited_text: b.edited_text as string | undefined,
      selected_draft_index: b.selected_draft_index as number | undefined,
      manual_entry: b.manual_entry as boolean | undefined,
      compositional_outcome: b.compositional_outcome as
        | DecideRequestFields["compositional_outcome"]
        | undefined,
      target_bullet_text: b.target_bullet_text as string | undefined,
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

  // ── 4. Fetch phase2_run with F11 ownership collapse ────────────────────
  const lookup = await findPhase2RunByIdForProfile(
    supabaseAdmin,
    phase2RunId,
    profileId,
  )
  if (lookup.error) {
    console.warn(
      `[positioning-v2/phase2/decide] LOOKUP_FAILED phase2RunId=${phase2RunId} error=${lookup.error}`,
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

  // ── 6. Check item not already decided (409) ────────────────────────────
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

  // ── 7. Fetch persona.resume_text ────────────────────────────────────────
  // Needed BEFORE step 8's resolveFinalText call so the resolver can
  // enforce the C1 verbatim invariant when compositional_outcome ===
  // "reword_existing_bullet" (target_bullet_text must be a substring of
  // persona.resume_text). Also used by composeRevisedResume in step 12.
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
  if (!persona || persona.resume_text === null) {
    console.warn(
      `[positioning-v2/phase2/decide] PERSONA_EMPTY phase2RunId=${phase2RunId} personaId=${phase2Run.persona_id}`,
    )
  }
  // Defensive: persona row could be missing (race with persona deletion)
  // or resume_text could be null on a malformed persona. Treat as empty
  // string — composer stub returns originalResumeText unchanged, so empty
  // in → empty out. C1 verbatim check against "" will reject any
  // target_bullet_text — correct behavior (no resume → no valid bullet).
  const originalResumeText = persona?.resume_text ?? ""

  // ── 8. Resolve final_text via pure function ─────────────────────────────
  // resolveFinalText also enforces C1 gap-specific validation:
  //   - compositional_outcome required on gap accept
  //   - target_bullet_text required + verbatim when outcome is reword
  //   - returns compositional_outcome + target_bullet_text for persistence
  const resolved = resolveFinalText(item, body, originalResumeText)
  if (!resolved.ok) {
    return withCorsJson(request, { error: resolved.error }, 400)
  }

  // ── 9. Mutate item in state ────────────────────────────────────────────
  // Build a fresh state object (state.items is a fresh copy from SELECT;
  // mutating is safe but explicit reconstruction makes the diff readable).
  const nowIso = new Date().toISOString()
  const updatedItem: PhaseTwoItem = (() => {
    // Common decision mutations
    const base = {
      ...item,
      accepted: body.decision === "accept",
      declined: body.decision === "decline",
      skipped: body.decision === "skip",
      manual_entry: resolved.manual_entry,
      decided_at: nowIso,
      final_text: resolved.final_text,
    }
    // Headline-specific: persist selected_draft_index + user_override_text
    // (decisions the resolver doesn't surface — the resolver answers
    // "what is final_text"; the item also needs to record the user's
    // selection mode for analytics + later re-render).
    if (item.type === "headline" && body.decision === "accept") {
      const headlineBase = base as Extract<PhaseTwoItem, { type: "headline" }>
      const setIdx =
        body.selected_draft_index !== undefined
          ? body.selected_draft_index
          : headlineBase.selected_draft_index
      const setOverride =
        body.selected_draft_index === undefined && body.edited_text !== undefined
          ? body.edited_text
          : headlineBase.user_override_text
      return {
        ...headlineBase,
        selected_draft_index: setIdx,
        user_override_text: setOverride,
      }
    }
    // C1 gap-specific: persist compositional_outcome + target_bullet_text
    // from the resolver's output. On accept, resolver returns the
    // payload's values (validated for verbatim invariant). On
    // decline/skip, resolver returns null for both — which retroactively
    // clears any stale values if a previously-undecided item is reaching
    // these flags now. Retroactive population: legacy rows without these
    // fields get the new values written; A2 backward-compat readers
    // (`?? null`, `?? []`) already handle the legacy-read case so the
    // write side is symmetric.
    if (item.type === "gap") {
      const gapBase = base as Extract<PhaseTwoItem, { type: "gap" }>
      return {
        ...gapBase,
        compositional_outcome: resolved.compositional_outcome,
        target_bullet_text: resolved.target_bullet_text,
      }
    }
    return base as PhaseTwoItem
  })()

  const newItems = [...phase2Run.state.items]
  newItems[itemIdx] = updatedItem

  // ── 10. Detect all-decided + flip completion_offered ───────────────────
  const allDecided = newItems.every(
    (i) => i.accepted || i.declined || i.skipped,
  )
  const flipCompletion =
    allDecided && !phase2Run.state.completion_offered
  const newState: PhaseTwoState = {
    ...phase2Run.state,
    items: newItems,
    completion_offered: flipCompletion
      ? true
      : phase2Run.state.completion_offered,
  }

  // ── 11. Compose revised_resume_text ────────────────────────────────────
  const revisedResumeText = composeRevisedResume(originalResumeText, newItems)

  // ── 12. UPDATE phase2_runs ─────────────────────────────────────────────
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("phase2_runs")
    .update({
      state: newState,
      revised_resume_text: revisedResumeText,
    })
    .eq("id", phase2RunId)
    .select("state, revised_resume_text")
    .single<{ state: PhaseTwoState; revised_resume_text: string }>()

  if (updateErr || !updated) {
    console.warn(
      `[positioning-v2/phase2/decide] UPDATE_FAILED phase2RunId=${phase2RunId} error=${updateErr?.message ?? "no row"}`,
    )
    return withCorsJson(
      request,
      {
        error: "phase2_run_update_failed",
        detail: updateErr?.message ?? "no row returned",
      },
      500,
    )
  }

  console.log(
    `[positioning-v2/phase2/decide] DECIDED phase2RunId=${phase2RunId} itemId=${body.item_id} decision=${body.decision}`,
  )
  if (flipCompletion) {
    console.log(
      `[positioning-v2/phase2/decide] COMPLETION_OFFERED phase2RunId=${phase2RunId}`,
    )
  }

  // ── 13. Return ─────────────────────────────────────────────────────────
  return withCorsJson(
    request,
    {
      state: updated.state,
      revised_resume_text: updated.revised_resume_text,
    },
    200,
  )
}
