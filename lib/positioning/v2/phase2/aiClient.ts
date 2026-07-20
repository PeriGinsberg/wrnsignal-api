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
} from "@/lib/ai/anthropicClient"
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
import {
  buildSuggestBulletsForGapPrompt,
  MAX_TOKENS_SUGGEST_BULLETS,
} from "./prompts/suggestBulletsForGapPrompt"
import {
  buildClassifyGapShapePrompt,
  MAX_TOKENS_CLASSIFY_GAP_SHAPE,
} from "./prompts/classifyGapShapePrompt"
import type {
  GapShape,
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

/**
 * suggestBulletsForGap temperatures. Lower than the draft-generation paths
 * because we want grounded SELECTION (verbatim picking from the resume),
 * not creative variation. Even on retry the temperature stays modest —
 * if the model can't find good matches, we'd rather it return an empty
 * array than start paraphrasing under high-temp pressure (the verbatim
 * filter would drop them anyway).
 */
const TEMPERATURE_SUGGEST_BULLETS_FIRST = 0.3
const TEMPERATURE_SUGGEST_BULLETS_RETRY = 0.7

/**
 * classifyGapShape temperatures. Lowest of any Phase 2 path because
 * classification is deterministic — given the gap text + context, the
 * shape should be a stable 1-of-7 pick. First attempt = 0.0 (true greedy
 * decoding). Retry bumps modestly to nudge the model off a wrong-but-
 * confident first answer without inviting genuine variation. If the
 * model still can't decide on retry, the caller's "unknown → fallback
 * to experience" path handles it.
 */
const TEMPERATURE_CLASSIFY_GAP_SHAPE_FIRST = 0.0
const TEMPERATURE_CLASSIFY_GAP_SHAPE_RETRY = 0.3

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
// A3 — bullet suggestion for gap reword (populator-time)
// ============================================================================

/**
 * Maximum number of bullet suggestions returned. Frontend's bullet-picker
 * UX (D2) defaults to a "top 3" display when the user picks
 * `reword_existing_bullet` as the compositional outcome. Cap matches.
 */
const MAX_SUGGESTED_BULLETS = 3

export type SuggestBulletsForGapInput = {
  /** Description of the gap being addressed. PhaseTwoGapItem.gap_description. */
  gapDescription: string
  /** JD excerpt motivating this gap. PhaseTwoGapItem.jd_context. */
  jdContext: string
  /**
   * Full resume text (persona.resume_text). PRIMARY source — every returned
   * suggestion must be a verbatim substring of this string. Post-parse
   * filter drops non-verbatim entries.
   */
  resumeText: string
  /** True if this is the retry attempt. Affects temperature. */
  isRetry?: boolean
  /** Test-only: inject mock invokeClaude. */
  invokeClaudeImpl?: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
}

export type SuggestBulletsForGapResult = {
  /**
   * 0-3 verbatim resume bullet substrings ordered by Claude's relevance
   * judgment. Empty array means either the model returned no matches OR
   * every returned candidate failed the verbatim filter — caller can
   * treat both cases identically (frontend falls back to "show all
   * bullets" if the picker has no top-3).
   */
  suggestions: string[]
  /** Token usage from the Anthropic API call. Feeds centsForUsage(). */
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

/**
 * Surface up to 3 existing resume bullets most relevant to a gap. Called
 * at populator time (Phase 2 v1 build A3) so the suggestions are cached
 * on phase2_runs.state.items[N].suggested_bullets_for_reword and the
 * frontend doesn't pay a per-click AI latency when the user opens the
 * gap-detail screen.
 *
 * Architectural contract (load-bearing):
 *   Every returned suggestion is a CHARACTER-FOR-CHARACTER substring of
 *   `resumeText`. The model is instructed to return verbatim picks and
 *   this function post-filters anything that fails the invariant. If
 *   every candidate fails, returns suggestions=[]; the cost is still
 *   reported in `usage` (the API call happened).
 *
 * Defensive paths (all collapse to suggestions=[], usage still reported):
 *   - Malformed JSON, missing `drafts` field, non-string elements →
 *     parseClaudeResponse returns []. Filter step gets nothing to
 *     verify.
 *   - All candidates fail verbatim check → filter drops everything.
 *   - More than 3 verbatim candidates → cap at 3 in original order.
 *
 * Does NOT retry internally. Caller (itemPopulator) decides retry policy.
 */
export async function suggestBulletsForGap(
  input: SuggestBulletsForGapInput,
): Promise<SuggestBulletsForGapResult> {
  const userPrompt = buildSuggestBulletsForGapPrompt({
    gapDescription: input.gapDescription,
    jdContext: input.jdContext,
    resumeText: input.resumeText,
  })

  const invoke = input.invokeClaudeImpl ?? defaultInvokeClaude
  const apiResult = await invoke({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: MAX_TOKENS_SUGGEST_BULLETS,
    temperature: input.isRetry
      ? TEMPERATURE_SUGGEST_BULLETS_RETRY
      : TEMPERATURE_SUGGEST_BULLETS_FIRST,
  })

  // Parse first (handles all the standard defensive cases: malformed
  // JSON, missing field, non-string elements). MAX_SUGGESTED_BULLETS is
  // the parse-stage cap — we may still drop more in the verbatim filter
  // below.
  const parsed = parseClaudeResponse(apiResult.text, {
    maxDrafts: MAX_SUGGESTED_BULLETS,
  })

  // Verbatim filter. Every candidate must be a substring of resumeText.
  // Defensive against:
  //   - Model paraphrased despite the instruction (drop)
  //   - Model added bullet glyphs or normalized whitespace (drop — the
  //     stored suggestion must be a locate-and-replace anchor and any
  //     normalization breaks that)
  //   - resumeText being empty (every candidate fails; suggestions=[])
  const resume = typeof input.resumeText === "string" ? input.resumeText : ""
  const verbatim = parsed.drafts.filter(
    (d) => d.length > 0 && resume.includes(d),
  )

  return {
    suggestions: verbatim.slice(0, MAX_SUGGESTED_BULLETS),
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

// ============================================================================
// G1 — gap_shape classification (populator-time, LLM fallback only)
// ============================================================================

/**
 * The seven legal shape values. Used by the local response parser to
 * reject malformed Claude responses without coupling to the GapShape
 * type's literal-union narrowing (Set<string> comparison is cheaper than
 * a switch over the union).
 */
const VALID_GAP_SHAPES: ReadonlySet<GapShape> = new Set([
  "experience",
  "skill",
  "certification",
  "tool",
  "language",
  "coursework",
  "unknown",
])

export type ClassifyGapShapeInput = {
  /** Description of the gap to classify. PhaseTwoGapItem.gap_description. */
  gapDescription: string
  /** JD excerpt anchoring the gap. PhaseTwoGapItem.jd_context. */
  jdContext: string
  /** True if this is the retry attempt. Affects temperature. */
  isRetry?: boolean
  /** Test-only: inject mock invokeClaude. */
  invokeClaudeImpl?: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
}

export type ClassifyGapShapeResult = {
  /**
   * Classified shape. "unknown" is returned on either (a) the model
   * explicitly returning {"shape":"unknown"} or (b) any defensive parse
   * failure (malformed JSON, missing field, illegal shape value). The
   * caller's heuristic-fallback logic is responsible for promoting
   * "unknown" to a usable shape ("experience" is the safest default per
   * the kickoff spec).
   */
  shape: GapShape
  /** Token usage from the Anthropic API call. Feeds centsForUsage(). */
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

/**
 * Parse Claude's classification response. Tight local parser (not the
 * shared parseClaudeResponse) because the output shape is `{"shape": X}`
 * rather than `{"drafts": [...]}`. All defensive paths collapse to
 * `shape: "unknown"` — the caller can't distinguish "model said unknown"
 * from "model returned garbage", which is fine: both bypass the
 * heuristic and feed the same fallback default.
 */
function parseShapeResponse(text: string): GapShape {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return "unknown"
  }
  if (!parsed || typeof parsed !== "object") return "unknown"
  const shape = (parsed as { shape?: unknown }).shape
  if (typeof shape !== "string") return "unknown"
  if (!VALID_GAP_SHAPES.has(shape as GapShape)) return "unknown"
  return shape as GapShape
}

/**
 * Classify the structural shape of a gap via Claude. Called by the
 * classifyGapShape orchestrator (lib/positioning/v2/phase2/
 * itemPopulatorParts/classifyGapShape.ts) only when the deterministic
 * heuristic returns low confidence or unclassified — most gaps never
 * reach this method.
 *
 * Defensive paths (all collapse to shape="unknown", usage still reported):
 *   - Malformed JSON, missing/wrong-type `shape` field → "unknown".
 *   - Model returned an illegal shape value (e.g. "executive") → "unknown".
 *
 * Does NOT retry internally. Caller (the orchestrator) decides retry
 * policy. Errors thrown by invokeClaude propagate — caller catches.
 */
export async function classifyGapShape(
  input: ClassifyGapShapeInput,
): Promise<ClassifyGapShapeResult> {
  const userPrompt = buildClassifyGapShapePrompt({
    gapDescription: input.gapDescription,
    jdContext: input.jdContext,
  })

  const invoke = input.invokeClaudeImpl ?? defaultInvokeClaude
  const apiResult = await invoke({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: MAX_TOKENS_CLASSIFY_GAP_SHAPE,
    temperature: input.isRetry
      ? TEMPERATURE_CLASSIFY_GAP_SHAPE_RETRY
      : TEMPERATURE_CLASSIFY_GAP_SHAPE_FIRST,
  })

  return {
    shape: parseShapeResponse(apiResult.text),
    usage: apiResult.usage,
  }
}
