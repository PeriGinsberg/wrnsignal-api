// lib/positioning/v2/phase2/costPolicy.ts
//
// Centralized AI cost constants for Phase 2. Extracted from the route
// handler + groundingValidator + aiClient so cost policy lives in one
// reviewable place.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.12 — AI cost tracking and cap (per-run ceiling rationale)
//   §6.6  — /draft endpoint cost-check timing
//
// Pure constants only — no I/O, no logic.

/**
 * Per-attempt AI cost in cents (fallback constant).
 *
 * Originally a placeholder for v0.1 before real Claude integration. Stage
 * 2c shipped token-accurate cost via centsForUsage(usage). This constant
 * is retained as a fallback for call sites that don't have a usage object
 * available (e.g., grounding-failed-after-retry where we increment a
 * coarse attempt count rather than per-call usage).
 *
 * With MAX_COST_CENTS=50 this gives users ~50 attempts per phase2_run
 * before the cap fires — well above typical workflow usage.
 *
 * @deprecated Used as fallback when usage data unavailable. Prefer
 * centsForUsage() with real usage object.
 */
export const COST_CENTS_PER_ATTEMPT = 1

/**
 * Per-run AI cost cap in cents. Per FRD §6.12 initial proposal: $0.50.
 *
 * Enforced server-side in /draft. Pre-check only — the current call may
 * push cumulative cost ABOVE the cap; the NEXT call returns 429. See
 * /draft route.ts step 10 for enforcement logic.
 *
 * Tunable post-launch per FRD §12.7 — review phase2_runs.ai_cost_cents
 * distribution after first 10 completed runs.
 */
export const MAX_COST_CENTS = 50

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
 * If Anthropic changes pricing, update this constant. Stage 2c+ telemetry
 * (phase2_runs.ai_cost_cents distribution) will surface drift if the
 * constant becomes stale.
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
 * Schema constraint: phase2_runs.ai_cost_cents is INTEGER NOT NULL. The
 * Math.ceil + integer return contract matches that constraint.
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
