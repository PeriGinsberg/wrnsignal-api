// lib/positioning/v2/caseDetermination.ts
//
// Phase 1's case assignment engine. Pure function — no I/O, no side effects.
// Reads JobFit findings + Foundation targeting/career_stage context and
// returns one of A/B/C with a reasoning string.
//
// FRD: docs/Features/positioning-phase1-frd.md (section 4.1)
//
// Cascading rules (FRD section 4.1):
//   1. verdict=Pass                                                  → Case C
//   2. verdict=Review + family mismatch (targetFamilies ∩ jobFamily
//      = ∅, both signals present and non-"Other")                    → Case C
//      (Added 2026-05-15 tuning; narrowed 2026-05-16 to Review-only —
//      see runlog. Adjacent families like Product Marketing vs Product
//      Management are common legitimate overlaps; on Apply/Priority
//      Apply, JobFit's verdict is the stronger signal and shouldn't
//      be overridden by family-taxonomy mismatch alone.)
//   3. verdict=Review + high-severity risk                           → Case C
//                                            (gated by CASE_C_HIGH_SEVERITY_TRIGGER)
//   4. verdict=Review + no high-severity                             → Case B
//   5. verdict=Apply/Priority Apply + (0 risks OR all-low-severity)
//      + whys ≥ threshold + no data quality issue                    → Case A
//   6. verdict=Apply/Priority Apply + high-severity                  → Case B
//   7. verdict=Apply/Priority Apply (default)                        → Case B
//   8. Defensive (missing/malformed/unexpected verdict)              → Case B
//
// Defensive coding (cross-references Foundation DD-23: jobfit_runs.result_json
// fields are unreliable on historical garbage runs — empty/scraped JDs
// produced fallback classifications that don't reflect real signal):
//   - Missing jobfit data → Case B with data-quality reasoning
//   - V4 runs (no risk_structured, risk_codes present) → treat risks as medium
//   - Malformed risk_structured (not array, missing severity) → treat as medium,
//     surface in reasoning, block Case A promotion
//   - Empty risks + empty whys → falls through to default Case B
//   - dataQualityIssue blocks Case A promotion (don't trust 0-risks if data
//     is suspect)

import type {
  CaseAssignment,
  CaseInputs,
  JobfitResultJson,
  JobfitVerdict,
  RiskStructuredItem,
} from "./types"
import {
  CASE_A_MIN_WHY_COUNT,
  CASE_C_HIGH_SEVERITY_TRIGGER,
} from "./caseThresholds"

// ============================================================================
// Helpers (defensive extraction from jobfit result_json)
// ============================================================================

function isValidVerdict(v: string): v is JobfitVerdict {
  return (
    v === "Priority Apply" || v === "Apply" || v === "Review" || v === "Pass"
  )
}

/**
 * Prefer the V5+ `decision` field; fall back to older `verdict` field; null
 * if both missing or invalid.
 */
function extractVerdict(jobfit: JobfitResultJson): JobfitVerdict | null {
  if (typeof jobfit.decision === "string" && isValidVerdict(jobfit.decision)) {
    return jobfit.decision
  }
  if (typeof jobfit.verdict === "string" && isValidVerdict(jobfit.verdict)) {
    return jobfit.verdict
  }
  return null
}

export type RiskExtraction = {
  items: RiskStructuredItem[]
  /**
   * True if risk_structured was malformed (not array, items not objects,
   * or items missing valid severity). Surfaces in reasoning string and
   * blocks Case A promotion.
   */
  dataQualityIssue: boolean
  /** True if we fell back to risk_codes (V4 path); not a data quality issue. */
  v4Fallback: boolean
}

/**
 * Extract risk items defensively. Handles:
 *   - Well-formed V5 risk_structured (normal path)
 *   - V4 runs with risk_codes but no risk_structured (fallback: medium severity)
 *   - Malformed risk_structured (not array, items not objects, missing severity)
 *
 * Cross-references Foundation DD-23: historical jobfit_runs can have
 * garbage/malformed result_json from runs against empty/scraped JDs.
 */
