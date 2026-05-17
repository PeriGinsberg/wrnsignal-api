// lib/positioning/v2/phase2/prompts/gapPrompt.ts
//
// Pattern C user prompt builder. Returns the user message Claude receives
// for gap-addressing bullet/skill generation.
//
// FRD: docs/Features/positioning-phase2-frd.md §6.7.3, §6.8
//
// Pure function — no I/O, no async.
//
// Allowed-source contract for Commit 4 (groundingValidator): the validator
// MUST exclude full resume_text from the allowed-source set for this
// pattern. Only gap_description + user_input + general competence language
// count. Resume is provided to the model as context (so it doesn't
// duplicate existing content) but the validator treats only the user's
// response as the fact source for the new bullet/skill.

/**
 * Per-call max output tokens for gap generation.
 * FRD §6.7.3 spec: ~150 output tokens. Padding to 250 for JSON wrapper.
 */
export const MAX_TOKENS_GAP = 250

export type GapPromptInput = {
  /** Full resume text (provided for broad context). */
  resumeText: string
  /** Full job description text. */
  jobDescription: string
  /**
   * Description of the gap being addressed. From PhaseTwoGapItem
   * .gap_description (e.g., "JD asks for Excel; resume doesn't mention it").
   */
  gapDescription: string
  /**
   * The JD excerpt motivating this gap. From PhaseTwoGapItem.jd_context.
   */
  jdContext: string
  /**
   * The candidate's typed response. PRIMARY fact source for the generated
   * bullet/skill (since the resume by definition doesn't contain
   * information about this gap).
   */
  userResponse: string
}

/**
 * Build the user message for gap-addressing generation.
 *
 * Structure (per FRD §6.8):
 *   - SOURCE: Gap description
 *   - SOURCE: User's typed response (PRIMARY fact source)
 *   - SOURCE: Full resume (CONTEXT only)
 *   - TARGET: JD excerpt + gap context
 *   - TASK: 1 new bullet OR skill addition, only facts from user's response
 *
 * Allowed-source narrowing per FRD §6.8: by definition the gap is content
 * NOT in the resume, so the user's response is the load-bearing source.
 * Full resume provided for context (so AI doesn't generate something
 * already on the resume) but not as a fact source for the new content.
 *
 * Output contract: strict JSON {"drafts": ["new bullet or skill"]} with
 * exactly 1 element.
 */
export function buildGapPrompt(input: GapPromptInput): string {
  return `=== SOURCE: Gap to address ===
${input.gapDescription}

=== SOURCE: User's typed response (PRIMARY fact source) ===
${input.userResponse}

=== SOURCE: Full resume (context only — not a fact source) ===
${input.resumeText}

=== TARGET: JD excerpt motivating this gap ===
${input.jdContext}

=== TASK ===
Generate 1 new bullet OR skill addition that addresses the gap, using only the user's response above as the fact source. The generated content must:
- Be 1-2 sentences (for a bullet) or 1-5 words (for a skill keyword).
- Use only facts from the user's response.
- Directly address the gap described.
- NOT invent metrics, employers, certifications, or accomplishments not present in the user's response.
- NOT repeat content already on the resume.

Return strict JSON in this exact shape, no markdown fences, no preamble:
{"drafts": ["new bullet or skill addition"]}

If the user's response doesn't contain enough information to address the gap, return:
{"drafts": [], "reason": "insufficient_source_evidence"}`
}
