// FILE: app/api/_lib/jobfitEvaluator.ts
// Deterministic JobFit orchestrator.
// This file is the real engine wrapper used by routes.
// No circular calls back into app/api/jobfit/evaluator.ts.

import { extractJobSignals, extractProfileSignals } from "../jobfit/extract"
import { evaluateGates } from "../jobfit/constraints"
import { scoreJobFit } from "../jobfit/scoring"
import { decisionFromScore, applyGateOverrides, applyRiskDowngrades, applyEvidenceGuardrails, capScoreForDecision } from "../jobfit/decision"
import type {
  EvalOutput,
  StructuredProfileSignals,
  Decision,
  LocationConstraint,
} from "../jobfit/signals"
import { renderBulletsV4, RENDERER_V4_STAMP } from "../jobfit/deterministicBulletRendererV4"

export const JOBFIT_EVAL_WRAPPER_STAMP =
  "JOBFIT_EVAL_WRAPPER_STAMP__2026_03_07__DIRECT_DETERMINISTIC_ORCHESTRATOR__B"

console.log("[jobfitEvaluator] loaded:", JOBFIT_EVAL_WRAPPER_STAMP)

function iconForDecision(decision: Decision) {
  if (decision === "Priority Apply") return "🔥"
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠"
  return "⛔"
}

function decisionNextStep(decision: Decision): string {
  if (decision === "Priority Apply") {
    return "Apply now. Then send 2 targeted networking messages within 24 hours."
  }
  if (decision === "Apply") {
    return "Apply. Then send 2 targeted networking messages within 24 hours."
  }
  if (decision === "Review") {
    return "Only proceed if you can reduce the top risks. If yes, apply and network immediately."
  }
  return "Pass. Do not apply. Put that effort into a better-fit role."
}

function locationConstraintFromProfile(
  profileOverrides?: Partial<StructuredProfileSignals>
): LocationConstraint {
  if (!profileOverrides || !profileOverrides.locationPreference) return "unclear"
  return profileOverrides.locationPreference.constrained ? "constrained" : "not_constrained"
}

export async function runJobFit(args: {
  profileText: string
  jobText: string
  profileOverrides?: Partial<StructuredProfileSignals>
  // User-provided job title and company name override extracted values
  // BEFORE scoring runs (not just at the end for display). The scoring
  // engine uses jobSignals.jobTitle directly — e.g. for target-role
  // matching, title-based family inference, etc. — so it must see the
  // authoritative user value, not the extractor's best guess.
  userJobTitle?: string
  userCompanyName?: string
}): Promise<
  EvalOutput & {
    icon: string
    debug: Record<string, unknown>
  }
> {
  // Pass the user-provided title INTO extraction so title-based family
  // detectors (jobTitleIsSoftware, jobTitleIsCyberSecurity, jobTitleIsHR,
  // etc.) can see it. Without this, short or company-heavy JDs whose
  // first 1500 chars do not repeat the title get misclassified —
  // e.g. a Maybern "Software Engineer" JD that opens with a company
  // blurb was classifying as Marketing family.
  const jobSignals = extractJobSignals(args.jobText || "", {
    userJobTitle: args.userJobTitle,
  })

  // Overwrite the surface jobTitle / companyName fields for display.
  // Extraction used the title for family detection but may have set its
  // own `jobTitle` from the JD body; the user-entered value is
  // authoritative for downstream consumers.
  if (args.userJobTitle) jobSignals.jobTitle = args.userJobTitle
  if (args.userCompanyName) jobSignals.companyName = args.userCompanyName

  const profileSignals = extractProfileSignals(args.profileText || "", args.profileOverrides || {})

  const gate = evaluateGates(jobSignals, profileSignals)
  const scored = scoreJobFit(jobSignals, profileSignals)

  const decisionInitial = decisionFromScore(scored.score)
  const decisionAfterGate = applyGateOverrides(decisionInitial, gate)
  const decisionAfterRisk = applyRiskDowngrades(decisionAfterGate, scored.penaltySum, scored.riskCodes)
  // Evidence guardrails: cap decision when the underlying evidence is
  // too thin or the risk load is too heavy, regardless of raw score.
  // Prevents "Apply" with zero WHY codes or 4+ high-severity risks.
  const guardrail = applyEvidenceGuardrails(decisionAfterRisk, scored.whyCodes, scored.riskCodes, {
    yearsRequired: jobSignals.yearsRequired,
    yearsExperienceApprox: profileSignals.yearsExperienceApprox,
  })
  const decisionFinal = guardrail.decision

  // When a hard gate fires, the raw score is misleading — a candidate who
  // cannot get an interview should never see a 60+ score. Cap gate scores
  // at 25 so the number clearly matches the Pass decision.
  const gateScore = gate.type === "force_pass"
    ? Math.min(scored.score, 25)
    : capScoreForDecision(scored.score, decisionFinal)

  const baseOut: EvalOutput = {
    decision: decisionFinal,
    score: gateScore,
    bullets: [],
    risk_flags: [],
    next_step: decisionNextStep(decisionFinal),
    location_constraint: locationConstraintFromProfile(args.profileOverrides),
    why_codes: gate.type === "force_pass" ? [] : scored.whyCodes,
    risk_codes: scored.riskCodes,
    gate_triggered: gate,
    job_signals: jobSignals,
    profile_signals: profileSignals,
    score_breakdown: {
      raw_score: scored.score,
      clamped_score: gateScore,
      components: [
        { label: "decision_initial", points: 0, note: decisionInitial },
        { label: "decision_after_gate", points: 0, note: decisionAfterGate },
        { label: "decision_final", points: 0, note: decisionFinal },
        { label: "penalty_sum", points: -Math.round(scored.penaltySum), note: String(scored.penaltySum) },
      ],
    },
  }

  const rendered = renderBulletsV4(baseOut)

  return {
    ...baseOut,
    icon: iconForDecision(decisionFinal),
    bullets: rendered.why,
    risk_flags: rendered.risk,
    debug: {
      eval_wrapper_stamp: JOBFIT_EVAL_WRAPPER_STAMP,
      renderer_stamp: RENDERER_V4_STAMP,

      decision_initial: decisionInitial,
      decision_after_gate: decisionAfterGate,
      decision_final: decisionFinal,

      baseScore: scored.score,
      rawPenaltySum: scored.penalties.reduce((s, p) => s + p.amount, 0),
      penaltySum: scored.penaltySum,

      whyCount: scored.whyCodes.length,
      riskCount: scored.riskCodes.length,

      why_count: rendered.why.length,
      risk_count: rendered.risk.length,

      ...rendered.renderer_debug,
    },
  }
}