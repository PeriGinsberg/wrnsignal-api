// FILE: app/api/_lib/jobfitEvaluator.ts
// Deterministic JobFit orchestrator.
// This file is the real engine wrapper used by routes.
// No circular calls back into app/api/jobfit/evaluator.ts.

import { extractJobSignals, extractProfileSignals } from "../jobfit/extract"
import { evaluateGates } from "../jobfit/constraints"
import {
  scoreJobFit,
  buildEvidenceMatches,
  type WhyEvidenceMatch,
  type RequirementCoverage,
} from "../jobfit/scoring"
import {
  resolveSuppressions,
  verdictKey,
  type VerdictCache,
  type VerdictLog,
} from "../jobfit/semanticRelevance"
import { decisionFromScore, applyGateOverrides, applyRiskDowngrades, applyEvidenceGuardrails, capScoreForDecision } from "../jobfit/decision"
import { buildGateLedger, applyLedgerCap, type GateLedgerEntry } from "../jobfit/gateLedger"
import { classifyRequirements } from "../jobfit/gateClassifier"
import { extractProfileEvidence } from "../jobfit/profileEvidence"
import { extractVerbEvidence } from "../jobfit/verbEvidence"
import { detectOwnershipVerbMismatch } from "../jobfit/verbMismatch"
import { detectPresenceRisks, detectSemanticRisks, bumpSeniorityIfExtreme } from "../jobfit/riskDetectors"
import { resolveResumeEvidence, type ResumeExtractCache } from "../jobfit/llmResumeExtractor"
import { isDevEnvironment } from "../../../lib/devOnly"
import type {
  EvalOutput,
  StructuredProfileSignals,
  StructuredJobSignals,
  Decision,
  LocationConstraint,
} from "../jobfit/signals"
import { renderBulletsV4, RENDERER_V4_STAMP } from "../jobfit/deterministicBulletRendererV4"
import { extractJobSignalsLLM } from "../jobfit/extractJobSignalsLLM"
import { llmJobExtractionToSignals } from "../jobfit/llmJobSignalsAdapter"
import type { ExtractionCache } from "../jobfit/extractionCache"

export const JOBFIT_EVAL_WRAPPER_STAMP =
  "JOBFIT_EVAL_WRAPPER_STAMP__2026_03_07__DIRECT_DETERMINISTIC_ORCHESTRATOR__B"

console.log("[jobfitEvaluator] loaded:", JOBFIT_EVAL_WRAPPER_STAMP)

// In-memory extraction cache — mirrors the semantic layer's SEMANTIC_VERDICT_CACHE
// (warm-instance reuse on Fluid Compute, repopulated on cold start). No durable
// backing yet; see commit follow-up note (Supabase-backed ExtractionCache).
const EXTRACTION_CACHE: ExtractionCache = {}

// Warm-instance résumé-extraction cache for the non-prod detector path (mirrors
// EXTRACTION_CACHE / the semantic layer's cache; repopulated on cold start).
const RESUME_EXTRACT_CACHE: ResumeExtractCache = {}

