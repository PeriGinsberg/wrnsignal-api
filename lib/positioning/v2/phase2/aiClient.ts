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
// REAL CLAUDE INTEGRATION (Stage 2c Commit 3):
//   - Each pattern builds its user prompt via lib/positioning/v2/phase2/
//     prompts/<pattern>Prompt.ts (Commit 1) and posts to Anthropic via
//     invokeClaude() (Commit 2 — lib/positioning/v2/phase2/anthropicClient.ts)
//   - Temperature: 0.7 first attempt, 1.0 on retry (caller signals via
//     isRetry flag). Bumping temperature on retry gives genuine output
//     variation rather than re-rolling the same near-deterministic draft.
//   - Returns usage in result for token-accurate cost tracking. Commit 5
//     migrates /draft route from COST_CENTS_PER_ATTEMPT to
//     centsForUsage(result.usage).
//   - JSON parsing consolidated into parseClaudeResponse() — all defensive
//     paths (malformed JSON, missing/non-array drafts, non-string elements,
//     insufficient_source_evidence reason field, truncation to maxDrafts)
//     collapse to { drafts: [] } and surface to /draft as the grounding-
//     failed path.
//
// Mock injection: each function accepts an optional invokeClaudeImpl to
// allow unit tests to bypass the real API call (mirrors Commit 2's
// fetchImpl pattern). Production callers omit it and get the real
// invokeClaude.
//
// questionAsked: aiClient does NOT generate questions in Commit 3. The
// populator (lib/positioning/v2/phase2/itemPopulator.ts) is the source
// of truth for item.question_asked. /draft route's existing
// `result.questionAsked ?? item.question_asked` fallback handles the
// undefined case. v0.2 may add Claude-generated questions.
//
// Model: Claude Haiku 4.5 (claude-haiku-4-5-20251001). Chosen for latency
// and cost — Phase 2 generation outputs are short (150-200 tokens) and
// must complete inside the user's working tempo (FRD §4.5 target < 5s p50).

import {
  invokeClaude as defaultInvokeClaude,
  type InvokeClaudeInput,
  type InvokeClaudeResult,
} from "./anthropicClient"
import { SYSTEM_PROMPT } from "./prompts/systemPrompt"
import {
  buildHeadlinePrompt,
  MAX_TOKENS_HEADLINE,
} from "./prompts/headlinePrompt"
import {
  buildBulletPrompt,
  MAX_TOKENS_BULLET,
} from "./prompts/bulletPrompt"
import {
  buildGapPrompt,
  MAX_TOKENS_GAP,
} from "./prompts/gapPrompt"
import type {
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
} from "./types"

// ============================================================================
// Temperature schedule
// ============================================================================

/** First-attempt temperature. Conservative — favor on-prompt drafts. */
const TEMPERATURE_FIRST_ATTEMPT = 0.7
/** Retry temperature. Higher — give genuine output variation when first try failed grounding. */
const TEMPERATURE_RETRY = 1.0

// ============================================================================
// Unified return type for all three generation paths
// ============================================================================

/**
 * Result returned by every aiClient generation function.
 *   - drafts: 1-3 strings for Pattern A (headline); exactly 1 element for
 *     Patterns B and C (bullet/gap). Empty array on insufficient-evidence
 *     or any defensive parse failure (caller treats as grounding-failed).
 *   - questionAsked: Present in the type for backwards compat with /draft
 *     route's fallback chain. NOT set by Commit 3 — Claude does not
 *     generate questions. Populator's item.question_asked is the source
 *     of truth.
 *   - usage: Token usage from the Anthropic API call. Always present when
 *     a GenerateResult is returned (only absent when aiClient throws,
 *     which happens iff invokeClaude itself threw).
 */
export type GenerateResult = {
  drafts: string[]
  questionAsked?: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

// ============================================================================
// Shared response parser
// ============================================================================

type ParsedDrafts = { drafts: string[] }

/**
 * Parse Claude's response text into a normalized drafts array. All defensive
 * paths (malformed JSON, missing fields, type mismatches, insufficient
 * evidence) collapse to { drafts: [] } so the caller has a single signal
 * for "no usable drafts" without inspecting parse internals.
 *
 * Truncates drafts.length > maxDrafts with a console.warn (FRD §6.7.1 caps
 * headline at 3 options; B/C at 1).
 */
function parseClaudeResponse(
  text: string,
  opts: { maxDrafts: number },
): ParsedDrafts {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { drafts: [] }
  }

  if (!parsed || typeof parsed !== "object") {
    return { drafts: [] }
  }

  const obj = parsed as Record<string, unknown>

  // Intended empty: model returned the insufficient-evidence escape hatch.
  if (obj.reason === "insufficient_source_evidence") {
    return { drafts: [] }
  }

  if (!Array.isArray(obj.drafts)) {
    return { drafts: [] }
  }

  const stringDrafts = obj.drafts.filter(
    (d): d is string => typeof d === "string" && d.trim().length > 0,
  )

  if (stringDrafts.length === 0) {
    return { drafts: [] }
  }

  if (stringDrafts.length > opts.maxDrafts) {
    console.warn(
      `[aiClient.parseClaudeResponse] truncating drafts ${stringDrafts.length} → ${opts.maxDrafts}`,
    )
    return { drafts: stringDrafts.slice(0, opts.maxDrafts) }
  }

  return { drafts: stringDrafts }
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
  /** True if this is the retry attempt (per /draft loop). Affects temperature. */
  isRetry?: boolean
  /** Test-only: inject mock invokeClaude. Defaults to real implementation. */
  invokeClaudeImpl?: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
}

