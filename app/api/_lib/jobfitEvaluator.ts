// app/api/_lib/jobfitEvaluator.ts

import { evaluateJobFit } from "../jobfit/evaluator"
import type { EvalOutput } from "../jobfit/signals"

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
 * This is now a compatibility wrapper around /jobfit/* engine.
 */
export async function runJobFit({
  profileText,
  jobText,
}: {
  profileText: string
  jobText: string
}) {
  // If you do NOT yet have structured profile overrides wired from DB,
  // you can either:
  // 1) Keep this as text-only for now (engine will use conservative defaults),
  // 2) Or parse your existing structured profile JSON upstream and pass overrides here.

  const out: EvalOutput = evaluateJobFit({
    jobText,
    profileText,
    // profileOverrides: <optional> pass structured profile here once you wire it
  })

  return {
    decision: out.decision as Decision,
    icon: iconForDecision(out.decision as Decision),
    score: out.score,
    bullets: out.bullets.slice(0, 8),
    risk_flags: out.risk_flags.slice(0, 6),
    next_step: out.next_step,
    location_constraint: out.location_constraint as LocationConstraint,
    // If you want debug info available in dev without breaking UI,
    // you can optionally include these behind a flag in your API route:
    // why_codes: out.why_codes,
    // risk_codes: out.risk_codes,
    // gate_triggered: out.gate_triggered,
  }
}