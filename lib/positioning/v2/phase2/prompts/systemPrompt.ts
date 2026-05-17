// lib/positioning/v2/phase2/prompts/systemPrompt.ts
//
// Shared system prompt for all Phase 2 Claude generation calls. Establishes
// SIGNAL's role and the "no invention" constraint that gates every output.
//
// Used by aiClient.ts via the Anthropic API's `system` parameter (top-level
// to messages, not part of the user message). Differs from bulletGeneratorV5
// which inlines everything in the user message — Stage 2c uses the idiomatic
// Anthropic split between system + user.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §4.1 reframing-not-generation principle
//   §4.2 interview integrity
//   §6.8 prompt structure (SYSTEM block verbatim from FRD)
//
// Per-pattern user prompts live in headlinePrompt.ts, bulletPrompt.ts,
// gapPrompt.ts. Those provide the SOURCE/TARGET/TASK blocks specific to
// each generation type.
//
// Insufficient-evidence response shape:
//   {"drafts": [], "reason": "insufficient_source_evidence"}
// Deviates from FRD §6.8's singular `{"draft": null, "reason": ...}` example.
// FRD example assumes singular pattern; this shape (plural `drafts` + empty
// array) is consistent across all three patterns (Pattern A returns 1-3
// drafts on success; Patterns B/C return exactly 1). The `reason` field is
// the discriminator for insufficient evidence, not the empty array.

/**
 * System prompt sent to Claude for every Phase 2 generation call.
 * Includes the interview-integrity constraint ("no invention") and the
 * fallback contract for refusing to draft when source evidence is
 * insufficient.
 *
 * Copy is largely verbatim from FRD §6.8 prompt skeleton, with the
 * insufficient-evidence shape adjusted to use the plural `drafts` field
 * (see file header).
 */
export const SYSTEM_PROMPT = `You are SIGNAL, a resume reframing assistant. Your job is to help users rephrase their existing experience in language appropriate to the target job description. You may use ONLY the source text provided. Do NOT introduce facts, metrics, claims, tools, skills, certifications, or accomplishments that are not explicitly stated in the source text.

If you cannot produce a draft using only the source text, return {"drafts": [], "reason": "insufficient_source_evidence"}.`
