// lib/positioning/v2/phase2/itemPopulator.ts
//
// Derives the initial PhaseTwoItem[] for a new phase2_run from the parent
// positioning_run_v2 row + upstream jobfit_run.result_json + case_specific
// data + persona resume_text. Called at phase2_run creation time by the
// POST /api/positioning/v2/phase2/start endpoint (FRD §6.5.1).
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.2 — item population rules
//   §4.3 — no filler principle
//   §6.10 — resumeComposer locate-and-replace (depends on bullet verbatim invariant)
// Types: ./types.ts (PhaseTwoItem discriminated union)
// Parent types: @/lib/positioning/v2/types (PositioningRunV2Row,
//               JobfitResultJson)
// Helpers: ./itemPopulatorParts/* (Stage 2b Commit 1 — 4000af9d)
//
// Behavior (Stage 2b Commit 2):
//   1. Case gate. Non-B → []. The route currently 400s Case A/C before
//      this is called, but the in-function gate is defense-in-depth for
//      callers that decouple from the route (tests, future code paths).
//   2. Extract candidates via Commit 1 helpers.
//   3. Cap bullets and gaps at 3 each. Headline is 0-or-1 from the helper.
//   4. Transform candidates to PhaseTwoItem objects with position-based IDs
//      (headline-1, bullet-1..3, gap-1..3) and seed decision fields
//      (accepted/declined/skipped/manual_entry all false, decided_at null).
//   5. Return in canonical order: [headline?, ...bullets, ...gaps] per §6.2.
//
// Architectural invariant (load-bearing):
//   For every PhaseTwoBulletItem.original_bullet returned, the string MUST
//   appear character-for-character in `resumeText`. resumeComposer's
//   locate-and-replace (FRD §6.10) depends on this. anchorBullet (Commit 1)
//   enforces it on the way in by returning a verbatim substring of
//   resumeText; this orchestrator must NOT trim, normalize, or otherwise
//   modify candidate.original_bullet before assigning it to the item.

import type {
  JobfitResultJson,
  PositioningRunV2Row,
} from "@/lib/positioning/v2/types"
import type {
  GapShape,
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
  PhaseTwoItem,
} from "./types"
import { extractBulletCandidates } from "./itemPopulatorParts/extractBulletCandidates"
import { extractGapCandidates } from "./itemPopulatorParts/extractGapCandidates"
import { extractHeadlineCandidate } from "./itemPopulatorParts/extractHeadlineCandidate"
import {
  bulletLabel,
  bulletQuestionTemplate,
  gapLabel,
  gapQuestionTemplate,
  headlineLabel,
} from "./itemPopulatorParts/templates"
import {
  suggestBulletsForGap as defaultSuggestBulletsForGap,
  type SuggestBulletsForGapInput,
  type SuggestBulletsForGapResult,
} from "./aiClient"
import {
  classifyGapShape as defaultClassifyGapShape,
  type ClassifyGapShapeAiImpl,
  type ClassifyGapShapeOrchestratorResult,
} from "./itemPopulatorParts/classifyGapShape"
import { centsForUsage, MAX_COST_CENTS } from "./costPolicy"

/** Maximum bullet items emitted per run. */
const MAX_BULLETS = 3
/** Maximum gap items emitted per run. */
const MAX_GAPS = 3

/**
 * Result returned by populateItems. Items array seeds phase2_runs.state
 * .items. aiCostCents is the integer cents accumulated during populator-
 * time AI calls (currently just A3's bullet suggestions); caller persists
 * it to phase2_runs.ai_cost_cents at INSERT time so subsequent /draft
 * calls see the populator cost as the cumulative baseline.
 */
export type PopulateItemsResult = {
  items: PhaseTwoItem[]
  aiCostCents: number
}

/**
 * Dependency-injection override for tests. Match the suggestBulletsForGap
 * signature so the populator can call it identically regardless of source.
 * Production callers omit it; the real aiClient implementation is used.
 */
export type SuggestBulletsForGapImpl = (
  input: SuggestBulletsForGapInput,
) => Promise<SuggestBulletsForGapResult>

