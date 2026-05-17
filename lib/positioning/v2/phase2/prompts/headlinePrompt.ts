// lib/positioning/v2/phase2/prompts/headlinePrompt.ts
//
// Pattern A user prompt builder. Returns the user message Claude receives
// for headline option generation. Paired with SYSTEM_PROMPT from
// systemPrompt.ts.
//
// FRD: docs/Features/positioning-phase2-frd.md §6.7.1, §6.8
//
// Pure function — no I/O, no async. Same input always produces same output.

/**
 * Per-call max output tokens for headline generation.
 * FRD §6.7.1 spec: ~200 output tokens. Padding to 300 for JSON wrapper
 * + 1-3 options with some headroom.
 */
export const MAX_TOKENS_HEADLINE = 300

/**
 * Input shape for buildHeadlinePrompt.
 *
 * Decoupled from PhaseTwoHeadlineItem — takes just the fields the prompt
 * needs. Caller (aiClient.generateHeadlineOptions) extracts these from
 * the item before invoking.
 */
export type HeadlinePromptInput = {
  /** Full resume text (typically persona.resume_text). */
  resumeText: string
  /** Full job description text. */
  jobDescription: string
  /**
   * Current headline text from the resume being reframed. From
   * PhaseTwoHeadlineItem.original.
   */
  originalHeadline: string
}

/**
 * Build the user message for headline option generation.
 *
 * Structure (per FRD §6.8):
 *   - SOURCE: Original headline (the line being reframed)
 *   - SOURCE: Full resume text (for grounding context)
 *   - TARGET: Job description excerpt
 *   - TASK: 1-3 reframed options, evidence-grounded
 *
 * Output contract: strict JSON {"drafts": ["...", ...]} with 1-3 elements.
 * Reinforces the "no invention" constraint inline (defense in depth on top
 * of SYSTEM_PROMPT).
 */
export function buildHeadlinePrompt(input: HeadlinePromptInput): string {
  return `=== SOURCE: Current headline ===
${input.originalHeadline}

=== SOURCE: Full resume ===
${input.resumeText}

=== TARGET: Job description ===
${input.jobDescription}

=== TASK ===
Generate 1-3 reframed headline options for this candidate. Each option must:
- Be 5-12 words.
- Reference skills, roles, or experience explicitly present in the resume above.
- Use language and framing that aligns with the target job description.
- NOT invent metrics, employers, certifications, or accomplishments not present in the resume.

Return strict JSON in this exact shape, no markdown fences, no preamble:
{"drafts": ["option 1", "option 2", "option 3"]}

If you cannot produce grounded options from the resume, return:
{"drafts": [], "reason": "insufficient_source_evidence"}`
}
