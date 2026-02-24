// jobfit/evaluator.ts

import { POLICY, Decision } from "./policy"
import { extractJobSignals, extractProfileSignals } from "./extract"
import { evaluateGates } from "./constraints"
import { scoreJobFit } from "./scoring"
import { applyGateOverrides, applyRiskDowngrades, decisionFromScore } from "./decision"
import { EvalOutput, RiskItem, WhyItem, StructuredProfileSignals } from "./signals"

function dedupe<T extends string>(xs: T[]): T[] {
  return Array.from(new Set(xs))
}

function nextStepForDecision(d: Decision): string {
  if (d === "Apply") return "Apply. Then send 2 targeted networking messages within 24 hours."
  if (d === "Review") return "Only proceed if you can reduce the top risks. If yes, apply and network immediately."
  return "Pass. Do not apply. Put that effort into a better-fit role."
}

export type EvaluateInput = {
  jobText: string
  profileText?: string
  profileOverrides?: Partial<StructuredProfileSignals>
}

export function evaluateJobFit(input: EvaluateInput): EvalOutput {
  const job = extractJobSignals(input.jobText)
  const profile = extractProfileSignals(input.profileText || "", input.profileOverrides)

  const gate = evaluateGates(job, profile)
  const scoring = scoreJobFit(job, profile)

  // Base decision from score
  let decision = decisionFromScore(scoring.score)

  // Gate override
  decision = applyGateOverrides(decision, gate)

  // Risk-based downgrade (penalty sum based)
  decision = applyRiskDowngrades(decision, scoring.penaltySum)

  // Presentation layer
  const location_constraint =
    job.location.constrained || profile.locationPreference.constrained
      ? "constrained"
      : job.location.mode === "unclear" && profile.locationPreference.mode === "unclear"
      ? "unclear"
      : "not_constrained"

  // Pass: show only pass reason bullets (no pros/risks mixed)
  if (decision === "Pass") {
    const passText =
      gate.type === "force_pass"
        ? POLICY.bullets.pass[gate.gateCode] || "Pass. Hard mismatch."
        : "Pass. The risks outweigh the upside for your profile."

    return {
      decision,
      score: scoring.score,
      bullets: [passText],
      risk_flags: [],
      next_step: nextStepForDecision(decision),
      location_constraint,
     why_codes: dedupe(scoring.whyCodes),
risk_codes: dedupe(scoring.riskCodes),
      gate_triggered: gate.type === "none" ? { type: "none" } : { type: gate.type, gateCode: gate.gateCode },
    }
  }

  // Why bullets
  const whyItems: WhyItem[] = scoring.whyCodes.map((c) => ({ code: c, text: POLICY.bullets.why[c] }))
  // Risk bullets
  const riskItems: RiskItem[] = scoring.riskCodes.map((c) => ({ code: c, text: POLICY.bullets.risk[c] }))

  const bullets = dedupe(whyItems.map((x) => x.text)).slice(0, 6)
  const risk_flags = dedupe(riskItems.map((x) => x.text)).slice(0, 6)

  return {
    decision,
    score: scoring.score,
    bullets,
    risk_flags,
    next_step: nextStepForDecision(decision),
    location_constraint,
    why_codes: dedupe(scoring.whyCodes),
    risk_codes: dedupe(scoring.riskCodes),
    gate_triggered: gate.type === "none" ? { type: "none" } : { type: gate.type, gateCode: gate.gateCode },
  }
}