// FILE: app/api/jobfit/evaluator.ts

import type { Decision, EvalOutput, StructuredProfileSignals } from "./signals"
import { extractJobSignals, extractProfileSignals } from "./extract"
import { evaluateGates } from "./constraints"
import { scoreJobFit } from "./scoring"
import { applyGateOverrides, applyRiskDowngrades, decisionFromScore } from "./decision"

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

function clampScoreToDecision(d: Decision, s: number): number {
  if (d === "Pass") return Math.min(s, 39)
  if (d === "Review") return Math.max(40, Math.min(s, 69))
  return Math.max(70, Math.min(s, 97))
}

export function evaluateJobFit(input: EvaluateInput): EvalOutput {
  const job = extractJobSignals(input.jobText)
  const profile = extractProfileSignals(input.profileText || "", input.profileOverrides)

  const gate = evaluateGates(job, profile)
  const scoring = scoreJobFit(job, profile)

  let decision = decisionFromScore(scoring.score)
  decision = applyGateOverrides(decision, gate)
  decision = applyRiskDowngrades(decision, scoring.penaltySum)

  const location_constraint =
    job.location.constrained || profile.locationPreference.constrained
      ? "constrained"
      : job.location.mode === "unclear" && profile.locationPreference.mode === "unclear"
        ? "unclear"
        : "not_constrained"

  const clampedScore = clampScoreToDecision(decision, scoring.score)

  return {
    decision,
    score: clampedScore,
    bullets: [],
    risk_flags: [],
    next_step: nextStepForDecision(decision),
    location_constraint,
    why_codes: scoring.whyCodes,
    risk_codes: scoring.riskCodes,
    gate_triggered: gate,
    job_signals: job,
    profile_signals: profile,
  }
}