export function extractRisks(jobfit: JobfitResultJson): RiskExtraction {
  // Happy path: V5 array
  if (Array.isArray(jobfit.risk_structured)) {
    const items: RiskStructuredItem[] = []
    let hadMalformed = false
    for (const raw of jobfit.risk_structured) {
      if (!raw || typeof raw !== "object") {
        hadMalformed = true
        continue
      }
      const item = raw as Partial<RiskStructuredItem>
      const severity = item.severity
      if (severity === "high" || severity === "medium" || severity === "low") {
        items.push({
          keyword: item.keyword ?? "",
          gap: item.gap ?? "",
          adjacent_evidence: item.adjacent_evidence ?? "",
          severity,
        })
      } else {
        // Missing or invalid severity — treat as medium, flag the issue
        items.push({
          keyword: item.keyword ?? "",
          gap: item.gap ?? "",
          adjacent_evidence: item.adjacent_evidence ?? "",
          severity: "medium",
        })
        hadMalformed = true
      }
    }
    return { items, dataQualityIssue: hadMalformed, v4Fallback: false }
  }

  // V4 fallback: risk_codes present, no risk_structured.
  //
  // Accepts both historical shapes:
  //   - V4 entries: bare strings (e.g. "RISK_FAMILY_MISMATCH"). Severity
  //     unknown → defaulted to medium (V4 didn't tag severity).
  //   - V5 entries: objects with .code (and usually .severity). JobFit V5
  //     emits this shape on every recent run; see RiskCodeV5 + the writer's
  //     app/api/jobfit/signals.ts:274 RiskCode. When severity is missing or
  //     not one of high/medium/low, defaults to medium (same fallback as
  //     the malformed-risk_structured path above).
  //
  // Pre-fix the filter rejected non-string entries, silently producing
  // items=[] for V5-shape rows that hit this fallback path (rare combination
  // of risk_structured missing + risk_codes populated, ~2.3% of recent runs
  // per probe-catherine-risk-codes-runtime). That breakage could wrongly
  // promote Apply/Priority Apply rows to Case A on the zero-risks check.
  if (Array.isArray(jobfit.risk_codes) && jobfit.risk_codes.length > 0) {
    const items: RiskStructuredItem[] = []
    for (const raw of jobfit.risk_codes) {
      if (typeof raw === "string") {
        if (raw.length === 0) continue
        items.push({ keyword: raw, gap: "", adjacent_evidence: "", severity: "medium" })
      } else if (raw && typeof raw === "object") {
        const obj = raw as { code?: unknown; severity?: unknown }
        const code = typeof obj.code === "string" ? obj.code : ""
        if (code.length === 0) continue
        const severity =
          obj.severity === "high" ||
          obj.severity === "medium" ||
          obj.severity === "low"
            ? obj.severity
            : "medium"
        items.push({ keyword: code, gap: "", adjacent_evidence: "", severity })
      }
    }
    return { items, dataQualityIssue: false, v4Fallback: true }
  }

  // risk_structured is defined but not an array → malformed
  if (jobfit.risk_structured !== undefined) {
    return { items: [], dataQualityIssue: true, v4Fallback: false }
  }

  // Genuinely missing → no risks, no data issue
  return { items: [], dataQualityIssue: false, v4Fallback: false }
}

function countWhys(jobfit: JobfitResultJson): number {
  return Array.isArray(jobfit.why_structured) ? jobfit.why_structured.length : 0
}

// ============================================================================
// Main: determineCase
// ============================================================================

/**
 * Apply Phase 1's cascading case-determination rules. Returns the assigned
 * case + a human-readable reasoning string that's logged on every
 * positioning_run_v2 for post-launch tuning.
 *
 * See file header for the rule cascade and defensive coding contract.
 */