// Non-prod opt-in for the defect #1–#3 detectors + the LLM résumé extractor.
// Returns the runJobFit flags ONLY when BOTH guards pass:
//   • JOBFIT_DETECTORS === "on" — explicit opt-in (lets you A/B detectors off/on),
//     mirrors the JOBFIT_LLM_EXTRACTION pattern.
//   • isDevEnvironment() — keyed to the dev Supabase ref (lib/devOnly.ts). In prod
//     — and on Vercel preview, which uses prod Supabase env — this is FALSE, so
//     even JOBFIT_DETECTORS=on cannot enable detectors against prod. Failsafe:
//     the guard tracks the DB the app points at, not VERCEL_ENV.
// When either guard fails it returns {}, so the runJobFit call is byte-identical
// to today's prod behavior (regex fail-open, no live LLM call, no ledger/risks).
// allowLive:true because real user inputs won't be in any frozen cache.
export function nonProdDetectorFlags(): {
  applyGateLedger?: boolean
  applyVerbMismatchRisk?: boolean
  applyRiskDetectors?: boolean
  resumeExtractor?: { cache: ResumeExtractCache; allowLive: boolean }
} {
  if (process.env.JOBFIT_DETECTORS !== "on" || !isDevEnvironment()) return {}
  return {
    applyGateLedger: true,
    applyVerbMismatchRisk: true,
    applyRiskDetectors: true,
    resumeExtractor: { cache: RESUME_EXTRACT_CACHE, allowLive: true },
  }
}

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
  // Stage 0 regression harness opt-in. When true, attach the full match set +
  // coverage under `engine_trace` on the return. Route callers omit this, so
  // their output is byte-identical (no engine_trace key, no payload bloat).
  includeEngineTrace?: boolean
  // Shadow-scoring seam. When provided, skip the internal regex extraction and
  // score this pre-built job-signal object instead. No live caller — the shadow
  // harness uses it to feed LLM-adapted signals through the same spine. Omit for
  // byte-identical behavior (cf. includeEngineTrace precedent).
  jobSignalsOverride?: StructuredJobSignals
  // Per-requirement gate ledger (defect #1). Opt-in, OFF by default: computes
  // the ledger and FLOORS the verdict to PASS on any unmet required gate. Left
  // off on the prod path until the résumé-side extractor is prod-hardened
  // (DESIGN §5a); the golden harness passes true.
  applyGateLedger?: boolean
  // Ownership evidence-verb mismatch RISK (defect #2). Opt-in, OFF by default —
  // same prod-off posture as applyGateLedger (résumé-side extractor is
  // corpus-fitted, DESIGN-verb-classifier §6). The golden harness passes true.
  applyVerbMismatchRisk?: boolean
  // Risk under-detection detectors (defect #3): domain_gap, crm_pipeline_absent,
  // revenue_metrics_absent, stale_skill, people_mgmt_absent, scope_inversion,
  // adjacency_inflation, + a seniority severity bump. Opt-in, OFF by default —
  // corpus-fitted (DESIGN-risk-detectors §Prod). Golden harness passes true.
  applyRiskDetectors?: boolean
  // LLM résumé extractor (§5a/§6 hardening). When provided, résumé evidence is
  // read by the span-grounded LLM extractor (frozen cache in the harness); when
  // omitted, the deterministic regex extractor is used (fail-open / prod today).
  resumeExtractor?: { cache: ResumeExtractCache; allowLive: boolean }
}): Promise<
  EvalOutput & {
    icon: string
    debug: Record<string, unknown>
    engine_trace?: { matches: WhyEvidenceMatch[]; coverage: RequirementCoverage[] }
  }
