// lib/interviewPrep/contentHash.ts
//
// Cache identity for a generated prep.
//
// DETERMINISM COMES FROM THE CACHE, NOT THE MODEL. temperature:0 narrows
// variance but Anthropic does not promise byte-identical output, so "the same
// inputs give the same result" is true here only because the same inputs never
// produce a second call. Same honesty as the frozen verdict cache in
// app/api/jobfit/semanticRelevance.ts, which this follows deliberately:
//
//   - the MODEL ID is inside the key, so a model bump re-freezes behind a
//     reviewed diff rather than silently changing what users read
//   - PROMPT_VERSION is inside the key for the same reason. Editing the prompt
//     without bumping it would leave old output in place looking current
//
// Canonical JSON per lib/positioning/v2/fingerprint.ts: keys sorted at every
// level, no insignificant whitespace. Pure — no I/O, no clock, no randomness.

import { createHash } from "node:crypto"

/**
 * Bump on ANY change to the prompt, the schema, or what gets put in front of
 * the model. Every existing prep then regenerates on next view.
 *
 *   2  RULE 5, no em dashes. Preps generated before this carry them, and the
 *      version bump is what makes those regenerate rather than sit in the
 *      cache looking current while breaking the house style.
 *   3  Supporting requirement_units admitted alongside core, and the
 *      REQUIREMENTS header reworded to match. Different material in front of
 *      the model means a different answer is owed.
 *   4  RULE 5 widened to ban markdown, and RULE 6 added against ungrounded
 *      enthusiasm claims. Both were observed in live output.
 */
export const PROMPT_VERSION = 4

export type ContentHashInputs = {
  model: string
  jobfitRunId: string
  /** The run's own identity. A rescored job produces a different one. */
  runFingerprint: string | null
  /** Both change the questions, so both invalidate. */
  stage: string | null
  format: string | null
}

/** Sorted keys at every level, no insignificant whitespace. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(",")}}`
}

export function computeContentHash(inputs: ContentHashInputs): string {
  const payload = {
    v: PROMPT_VERSION,
    model: inputs.model,
    jobfit_run_id: inputs.jobfitRunId,
    run_fingerprint: inputs.runFingerprint ?? null,
    // null is a REAL value for format and must hash differently from "phone".
    // "not recorded" is a state the prompt branches on, not a missing input.
    stage: inputs.stage ?? null,
    format: inputs.format ?? null,
  }
  return createHash("sha256").update(canonical(payload)).digest("hex")
}
