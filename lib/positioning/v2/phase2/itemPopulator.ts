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

/** Maximum bullet items emitted per run. */
const MAX_BULLETS = 3
/** Maximum gap items emitted per run. */
const MAX_GAPS = 3

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
export function populateItems(
  positioningRun: PositioningRunV2Row,
  jobfit: JobfitResultJson,
  caseSpecific: CaseSpecificData | null,
  resumeText: string,
): PhaseTwoItem[] {
  // caseSpecific is wired through for forward-compat (FRD §6.2 future
  // headline_recommendation field). Currently unused — silence the lint.
  void caseSpecific

  // ── Case gate ─────────────────────────────────────────────────────────
  if (positioningRun.case_assigned !== "B") {
    console.log(
      `[itemPopulator] case-gated case=${positioningRun.case_assigned} run=${positioningRun.id}`,
    )
    return []
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

  const gapItems: PhaseTwoGapItem[] = cappedGaps.map((c, idx) => ({
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
  }))

  console.log(
    `[itemPopulator] populated case=B run=${positioningRun.id} headline=${headlineItems.length} bullets=${bulletItems.length} gaps=${gapItems.length}`,
  )

  return [...headlineItems, ...bulletItems, ...gapItems]
}
