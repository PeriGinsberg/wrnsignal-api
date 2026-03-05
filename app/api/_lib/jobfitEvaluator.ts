// FILE: app/api/_lib/jobfitEvaluator.ts
// CLEAN REWRITE: V4 deterministic renderer only (no LLM substance)
// - Uses renderBulletsV4 for Apply/Review/Pass
// - Force-pass: NEVER shows WHY bullets (only risks)
// - Explicit debug stamps

import { evaluateJobFit } from "../jobfit/evaluator"
import type { EvalOutput, StructuredProfileSignals, Decision, LocationConstraint } from "../jobfit/signals"
import { renderBulletsV4, RENDERER_V4_STAMP } from "../jobfit/deterministicBulletRendererV4"

export const JOBFIT_EVAL_WRAPPER_STAMP =
  "JOBFIT_EVAL_WRAPPER_STAMP__2026_02_27__V4_RENDERER_ONLY__A"
console.log("[jobfitEvaluator] loaded:", JOBFIT_EVAL_WRAPPER_STAMP)

/* ----------------------- UI helpers ----------------------- */

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠️"
  return "⛔"
}

function decisionNextStep(decision: Decision): string {
  if (decision === "Apply") return "Apply. Then send 2 targeted networking messages within 24 hours."
  if (decision === "Review")
    return "Only proceed if you can reduce the top risks. If yes, apply and network immediately."
  return "Pass. Do not apply. Put that effort into a better-fit role."
}

/* ----------------------- MAIN EXPORT ----------------------- */

export async function runJobFit(args: {
  profileText: string
  jobText: string
  profileOverrides?: Partial<StructuredProfileSignals>
}) {
  const out = await evaluateJobFit({
    jobText: args.jobText,
    profileText: args.profileText,
    profileOverrides: args.profileOverrides,
  })

  const isForcePass = out?.gate_triggered?.type === "force_pass"

  // Single deterministic renderer for all outcomes
  // For force-pass we still render risks, but we never show WHY bullets.
  const rendered = renderBulletsV4(out)
  const why = isForcePass ? [] : rendered.why
  const risk = rendered.risk

  const finalDecision: Decision = isForcePass ? ("Pass" as Decision) : out.decision

  return {
    decision: finalDecision,
    icon: iconForDecision(finalDecision),
    score: out.score,
    bullets: why,
    risk_flags: risk,
    next_step: out.next_step || decisionNextStep(finalDecision),
    location_constraint: out.location_constraint as LocationConstraint,
    why_codes: isForcePass ? [] : out.why_codes,
    risk_codes: out.risk_codes,
    gate_triggered: out.gate_triggered,
    debug: {
      eval_wrapper_stamp: JOBFIT_EVAL_WRAPPER_STAMP,
      bullets_mode: "renderer_v4_deterministic",
      renderer_stamp: RENDERER_V4_STAMP,
      force_pass: isForcePass,
      why_count: why.length,
      risk_count: risk.length,
      why_codes_count: Array.isArray(out.why_codes) ? out.why_codes.length : 0,
      risk_codes_count: Array.isArray(out.risk_codes) ? out.risk_codes.length : 0,
      ...rendered.renderer_debug,
    },
  }
}