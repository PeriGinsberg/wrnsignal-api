// lib/positioning/v2/phase2/prompts/bulletPrompt.ts
//
// Pattern B user prompt builder. Returns the user message Claude receives
// for reframed bullet generation.
//
// FRD: docs/Features/positioning-phase2-frd.md §6.7.2, §6.8
//
// Pure function — no I/O, no async.
//
// Allowed-source contract for Commit 4 (groundingValidator): the validator
// MUST exclude full resume_text from the allowed-source set for this
// pattern. Only original_bullet + user_input + general competence language
// count. Resume is provided to the model as context (so it doesn't generate
// content the resume already covers) but the validator treats only
// original_bullet + user_input as fact sources for the reframe.

/**
 * Per-call max output tokens for bullet generation.
 * FRD §6.7.2 spec: ~150 output tokens. Padding to 250 for JSON wrapper.
 */
export const MAX_TOKENS_BULLET = 250

export type BulletPromptInput = {
  /** Full resume text (provided for broad context, not as fact source). */
  resumeText: string
  /** Full job description text. */
  jobDescription: string
  /**
   * The original bullet text being reframed. From
   * PhaseTwoBulletItem.original_bullet. PRIMARY fact source along with
   * userResponse.
   */
  originalBullet: string
  /**
   * The JD excerpt that motivated this recommendation. From
   * PhaseTwoBulletItem.jd_context.
   */
  jdContext: string
  /**
   * The candidate's typed response to the bullet's question. From the
   * /draft request body. PRIMARY fact source along with originalBullet.
   */
  userResponse: string
}

/**
 * Build the user message for bullet reframe generation.
 *
 * Structure (per FRD §6.8):
 *   - SOURCE: Original bullet (PRIMARY fact source)
 *   - SOURCE: User's typed response (PRIMARY fact source)
 *   - SOURCE: Full resume (CONTEXT only, not a fact source)
 *   - TARGET: JD excerpt motivating this reframe
 *   - TASK: 1 reframed bullet, only facts from PRIMARY sources
 *
 * Allowed-source narrowing per FRD §6.8: the grounding validator will
 * reject content that introduces facts not in original_bullet + user_response.
 * Full resume is provided for context but the bullet must not introduce
 * resume facts not connected to the original bullet.
 *
 * Output contract: strict JSON {"drafts": ["reframed bullet"]} with exactly
 * 1 element.
 */
export function buildBulletPrompt(input: BulletPromptInput): string {
  return `=== SOURCE: Original bullet (PRIMARY fact source) ===
${input.originalBullet}

=== SOURCE: User's typed response (PRIMARY fact source) ===
${input.userResponse}

=== SOURCE: Full resume (context only — not a fact source) ===
${input.resumeText}

=== TARGET: JD excerpt motivating this reframe ===
${input.jdContext}

=== TASK ===
Generate 1 reframed version of the original bullet. The reframe must:
- Be 1-2 sentences, 30 words maximum.
- Use only facts from the original bullet and the user's response above.
- Use language and emphasis that aligns with the JD excerpt.
- NOT invent metrics, employers, certifications, or accomplishments not present in those sources.
- NOT introduce facts from elsewhere in the resume that aren't connected to the original bullet.

Return strict JSON in this exact shape, no markdown fences, no preamble:
{"drafts": ["reframed bullet text"]}

If you cannot produce a grounded reframe, return:
{"drafts": [], "reason": "insufficient_source_evidence"}`
}
