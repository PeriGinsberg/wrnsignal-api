// app/api/jobfit/scoring.ts

import { POLICY, PenaltyKey } from "./policy"
import type {
  StructuredJobSignals,
  StructuredProfileSignals,
  RiskCode,
  WhyCode,
} from "./signals"

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

function normalizeCity(s: string): string {
  const t = (s || "").trim().toLowerCase()

  if (t.includes("new york")) return "new york"
  if (t.includes("nyc")) return "new york"

  if (t.includes("boston")) return "boston"
  if (t.includes("philadelphia") || t.includes("philly")) return "philadelphia"
  if (t.includes("washington") && (t.includes("dc") || t.includes("d.c"))) return "washington, d.c."

  return t
}

function locationCityMatches(jobCity: string, preferredCities: string[]) {
  const j = normalizeCity(jobCity)
  const prefs = preferredCities.map(normalizeCity)
  return prefs.includes(j)
}

/**
 * IMPORTANT:
 * Old model: score = startScore - penalties
 * Problem: most internships generate few penalties, so score clusters (93 forever).
 *
 * New model:
 * score = baseFromFitSignals + bonuses - penalties
 * Still deterministic. Much more spread.
 */
function computeBaseScore(job: StructuredJobSignals, profile: StructuredProfileSignals): number {
  // Neutral base for “seems plausible”
  let base = 72

  // Job family alignment is the biggest positive
  if (profile.targetFamilies.includes(job.jobFamily)) base += 10

  // Marketing that is NOT analytics-heavy is good for most marketing-target profiles
  if (job.jobFamily === "Marketing" && !job.analytics.isHeavy) base += 4

  // Early-career friendly
  if (!job.yearsRequired || job.yearsRequired <= 1) base += 5

  // Internship structure bonuses (only when present)
  if (job.internship?.isInternship) base += 5
  if (job.internship?.isSummer) base += 3
  if (job.internship?.hasCapstone) base += 4

  // Rotation is valuable, but don’t over-reward it
  if (job.internship?.isMarketingRotation) base += 3

  // Explicit AI comfort callout is a mild signal, not a giant one
  if (job.internship?.mentionsAITools) base += 2

  // Location positives (strict city match is strongest)
  const jobCity = job.location?.city ?? null
  const allowedCities = profile.locationPreference?.allowedCities ?? null
  const jobCityKnown = typeof jobCity === "string" && jobCity.trim().length > 0
  const hasCityPrefs = Array.isArray(allowedCities) && allowedCities.length > 0

  if (jobCityKnown && hasCityPrefs && locationCityMatches(jobCity!, allowedCities!)) {
    base += 6
  } else {
    // fallback: mode match (weak)
    const modeOk =
      profile.locationPreference.mode !== "unclear" &&
      job.location.mode !== "unclear" &&
      profile.locationPreference.mode === job.location.mode
    if (modeOk) base += 2
  }

  return base
}