export function determineCase(inputs: CaseInputs): CaseAssignment {
  // Defensive: missing/non-object jobfit input
  if (!inputs.jobfit || typeof inputs.jobfit !== "object") {
    return {
      case: "B",
      reasoning:
        "JobFit data unavailable or malformed; defaulting to Case B (data quality issue).",
    }
  }
  const jobfit = inputs.jobfit

  // Defensive: missing or invalid verdict
  const verdict = extractVerdict(jobfit)
  if (!verdict) {
    return {
      case: "B",
      reasoning:
        "JobFit verdict missing or invalid; defaulting to Case B (data quality issue).",
    }
  }

  // Defensive extraction
  const risks = extractRisks(jobfit)
  const whys = countWhys(jobfit)
  const hasHighSeverity = risks.items.some((r) => r.severity === "high")
  const topHighRisk = risks.items.find((r) => r.severity === "high")

  // Rule 1: Pass → Case C
  if (verdict === "Pass") {
    return {
      case: "C",
      reasoning:
        "JobFit verdict is Pass; significant repositioning required to compete.",
    }
  }

  // Rule 2: Family mismatch (added 2026-05-15 tuning, narrowed 2026-05-16).
  // Fires for Review verdict only when the candidate's targeted job
  // families don't overlap with the JD's classified family. Catches the
  // canonical Case C scenario (Communications candidate applying to
  // Finance role) that the upstream scorer's per-risk severity tagging
  // consistently misses (tagging field mismatches as medium instead of
  // high — see runlog 2026-05-15 tuning session).
  //
  // Why Review-only: adjacent families are common legitimate overlaps
  // (Product Marketing vs Product Management, Marketing Analytics vs
  // Analytics, Strategy Consulting vs Business Operations). When JobFit
  // returns Apply/Priority Apply, it has already weighed evidence
  // holistically and concluded the candidate is a strong match.
  // Overriding that to Case C purely on family-taxonomy mismatch
  // contradicts the stronger upstream signal. On Review the verdict is
  // ambivalent, so the mismatch acts as a tiebreaker pushing toward C.
  // Surfaced 2026-05-16 by Product Marketing Intern @ Diligent test
  // case: Apply/91, one minor risk, was wrongly routed to Case C.
  //
  // "Other" semantics:
  //   - targetFamilies === ["Other"] (single-element, just-Other) →
  //     treated as no-signal, skip. "Other" usually means "no specific
  //     target stated," not "specifically the Other family."
  //   - jobFamily === "Other" or "unknown" → JD classifier couldn't pin
  //     the family; no signal to compare against, skip.
  //   - Multi-element targets containing Other (e.g. ["Marketing", "Other"])
  //     → standard .includes() applies; jobFamily must match one of them.
  const targetFamilies = jobfit.profile_signals?.targetFamilies
  const jobFamily = jobfit.job_signals?.jobFamily
  const targetsAreSignal =
    Array.isArray(targetFamilies) &&
    targetFamilies.length > 0 &&
    !(targetFamilies.length === 1 && targetFamilies[0] === "Other")
  const jobFamilyIsSignal =
    typeof jobFamily === "string" &&
    jobFamily.length > 0 &&
    jobFamily !== "Other" &&
    jobFamily !== "unknown"
  if (
    verdict === "Review" &&
    targetsAreSignal &&
    jobFamilyIsSignal &&
    !targetFamilies!.includes(jobFamily!)
  ) {
    return {
      case: "C",
      reasoning: `Profile targets [${targetFamilies!.join(", ")}] don't overlap with JD family ${jobFamily}; fundamental field mismatch.`,
    }
  }

  // Rule 3: Review
  if (verdict === "Review") {
    if (hasHighSeverity && CASE_C_HIGH_SEVERITY_TRIGGER) {
      return {
        case: "C",
        reasoning: `JobFit verdict is Review with high-severity risk: ${
          topHighRisk?.keyword || "unspecified"
        }.`,
      }
    }
    return {
      case: "B",
      reasoning: risks.dataQualityIssue
        ? "JobFit verdict is Review; risk data had quality issues but appears manageable. Targeted changes needed."
        : "JobFit verdict is Review with manageable risks; targeted changes needed.",
    }
  }

  // Rule 5: Apply or Priority Apply
  if (verdict === "Apply" || verdict === "Priority Apply") {
    // Case A: clean signal AND sufficient positive findings AND data trustworthy.
    // Relaxed 2026-05-15: zero-risks OR all-low-severity-risks now satisfy
    // the "clean signal" precondition. Rationale: prod B3 data (tuning
    // session) showed 91.2% of Apply verdicts have ≥1 risk; the strict
    // zero-risks gate made Case A unreachable in practice for non-Priority-
    // Apply verdicts. Low-severity risks are surfaced as small_refinements
    // by caseSpecific.ts::buildCaseAData (the FRD-spec "1-2 refinements"
    // surface).
    const allRisksLow =
      risks.items.length > 0 &&
      risks.items.every((r) => r.severity === "low")
    if (
      (risks.items.length === 0 || allRisksLow) &&
      whys >= CASE_A_MIN_WHY_COUNT &&
      !risks.dataQualityIssue
    ) {
      const reasoning =
        risks.items.length === 0
          ? `JobFit verdict is ${verdict} with no surfaced risks and ${whys} positive findings.`
          : `JobFit verdict is ${verdict} with ${risks.items.length} low-severity risk(s) (surfaced as refinements) and ${whys} positive findings.`
      return { case: "A", reasoning }
    }

    // High-severity even with favorable verdict → Case B
    if (hasHighSeverity) {
      return {
        case: "B",
        reasoning: `Favorable JobFit verdict (${verdict}) but high-severity risk present: ${
          topHighRisk?.keyword || "unspecified"
        }.`,
      }
    }

    // Default Case B
    const baseReasoning = `JobFit verdict is ${verdict} with ${risks.items.length} risk(s); targeted changes needed.`
    return {
      case: "B",
      reasoning: risks.dataQualityIssue
        ? `${baseReasoning} (Note: data quality issue in risk_structured.)`
        : baseReasoning,
    }
  }

  // Rule 7: Defensive fallback. Unreachable given current JobfitVerdict
  // literal union — extractVerdict validates against the 4 known values
  // and the if-chain above covers all 4. Belt-and-suspenders for any
  // future JobfitVerdict extension that slips through validation.
  return {
    case: "B",
    reasoning: `Unexpected verdict "${String(verdict)}"; defaulting to Case B (data quality issue).`,
  }
}