/**
 * Pattern A — generate 1-3 reframed headline options.
 *
 * Per FRD §6.7.1:
 *   - Output: 1-3 reframed headline options
 *   - Constraint: evidence-grounded — anchored in skills present in resumeText
 *   - Model: Claude Haiku 4.5
 *   - Token budget: MAX_TOKENS_HEADLINE (300 — covers ~200 output + JSON wrapper)
 *
 * Insufficient evidence / malformed response → drafts: [], usage still reported.
 */
export async function generateHeadlineOptions(
  input: GenerateHeadlineOptionsInput,
): Promise<GenerateResult> {
  const userPrompt = buildHeadlinePrompt({
    resumeText: input.resumeText,
    jobDescription: input.jobDescription,
    originalHeadline: input.item.original,
  })

  const invoke = input.invokeClaudeImpl ?? defaultInvokeClaude
  const apiResult = await invoke({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: MAX_TOKENS_HEADLINE,
    temperature: input.isRetry ? TEMPERATURE_RETRY : TEMPERATURE_FIRST_ATTEMPT,
  })

  const parsed = parseClaudeResponse(apiResult.text, { maxDrafts: 3 })
  return {
    drafts: parsed.drafts,
    usage: apiResult.usage,
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
  /** True if this is the retry attempt. Affects temperature. */
  isRetry?: boolean
  /** Test-only: inject mock invokeClaude. */
  invokeClaudeImpl?: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
}

/**
 * Pattern B — draft a reframed bullet from the user's response.
 *
 * Per FRD §6.7.2:
 *   - Output: 1 reframed bullet
 *   - Constraint: facts from original_bullet + userResponse only (resume
 *     marked context-only in the prompt; groundingValidator enforces)
 *   - Model: Claude Haiku 4.5
 *   - Token budget: MAX_TOKENS_BULLET (250)
 *
 * questionAsked NOT set — populator's item.question_asked is source of truth.
 */
export async function generateBulletReframe(
  input: GenerateBulletReframeInput,
): Promise<GenerateResult> {
  const userPrompt = buildBulletPrompt({
    resumeText: input.resumeText,
    jobDescription: input.jobDescription,
    originalBullet: input.item.original_bullet,
    jdContext: input.item.jd_context,
    userResponse: input.userResponse,
  })

  const invoke = input.invokeClaudeImpl ?? defaultInvokeClaude
  const apiResult = await invoke({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: MAX_TOKENS_BULLET,
    temperature: input.isRetry ? TEMPERATURE_RETRY : TEMPERATURE_FIRST_ATTEMPT,
  })

  const parsed = parseClaudeResponse(apiResult.text, { maxDrafts: 1 })
  return {
    drafts: parsed.drafts,
    usage: apiResult.usage,
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
  /** True if this is the retry attempt. Affects temperature. */
  isRetry?: boolean
  /** Test-only: inject mock invokeClaude. */
  invokeClaudeImpl?: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
}

/**
 * Pattern C — draft a new bullet or skill addition from the user's
 * response to the probing question about a missing JD requirement.
 *
 * Per FRD §6.7.3:
 *   - Output: 1 new bullet OR 1 skill addition
 *   - Constraint: facts from userResponse only (gap by definition absent
 *     from resume; resume marked context-only in prompt)
 *   - Model: Claude Haiku 4.5
 *   - Token budget: MAX_TOKENS_GAP (250)
 */
export async function generateGapResponse(
  input: GenerateGapResponseInput,
): Promise<GenerateResult> {
  const userPrompt = buildGapPrompt({
    resumeText: input.resumeText,
    jobDescription: input.jobDescription,
    gapDescription: input.item.gap_description,
    jdContext: input.item.jd_context,
    userResponse: input.userResponse,
  })

  const invoke = input.invokeClaudeImpl ?? defaultInvokeClaude
  const apiResult = await invoke({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: MAX_TOKENS_GAP,
    temperature: input.isRetry ? TEMPERATURE_RETRY : TEMPERATURE_FIRST_ATTEMPT,
  })

  const parsed = parseClaudeResponse(apiResult.text, { maxDrafts: 1 })
  return {
    drafts: parsed.drafts,
    usage: apiResult.usage,
  }
}
