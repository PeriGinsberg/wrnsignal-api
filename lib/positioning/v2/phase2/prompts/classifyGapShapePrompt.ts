// lib/positioning/v2/phase2/prompts/classifyGapShapePrompt.ts
//
// User prompt builder for the populator-time gap_shape classification
// fallback (Phase 2 v1 build G1). Called only when the deterministic
// heuristic returns low-confidence or unclassified — most gaps never
// reach this prompt.
//
// Output contract:
//   { "shape": "experience" | "skill" | "certification" | "tool"
//            | "language" | "coursework" | "unknown" }
//
// The shared parseClaudeResponse in aiClient.ts is not reused here —
// the response shape differs (single `shape` field, not a `drafts`
// array). aiClient.classifyGapShape uses a tight local parser instead.
//
// FRD: docs/Features/positioning-phase2-frd.md §5.4 — multi-outcome gap
//      composition (the downstream consumer that needs gap_shape to
//      route outcomes to the correct resume section).
//
// Pure function — no I/O, no async.

/**
 * Per-call max output tokens for shape classification.
 *
 * Budget rationale: single-word answer + JSON wrapper = ~20 tokens
 * worst case. Padded to 60 to absorb verbose-model variants that emit
 * leading whitespace, trailing commentary truncation, or include the
 * full unioned literal types in the response (e.g.
 * `{"shape":"certification"}`).
 */
export const MAX_TOKENS_CLASSIFY_GAP_SHAPE = 60

export type ClassifyGapShapePromptInput = {
  /**
   * The gap requirement to classify. From PhaseTwoGapItem.gap_description
   * (e.g. "PMP certification preferred").
   */
  gapDescription: string
  /**
   * The JD excerpt motivating this gap. From PhaseTwoGapItem.jd_context.
   * Helps the model disambiguate ambiguous nouns (e.g. "Excel" the tool
   * vs. "excel" the verb).
   */
  jdContext: string
}

/**
 * Build the user message for shape classification.
 *
 * Structure mirrors the other Phase 2 prompts' SOURCE/TASK convention
 * but is intentionally short — the model is doing a 1-of-7 pick, not a
 * generation task, so the prompt is mostly examples-by-shape with a
 * tight JSON output contract.
 */
export function buildClassifyGapShapePrompt(
  input: ClassifyGapShapePromptInput,
): string {
  return `=== SOURCE: Gap to classify ===
${input.gapDescription}

=== SOURCE: JD context ===
${input.jdContext}

=== TASK ===
Classify this resume gap by its structural shape. Pick exactly one of these seven values based on what kind of thing the job requires:

- experience: past job, internship, or project experience, often described with duration or scale. Examples: "5 years stakeholder management", "led a team of 10", "managed a $5M budget".
- skill: a single competency or capability, not tied to a specific software product or credential. Examples: "Excel proficiency", "data analysis", "written communication".
- certification: a formal credential, license, or designation. Examples: "PMP certified", "CFA Level II", "Series 7 license", "AWS Certified Solutions Architect".
- tool: a specific software, platform, or technology product. Examples: "Salesforce", "Tableau", "Power BI", "AutoCAD", "Figma".
- language: a spoken or written human language. Examples: "Spanish fluency", "fluent in Mandarin", "bilingual French".
- coursework: academic familiarity or topic exposure rather than work experience. Examples: "familiarity with statistical methods", "fundamentals of econometrics", "exposure to machine learning".
- unknown: cannot confidently pick one of the six above.

Return strict JSON in this exact shape, no markdown fences, no preamble, no trailing commentary:
{"shape": "experience"}

If you cannot confidently classify, return:
{"shape": "unknown"}`
}
