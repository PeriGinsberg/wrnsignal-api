// jobfit/scoring.ts

import { POLICY, PenaltyKey } from "./policy"
import { StructuredJobSignals, StructuredProfileSignals, RiskCode, WhyCode } from "./signals"

export type Penalty = {
  key: PenaltyKey
  amount: number
  note: string
  riskCode: RiskCode
}

export type ScoreResult = {
  score: number
  penalties: Penalty[]
  penaltySum: number
  whyCodes: WhyCode[]
  riskCodes: RiskCode[]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function applyDiminishingReturns(penaltySum: number): number {
  const softCap = POLICY.score.perPenaltySoftCap
  if (penaltySum <= softCap) return penaltySum
  const extra = penaltySum - softCap
  const reduced = extra * (1 - POLICY.score.diminishingReturnsRate)
  return softCap + reduced
}

function computePenaltyAmount(key: PenaltyKey): number {
  const p = POLICY.penalties[key]
  return p.severity * p.multiplier
}

function dedupeStrings(xs: string[]): string[] {
  return Array.from(new Set(xs))
}

function toolMissing(profileTools: string[], tool: string): boolean {
  const p = profileTools.map((x) => x.toLowerCase())
  return !p.includes(tool.toLowerCase())
}

export function scoreJobFit(job: StructuredJobSignals, profile: StructuredProfileSignals): ScoreResult {
  const penalties: Penalty[] = []
  const whyCodes: WhyCode[] = []
  const riskCodes: RiskCode[] = []

  // WHY signals (positive, deterministic)
  if (profile.targetFamilies.includes(job.jobFamily)) whyCodes.push("WHY_FAMILY_MATCH")
  if (job.jobFamily === "Marketing" && !job.analytics.isHeavy) whyCodes.push("WHY_MARKETING_EXECUTION")
  if (job.analytics.isLight && !job.analytics.isHeavy) whyCodes.push("WHY_MEASUREMENT_LIGHT")

  // Location match (only if both are clear enough)
  if (
    profile.locationPreference.mode !== "unclear" &&
    job.location.mode !== "unclear" &&
    profile.locationPreference.mode === job.location.mode
  ) {
    whyCodes.push("WHY_LOCATION_MATCH")
  }

  // Early-career friendliness (simple heuristic)
  if (!job.yearsRequired || job.yearsRequired <= 1) whyCodes.push("WHY_EARLY_CAREER_FRIENDLY")

  // Tool match (if required tools exist and profile has most)
  if (job.requiredTools.length > 0) {
    const missing = job.requiredTools.filter((t) => toolMissing(profile.tools, t))
    if (missing.length <= 1) whyCodes.push("WHY_TOOL_MATCH")
  }

  // RISK penalties

  // Location mismatch logic
  if (job.location.mode !== "unclear" && profile.locationPreference.mode !== "unclear") {
    if (job.location.mode !== profile.locationPreference.mode) {
      if (job.location.constrained || profile.locationPreference.constrained) {
        penalties.push({
          key: "location_mismatch_constrained",
          amount: computePenaltyAmount("location_mismatch_constrained"),
          note: "Constrained location mismatch",
          riskCode: "RISK_LOCATION",
        })
      } else {
        penalties.push({
          key: "location_mismatch_unclear",
          amount: computePenaltyAmount("location_mismatch_unclear"),
          note: "Location mismatch but not explicitly constrained",
          riskCode: "RISK_LOCATION",
        })
      }
    }
  }

  // Analytics mismatch (only penalize if profile explicitly prefers not heavy analytics)
  if (profile.constraints.preferNotAnalyticsHeavy && job.analytics.isHeavy) {
    penalties.push({
      key: "heavy_analytics_mismatch",
      amount: computePenaltyAmount("heavy_analytics_mismatch"),
      note: "Analytics heavy signals present",
      riskCode: "RISK_ANALYTICS_HEAVY",
    })
  }

  // Hard preference mismatches
  if (profile.constraints.hardNoSales && job.isSalesHeavy) {
    penalties.push({
      key: "sales_mismatch",
      amount: computePenaltyAmount("sales_mismatch"),
      note: "Sales signals present",
      riskCode: "RISK_SALES",
    })
  }

  if (profile.constraints.hardNoGovernment && job.isGovernment) {
    penalties.push({
      key: "government_mismatch",
      amount: computePenaltyAmount("government_mismatch"),
      note: "Government signals present",
      riskCode: "RISK_GOVERNMENT",
    })
  }

  // Contract and hourly are not treated as severe by default (your failure list)
  if (profile.constraints.prefFullTime && job.isContract) {
    penalties.push({
      key: "contract_mismatch",
      amount: computePenaltyAmount("contract_mismatch"),
      note: "Contract vs full-time preference",
      riskCode: "RISK_CONTRACT",
    })
  }

  if (profile.constraints.hardNoContract && job.isContract) {
    penalties.push({
      key: "contract_mismatch",
      amount: computePenaltyAmount("contract_mismatch") + 2, // still policy-based? keep it deterministic and visible
      note: "Hard no contract",
      riskCode: "RISK_CONTRACT",
    })
  }

  if (profile.constraints.hardNoHourlyPay && job.isHourly) {
    penalties.push({
      key: "hourly_pay_mismatch",
      amount: computePenaltyAmount("hourly_pay_mismatch"),
      note: "Hourly pay signals present",
      riskCode: "RISK_HOURLY",
    })
  }

  // Missing tools
  const requiredMissing = job.requiredTools.filter((t) => toolMissing(profile.tools, t))
  for (const tool of requiredMissing) {
    penalties.push({
      key: "missing_core_tool",
      amount: computePenaltyAmount("missing_core_tool"),
      note: `Missing required tool: ${tool}`,
      riskCode: "RISK_MISSING_TOOLS",
    })
  }

  const preferredMissing = job.preferredTools.filter((t) => toolMissing(profile.tools, t))
  for (const tool of preferredMissing) {
    penalties.push({
      key: "missing_preferred_tool",
      amount: computePenaltyAmount("missing_preferred_tool"),
      note: `Missing preferred tool: ${tool}`,
      riskCode: "RISK_MISSING_TOOLS",
    })
  }

  // Reporting/measurement strength
  if (job.reportingSignals.strong && !job.analytics.isHeavy) {
    penalties.push({
      key: "missing_reporting_signals",
      amount: computePenaltyAmount("missing_reporting_signals"),
      note: "Strong reporting ownership signals",
      riskCode: "RISK_REPORTING_SIGNALS",
    })
  }

  // Years experience gap
  if (job.yearsRequired && profile.yearsExperienceApprox !== null) {
    if (profile.yearsExperienceApprox + 0.5 < job.yearsRequired) {
      penalties.push({
        key: "experience_years_gap",
        amount: computePenaltyAmount("experience_years_gap"),
        note: `Years required ${job.yearsRequired}, profile approx ${profile.yearsExperienceApprox}`,
        riskCode: "RISK_EXPERIENCE",
      })
    }
  }

  // MBA / Grad hints as risks (gates handled elsewhere too)
  if (job.mbaRequired) {
    penalties.push({
      key: "mba_required",
      amount: computePenaltyAmount("mba_required"),
      note: "MBA required",
      riskCode: "RISK_MBA",
    })
  }

  if (job.gradYearHint && profile.gradYear) {
    const delta = Math.abs(profile.gradYear - job.gradYearHint)
    if (delta >= 2) {
      penalties.push({
        key: "grad_window_mismatch",
        amount: computePenaltyAmount("grad_window_mismatch"),
        note: "Graduation window mismatch",
        riskCode: "RISK_GRAD_WINDOW",
      })
    }
  }

  // Apply per-key stacking caps deterministically
  const counts: Record<string, number> = {}
  const capped: Penalty[] = []
  for (const p of penalties) {
    const maxStack = POLICY.penalties[p.key].maxStackCount ?? 999
    counts[p.key] = (counts[p.key] || 0) + 1
    if (counts[p.key] <= maxStack) capped.push(p)
  }

  // Total penalty sum with diminishing returns and hard cap
  const rawPenaltySum = capped.reduce((s, p) => s + p.amount, 0)
  const diminished = applyDiminishingReturns(rawPenaltySum)
  const penaltySum = Math.min(POLICY.score.penaltyStackCap, diminished)

  // Score calculation
  let score = POLICY.score.startScore - penaltySum
  score = clamp(score, POLICY.score.minScore, POLICY.score.maxScore)

  for (const p of capped) riskCodes.push(p.riskCode)

  return {
    score: Math.round(score),
    penalties: capped,
    penaltySum,
    whyCodes: dedupeStrings(whyCodes) as WhyCode[],
    riskCodes: dedupeStrings(riskCodes) as RiskCode[],
  }
}