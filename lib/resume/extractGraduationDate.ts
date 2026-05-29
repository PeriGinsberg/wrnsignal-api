// lib/resume/extractGraduationDate.ts
//
// Focused graduation-date extractor for cover letter + networking. Calls
// Claude Haiku with a tight prompt and returns a normalized ParsedGradDate
// (or null). Designed to be called per-generation (Option A storage) so
// callers don't have to manage a schema column or invalidation. Cost ≈
// 0.35¢/call (Haiku pricing) with low latency; the cover letter and
// networking routes parallelize this with their other fetches.
//
// NOT a reuse of resume-rx's inline extraction — that one is bundled
// inside a 30-field diagnosis on Sonnet 4 with 6000 max_tokens, gated
// behind the resume-rx UX flow, and returns unnormalized free text. This
// helper is the focused equivalent: same prompting approach at a tighter
// scope, on the cheaper model, with parsed year/month/type so downstream
// computeStatus can branch deterministically.
//
// Design:
//   - Model: Haiku via invokeClaude. Temperature 0.0 (date extraction is
//     deterministic — same resume should yield the same date every call).
//   - Output schema: { found, raw, year, month, type, confidence }.
//   - Defensive parsing: any malformed model output → null. The caller's
//     fallback chain (career_stage → "unknown") handles nulls.
//   - Empty resume text skips the API call entirely (returns null + zero
//     usage). Cover letter / networking pass resume_text that may be ""
//     for legacy zero-persona profiles.
//
// The `type` field distinguishes expected (future intent: "Expected May
// 2026", "Class of 2027" with future year) from completed (past-tense
// degree statements) from unknown (bare date with no cue). It is advisory:
// the authoritative student-vs-graduated call comes from
// computeStatus(parsedDate, today), which uses the date itself. `type`
// only matters as a tiebreaker when the date is year-only and same as
// the current year.
//
// Mock injection mirrors Phase 2's aiClient pattern: tests pass
// invokeClaudeImpl to avoid real API calls.

import {
  invokeClaude as defaultInvokeClaude,
  type InvokeClaudeInput,
  type InvokeClaudeResult,
} from "@/lib/positioning/v2/phase2/anthropicClient"

// ============================================================================
// Tuning
// ============================================================================

/** System prompt — short, role-anchored. */
const SYSTEM_PROMPT =
  "You extract graduation dates from resumes. Return only JSON matching the requested schema. No commentary, no markdown."

/** Output is ~50 tokens of JSON; 200 leaves headroom for malformed runs. */
const MAX_TOKENS = 200

/** 0.0 — date extraction is deterministic; same resume → same date every call. */
const TEMPERATURE = 0.0

// ============================================================================
// Types
// ============================================================================

/**
 * Normalized graduation date. Returned by extractGraduationDate when a
 * date is found and the model output passes defensive validation. Callers
 * should treat null as "no date available" and fall back to career_stage.
 *
 * - raw: the verbatim string from the resume the model parsed (e.g.
 *   "Expected May 2026"). Preserved so we can surface what was extracted
 *   in logs / diagnostics.
 * - year: 4-digit year, 1900–2100. Required.
 * - month: 1–12 if a specific month was given; null for year-only
 *   ("Class of 2025"). computeStatus's same-year tiebreaker uses this.
 * - type: model's classification of intent. "expected" = future, "completed"
 *   = past-tense degree statement, "unknown" = bare date with no cue.
 *   Used by computeStatus only as a tiebreaker for year-only + same-year
 *   inputs.
 * - confidence: model's self-rating. "high" = unambiguous direct date,
 *   "low" = inferred from a range or ambiguous phrasing. Advisory only;
 *   no current consumer reads it but kept for future telemetry.
 */
export type ParsedGradDate = {
  raw: string
  year: number
  month: number | null
  type: "expected" | "completed" | "unknown"
  confidence: "high" | "low"
}

export type ExtractGraduationDateInput = {
  /** Resume body text. Empty string short-circuits to null without API call. */
  resumeText: string
  /** Test-only: inject mock invokeClaude. Defaults to real implementation. */
  invokeClaudeImpl?: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
}

export type ExtractGraduationDateResult = {
  /** Parsed date or null. Null on: no date found, malformed JSON, validation failure, empty resume. */
  result: ParsedGradDate | null
  /** Token usage from the API call. Feeds centsForUsage() for cost logging. Zero when short-circuited. */
  usage: { input_tokens: number; output_tokens: number }
  /** Elapsed wall-clock time for the API call. Zero when short-circuited. */
  latencyMs: number
}

// ============================================================================
// Prompt
// ============================================================================