/**
 * Dependency-injection override for the G1 gap-shape classifier
 * orchestrator. Tests pass a mock so unit checks don't hit the live
 * heuristic dictionaries OR the Anthropic API. Production callers omit;
 * the real orchestrator (./itemPopulatorParts/classifyGapShape) is used.
 *
 * Note: this is the ORCHESTRATOR signature (heuristic + LLM fallback),
 * not the raw aiClient LLM call. The orchestrator handles cost-cap
 * routing internally — the populator just passes `aiAllowed` per gap.
 */
export type ClassifyGapShapeImpl = (input: {
  candidate: import("./itemPopulatorParts/types").GapCandidate
  aiAllowed: boolean
  aiImpl?: ClassifyGapShapeAiImpl
}) => Promise<ClassifyGapShapeOrchestratorResult>

/**
 * Build the initial PhaseTwoItem[] for a new phase2_run.
 *
 * FRD §6.2 item population rules (orchestrated here):
 *   - Headline (0 or 1): from job_signals.jobTitle. Synthesized "original"
 *     line — v0.1 does NOT scrape resume_text for a headline candidate;
 *     blind-read pass is deferred to v2.5+.
 *   - Bullets (0-3): from why_structured entries with reframe-flavored
 *     action AND lead that anchors to a verbatim resume line.
 *   - Gaps (0-3): from job_signals.requirement_units (core only) not
 *     already represented in the resume.
 *
 * Item ordering on the selection screen (§6.2 default):
 *   1. Headline first (if any)
 *   2. Bullets in extraction order, post-cap
 *   3. Gaps in extraction order, post-cap
 *
 * Case gate (§6.5.1, v0.1):
 *   Returns [] for any case_assigned !== "B". The /start route gates
 *   Case A/C with 400 upstream, so in production paths this branch fires
 *   only on test inputs or future code paths that bypass the route.
 *
 * Edge cases:
 *   - case_assigned not in {"A","B","C"} (data corruption / wrong-type) → []
 *   - jobfit with no reframe-flavored whys AND no unrepresented core
 *     requirements + jobTitle present → returns [headlineItem] only
 *   - jobTitle missing → no headline; bullets/gaps still emitted
 *
 * @param positioningRun The parent positioning_run_v2 row. Provides case
 *                       context + run id for telemetry.
 * @param jobfit The jobfit_run.result_json that drove case assignment.
 *               Source of why_structured (bullet candidates) +
 *               job_signals.requirement_units (gap candidates) +
 *               job_signals.jobTitle/jobFamily (headline candidate).
 * @param resumeText Verbatim persona.resume_text. anchorBullet returns
 *                   substrings of this verbatim — invariant downstream.
 * @returns Ordered array of PhaseTwoItem ready to seed phase2_runs.state.items.
 *          Empty array is a valid result (see edge cases).
 */
