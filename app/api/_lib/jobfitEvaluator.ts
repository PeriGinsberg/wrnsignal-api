// app/api/_lib/jobfitEvaluator.ts

import { evaluateJobFit } from "../jobfit/evaluator"
import type { EvalOutput, StructuredProfileSignals } from "../jobfit/signals"

// Keep legacy UI contract (UI depends on this shape)
type Decision = "Apply" | "Review" | "Pass"
type LocationConstraint = "constrained" | "not_constrained" | "unclear"

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠️"
  return "⛔"
}

/**
 * Deterministic JobFit runner.
 * Compatibility wrapper around /jobfit/* engine.
 */
export async function runJobFit({
  profileText,
  jobText,
  profileOverrides,
}: {
  profileText: string
  jobText: string
  profileOverrides?: Partial<StructuredProfileSignals>
}) {
  const out: EvalOutput = evaluateJobFit({
    jobText,
    profileText,
    profileOverrides,
  })

  return {
    decision: out.decision as Decision,
    icon: iconForDecision(out.decision as Decision),
    score: out.score,
    bullets: out.bullets.slice(0, 8),
    risk_flags: out.risk_flags.slice(0, 6),
    next_step: out.next_step,
    location_constraint: out.location_constraint as LocationConstraint,

    // dev-only fields (route can choose to expose)
    why_codes: out.why_codes,
    risk_codes: out.risk_codes,
    gate_triggered: out.gate_triggered,
  }
}