function buildUserPrompt(resumeText: string): string {
  return `Extract the candidate's graduation date from this resume.

Find the EDUCATION section. Identify the most recent / authoritative graduation entry. If multiple degrees, pick the highest / most recent one.

Return JSON only matching this exact schema:
{
  "found": boolean,
  "raw": string,
  "year": number,
  "month": number | null,
  "type": "expected" | "completed" | "unknown",
  "confidence": "high" | "low"
}

Rules:
- "found": true only if you can extract at least a year tied to a graduation entry. False if the resume has no education section, no graduation date, or only date ranges that don't include a graduation year.
- "raw": the verbatim string from the resume that you parsed (e.g. "Expected May 2026", "May 2024", "Class of 2025"). Include leading words like "Expected" or "Anticipated" when present.
- "year": the 4-digit year (e.g. 2026). Required when found is true.
- "month": 1-12 if a specific month is given, null if only a year (e.g. "Class of 2025").
- "type":
  - "expected" if the resume explicitly uses future-intent framing: "Expected", "Anticipated", "Projected", "to be completed", "in progress".
  - "completed" if past-tense framing: "Graduated", "B.S. awarded", "Degree conferred", or a year clearly tied to a past-tense degree statement.
  - "unknown" if the date string is bare (e.g. "May 2024" alone, or "Class of 2025") with no expected/completed cue.
- "confidence": "high" when the date is unambiguous and tied directly to graduation. "low" when you had to infer from a date range or ambiguous phrasing.

When found is false, set raw="", year=0, month=null, type="unknown", confidence="low".

Resume:
${resumeText}`
}

// ============================================================================
// Response parser (defensive)
// ============================================================================

/**
 * Parse Claude's response into a normalized ParsedGradDate or null. All
 * defensive paths collapse to null so the caller has a single signal for
 * "no usable date" without inspecting parse internals.
 *
 * Validation:
 *   - JSON parse failure → null
 *   - Non-object result → null
 *   - found !== true → null (model said no date present)
 *   - year missing / non-integer / out of 1900–2100 → null
 *   - month: coerced to null when missing or out of 1–12 (keep the
 *     result; year is sufficient)
 *   - type: coerced to "unknown" when malformed
 *   - confidence: coerced to "low" when malformed
 */
function parseResponse(text: string): ParsedGradDate | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const obj = parsed as Record<string, unknown>

  // Model returned found=false (or omitted it).
  if (obj.found !== true) return null

  // Year is the load-bearing field — null result if it's missing or invalid.
  const year = obj.year
  if (typeof year !== "number" || !Number.isInteger(year)) return null
  if (year < 1900 || year > 2100) return null

  // Month is optional. Coerce malformed to null but keep the result.
  const monthRaw = obj.month
  const month: number | null =
    monthRaw === null || monthRaw === undefined
      ? null
      : typeof monthRaw === "number" &&
          Number.isInteger(monthRaw) &&
          monthRaw >= 1 &&
          monthRaw <= 12
        ? monthRaw
        : null

  const raw = typeof obj.raw === "string" ? obj.raw.trim() : ""

  const type: ParsedGradDate["type"] =
    obj.type === "expected" || obj.type === "completed" || obj.type === "unknown"
      ? (obj.type as ParsedGradDate["type"])
      : "unknown"

  const confidence: ParsedGradDate["confidence"] =
    obj.confidence === "high" || obj.confidence === "low"
      ? (obj.confidence as ParsedGradDate["confidence"])
      : "low"

  return { raw, year, month, type, confidence }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract the candidate's graduation date from a resume.
 *
 * Empty / whitespace resumeText short-circuits to {result: null, usage: 0}
 * — no API call is made. Otherwise calls Haiku via invokeClaude, parses
 * defensively, returns the parsed date or null.
 *
 * The returned `usage` lets the caller log cost via centsForUsage().
 * Latency is included for observability.
 *
 * Errors from invokeClaude (missing API key, non-200 from Anthropic, fetch
 * failure) propagate — caller decides whether to absorb or surface.
 */
export async function extractGraduationDate(
  input: ExtractGraduationDateInput,
): Promise<ExtractGraduationDateResult> {
  const text = typeof input.resumeText === "string" ? input.resumeText : ""
  if (!text.trim()) {
    return {
      result: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      latencyMs: 0,
    }
  }

  const invoke = input.invokeClaudeImpl ?? defaultInvokeClaude
  const apiResult = await invoke({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(text),
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  })

  return {
    result: parseResponse(apiResult.text),
    usage: apiResult.usage,
    latencyMs: apiResult.latencyMs,
  }
}