export async function populateItems(
  positioningRun: PositioningRunV2Row,
  jobfit: JobfitResultJson,
  resumeText: string,
  /**
   * Test-only: inject a mock suggestBulletsForGap to avoid live Anthropic
   * calls. Production callers omit; the real aiClient.suggestBulletsForGap
   * is used. Mirrors the invokeClaudeImpl DI pattern in aiClient itself.
   */
  suggestBulletsImpl?: SuggestBulletsForGapImpl,
  /**
   * Test-only: inject a mock G1 gap-shape classifier orchestrator. When
   * omitted, the real heuristic+LLM orchestrator runs. Tests that don't
   * care about classification can pass a no-op that always returns
   * { shape: "unknown", aiCostCents: 0, llmCalled: false }.
   */
  classifyGapShapeImpl?: ClassifyGapShapeImpl,
): Promise<PopulateItemsResult> {
  // ── Case gate ─────────────────────────────────────────────────────────
  if (positioningRun.case_assigned !== "B") {
    console.log(
      `[itemPopulator] case-gated case=${positioningRun.case_assigned} run=${positioningRun.id}`,
    )
    return { items: [], aiCostCents: 0 }
  }

  // ── Extract candidates ────────────────────────────────────────────────
  const headlineCandidate = extractHeadlineCandidate(jobfit, resumeText)
  const bulletCandidates = extractBulletCandidates(jobfit, resumeText)
  const gapCandidates = extractGapCandidates(jobfit, resumeText)

  // ── Apply caps ────────────────────────────────────────────────────────
  // Headline is already 0-or-1 from the helper. Bullets and gaps cap at 3.
  const cappedBullets = bulletCandidates.slice(0, MAX_BULLETS)
  const cappedGaps = gapCandidates.slice(0, MAX_GAPS)

  // ── Transform to PhaseTwoItem objects with position-based IDs ─────────
  const headlineItems: PhaseTwoHeadlineItem[] = []
  if (headlineCandidate !== null) {
    // Branch on the candidate's `kind`:
    //   - "replace":    real headline block detected — use it verbatim as
    //                   the locate-and-replace anchor; synthesize_mode=false.
    //   - "synthesize": no headline found; emit informational placeholder
    //                   "Headline targeting: ${jobTitle}" and flag
    //                   synthesize_mode=true so resumeComposer's insertion
    //                   path inserts final_text at the first blank line
    //                   after the contact block instead of replacing.
    const isReplace = headlineCandidate.kind === "replace"
    const original = isReplace
      ? headlineCandidate.original
      : `Headline targeting: ${headlineCandidate.jobTitle}`
    headlineItems.push({
      id: "headline-1",
      type: "headline",
      label: headlineLabel(headlineCandidate.jobTitle),
      original,
      synthesize_mode: !isReplace,
      draft_options: [],
      selected_draft_index: null,
      user_override_text: null,
      final_text: null,
      accepted: false,
      declined: false,
      skipped: false,
      manual_entry: false,
      decided_at: null,
    })
  }

  const bulletItems: PhaseTwoBulletItem[] = cappedBullets.map((c, idx) => ({
    id: `bullet-${idx + 1}`,
    type: "bullet" as const,
    label: bulletLabel(c.keyword),
    // ARCHITECTURAL INVARIANT: original_bullet must appear verbatim in
    // resumeText. anchorBullet guarantees this on the way in; do NOT
    // trim, normalize, or otherwise modify c.original_bullet here.
    // resumeComposer locate-and-replace (FRD §6.10) depends on it.
    original_bullet: c.original_bullet,
    jd_context: c.jd_context,
    question_asked: bulletQuestionTemplate(c.original_bullet, c.jd_context),
    user_response: null,
    draft: null,
    final_text: null,
    accepted: false,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: null,
  }))

  // ── Gap items: G1 classify + A3 bullet suggestions per gap ───────────
  // Each gap runs through two AI-bearing operations in fixed order:
  //
  //   1. G1 classifyGapShape — heuristic-first; LLM only on low-confidence
  //      / unclassified gaps. Sets PhaseTwoGapItem.gap_shape.
  //   2. A3 suggestBulletsForGap — Claude picks top-3 verbatim resume
  //      bullets relevant to this gap. Populates
  //      PhaseTwoGapItem.suggested_bullets_for_reword.
  //
  // Order matters: classify FIRST. Future commits (A4 if shipped) may use
  // gap_shape to decide WHICH bullet/skill suggestion call to make. The
  // defensive sequencing keeps us free to wire shape-aware suggestion
  // later without re-flowing the populator.
  //
  // Calls run SERIALLY so the cost-cap check fires before each one
  // (parallel would race the accumulator and over-spend). Latency cost:
  // ~1-3s per gap for A3, ~0.3s for G1 when LLM fires (most gaps skip
  // the LLM entirely).
  //
  // Cost-cap behavior: when accumulated cost >= MAX_COST_CENTS, remaining
  // AI calls are short-circuited per operation:
  //   - G1: orchestrator runs heuristic only; gap_shape uses the
  //     heuristic best guess (or "experience" default for unclassified).
  //   - A3: suggested_bullets_for_reword: [] (the A2 default).
  // Populator does NOT throw — /start succeeds and the user gets a
  // usable run.
  const suggestBullets = suggestBulletsImpl ?? defaultSuggestBulletsForGap
  const classifyShape = classifyGapShapeImpl ?? defaultClassifyGapShape
  const gapItems: PhaseTwoGapItem[] = []
  let aiCostCents = 0
  let costCapHit = false

  for (let idx = 0; idx < cappedGaps.length; idx++) {
    const c = cappedGaps[idx]
    let suggestions: string[] = []
    // Default to the candidate's seed shape ("unknown" from
    // extractGapCandidates). Overwritten by the G1 classifier below.
    let gapShape: GapShape = c.gap_shape

    // Cap-state housekeeping. Mirrors the pattern used for A3 below.
    if (!costCapHit && aiCostCents >= MAX_COST_CENTS) {
      costCapHit = true
      console.log(
        `[itemPopulator] cost cap exhausted (${aiCostCents}/${MAX_COST_CENTS}) before gap-${idx + 1}; remaining AI calls skipped`,
      )
    }

    // ── G1: classify gap_shape ───────────────────────────────────────
    // aiAllowed gates the orchestrator's LLM fallback. When false, the
    // orchestrator returns the pure-heuristic best guess (no cost).
    try {
      const shapeResult = await classifyShape({
        candidate: c,
        aiAllowed: !costCapHit,
      })
      aiCostCents += shapeResult.aiCostCents
      gapShape = shapeResult.shape
    } catch (e) {
      // Classifier shouldn't throw (it catches LLM errors internally),
      // but defend against unexpected exceptions in the orchestrator.
      // Fall back to "experience" — the safest default per design.
      console.warn(
        `[itemPopulator] classifyGapShape unexpectedly threw for gap-${idx + 1} run=${positioningRun.id}: ${e instanceof Error ? e.message : String(e)}`,
      )
      gapShape = "experience"
    }

    // Re-check cap between G1 and A3 — G1 may have just pushed us over.
    if (!costCapHit && aiCostCents >= MAX_COST_CENTS) {
      costCapHit = true
      console.log(
        `[itemPopulator] cost cap exhausted after G1 for gap-${idx + 1}; skipping A3 suggestBulletsForGap`,
      )
    }

    // ── A3: bullet suggestions for reword ────────────────────────────
    // Single retry on empty suggestions — handles parse/verbatim
    // failures recoverable by re-rolling at a higher temperature.
    // Legitimate "no good matches" cases also fall through this
    // retry (one extra call, ~1 cent).
    if (!costCapHit) {
      try {
        let result = await suggestBullets({
          gapDescription: c.gap_description,
          jdContext: c.jd_context,
          resumeText,
          isRetry: false,
        })
        aiCostCents += centsForUsage(result.usage)
        if (result.suggestions.length === 0) {
          if (aiCostCents < MAX_COST_CENTS) {
            result = await suggestBullets({
              gapDescription: c.gap_description,
              jdContext: c.jd_context,
              resumeText,
              isRetry: true,
            })
            aiCostCents += centsForUsage(result.usage)
          }
        }
        suggestions = result.suggestions
      } catch (e) {
        // AI call failed. Log and continue with empty suggestions —
        // populator is non-fail-critical for the suggestion enrichment.
        console.warn(
          `[itemPopulator] suggestBulletsForGap failed for gap-${idx + 1} run=${positioningRun.id}: ${e instanceof Error ? e.message : String(e)}`,
        )
        suggestions = []
      }
    }

    gapItems.push({
      id: `gap-${idx + 1}`,
      type: "gap" as const,
      label: gapLabel(c.keyword),
      gap_description: c.gap_description,
      jd_context: c.jd_context,
      question_asked: gapQuestionTemplate(c.gap_description, c.jd_context),
      user_response: null,
      draft: null,
      final_text: null,
      accepted: false,
      declined: false,
      skipped: false,
      manual_entry: false,
      decided_at: null,
      // A2 multi-outcome composition fields. compositional_outcome and
      // target_bullet_text stay at their A2 defaults — user decides in
      // /decide (C1). suggested_bullets_for_reword is populated by A3's
      // aiClient call above (verbatim-filtered, capped at 3, or [] if
      // AI returned nothing usable or the cost cap was exhausted).
      // Legacy phase2_runs rows lack these fields entirely — downstream
      // readers default accordingly. See PhaseTwoGapItem JSDoc.
      compositional_outcome: null,
      target_bullet_text: null,
      suggested_bullets_for_reword: suggestions,
      // G1 gap_shape: set by the classifier above (heuristic-first,
      // LLM fallback). Legacy phase2_runs rows seeded before G1 lack
      // this field — readers default `gap_shape ?? "unknown"`. See
      // PhaseTwoGapItem JSDoc.
      gap_shape: gapShape,
    })
  }

  console.log(
    `[itemPopulator] populated case=B run=${positioningRun.id} headline=${headlineItems.length} bullets=${bulletItems.length} gaps=${gapItems.length} aiCostCents=${aiCostCents}`,
  )

  return {
    items: [...headlineItems, ...bulletItems, ...gapItems],
    aiCostCents,
  }
}
