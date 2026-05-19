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
//               JobfitResultJson, CaseSpecificData)
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
  CaseSpecificData,
  JobfitResultJson,
  PositioningRunV2Row,
} from "@/lib/positioning/v2/types"
import type {
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
 * @param caseSpecific Case-specific data computed at Phase 1 /start time.
 *                     Reserved for forward compat (future
 *                     headline_recommendation field). Currently unused.
 * @param resumeText Verbatim persona.resume_text. anchorBullet returns
 *                   substrings of this verbatim — invariant downstream.
 * @returns Ordered array of PhaseTwoItem ready to seed phase2_runs.state.items.
 *          Empty array is a valid result (see edge cases).
 */
export async function populateItems(
  positioningRun: PositioningRunV2Row,
  jobfit: JobfitResultJson,
  caseSpecific: CaseSpecificData | null,
  resumeText: string,
  /**
   * Test-only: inject a mock suggestBulletsForGap to avoid live Anthropic
   * calls. Production callers omit; the real aiClient.suggestBulletsForGap
   * is used. Mirrors the invokeClaudeImpl DI pattern in aiClient itself.
   */
  suggestBulletsImpl?: SuggestBulletsForGapImpl,
): Promise<PopulateItemsResult> {
  // caseSpecific is wired through for forward-compat (FRD §6.2 future
  // headline_recommendation field). Currently unused — silence the lint.
  void caseSpecific

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

  // ── Gap items + A3 bullet suggestions (serial AI calls per gap) ──────
  // Each gap gets one suggestBulletsForGap call. Calls run SERIALLY so the
  // cost-cap check fires before each one (parallel would race the
  // accumulator and over-spend). Latency cost: ~1-3s per gap. Acceptable
  // for v0.1 — perf parallelization is a separate commit per design lock.
  //
  // Cost-cap behavior: when accumulated cost >= MAX_COST_CENTS, remaining
  // gaps emit with suggested_bullets_for_reword: [] (the A2 default).
  // Populator does NOT throw — /start succeeds and the user gets a usable
  // run; the bullet-picker UX falls back to "show all bullets" for the
  // un-suggested gaps.
  //
  // Retry-on-parse-failure: aiClient does NOT retry internally. If
  // suggestions=[] from the first attempt could be either "model returned
  // no good matches" (legitimate) OR "parse/verbatim failure" (recoverable).
  // We can't discriminate from outside aiClient, so we retry exactly once
  // with isRetry=true. If the second attempt also returns [], we treat
  // it as legitimate-no-matches.
  const suggestBullets = suggestBulletsImpl ?? defaultSuggestBulletsForGap
  const gapItems: PhaseTwoGapItem[] = []
  let aiCostCents = 0
  let costCapHit = false

  for (let idx = 0; idx < cappedGaps.length; idx++) {
    const c = cappedGaps[idx]
    let suggestions: string[] = []

    if (costCapHit) {
      // Cost cap already exhausted on a prior iteration; skip AI calls
      // for remaining gaps. Item still emits with [] suggestions (A2
      // default) so the user gets the gap item, just without picker
      // top-3 cache.
    } else if (aiCostCents >= MAX_COST_CENTS) {
      // Pre-call check — covers the rare case where prior iterations
      // hit exactly the cap. Flip the flag so subsequent iterations
      // short-circuit without re-checking.
      costCapHit = true
      console.log(
        `[itemPopulator] cost cap exhausted (${aiCostCents}/${MAX_COST_CENTS}), skipping AI bullet suggestions for remaining gaps`,
      )
    } else {
      try {
        let result = await suggestBullets({
          gapDescription: c.gap_description,
          jdContext: c.jd_context,
          resumeText,
          isRetry: false,
        })
        aiCostCents += centsForUsage(result.usage)
        // Single retry on empty suggestions — handles parse/verbatim
        // failures recoverable by re-rolling at a higher temperature.
        // Legitimate "no good matches" cases also fall through this
        // retry (one extra call, ~1 cent), which is acceptable cost
        // for the simplicity of not threading parse-failure-vs-no-
        // match discrimination out of aiClient.
        if (result.suggestions.length === 0) {
          // Re-check cap before the retry call — defensive against
          // the unusual case where the first call exactly hit the cap.
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
        // AI call failed (network error, Anthropic 5xx, invalid API key).
        // Log and continue with empty suggestions — populator is
        // non-fail-critical for the suggestion enrichment; the gap item
        // still emits with the A2 default. /start does NOT throw on AI
        // failure here.
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
      // /decide (C1). suggested_bullets_for_reword is now populated by
      // A3's aiClient call above (verbatim-filtered, capped at 3, or []
      // if AI returned nothing usable or the cost cap was exhausted).
      // Legacy phase2_runs rows lack these fields entirely — downstream
      // readers default accordingly. See PhaseTwoGapItem JSDoc.
      compositional_outcome: null,
      target_bullet_text: null,
      suggested_bullets_for_reword: suggestions,
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
