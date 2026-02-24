// jobfit/decision.ts

import { Decision, Gate, POLICY } from "./policy"

export function decisionFromScore(score: number): Decision {
  if (score >= POLICY.thresholds.apply) return "Apply"
  if (score >= POLICY.thresholds.review) return "Review"
  return "Pass"
}

export function applyGateOverrides(initial: Decision, gate: Gate): Decision {
  if (gate.type === "force_pass") return "Pass"
  if (gate.type === "floor_review" && initial === "Apply") return "Review"
  return initial
}

export function applyRiskDowngrades(decision: Decision, penaltySum: number): Decision {
  if (!POLICY.downgrade.enabled) return decision

  if (decision === "Apply" && penaltySum >= POLICY.downgrade.applyToReviewPenaltySum) return "Review"
  if (decision === "Review" && penaltySum >= POLICY.downgrade.reviewToPassPenaltySum) return "Pass"
  return decision
}