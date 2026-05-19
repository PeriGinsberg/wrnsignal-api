// lib/positioning/v2/phase2/itemPopulatorParts/templates.ts
//
// Pure string builders for item labels + Pattern B / Pattern C question
// prompts. NO defensive checks on inputs — the orchestrator (Commit 2)
// is responsible for not calling these with empty strings on the
// question-template path. Label functions DO accept empty input and
// fall back to a generic label without trailing punctuation.
//
// Templates are load-bearing user-visible copy. Wording is locked by
// design point 5 — coordinate with Peri before tweaking.

/**
 * Pattern B (bullet reframe) — the question shown on a bullet item card.
 * Asks for the missing specificity the JD reframe needs (outcome, who,
 * tools/methods). The 2-4 sentence cap bounds the downstream AI client's
 * draft input.
 *
 * Inputs must be non-empty strings; orchestrator enforces.
 */
export function bulletQuestionTemplate(
  originalBullet: string,
  jdContext: string,
): string {
  return `You wrote: "${originalBullet}"

The job is asking for: ${jdContext}

In 2-4 sentences, tell me more about this work — what was the specific outcome, who else was involved, and what tools or methods did you use?`
}

/**
 * Pattern C (gap) — the question shown on a gap item card. Probes for
 * transferable experience.
 *
 * The "if you genuinely don't have this experience, that's fine" exit
 * is LOAD-BEARING for interview integrity. Do not drop it. Without the
 * exit, users feel pressured to fabricate transferable experience, which
 * produces bullets they cannot defend in interview.
 *
 * Inputs must be non-empty strings; orchestrator enforces.
 *
 * Note: `gapDescription` is in the signature for orchestrator traceability
 * but isn't interpolated in the template body — the template uses
 * jdContext (the verbatim JD snippet) as the anchor. Kept in the
 * signature so future template revisions can incorporate it without
 * a signature churn.
 */
export function gapQuestionTemplate(
  gapDescription: string,
  jdContext: string,
): string {
  void gapDescription
  return `The job asks for: ${jdContext}

Your resume doesn't directly mention this, but you may have related experience. In 2-4 sentences, tell me about any work — coursework, projects, internships, volunteer — where you did something similar. If you genuinely don't have this experience, that's fine — just say so.`
}

// ============================================================================
// Item labels
// ============================================================================

/**
 * Headline item label. Falls back to "Reframe headline" when jobTitle is
 * empty (no trailing "for" with nothing after it).
 */
export function headlineLabel(jobTitle: string): string {
  if (!jobTitle) return "Reframe headline"
  return `Reframe headline for ${jobTitle}`
}

/**
 * Bullet item label. Falls back to "Reframe bullet" when keyword is
 * empty (no trailing colon-with-nothing).
 */
export function bulletLabel(keyword: string): string {
  if (!keyword) return "Reframe bullet"
  return `Reframe bullet: ${keyword}`
}

/**
 * Gap item label. Falls back to "Address gap" when keyword is empty.
 */
export function gapLabel(keyword: string): string {
  if (!keyword) return "Address gap"
  return `Address ${keyword}`
}
