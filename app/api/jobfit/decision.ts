import type { Decision, GateTriggered } from "./signals"
import { POLICY } from "./policy"

export function decisionFromScore(score: number): Decision {
  if (score >= 92) return "Priority Apply"
  if (score >= 75) return "Apply"
  if (score >= 60) return "Review"
  return "Pass"
}
export function applyGateOverrides(initial: Decision, gate: GateTriggered): Decision {
  if (gate.type === "force_pass") return "Pass"
  if (gate.type === "floor_review" && initial === "Apply") return "Review"
  return initial
}


export function applyRiskDowngrades(decision: Decision, penaltySum: number): Decision {
  if (!POLICY.downgrade.enabled) return decision
  if (decision === "Priority Apply" && penaltySum >= 8) return "Apply"
  if (decision === "Apply" && penaltySum >= POLICY.downgrade.applyToReviewPenaltySum) return "Review"
  if (decision === "Review" && penaltySum >= POLICY.downgrade.reviewToPassPenaltySum) return "Pass"
  return decision
}