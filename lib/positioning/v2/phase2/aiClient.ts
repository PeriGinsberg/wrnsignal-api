// lib/positioning/v2/phase2/aiClient.ts
//
// Claude API wrapper for the three Phase 2 generation paths. Each path
// corresponds to one of the FRD §5.3 interaction patterns:
//   - Pattern A: headline option generation (1-3 reframed headlines)
//   - Pattern B: bullet reframe drafting (1 reframed bullet)
//   - Pattern C: gap discussion drafting (1 new bullet or skill addition)
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.7 — AI integration architecture (model choice, token budgets,
//          retry policy, common contract)
//   §6.8 — prompt structure + grounding validation contract
//   §4.1 — reframing-not-generation principle (enforced in prompts)
//   §4.2 — interview integrity (enforced via grounding constraint)
//
// Types: ./types.ts (PhaseTwoHeadlineItem, PhaseTwoBulletItem, PhaseTwoGapItem)
//
// Model: Claude Haiku (claude-haiku-4-5-20251001 per existing project
// pattern in app/api/jobfit/bulletGeneratorV5.ts). Chosen for latency
// and cost — Phase 2 generation outputs are short (150-200 tokens) and
// must complete inside the user's working tempo (FRD §4.5 target < 5s p50).
//
// Grounding: each prompt enforces the "no invention" constraint with
// verbatim language ("You may use only the following source text. Do not
// introduce facts, metrics, claims, skills, tools, or accomplishments not
// explicitly present in the source."). Server-side validation per
// groundingValidator.ts rejects drafts that introduce ungrounded entities.
// The /draft endpoint (FRD §6.5.3) orchestrates the retry-on-fail loop.
//
// SKELETON — Phase 2a commit. Real Claude wiring (prompt construction,
// API call, response parsing, cost tracking integration with
// phase2_runs.ai_cost_cents) lands in a later Stage 2 commit. Stub
// functions throw to make missing implementation obvious to callers.

import type {
  PhaseTwoHeadlineItem,
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
} from "./types"

// ============================================================================
// Pattern A — headline option generation
// ============================================================================

/**
 * Input shape for generateHeadlineOptions.
 */
export type GenerateHeadlineOptionsInput = {
  /** Full resume text (typically persona.resume_text). */
  resumeText: string
  /** Full job description text. */
  jobDescription: string
  /** The headline item being processed. */
  item: PhaseTwoHeadlineItem
}

/**
 * Pattern A — generate 1-3 reframed headline options for a headline item.
 *
 * FRD §6.7.1:
 *   - Output: 1-3 reframed headline options
 *   - Constraint: each option must be evidence-grounded — anchored in
 *     skills/experience present in resumeText
 *   - Token budget: ~200 output tokens
 *   - Model: Claude Haiku
 *
 * Retry policy (FRD §6.7 common contract): if any returned option fails
 * grounding validation, the caller (/draft endpoint) regenerates once;
 * if regeneration also fails, the endpoint returns 422 and the frontend
 * transitions to manual-entry mode (FRD §6.9.1).
 *
 * @param input resumeText + jobDescription + item context
 * @returns 1-3 reframed headline option strings, each grounded in resumeText
 * @throws Error if AI request fails (network, malformed response, etc.) —
 *         caller handles via /draft 422/500 error contract
 */
export async function generateHeadlineOptions(
  input: GenerateHeadlineOptionsInput,
): Promise<string[]> {
  // TODO(phase-2-stage-2b): wire to Claude Haiku per FRD §6.7.1.
  void input
  throw new Error("generateHeadlineOptions: not implemented (Phase 2a skeleton)")
}

// ============================================================================
// Pattern B — bullet reframe drafting
// ============================================================================

/**
 * Input shape for generateBulletReframe.
 */
export type GenerateBulletReframeInput = {
  /** Full resume text. */
  resumeText: string
  /** Full job description text. */
  jobDescription: string
  /** The bullet item being processed. */
  item: PhaseTwoBulletItem
  /** User's typed response to the item's question_asked. Required. */
  userResponse: string
}

/**
 * Pattern B — draft a reframed bullet from the user's response to the
 * targeted question.
 *
 * FRD §6.7.2:
 *   - Output: 1 reframed bullet
 *   - Constraint: bullet content must use only facts from item.original_bullet
 *     + userResponse (allowed-source set is intentionally narrow for
 *     Pattern B — broader resumeText is provided for context, not as
 *     fact source)
 *   - Token budget: ~150 output tokens
 *   - Model: Claude Haiku
 *
 * Retry + grounding: same contract as generateHeadlineOptions.
 *
 * @param input resumeText + jobDescription + item context + userResponse
 * @returns 1 reframed bullet string grounded in original_bullet + userResponse
 * @throws Error if AI request fails
 */
export async function generateBulletReframe(
  input: GenerateBulletReframeInput,
): Promise<string> {
  // TODO(phase-2-stage-2b): wire to Claude Haiku per FRD §6.7.2.
  void input
  throw new Error("generateBulletReframe: not implemented (Phase 2a skeleton)")
}

// ============================================================================
// Pattern C — gap discussion drafting
// ============================================================================

/**
 * Input shape for generateGapResponse.
 */
export type GenerateGapResponseInput = {
  /** Full resume text. */
  resumeText: string
  /** Full job description text. */
  jobDescription: string
  /** The gap item being processed. */
  item: PhaseTwoGapItem
  /** User's typed response to the item's question_asked. Required. */
  userResponse: string
}

/**
 * Pattern C — draft a new bullet or skill addition from the user's
 * response to the probing question about a missing JD requirement.
 *
 * FRD §6.7.3:
 *   - Output: 1 new bullet OR 1 skill addition (the AI decides which
 *     form fits; downstream resumeComposer routes to the right resume
 *     section per §6.10 anchor logic)
 *   - Constraint: same as Pattern B — only facts from resumeText +
 *     userResponse (the gap by definition isn't in the original resume,
 *     so the user's response is the load-bearing source)
 *   - Token budget: ~150 output tokens
 *   - Model: Claude Haiku
 *
 * Retry + grounding: same contract as generateHeadlineOptions.
 *
 * @param input resumeText + jobDescription + item context + userResponse
 * @returns 1 draft string grounded in resumeText + userResponse
 * @throws Error if AI request fails
 */
export async function generateGapResponse(
  input: GenerateGapResponseInput,
): Promise<string> {
  // TODO(phase-2-stage-2b): wire to Claude Haiku per FRD §6.7.3.
  void input
  throw new Error("generateGapResponse: not implemented (Phase 2a skeleton)")
}
