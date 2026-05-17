// lib/positioning/v2/phase2/anthropicClient.ts
//
// Low-level Claude API helper for Phase 2. Wraps a single fetch call to
// Anthropic's /v1/messages endpoint with the request shape Phase 2 needs:
// system prompt + user message + max_tokens + temperature.
//
// FRD: docs/Features/positioning-phase2-frd.md §6.7 (model, token budgets)
//
// Architectural references:
//   - app/api/jobfit/bulletGeneratorV5.ts — existing Claude integration
//     pattern in this repo (raw fetch, no SDK, x-api-key header,
//     anthropic-version: 2023-06-01, fence-strip via String.fromCharCode
//     to avoid Turbopack parse error)
//   - lib/positioning/v2/phase2/prompts/systemPrompt.ts — SYSTEM_PROMPT
//     constant the caller passes here
//   - lib/positioning/v2/phase2/prompts/{headline,bullet,gap}Prompt.ts —
//     user prompt builders + MAX_TOKENS_* constants the caller passes here
//
// Design choices (per Stage 2c Commit 2 planning):
//   - Returns RAW TEXT (after markdown fence-strip), not parsed JSON.
//     Caller is responsible for JSON.parse. Keeps this helper general-
//     purpose; future call sites might want non-JSON output.
//   - NO retry inside this helper. Caller (aiClient) decides retry policy.
//     Anthropic 429s, network errors, etc. all surface immediately.
//   - NO explicit timeout. Vercel's default bounds the upper limit. Add
//     AbortController if real-world data shows long tail.
//   - System prompt passed via Anthropic's top-level `system` parameter
//     (idiomatic). Differs from bulletGeneratorV5 which inlines system
//     into the user message.
//
// Pure-ish: side effect is the HTTP call. No DB, no state. Deterministic
// given fixed inputs and fixed Anthropic response.

/**
 * Claude Haiku 4.5 model id. Matches bulletGeneratorV5's MODEL constant
 * for consistency. Pricing per Anthropic docs (verified 2026-05-17):
 *   Input: $1 / MTok, Output: $5 / MTok
 */
export const MODEL = "claude-haiku-4-5-20251001"

/** Anthropic API version header value. Pinned to match bulletGeneratorV5. */
export const ANTHROPIC_VERSION = "2023-06-01"

/**
 * Custom error class for non-200 Anthropic responses. Caller can catch
 * with `instanceof InvokeClaudeError` to access status + body for
 * structured handling (e.g., retry on 429, log on 500).
 */
export class InvokeClaudeError extends Error {
  constructor(public status: number, public body: string) {
    // Truncate body in default message to keep error logs readable; full
    // body is available on the .body property for callers that need it.
    super(`Anthropic API error: ${status} ${body.slice(0, 200)}`)
    this.name = "InvokeClaudeError"
  }
}

export type InvokeClaudeInput = {
  /** System prompt sent as Anthropic's top-level `system` parameter. */
  systemPrompt: string
  /** User message content. */
  userPrompt: string
  /** Max output tokens. Pass MAX_TOKENS_HEADLINE / MAX_TOKENS_BULLET / MAX_TOKENS_GAP. */
  maxTokens: number
  /**
   * Sampling temperature. Stage 2c retry policy: first attempt 0.7,
   * retry 1.0. Caller (aiClient) controls the value per attempt.
   */
  temperature: number
  /**
   * Optional fetch implementation override for testing. Defaults to
   * globalThis.fetch. Tests can pass a mock to avoid real API calls.
   */
  fetchImpl?: typeof fetch
}

export type InvokeClaudeResult = {
  /**
   * Raw text content from the response, after markdown fence-strip
   * (` ```json ` and ` ``` ` removed). Caller is responsible for
   * JSON.parse if structured output is expected.
   */
  text: string
  /** Token usage from the response. Use centsForUsage() to convert to cents. */
  usage: {
    input_tokens: number
    output_tokens: number
  }
  /** Elapsed wall-clock time for the API call. For logging/observability. */
  latencyMs: number
}

/**
 * Invoke Claude Haiku and return raw text + usage + latency.
 *
 * Failure modes:
 *   - Missing ANTHROPIC_API_KEY → throws plain Error (configuration bug)
 *   - Non-200 from Anthropic → throws InvokeClaudeError with status + body
 *   - Network error / fetch throws → bubbles up
 *   - Empty content array → returns text="" (caller decides if that's OK)
 *
 * Markdown fence stripping uses the String.fromCharCode(96) trick from
 * bulletGeneratorV5 to avoid Turbopack mis-parsing literal backticks in
 * the source file.
 *
 * @param input systemPrompt + userPrompt + maxTokens + temperature
 * @returns text + usage + latencyMs
 * @throws InvokeClaudeError on non-200 responses
 * @throws Error on missing API key or fetch failure
 */
export async function invokeClaude(
  input: InvokeClaudeInput,
): Promise<InvokeClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      "invokeClaude: ANTHROPIC_API_KEY env var not set",
    )
  }

  const doFetch = input.fetchImpl ?? globalThis.fetch

  const t0 = Date.now()
  const res = await doFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.userPrompt }],
    }),
  })
  const latencyMs = Date.now() - t0

  if (!res.ok) {
    const body = await res.text().catch(() => "(failed to read body)")
    throw new InvokeClaudeError(res.status, body)
  }

  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }

  // Concatenate all text-typed content blocks (Anthropic can return
  // multiple if the response uses tool use or thinking blocks; for
  // Phase 2 we only expect one text block but handle multi-block defensively).
  const rawText = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => String(b.text ?? ""))
    .join("")

  // Strip markdown fences. Backtick char built via fromCharCode to avoid
  // Turbopack parse error if literal backticks appear in source file
  // (per bulletGeneratorV5 precedent).
  const tick = String.fromCharCode(96)
  const fence = tick + tick + tick
  const text = rawText
    .split(fence + "json")
    .join("")
    .split(fence)
    .join("")
    .trim()

  const usage = {
    input_tokens: json.usage?.input_tokens ?? 0,
    output_tokens: json.usage?.output_tokens ?? 0,
  }

  return { text, usage, latencyMs }
}
