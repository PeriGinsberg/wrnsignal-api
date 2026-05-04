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

// Detect profile snippets that are skills-list boilerplate rather than
// action-backed proof. A direct WHY whose profile_fact is a pipe-separated
// competency list ("Financial Modeling | Investment Analysis | ...") or a
// "Strengths: client relationship building. analytical skills." tag line
// doesn't prove the candidate has actually DONE the work — it proves they
// listed it. These should not escape the no-direct-WHY Review cap on their
// own.
function isSkillsListBoilerplate(profileFact: string): boolean {
  if (!profileFact) return false
  const f = String(profileFact).trim()
  if (!f) return false
  // Pipe-separated skills lists: 3+ pipes means a tag row.
  const pipeCount = (f.match(/\|/g) || []).length
  if (pipeCount >= 3) return true
  // Explicit skills-list labels at the start of the snippet.
  if (/^(strengths?|skills?|competenc(?:y|ies)|tools?|certifications?|proficiencies|areas of expertise)\s*:/i.test(f)) {
    return true
  }
  // "Proficient in X, Y, Z" / "Proficient with X, Y, Z" style lists.
  if (/\bproficient (in|with)\b/i.test(f) && (f.match(/,/g) || []).length >= 2) return true
  return false
}

// A direct WHY is "high-quality" (counts toward the no-direct-WHY cap
// escape) only if its weight is >= MIN_QUALITY_DIRECT_WEIGHT AND its
// profile_fact is not skills-list boilerplate. This prevents a single
// inflated tool proof (weight ~60) or a single skills-list tag row from
// being the sole "proof" that a candidate should Apply.
const MIN_QUALITY_DIRECT_WEIGHT = 75

function isQualityDirectWhy(w: WhyCode): boolean {
  if (w.match_strength !== "direct") return false
  if ((w.weight ?? 0) < MIN_QUALITY_DIRECT_WEIGHT) return false
  if (isSkillsListBoilerplate(w.profile_fact || "")) return false
  return true
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
//   1. Zero WHY codes               → cap at Pass    (no evidence of any fit)
//   2. Zero QUALITY direct WHY codes → cap at Review  (only weak/boilerplate proof)
//      "Quality" means match_strength=direct AND weight >= 75 AND profile_fact
//      isn't a skills-list boilerplate snippet. A candidate whose only direct
//      matches are low-weight tool proofs or pipe-separated competency tags
//      hasn't actually demonstrated they've done the work.
//   3. 4+ high-severity risks       → cap at Pass    (too many red flags)
//   4. 3  high-severity risks       → cap at Review
//   5. Severe tenure gap            → cap at Review
//      When the JD demands >=3 years and the candidate is missing nearly
//      the entire requirement (gap >= yearsRequired - 1), Apply is wrong
//      regardless of how many keyword matches surface. A single high-
//      severity RISK_EXPERIENCE alone doesn't drag the decision down
//      because high-risk caps don't fire until 3+. This rule catches the
//      "undergrad vs 4-year minimum" shape specifically.
export function applyEvidenceGuardrails(
  decision: Decision,
  whyCodes: WhyCode[] = [],
  riskCodes: RiskCode[] = [],
  opts: { yearsRequired?: number | null; yearsExperienceApprox?: number | null } = {}
): { decision: Decision; reason: string | null } {
  const whyCount = whyCodes.length
  const directCount = whyCodes.filter((w) => w.match_strength === "direct").length
  const qualityDirectCount = whyCodes.filter(isQualityDirectWhy).length
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

  // Rule 5: severe tenure gap. Fires when the JD's minimum is non-trivial
  // (>= 3 years) AND the candidate is missing at least half the requirement.
  // A 1-year shortfall on a 2-year posting should NOT cap — that's normal
  // stretch territory. But missing 50%+ of the required tenure is a
  // structural mismatch that no amount of keyword overlap can rescue.
  // Examples that DO cap: 0y vs 3y, 2y vs 4y, 2y vs 5y, 3y vs 6y.
  // Examples that DON'T cap: 3y vs 4y (one short), 4y vs 6y (two short
  // but only 33%), any case where one of the numbers is missing.
  const yReq = typeof opts.yearsRequired === "number" ? opts.yearsRequired : null
  const yHave = typeof opts.yearsExperienceApprox === "number" ? opts.yearsExperienceApprox : null
  if (yReq !== null && yHave !== null && yReq >= 3 && yReq - yHave >= yReq / 2) {
    const capped = capDecision(decision, "Review")
    if (capped !== decision) {
      const reason = `severe tenure gap (have ~${yHave}y, need ${yReq}y)`
      console.log(`[decision] Evidence guardrail: ${decision} -> ${capped} (${reason})`)
      return { decision: capped, reason }
    }
  }

  // Rule 2: no QUALITY direct evidence means only weak, boilerplate, or
  // adjacent/inferred matches — not strong enough to recommend applying.
  // Quality = direct + weight >= 75 + profile_fact isn't skills-list boilerplate.
  if (qualityDirectCount === 0 && whyCount > 0) {
    const capped = capDecision(decision, "Review")
    if (capped !== decision) {
      const reason = directCount === 0
        ? `no direct WHY codes — only adjacent evidence`
        : `no quality direct WHY codes (${directCount} direct WHYs were all low-weight or skills-list boilerplate)`
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