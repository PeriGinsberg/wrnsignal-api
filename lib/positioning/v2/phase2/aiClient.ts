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
// Cost:  ./costPolicy.ts (COST_CENTS_PER_ATTEMPT placeholder until Stage 2c)
//
// Model: Claude Haiku (claude-haiku-4-5-20251001 per existing project
// pattern in app/api/jobfit/bulletGeneratorV5.ts). Chosen for latency
// and cost — Phase 2 generation outputs are short (150-200 tokens) and
// must complete inside the user's working tempo (FRD §4.5 target < 5s p50).
//
// STUB IMPLEMENTATION (Phase 2b): functions return deterministic fake
// data prefixed with [STUB ...] so anyone testing knows they're not
// seeing real AI output. Real Claude Haiku wiring (prompt construction,
// API call, response parsing, token-accurate cost tracking) lands in
// Stage 2c. Until that ships:
//   - Phase 2 cannot ship to live users (real AI integration is
//     load-bearing for the reframing value proposition)
//   - Cost per /draft attempt is a fixed placeholder (1 cent) — see
//     COST_CENTS_PER_ATTEMPT in costPolicy.ts
//   - Stub drafts pass the (also-permissive) groundingValidator stub
//     trivially, so /draft endpoint can be wired and tested end-to-end
//
// Retry policy note for Stage 2c: when real Claude integration lands,
// the retry call (attempt 2) should VARY the prompt slightly — bump
// temperature, tweak the no-invention phrasing, etc. — to give a real
// chance of producing different (and potentially grounded) output. The
// stub here returns the SAME output on retry (deterministic), so the
// second attempt always "passes" the permissive validator. Stage 2c
// must replace this with genuine variation or single-shot grounding
// success will hide latent issues.

import type {
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
} from "./types"

// ============================================================================
// Unified return type for all three generation paths
// ============================================================================

/**
 * Result returned by every aiClient generation function.
 *   - drafts: 1-3 strings for Pattern A (headline); exactly 1 element for
 *     Patterns B and C (bullet/gap)
 *   - questionAsked: the question SIGNAL formulated to prompt the user's
 *     response. Present for Patterns B and C (where the workflow includes
 *     a question step); absent for Pattern A (no question for headlines)
 */
export type GenerateResult = {
  drafts: string[]
  questionAsked?: string
}

// ============================================================================
// Pattern A — headline option generation
// ============================================================================

export type GenerateHeadlineOptionsInput = {
  /** Full resume text (typically persona.resume_text). */
  resumeText: string
  /** Full job description text. */
  jobDescription: string
  /** The headline item being processed. */
  item: PhaseTwoHeadlineItem
}

/**
 * Pattern A — generate 1-3 reframed headline options.
 *
 * STUB v0.1: returns 3 deterministic fake options derived from the
 * original headline. Each option is prefixed [STUB ...] to make the
 * placeholder visible. Real Claude Haiku integration in Stage 2c per
 * FRD §6.7.1.
 *
 * Per FRD §6.7.1:
 *   - Output: 1-3 reframed headline options
 *   - Constraint: evidence-grounded — anchored in skills present in resumeText
 *   - Model: Claude Haiku
 *   - Token budget: ~200 output tokens
 *
 * No questionAsked returned (headlines have no question step).
 */
export async function generateHeadlineOptions(
  input: GenerateHeadlineOptionsInput,
): Promise<GenerateResult> {
  // STUB: deterministic placeholder. Replace with real Claude call in Stage 2c.
  const orig = input.item.original.slice(0, 100)
  return {
    drafts: [
      `[STUB OPTION 1] ${orig}`,
      `[STUB OPTION 2] ${orig} — refined`,
      `[STUB OPTION 3] ${orig} — alternate framing`,
    ],
  }
}

// ============================================================================
// Pattern B — bullet reframe drafting
// ============================================================================

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
 * Pattern B — draft a reframed bullet from the user's response.
 *
 * STUB v0.1: returns 1 deterministic fake reframe + a static
 * questionAsked. Real Claude Haiku integration in Stage 2c per FRD §6.7.2.
 *
 * Per FRD §6.7.2:
 *   - Output: 1 reframed bullet
 *   - Constraint: facts from original_bullet + userResponse only
 *   - Model: Claude Haiku
 *   - Token budget: ~150 output tokens
 *
 * questionAsked is returned so /decide-time analytics can persist the
 * exact prompt the user answered. In Stage 2c the question will be
 * generated alongside the draft; the stub returns a fixed-content
 * question for testing.
 */
export async function generateBulletReframe(
  input: GenerateBulletReframeInput,
): Promise<GenerateResult> {
  // STUB: deterministic placeholder. Replace with real Claude call in Stage 2c.
  const orig = input.item.original_bullet.slice(0, 80)
  const resp = input.userResponse.slice(0, 100)
  return {
    drafts: [`[STUB REFRAME] ${orig} — using user response: "${resp}"`],
    questionAsked:
      "What was the specific outcome of this work, and what tools did you use?",
  }
}

// ============================================================================
// Pattern C — gap discussion drafting
// ============================================================================

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
 * STUB v0.1: returns 1 deterministic fake bullet + a static
 * questionAsked. Real Claude Haiku integration in Stage 2c per FRD §6.7.3.
 *
 * Per FRD §6.7.3:
 *   - Output: 1 new bullet OR 1 skill addition
 *   - Constraint: facts from resumeText + userResponse only
 *   - Model: Claude Haiku
 *   - Token budget: ~150 output tokens
 */
export async function generateGapResponse(
  input: GenerateGapResponseInput,
): Promise<GenerateResult> {
  // STUB: deterministic placeholder. Replace with real Claude call in Stage 2c.
  const gap = input.item.gap_description.slice(0, 80)
  const resp = input.userResponse.slice(0, 100)
  return {
    drafts: [`[STUB GAP BULLET] Addresses "${gap}" via user response: "${resp}"`],
    questionAsked:
      "Have you done work that demonstrates this skill, even if not explicitly labeled?",
  }
}
