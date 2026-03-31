import type { Decision, GateTriggered, RiskCode } from "./signals"
import { POLICY } from "./policy"

// Priority Apply threshold raised from 92 → 96.
// Intent: Priority Apply should be top ~10% of fits — exceptional, not just good.
// At maxScore=97, a score of 96+ means near-perfect keyword coverage with minimal gaps.
export function decisionFromScore(score: number): Decision {
  if (score >= 96) return "Priority Apply"
  if (score >= 75) return "Apply"
  if (score >= 60) return "Review"
  return "Pass"
}

export function applyGateOverrides(initial: Decision, gate: GateTriggered): Decision {
  if (gate.type === "force_pass") return "Pass"
  if (gate.type === "floor_review" && initial === "Apply") return "Review"
  return initial
}

// Priority Apply requires zero risk flags — any risk flag downgrades to Apply.
// This covers structural disqualifiers (part-time, seniority, location, employment type)
// that may not accumulate enough penalty points to trigger the old threshold-based downgrade.
export function applyRiskDowngrades(
  decision: Decision,
  penaltySum: number,
  riskCodes: RiskCode[] = []
): Decision {
  if (!POLICY.downgrade.enabled) return decision

  // Zero-tolerance rule: any risk flag blocks Priority Apply
  if (decision === "Priority Apply" && riskCodes.length > 0) {
    console.log(
      `[decision] Priority Apply blocked — ${riskCodes.length} risk flag(s):`,
      riskCodes.map(r => r.code).join(", ")
    )
    return "Apply"
  }

  // Fallback: also downgrade if penalty sum is high (catches edge cases)
  if (decision === "Priority Apply" && penaltySum >= 8) return "Apply"

  if (decision === "Apply" && penaltySum >= POLICY.downgrade.applyToReviewPenaltySum) return "Review"
  if (decision === "Review" && penaltySum >= POLICY.downgrade.reviewToPassPenaltySum) return "Pass"
  return decision
}