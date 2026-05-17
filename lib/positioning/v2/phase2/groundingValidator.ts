// lib/positioning/v2/phase2/groundingValidator.ts
//
// Server-side validation that an AI-generated draft contains only facts
// traceable to the allowed source set. Enforces the interview-integrity
// principle (FRD §4.2) — every claim in the revised resume must be
// defensible by the user in an interview, which means it must originate
// from the original resume or text the user typed.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.8 — grounding validation contract (the algorithm)
//   §4.2 — interview integrity (the why)
//   §6.7 — AI integration retry policy (uses this validator)
//   §6.9.1 — manual-entry mode (the downstream UX when validation fails
//            after retry)
//   §11 — grounding validator telemetry (operational pattern)
//
// Conservative-validator principle: the validator errs toward rejecting
// borderline drafts rather than letting ungrounded claims through. False
// rejects degrade UX (more manual-entry-mode invocations) but never
// produce interview-integrity violations. False accepts are the failure
// mode that matters — those leak ungrounded claims into the revised
// resume. Tuning post-launch will follow the §11 telemetry pattern
// (review first 100 rejections, loosen if false-reject rate > 20%).
//
// SKELETON — Phase 2a commit. Real validation logic (entity extraction,
// allowed-source membership check, ungrounded-entity surfacing) lands in
// a later Stage 2 commit. Stub permissively returns { ok: true, draft }
// for any input. This is INTENTIONALLY permissive — Phase 2 cannot ship
// to live users until the real validator is wired (the interview-integrity
// guarantee depends on it). The skeleton exists so that aiClient and
// /draft endpoint code can be written against the real contract without
// being blocked on validator implementation.

// ============================================================================
// Result type
// ============================================================================

/**
 * Result of a grounding validation pass. Discriminated on `ok`:
 *   - ok=true: draft passed validation; the validated draft is echoed
 *     back (callers can use this shape consistently regardless of pass/fail)
 *   - ok=false: draft failed validation; ungrounded_entities lists the
 *     specific phrases/entities/claims that couldn't be traced to allowed
 *     sources. Empty array is permitted (validator may detect overall
 *     ungrounded-ness without itemizing entities).
 */
export type GroundingValidationResult =
  | { ok: true; draft: string }
  | { ok: false; ungrounded_entities: string[] }

// ============================================================================
// Validator
// ============================================================================

/**
 * Input shape for validateDraftGrounding.
 */
export type ValidateDraftGroundingInput = {
  /** The AI-generated draft to validate. */
  draft: string
  /**
   * Allowed source texts. The validator's job is to confirm that every
   * fact-bearing token in `draft` traces back to at least one of these
   * sources.
   *
   * Per FRD §6.8:
   *   - Patterns B and C: [original_bullet (or gap_description), userResponse,
   *     general competence language]
   *   - Pattern A (headline): [full resumeText, case_specific recommendation
   *     framing]
   */
  allowedSources: string[]
}

/**
 * Validate that a draft contains only facts traceable to the allowed
 * source set.
 *
 * FRD §6.8 algorithm (real implementation):
 *   1. Tokenize draft into noun phrases, named entities, numeric claims,
 *      tool/skill mentions
 *   2. For each extracted item, check membership in the allowed-source set
 *   3. If any extracted item fails membership, return
 *      { ok: false, ungrounded_entities: [...] }
 *   4. Otherwise return { ok: true, draft }
 *
 * Initial implementation (Stage 2b) will use simple substring + entity
 * overlap heuristics. If false-reject rate exceeds ~20% in production
 * (per §11 telemetry pattern), validator moves to a small classifier
 * model or loosened heuristics.
 *
 * Synchronous + pure — no I/O, no model calls. Validator runs in-process
 * as part of the /draft endpoint's retry loop (FRD §6.6 pseudocode).
 *
 * @param input draft + allowedSources
 * @returns Pass-or-fail result. On pass, draft is echoed in the result
 *          so callers can use a uniform downstream shape.
 */
export function validateDraftGrounding(
  input: ValidateDraftGroundingInput,
): GroundingValidationResult {
  // SKELETON: permissively returns ok=true for any input. This is
  // intentionally a NO-OP — the real validator is the load-bearing
  // mechanism for interview integrity. Phase 2 cannot ship to live
  // users until real validation is implemented in Stage 2b.
  //
  // TODO(phase-2-stage-2b): implement per FRD §6.8.
  void input.allowedSources
  return { ok: true, draft: input.draft }
}