> {
  // Pass the user-provided title INTO extraction so title-based family
  // detectors (jobTitleIsSoftware, jobTitleIsCyberSecurity, jobTitleIsHR,
  // etc.) can see it. Without this, short or company-heavy JDs whose
  // first 1500 chars do not repeat the title get misclassified —
  // e.g. a Maybern "Software Engineer" JD that opens with a company
  // blurb was classifying as Marketing family.
  let jobSignals: StructuredJobSignals
  if (args.jobSignalsOverride) {
    // Explicit override (shadow harness) wins — unchanged.
    jobSignals = args.jobSignalsOverride
  } else if (process.env.JOBFIT_LLM_EXTRACTION === "on") {
    // LLM-first extraction (cutover), gated by env flag. extractJobSignalsLLM
    // FAILS OPEN: returns null on missing key / HTTP / refusal / unparseable /
    // throw, so any LLM hiccup silently falls back to regex — a JobFit run
    // NEVER hard-fails on the LLM path. The fallback is logged (to watch the
    // fail-open rate on dev) but never surfaced to the user.
    const llm = await extractJobSignalsLLM(args.jobText || "", {
      userJobTitle: args.userJobTitle,
      cache: EXTRACTION_CACHE,
      allowLive: true,
    })
    if (llm) {
      jobSignals = llmJobExtractionToSignals(llm, {
        jobText: args.jobText || "",
        userJobTitle: args.userJobTitle,
      })
    } else {
      console.warn("[jobfitEvaluator] LLM extraction unavailable — fail-open to regex")
      jobSignals = extractJobSignals(args.jobText || "", { userJobTitle: args.userJobTitle })
    }
  } else {
    // Default (flag off): regex extraction — current behavior, byte-identical.
    jobSignals = extractJobSignals(args.jobText || "", { userJobTitle: args.userJobTitle })
  }

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

  // Ownership evidence-verb mismatch RISK (defect #2). Opt-in / OFF by default.
  // When it fires, append RISK_OWNERSHIP_VERB_MISMATCH (HIGH) so it composes
  // through applyRiskDowngrades below — a RISK, never a gate; a targeted
  // Apply→Review cap for this code lives in decision.ts. Computed AFTER the
  // boost so the boost still keys on the original zero-risk shape.
  // Résumé evidence (defect #1–#3 consumers), computed ONCE. LLM extractor when
  // args.resumeExtractor is provided (frozen in the harness), else regex
  // fail-open. Same ProfileEvidence + VerbBullet[] shapes either way.
  const needEv = args.applyGateLedger || args.applyVerbMismatchRisk || args.applyRiskDetectors
  const resumeEv = needEv
    ? await resolveResumeEvidence(args.profileText || "", args.resumeExtractor ? { llm: args.resumeExtractor } : undefined)
    : undefined

  let riskCodes = scored.riskCodes
  if (args.applyVerbMismatchRisk) {
    const vm = detectOwnershipVerbMismatch(args.jobText || "", resumeEv!.verbBullets)
    if (vm.fires) {
      riskCodes = [
        ...scored.riskCodes,
        {
          code: "RISK_OWNERSHIP_VERB_MISMATCH",
          job_fact: `Requirement demands ownership of ${vm.firedOn}`,
          profile_fact: "résumé evidence for it is contribution verbs only (partnered/supported/assisted)",
          risk: "Ownership requirement substantiated only by contribution verbs, not ownership verbs (owned/built/led/drove).",
          severity: "high",
        },
      ]
    }
  }

  // Risk under-detection detectors (defect #3). Opt-in / OFF by default. Append
  // the detected risks and apply the seniority severity bump, then let the
  // existing applyRiskDowngrades / guardrails cascade consume the fuller set.
  if (args.applyRiskDetectors) {
    const jobText = args.jobText || ""
    const profileText = args.profileText || ""
    const candidates = classifyRequirements(jobText)
    const evidence = resumeEv!.profileEvidence
    const verbBullets = resumeEv!.verbBullets
    const detected = [
      ...detectPresenceRisks({ jobText, profileText, candidates, evidence }),
      ...detectSemanticRisks({ jobText, profileText, candidates, evidence, verbBullets }),
    ]
    riskCodes = bumpSeniorityIfExtreme([...riskCodes, ...detected], {
      yearsRequired: jobSignals.yearsRequired,
      yearsExperience: profileSignals.yearsExperienceApprox,
      jobText,
    })
  }

  const decisionInitial = decisionFromScore(scoreAfterBoost)
  const decisionAfterGate = applyGateOverrides(decisionInitial, gate)
  const decisionAfterRisk = applyRiskDowngrades(decisionAfterGate, scored.penaltySum, riskCodes)
  // Evidence guardrails: cap decision when the underlying evidence is
  // too thin or the risk load is too heavy, regardless of raw score.
  // Prevents "Apply" with zero WHY codes or 4+ high-severity risks.
  const guardrail = applyEvidenceGuardrails(decisionAfterRisk, scored.whyCodes, riskCodes, {
    yearsRequired: jobSignals.yearsRequired,
    yearsExperienceApprox: profileSignals.yearsExperienceApprox,
  })
  const decisionPreLedger = guardrail.decision

  // Per-requirement gate ledger (defect #1). COMPOSES with the coarse gate +
  // risk cascade above — it can only FLOOR the verdict to PASS when a required
  // gate is not MET; it never raises a verdict and never rewrites the score
  // math (the existing capScoreForDecision below consumes the final decision as
  // it always has). Opt-in / OFF by default (see args.applyGateLedger).
  let gateLedger: GateLedgerEntry[] | undefined
  let decisionFinal: Decision = decisionPreLedger
  if (args.applyGateLedger) {
    gateLedger = buildGateLedger(
      classifyRequirements(args.jobText || ""),
      resumeEv!.profileEvidence,
    )
    decisionFinal = applyLedgerCap(decisionPreLedger, gateLedger) as Decision
  }

  // Gate-reason line. §3b decision: a ledger knockout shows a MID score (~55,
  // via capScoreForDecision's Pass band below — NOT the coarse gate's 25). A 55
  // sits near the Apply band, so the candidate MUST see WHICH required gate
  // blocked them. Prepend an unmistakable "Blocked on" line naming the unmet
  // requirement(s); renders as next_step (the candidate's "your move").
  const ledgerBlockers = (gateLedger || []).filter((e) => e.required && e.status !== "MET")
  const nextStep = ledgerBlockers.length
    ? `Blocked on unmet required gate(s): ${ledgerBlockers.map((e) => `${e.requirement} [${e.status}]`).join("; ")}. ${decisionNextStep(decisionFinal)}`
    : decisionNextStep(decisionFinal)

  // §3b (one score authority): ANY gate block — coarse force_pass OR a ledger
  // unmet gate — shows the SAME mid ceiling via capScoreForDecision (a
  // force_pass forces decisionFinal="Pass", so this is ≤55). The old
  // coarse-only ≤25 tier is RETIRED; the "Blocked on" reason line above carries
  // severity, so it no longer needs to live in the number.
  const gateScore = capScoreForDecision(scoreAfterBoost, decisionFinal)

  const baseOut: EvalOutput = {
    decision: decisionFinal,
    score: gateScore,
    bullets: [],
    risk_flags: [],
    next_step: nextStep,
    location_constraint: locationConstraintFromProfile(args.profileOverrides),
    why_codes: gate.type === "force_pass" ? [] : scored.whyCodes,
    risk_codes: riskCodes,
    gate_triggered: gate,
    job_signals: jobSignals,
    profile_signals: profileSignals,
    gate_ledger: gateLedger,
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
    ...(args.includeEngineTrace
      ? { engine_trace: { matches: scored.allMatches, coverage: scored.coverage } }
      : {}),
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