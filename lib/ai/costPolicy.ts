// lib/ai/costPolicy.ts
//
// Centralized AI cost constants, so cost policy lives in one reviewable
// place rather than being spread across call sites.
//
// Written for Positioning v2 phase 2, which was never built and has been
// abandoned (docs/positioning-v2-abandoned.md). The per-attempt and per-run
// cap constants went with it — they guarded a /draft endpoint and a
// phase2_runs table, neither of which exists. What survives is the pricing
// math, which is live: app/api/interviews/[id]/prep/generate,
// app/api/networking and app/api/coverletter all log cost via
// centsForUsage().
//
// Pure constants only — no I/O, no logic.

// ============================================================================
// Token-accurate cost (Stage 2c onward)
// ============================================================================

/**
 * Claude Haiku 4.5 input cost in cents per million tokens.
 *
 * Source: Anthropic pricing page (https://platform.claude.com/docs/en/
 * about-claude/pricing). Verified 2026-05-17.
 *
 * Pricing: $1 per MTok input → 100 cents per MTok → 0.0001 cents per token.
 *
 * If Anthropic changes pricing, update this constant. The cost lines logged
 * by the live callers are the only drift signal now that phase2_runs is gone.
 */
export const HAIKU_INPUT_CENTS_PER_MTOK = 100

/**
 * Claude Haiku 4.5 output cost in cents per million tokens.
 *
 * Source: Anthropic pricing page. Verified 2026-05-17.
 *
 * Pricing: $5 per MTok output → 500 cents per MTok → 0.0005 cents per token.
 */
export const HAIKU_OUTPUT_CENTS_PER_MTOK = 500

/**
 * Convert Claude API usage (input_tokens + output_tokens) to integer cents.
 *
 * Uses Math.ceil to avoid undercount — fractional cents always round up so
 * cumulative ai_cost_cents tracking can't drift below true cost. With
 * Haiku pricing, typical Phase 2 generation (~500 input + ~200 output)
 * costs ~0.15 cents per attempt, which Math.ceil rounds to 1 cent.
 *
 * Integer return contract: interview_prep_runs.cost_cents is an integer
 * column, so Math.ceil keeps the value storable without a cast.
 *
 * @param usage { input_tokens, output_tokens } from invokeClaude result
 * @returns integer cents (>= 0)
 */
export function centsForUsage(usage: {
  input_tokens: number
  output_tokens: number
}): number {
  const inputCents =
    (usage.input_tokens * HAIKU_INPUT_CENTS_PER_MTOK) / 1_000_000
  const outputCents =
    (usage.output_tokens * HAIKU_OUTPUT_CENTS_PER_MTOK) / 1_000_000
  return Math.ceil(inputCents + outputCents)
}
