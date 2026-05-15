// lib/positioning/v2/caseSpecific.ts
//
// Generates the case-specific data payload returned by /api/positioning/v2/start
// (the response-level `case_specific` field). Populated only for Cases A and
// C; Case B returns null entirely. Pure function — no I/O.
//
// FRD: docs/Features/positioning-phase1-frd.md (section 4.2 case_specific field)
// Types: lib/positioning/v2/types.ts (CaseSpecificData)
//
// Defensive coding cross-references Foundation DD-23: jobfit_runs.result_json
// fields are unreliable on historical garbage runs. extractRisks (imported
// from caseDetermination) handles risk extraction; this file applies the
// same defensive shape for why_structured and job_signals.jobTitle.
//
// Template wording chosen to be direct (avoid corporate-ese). Wording is
// load-bearing — changes here are user-visible copy. Coordinate with Peri
// before tweaking.

import type {
  Case,
  CaseInputs,
  CaseSpecificData,
  InferredLaneMismatch,
  JobfitResultJson,
  RiskStructuredItem,
  SmallRefinement,
  WhyStructuredItem,
} from "./types"
import { extractRisks } from "./caseDetermination"

// ============================================================================
// Defensive extractors
// ============================================================================

/**
 * Extract non-empty why_structured keywords in original order. Returns []
 * if jobfit is missing / malformed / has no whys / all keywords are empty.
 *
 * Filters: keyword must be a string with length > 0 after string check.
 * Does not trim — keywords as-stored, just validated non-empty.
 */
function extractWhyKeywords(jobfit: JobfitResultJson | null | undefined): string[] {
  if (!jobfit || typeof jobfit !== "object") return []
  if (!Array.isArray(jobfit.why_structured)) return []
  const out: string[] = []
  for (const raw of jobfit.why_structured) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Partial<WhyStructuredItem>
    if (typeof item.keyword === "string" && item.keyword.length > 0) {
      out.push(item.keyword)
    }
  }
  return out
}

/**
 * Extract job title from inputs.jobfit.job_signals.jobTitle. Returns the
 * trimmed string if non-empty; null otherwise.
 *
 * Source rationale (option a from deliverable 5 plan): jobTitle is the
 * most informative defensible default for inferred_lane_mismatch.job_asking_for
 * without inventing content. True lane inference would require an LLM
 * blind-read, deferred to v2.5+.
 */
