// lib/positioning/v2/workflowPreview.ts
//
// Generates the workflow_preview payload returned by /api/positioning/v2/start
// for Phase 1 frontend rendering. Pure function — no I/O.
//
// FRD: docs/Features/positioning-phase1-frd.md (section 4.2 workflow_preview field)
// Types: lib/positioning/v2/types.ts (WorkflowPreview)
//
// Defensive coding cross-references Foundation DD-23: jobfit_runs.result_json
// fields are unreliable on historical garbage runs. extractRisks (imported
// from caseDetermination) handles the defensive extraction; this file
// trusts its output.
//
// Sharing note: extractRisks + RiskExtraction are imported from
// caseDetermination.ts to avoid duplicating defensive logic across files.
// caseSpecific.ts (deliverable 5) will share the same import.

import type {
  Case,
  CaseInputs,
  RiskStructuredItem,
  WorkflowPreview,
} from "./types"
import { extractRisks } from "./caseDetermination"

// ============================================================================
// Severity sort helper
// ============================================================================

function severityRank(s: RiskStructuredItem["severity"]): number {
  if (s === "high") return 0
  if (s === "medium") return 1
  return 2
}

/**
 * Sort risks by severity (high > medium > low). Stable — preserves original
 * array order within the same severity bucket (Array.prototype.sort has been
 * spec-required-stable since ES2019).
 */
function sortBySeverity(
  items: RiskStructuredItem[],
): RiskStructuredItem[] {
  return [...items].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity),
  )
}

// ============================================================================
// estimated_minutes computation
// ============================================================================

/**
 * Estimated time to complete the workflow, in minutes.
 *
 * Per FRD section 4.2:
 *   - Case A: 0  (clean — no refinements; workflow ends at Phase 1 "I'm ready
 *     to apply" CTA)
 *   - Case A with small_refinements: 5  (future v2.5+; not produced in v2
 *     because small_refinements has no real signal source yet — see Phase 1
 *     plan F2 discussion)
 *   - Case B: midpoint of 15-20 → 17
 *   - Case C: midpoint of 30-45 → 37
 *
 * Returns a single number (not a range) because the type signature is
 * `number` and the frontend can express ranges in display copy if needed
 * ("about 17 minutes" vs "15-20 minutes" is a UI choice).
 *
 * Tunable: if usage data shows real workflow time differs, adjust these
 * midpoints. Tracked alongside case_reasoning in positioning_run_v2 for
 * post-launch analysis.
 */
function estimatedMinutesForCase(c: Case): number {
  if (c === "A") return 0
  if (c === "B") return 17
  return 37 // Case C
}

// ============================================================================
// Main: generateWorkflowPreview
// ============================================================================

/**
 * Build the WorkflowPreview payload for the given inputs + assigned case.
 *
 * The assigned case must already be determined via determineCase. This
 * function does NOT re-derive it — separation of concerns: case logic in
 * caseDetermination, workflow preview shape here.
 *
 * gap_count and gap_themes come from JobFit's risk_structured (or V4
 * fallback to risk_codes). content_review_required is true unless the
 * assigned case is A. audit_findings_count is always null in v2 because
 * Phase 4 audit detection ships in v2.5+. estimated_minutes is derived
 * from the assigned case alone.
 *
 * Edge cases:
 *   - Missing/malformed jobfit → gap_count=0, gap_themes=[],
 *     workflow shape still rendered (consumer decides how to display)
 *   - Fewer than 3 risks → returns all available keywords (no padding)
 *   - Inconsistent inputs (e.g., Case A with non-zero risks) → reflects
 *     what's actually there in counts/themes; doesn't auto-correct
 *
 * Cross-references Foundation DD-23 (data quality on historical runs).
 */
export function generateWorkflowPreview(
  inputs: CaseInputs,
  assignedCase: Case,
): WorkflowPreview {
  const contentReviewRequired = assignedCase !== "A"
  const estimatedMinutes = estimatedMinutesForCase(assignedCase)
  const auditFindingsCount = null // v2 stub; v2.5 populates

  // Defensive: missing jobfit data → zero counts, still return shape
  if (!inputs.jobfit || typeof inputs.jobfit !== "object") {
    return {
      gap_count: 0,
      gap_themes: [],
      content_review_required: contentReviewRequired,
      audit_findings_count: auditFindingsCount,
      estimated_minutes: estimatedMinutes,
    }
  }

  // Extract risks via shared helper (handles V5 / V4 / malformed paths)
  const risks = extractRisks(inputs.jobfit)
  const sorted = sortBySeverity(risks.items)
  const top3Keywords = sorted
    .slice(0, 3)
    .map((r) => r.keyword)
    .filter((k) => typeof k === "string" && k.length > 0)

  return {
    gap_count: risks.items.length,
    gap_themes: top3Keywords,
    content_review_required: contentReviewRequired,
    audit_findings_count: auditFindingsCount,
    estimated_minutes: estimatedMinutes,
  }
}
