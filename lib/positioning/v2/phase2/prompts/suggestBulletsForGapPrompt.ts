// lib/positioning/v2/phase2/prompts/suggestBulletsForGapPrompt.ts
//
// User prompt builder for the populator-time bullet-suggestion call
// (Phase 2 v1 build A3). Differs from gapPrompt.ts (Pattern C) in three
// ways:
//
//   1. INPUT only: gap_description + jd_context + full resume.
//      No user_response (the user hasn't answered the gap question yet —
//      we're surfacing reword candidates AT POPULATOR TIME so the
//      frontend can show them on the gap-detail screen).
//
//   2. OUTPUT contract: up to 3 verbatim existing-resume bullets, not
//      a new bullet draft. The model is SELECTING, not GENERATING.
//      Response shape stays `{"drafts": [...]}` so the shared
//      parseClaudeResponse in aiClient.ts can be reused — the
//      "suggestions" semantic naming lives on the public Input/Result
//      type. Internally everything is still drafts.
//
//   3. Resume is the PRIMARY source, not context. This is the one Phase
//      2 generation path where the resume is load-bearing — every
//      returned bullet must be a verbatim substring of resumeText
//      (resumeComposer locate-and-replace dependency, FRD §6.10).
//      aiClient.suggestBulletsForGap enforces this with a post-parse
//      verbatim filter; any non-verbatim returns are dropped.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §5.4 — multi-outcome gap composition (the "reword existing bullet"
//          outcome this prompt feeds into)
//   §6.10 — verbatim invariant for resumeComposer
//
// Pure function — no I/O, no async.

/**
 * Per-call max output tokens for bullet suggestion.
 *
 * Budget rationale: 3 short bullets at ~80 tokens each (Catherine's
 * longest resume bullet is 24 tokens; budget assumes 3x worst-case
 * length) + JSON wrapper + occasional reasoning tokens = ~280 tokens.
 * Padded to 500 to absorb verbose-model variations without truncating
 * the third suggestion mid-string.
 */
export const MAX_TOKENS_SUGGEST_BULLETS = 500

export type SuggestBulletsForGapPromptInput = {
  /**
   * Description of the gap being addressed. From PhaseTwoGapItem
   * .gap_description (e.g. "JD asks for Excel; resume doesn't mention
   * it").
   */
  gapDescription: string
  /**
   * The JD excerpt motivating this gap. From PhaseTwoGapItem.jd_context.
   */
  jdContext: string
  /**
   * Full resume text (typically persona.resume_text). PRIMARY source —
   * the model returns verbatim substrings of this text.
   */
  resumeText: string
}

/**
 * Build the user message for populator-time bullet suggestion.
 *
 * Structure mirrors gapPrompt.ts's SOURCE/TARGET/TASK convention but
 * inverts the resume's role: resume is PRIMARY (we're picking FROM it),
 * gap_description + jd_context anchor what relevance means.
 *
 * Output contract: strict JSON `{"drafts": [...]}` with 0-3 verbatim
 * bullet strings. The aiClient post-parse filter drops any element that
 * is not a substring of resumeText (verbatim invariant). If the model
 * can't find any reasonably relevant bullets, it returns the empty-
 * array escape hatch shared across all Phase 2 prompts.
 */
export function buildSuggestBulletsForGapPrompt(
  input: SuggestBulletsForGapPromptInput,
): string {
  return `=== SOURCE: Gap to address ===
${input.gapDescription}

=== SOURCE: JD excerpt motivating this gap ===
${input.jdContext}

=== SOURCE: Full resume (PRIMARY — pick verbatim from here) ===
${input.resumeText}

=== TASK ===
Identify up to 3 existing bullets from the resume that are most relevant to the JD requirement above. Each bullet you return should be a candidate that the user could REWORD to better address the requirement.

Critical constraints:
- Return ONLY existing bullets from the resume.
- Each returned bullet must be VERBATIM — character-for-character — copied from the resume. Do not paraphrase, summarize, abbreviate, or invent text.
- Do not add prefixes, bullet glyphs, or markdown the resume doesn't already have.
- If fewer than 3 bullets are reasonably relevant, return fewer. Quality over quantity.
- If no resume bullets are reasonably relevant to this gap, return an empty array.

Return strict JSON in this exact shape, no markdown fences, no preamble:
{"drafts": ["bullet 1 verbatim", "bullet 2 verbatim", "bullet 3 verbatim"]}

If no bullets are reasonably relevant, return:
{"drafts": [], "reason": "insufficient_source_evidence"}`
}