function extractJobTitle(jobfit: JobfitResultJson | null | undefined): string | null {
  if (!jobfit || typeof jobfit !== "object") return null
  const js = jobfit.job_signals
  if (!js || typeof js !== "object") return null
  if (typeof js.jobTitle !== "string") return null
  const trimmed = js.jobTitle.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ============================================================================
// String helpers
// ============================================================================

/**
 * Append a "." if the trimmed string doesn't already end with .!?
 * Used when interpolating gap text whose own punctuation is unpredictable.
 */
function ensureTrailingPeriod(s: string): string {
  const trimmed = s.trimEnd()
  if (trimmed.length === 0) return ""
  if (/[.!?]$/.test(trimmed)) return trimmed
  return trimmed + "."
}

// ============================================================================
// Case A builder
// ============================================================================

const CASE_A_SUMMARY_GENERIC =
  "Your resume already aligns strongly with this role."

function buildCaseAData(inputs: CaseInputs): CaseSpecificData {
  const whys = extractWhyKeywords(inputs.jobfit)

  let summary: string
  if (whys.length >= 3) {
    summary = `Your resume already aligns strongly with this role. Top strengths: ${whys[0]}, ${whys[1]}, ${whys[2]}.`
  } else if (whys.length > 0) {
    // Defensive: Case A nominally requires ≥3 whys (CASE_A_MIN_WHY_COUNT in
    // caseThresholds.ts). If callers pass Case A with fewer (e.g., manual
    // override or threshold change), still produce a coherent summary using
    // what's available rather than crashing or going generic.
    summary = `Your resume already aligns strongly with this role. Top strengths: ${whys.join(", ")}.`
  } else {
    // No usable whys → fall back to generic summary, no keyword list
    summary = CASE_A_SUMMARY_GENERIC
  }

  // small_refinements: 2026-05-15 tuning. Case A's gate relaxed to admit
  // Apply/Priority-Apply runs with all-low-severity risks; surface those
  // low-severity risks here so renderCaseA's refinements.length > 0 block
  // becomes meaningful. Filters out items with blank keywords (defensive).
  // Returns empty array (not undefined) for zero-risks Case A so the
  // frontend can iterate without optional chaining.
  const lowSeverityRefinements: SmallRefinement[] = []
  if (inputs.jobfit && typeof inputs.jobfit === "object") {
    const risks = extractRisks(inputs.jobfit)
    for (const r of risks.items) {
      if (r.severity !== "low") continue
      const kw = typeof r.keyword === "string" ? r.keyword.trim() : ""
      if (!kw) continue
      lowSeverityRefinements.push({
        id: kw,
        description: (r.gap || r.reframe || kw).trim(),
      })
    }
  }

  return {
    well_positioned_summary: summary,
    small_refinements: lowSeverityRefinements,
  }
}

// ============================================================================
// Case C builder
// ============================================================================

/**
 * Render the high-severity gap summary template. Returns null if no
 * usable high-severity risk (empty list or all keywords blank) so the
 * caller can omit the field entirely — don't fabricate copy.
 */
function buildHighSeverityGapSummary(
  risks: RiskStructuredItem[],
): string | null {
  const highSev = risks
    .filter((r) => r.severity === "high")
    .filter((r) => typeof r.keyword === "string" && r.keyword.trim().length > 0)

  if (highSev.length === 0) return null

  if (highSev.length === 1) {
    const item = highSev[0]
    const keyword = item.keyword.trim()
    const gap = typeof item.gap === "string" ? item.gap.trim() : ""
    if (gap.length > 0) {
      return ensureTrailingPeriod(`The most significant gap is in ${keyword}: ${gap}`)
    }
    return `The most significant gap: ${keyword}.`
  }

  if (highSev.length === 2) {
    return `Significant gaps include: ${highSev[0].keyword.trim()} and ${highSev[1].keyword.trim()}.`
  }

  // 3+
  return `Significant gaps include: ${highSev[0].keyword.trim()}, ${highSev[1].keyword.trim()}, and others.`
}

function buildCaseCData(inputs: CaseInputs): CaseSpecificData {
  const jobTitle = extractJobTitle(inputs.jobfit)
  const inferred: InferredLaneMismatch = {
    resume_reads_as: null, // v2 stub; blind-read deferred to v2.5+
    job_asking_for: jobTitle ?? "this role",
  }

  const result: CaseSpecificData = {
    inferred_lane_mismatch: inferred,
  }

  // Defensive: missing jobfit → return minimal valid Case C shape
  // (lane_mismatch only, no high_severity_gap_summary)
  if (!inputs.jobfit || typeof inputs.jobfit !== "object") {
    return result
  }

  const risks = extractRisks(inputs.jobfit)
  const summary = buildHighSeverityGapSummary(risks.items)
  if (summary !== null) {
    result.high_severity_gap_summary = summary
  }
  return result
}

// ============================================================================
// Main: generateCaseSpecific
// ============================================================================

/**
 * Build the case_specific payload for the given inputs + assigned case.
 *
 * Returns null for Case B (no case-specific data needed; workflow_preview
 * alone carries the relevant info). Returns a populated object for
 * Cases A and C.
 *
 * Per case:
 *   - Case A: well_positioned_summary + small_refinements (empty array in v2)
 *   - Case B: null (entire return value)
 *   - Case C: inferred_lane_mismatch (always) + high_severity_gap_summary
 *            (omitted if no usable high-severity risk)
 *
 * Defensive:
 *   - Missing/malformed jobfit → produce minimal valid output per case
 *     (or null for B). Doesn't fabricate copy when source data is empty.
 *   - Case A with empty why_structured → generic summary, no keyword list
 *   - Case C with no high-severity risks → high_severity_gap_summary
 *     omitted (undefined), lane_mismatch still present
 *   - Case C with missing job_signals.jobTitle → job_asking_for = "this role"
 *
 * Cross-references Foundation DD-23 (data quality on historical runs).
 */
export function generateCaseSpecific(
  inputs: CaseInputs,
  assignedCase: Case,
): CaseSpecificData | null {
  if (assignedCase === "B") return null
  if (assignedCase === "A") return buildCaseAData(inputs)
  return buildCaseCData(inputs) // Case C
}
