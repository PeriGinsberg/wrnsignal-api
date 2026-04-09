import type { Decision, GateTriggered, RiskCode, WhyCode } from "./signals"
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

  // Medium/high-severity risk blocks Priority Apply. Low-severity
  // "heads-up" risks (e.g., RISK_LOCATION_UNCLEAR, RISK_LOCATION_UNDISCLOSED)
  // are informational and should not downgrade a near-perfect match.
  // Previously ANY risk blocked Priority Apply which caused cases with
  // 4 direct WHYs and a single low-severity confirmation-request risk
  // to drop out of the top band.
  const blockingRisks = riskCodes.filter((r) => r.severity !== "low")
  if (decision === "Priority Apply" && blockingRisks.length > 0) {
    console.log(
      `[decision] Priority Apply blocked — ${blockingRisks.length} medium/high risk flag(s):`,
      blockingRisks.map((r) => r.code).join(", ")
    )
    return "Apply"
  }

  // Fallback: also downgrade if penalty sum is high (catches edge cases)
  if (decision === "Priority Apply" && penaltySum >= 8) return "Apply"

  if (decision === "Apply" && penaltySum >= POLICY.downgrade.applyToReviewPenaltySum) return "Review"
  if (decision === "Review" && penaltySum >= POLICY.downgrade.reviewToPassPenaltySum) return "Pass"
  return decision
}

// Rank decisions so we can take a min()-style cap.
const DECISION_RANK: Record<Decision, number> = {
  "Priority Apply": 3,
  "Apply": 2,
  "Review": 1,
  "Pass": 0,
}
const RANK_TO_DECISION: Decision[] = ["Pass", "Review", "Apply", "Priority Apply"]
function capDecision(current: Decision, ceiling: Decision): Decision {
  return DECISION_RANK[current] > DECISION_RANK[ceiling]
    ? RANK_TO_DECISION[DECISION_RANK[ceiling]]
    : current
}

// Evidence and risk guardrails — applied after score/gate/risk-downgrade logic.
//
// The score-based decision threshold is optimistic: title + family + tool
// matches can push a case to Apply even when there is no actual proof the
// candidate has done the work, or when the posting carries multiple
// high-severity warnings. These guardrails translate those signals into
// decision caps so the candidate never sees "Apply" alongside 4 red flags
// and zero evidence matches.
//
// Rules:
//   1. Zero WHY codes         → cap at Pass    (no evidence of any fit)
//   2. Zero DIRECT WHY codes  → cap at Review  (only adjacent/inferred)
//   3. 4+ high-severity risks → cap at Pass    (too many red flags)
//   4. 3  high-severity risks → cap at Review
export function applyEvidenceGuardrails(
  decision: Decision,
  whyCodes: WhyCode[] = [],
  riskCodes: RiskCode[] = []
): { decision: Decision; reason: string | null } {
  const whyCount = whyCodes.length
  const directCount = whyCodes.filter((w) => w.match_strength === "direct").length
  const highRiskCount = riskCodes.filter((r) => r.severity === "high").length

  // Rule 1: zero WHY codes means we found nothing — Pass.
  if (whyCount === 0) {
    const capped = capDecision(decision, "Pass")
    if (capped !== decision) {
      const reason = `zero WHY codes — no evidence of fit`
      console.log(`[decision] Evidence guardrail: ${decision} -> ${capped} (${reason})`)
      return { decision: capped, reason }
    }
  }

  // Rule 3 & 4: high-severity risk ceilings. Check BEFORE rule 2 because
  // risk ceilings should apply even when direct evidence exists — a role
  // with 4 high-severity risks is not an Apply regardless of proof.
  if (highRiskCount >= 4) {
    const capped = capDecision(decision, "Pass")
    if (capped !== decision) {
      const reason = `${highRiskCount} high-severity risks (>= 4)`
      console.log(`[decision] Evidence guardrail: ${decision} -> ${capped} (${reason})`)
      return { decision: capped, reason }
    }
  } else if (highRiskCount >= 3) {
    const capped = capDecision(decision, "Review")
    if (capped !== decision) {
      const reason = `${highRiskCount} high-severity risks (>= 3)`
      console.log(`[decision] Evidence guardrail: ${decision} -> ${capped} (${reason})`)
      return { decision: capped, reason }
    }
  }

  // Rule 2: no direct evidence means only adjacent/inferred matches —
  // not strong enough to recommend applying.
  if (directCount === 0 && whyCount > 0) {
    const capped = capDecision(decision, "Review")
    if (capped !== decision) {
      const reason = `no direct WHY codes — only adjacent evidence`
      console.log(`[decision] Evidence guardrail: ${decision} -> ${capped} (${reason})`)
      return { decision: capped, reason }
    }
  }

  return { decision, reason: null }
}

// Cap the displayed score to the ceiling of the decision band so the
// number matches the label. A Pass with score 86 is confusing — the
// decision says don't apply but the score looks good. After a guardrail
// downgrade, clamp the score into the target band.
export function capScoreForDecision(score: number, decision: Decision): number {
  switch (decision) {
    case "Pass":
      return Math.min(score, 55)
    case "Review":
      return Math.min(score, 74)
    case "Apply":
      return Math.min(score, 95)
    case "Priority Apply":
      return score
  }
}