// FILE: app/api/_lib/jobfitEvaluator.ts
// Deterministic JobFit orchestrator.
// This file is the real engine wrapper used by routes.
// No circular calls back into app/api/jobfit/evaluator.ts.

import { extractJobSignals, extractProfileSignals } from "../jobfit/extract"
import { evaluateGates } from "../jobfit/constraints"
import { scoreJobFit, buildEvidenceMatches } from "../jobfit/scoring"
import {
  resolveSuppressions,
  verdictKey,
  type VerdictCache,
  type VerdictLog,
} from "../jobfit/semanticRelevance"
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
  // Semantic evidence-relevance layer. When provided, suspect generic-on-
  // specialized matches are sent through the gated relevance check and
  // suppressed on a satisfies:false + confidence:high verdict. Omit to disable
  // (no suppression). Tests pass a frozen cache with allowLive:false for
  // determinism; the prod route passes a runtime cache with allowLive:true.
  semantic?: { cache: VerdictCache; allowLive: boolean; onVerdict?: (log: VerdictLog) => void }
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

  // Semantic relevance suppression (optional). Resolve which suspect matches
  // the gated LLM rejects, then hand scoreJobFit a predicate that drops them.
  let suppressMatch: ((m: { job_fact: string; profile_fact: string }) => boolean) | undefined
  if (args.semantic) {
    const matches = buildEvidenceMatches(jobSignals, profileSignals)
    const suppressed = await resolveSuppressions(
      matches.map((m) => ({
        job_unit_key: m.job_unit.key,
        profile_unit_key: m.profile_unit.key,
        match_strength: m.match_strength,
        weight: m.weight,
        job_fact: m.job_fact,
        profile_fact: m.profile_fact,
      })),
      jobSignals,
      args.semantic.cache,
      { allowLive: args.semantic.allowLive, onVerdict: args.semantic.onVerdict }
    )
    if (suppressed.size > 0) {
      suppressMatch = (m) => suppressed.has(verdictKey(m.job_fact, m.profile_fact))
    }
  }

  const scored = scoreJobFit(jobSignals, profileSignals, { suppressMatch })

  // High-confidence positive-match boost. The raw score undercredits the
  // "many matches, no gaps" shape: when a JD lists 10 requirements and a
  // candidate clearly matches 2-3 with direct evidence AND the engine
  // fires zero risks, the score lands in the 70-74 "almost-Apply" range
  // and the user sees Review with an empty risk list — an incoherent UX
  // ("address top risks" when there are no risks shown).
  //
  // Scope deliberately narrow: only fires when (a) score is already in
  // the 70-74 band (one threshold tick from Apply), (b) at least 2 direct
  // WHY matches surfaced, (c) zero risk codes, (d) penalty sum is
  // negligible. Bumps to 75 — the Apply threshold floor, no more — so the
  // boost is the minimum needed to flip the decision band, not a generous
  // re-rank. Doesn't fire for force_pass (handled separately below).
  const directWhyCount = scored.whyCodes.filter(
    (w) => w.match_strength === "direct"
  ).length
  const isHighConfidencePositive =
    directWhyCount >= 2 &&
    scored.riskCodes.length === 0 &&
    scored.penaltySum < 5
  const scoreAfterBoost =
    isHighConfidencePositive && scored.score >= 70 && scored.score < 75
      ? 75
      : scored.score
  if (scoreAfterBoost !== scored.score) {
    console.log(
      `[scoring] High-confidence positive boost: ${scored.score} -> ${scoreAfterBoost} ` +
        `(${directWhyCount} direct WHYs, ${scored.riskCodes.length} risks, ` +
        `penaltySum=${scored.penaltySum})`
    )
  }

  const decisionInitial = decisionFromScore(scoreAfterBoost)
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
    : capScoreForDecision(scoreAfterBoost, decisionFinal)

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