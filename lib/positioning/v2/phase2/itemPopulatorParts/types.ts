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
 * Inputs needed to drive headline emission in the populator. Discriminated
 * on `kind`:
 *
 *   - "replace"   — a real headline block was detected in the resume.
 *                   `original` is the verbatim captured string (single line
 *                   OR multi-line joined with \n). resumeComposer's
 *                   locate-and-replace path uses `original` as the anchor
 *                   to swap with `final_text` at /complete time.
 *
 *   - "synthesize" — no headline block found in the resume, but the JD
 *                    carries a RISK_FAMILY_MISMATCH signal in
 *                    jobfit.risk_codes. The populator synthesizes a
 *                    placeholder informational string for `original`
 *                    ("Headline targeting: ${jobTitle}") and the
 *                    PhaseTwoHeadlineItem is flagged `synthesize_mode: true`
 *                    so resumeComposer's insertion path knows to write
 *                    the final_text at the first blank line after the
 *                    contact block rather than replacing.
 *
 * The extractor returns `null` (no headline item at all) when EITHER:
 *   - jobTitle is missing (no target to reframe toward), OR
 *   - no headline block found AND no synthesize-trigger present.
 *
 * Produced by extractHeadlineCandidate; consumed by the itemPopulator
 * orchestrator + later by aiClient.draftHeadlineOptions.
 */
export type HeadlineCandidate =
  | {
      kind: "replace"
      /**
       * Verbatim captured headline content from the resume. Multi-line
       * blocks are joined with \n so the full string is a substring of
       * the original resume_text (preserves the verbatim invariant that
       * resumeComposer's locate-and-replace depends on).
       */
      original: string
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
  | {
      kind: "synthesize"
      /** Source: job_signals.jobTitle (trimmed, non-empty). */
      jobTitle: string
      /** Source: job_signals.jobFamily (trimmed). Null when JD lacks family detection. */
      jobFamily: string | null
      /** Top-3 keywords from why_structured by array order. */
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
