// lib/positioning/v2/phase2/itemPopulatorParts/types.ts
//
// Pre-orchestration candidate shapes emitted by the extract* helpers in
// this directory. Distinct from phase2/types.ts PhaseTwoItem variants
// because these are intermediate forms — the orchestrator (itemPopulator.ts)
// wraps them into the final PhaseTwoItem discriminated union with item IDs,
// decision flags (accepted/declined/skipped all false), and decided_at:null
// seed fields.
//
// Pure types only — no runtime values, no logic.

/**
 * Inputs needed to draft 1-3 headline reframe options downstream.
 * Produced by extractHeadlineCandidate; consumed in Commit 2 by the
 * itemPopulator orchestrator + later by aiClient.draftHeadlineOptions.
 *
 * Returns null from the extractor when jobTitle is missing — without a
 * target title there is nothing to reframe toward.
 */
export type HeadlineCandidate = {
  /** Source: job_signals.jobTitle (trimmed, non-empty). */
  jobTitle: string
  /** Source: job_signals.jobFamily (trimmed). Null when JD lacks family detection. */
  jobFamily: string | null
  /**
   * Top-3 keywords from why_structured by array order (which is
   * weight-descending out of JobFit). Empty when why_structured is
   * missing or malformed.
   */
  topWhyKeywords: string[]
}

/**
 * Inputs needed to draft a Pattern B bullet reframe downstream. Produced
 * by extractBulletCandidates only when (a) the why's action matches a
 * reframe-flavored phrase AND (b) the lead anchors to a resume line.
 *
 * Verbatim invariant on original_bullet: this string MUST appear
 * character-for-character in the source resume_text. resumeComposer's
 * locate-and-replace (FRD §6.10) depends on this. anchorBullet's
 * algorithm enforces the invariant.
 */
export type BulletCandidate = {
  /** Verbatim resume line that anchored the why's lead. */
  original_bullet: string
  /** why_structured.connection — the JD-facing rationale. */
  jd_context: string
  /** why_structured.keyword — used for the item label + traceability. */
  keyword: string
  /**
   * The first reframe phrase that matched the why's action string
   * (e.g. "retitle", "reframe", "frame this"). Read by Commit 3
   * verification to tune the reframe filter.
   */
  action_match: string
}

/**
 * Inputs needed to draft a Pattern C gap-discussion question downstream.
 * Produced by extractGapCandidates for core JD requirements that are not
 * already represented in the resume.
 */
export type GapCandidate = {
  /** Source: requirement_units[].label (the human-readable description). */
  gap_description: string
  /** Source: requirement_units[].snippet (the verbatim JD excerpt). */
  jd_context: string
  /** Source: requirement_units[].key (e.g. "financial_analysis"). */
  keyword: string
}