export function scoreJobFit(job: StructuredJobSignals, profile: StructuredProfileSignals): ScoreResult {
  const penalties: Penalty[] = []
  const whyCodes: WhyCode[] = []

  const hasExplicitTools = job.requiredTools.length + job.preferredTools.length > 0

  // WHY signals
  if (profile.targetFamilies.includes(job.jobFamily)) whyCodes.push("WHY_FAMILY_MATCH")
  if (job.jobFamily === "Marketing" && !job.analytics.isHeavy) whyCodes.push("WHY_MARKETING_EXECUTION")
  if (job.analytics.isLight && !job.analytics.isHeavy) whyCodes.push("WHY_MEASUREMENT_LIGHT")
  if (!job.yearsRequired || job.yearsRequired <= 1) whyCodes.push("WHY_EARLY_CAREER_FRIENDLY")

  // Location WHY: prefer city match when possible
  {
    const jobCity = job.location?.city ?? null
    const allowedCities = profile.locationPreference?.allowedCities ?? null
    const jobCityKnown = typeof jobCity === "string" && jobCity.trim().length > 0
    const hasCityPrefs = Array.isArray(allowedCities) && allowedCities.length > 0

    const cityOk = jobCityKnown && hasCityPrefs ? locationCityMatches(jobCity!, allowedCities!) : false

    const modeOk =
      profile.locationPreference.mode !== "unclear" &&
      job.location.mode !== "unclear" &&
      profile.locationPreference.mode === job.location.mode

    if (cityOk || modeOk) whyCodes.push("WHY_LOCATION_MATCH")
  }

  // Tool WHY only when the job lists explicit tools
  if (hasExplicitTools) {
    const missing = job.requiredTools.filter((t) => toolMissing(profile.tools, t))
    if (missing.length <= 1) whyCodes.push("WHY_TOOL_MATCH")
  }

  // Internship-specific WHY codes
  if (job.internship?.isInternship && job.internship?.isSummer) whyCodes.push("WHY_SUMMER_INTERNSHIP_MATCH")

  if (
    job.internship?.isInPersonExplicit &&
    profile.constraints.hardNoFullyRemote &&
    (job.location.mode === "onsite" || job.location.mode === "hybrid")
  ) {
    whyCodes.push("WHY_IN_PERSON_MATCH")
  }

  if (job.internship?.mentionsAITools) whyCodes.push("WHY_AI_TOOLS_MATCH")
  if (job.internship?.isMarketingRotation && profile.targetFamilies.includes("Marketing")) {
    whyCodes.push("WHY_MARKETING_ROTATION_MATCH")
  }

  // ---------------- Location mismatch (STRICT) ----------------
  // Only penalize location when:
  // - profile is constrained
  // - job city is known
  // - allowed city list is explicit
  {
    const profileConstrained = !!profile.locationPreference.constrained
    const jobCity = job.location?.city ?? null
    const allowedCities = profile.locationPreference?.allowedCities ?? null
    const jobCityKnown = typeof jobCity === "string" && jobCity.trim().length > 0
    const hasCityPrefs = Array.isArray(allowedCities) && allowedCities.length > 0

    if (profileConstrained && jobCityKnown && hasCityPrefs) {
      if (!locationCityMatches(jobCity!, allowedCities!)) {
        penalties.push({
          key: "location_mismatch_constrained",
          amount: computePenaltyAmount("location_mismatch_constrained"),
          note: `Constrained city mismatch (job: ${jobCity})`,
          riskCode: "RISK_LOCATION",
        })
      }
    }
  }

  // Analytics mismatch
  if (profile.constraints.preferNotAnalyticsHeavy && job.analytics.isHeavy) {
    penalties.push({
      key: "heavy_analytics_mismatch",
      amount: computePenaltyAmount("heavy_analytics_mismatch"),
      note: "Analytics heavy signals present",
      riskCode: "RISK_ANALYTICS_HEAVY",
    })
  }

  // Sales / Gov mismatches
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

  // Contract / Hourly mismatches
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
      amount: computePenaltyAmount("contract_mismatch") + 2,
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

  // Missing tools (STRICT)
  if (hasExplicitTools) {
    const requiredMissing = job.requiredTools.filter((t) => toolMissing(profile.tools, t))
    const preferredMissing = job.preferredTools.filter((t) => toolMissing(profile.tools, t))

    for (const tool of requiredMissing) {
      penalties.push({
        key: "missing_core_tool",
        amount: computePenaltyAmount("missing_core_tool"),
        note: `Missing required tool: ${tool}`,
        riskCode: "RISK_MISSING_TOOLS",
      })
    }

    for (const tool of preferredMissing) {
      penalties.push({
        key: "missing_preferred_tool",
        amount: computePenaltyAmount("missing_preferred_tool"),
        note: `Missing preferred tool: ${tool}`,
        riskCode: "RISK_MISSING_TOOLS",
      })
    }
  }

  // Reporting emphasis
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

  // MBA / Grad mismatch risks
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

  // Apply per-key stacking caps
  const counts: Record<string, number> = {}
  const capped: Penalty[] = []
  for (const p of penalties) {
    const maxStack = POLICY.penalties[p.key].maxStackCount ?? 999
    counts[p.key] = (counts[p.key] || 0) + 1
    if (counts[p.key] <= maxStack) capped.push(p)
  }

  // Total penalty sum with diminishing returns + hard cap
  const rawPenaltySum = capped.reduce((s, p) => s + p.amount, 0)
  const diminished = applyDiminishingReturns(rawPenaltySum)
  const penaltySum = Math.min(POLICY.score.penaltyStackCap, diminished)

  // NEW score composition
  const base = computeBaseScore(job, profile)
  let score = base - penaltySum

  // Clamp to your desired visible band
  score = clamp(score, POLICY.score.minScore, POLICY.score.maxScore)

  const riskCodes = dedupeStrings(capped.map((p) => p.riskCode)) as RiskCode[]

  return {
    score: Math.round(score),
    penalties: capped,
    penaltySum,
    whyCodes: dedupeStrings(whyCodes) as WhyCode[],
    riskCodes,
  }
}