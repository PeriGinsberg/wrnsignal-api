// FILE: app/api/jobfit/scoring.ts

import { POLICY, type PenaltyKey } from "./policy"
import type { RiskCode, StructuredJobSignals, StructuredProfileSignals, WhyCode } from "./signals"

export type Penalty = {
  key: PenaltyKey
  amount: number
  note: string
  risk: RiskCode
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

function dedupeByCode<T extends { code: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    if (!it?.code) continue
    if (seen.has(it.code)) continue
    seen.add(it.code)
    out.push(it)
  }
  return out
}

function toolMissing(profileTools: string[], tool: string): boolean {
  const p = (profileTools || []).map((x) => String(x || "").toLowerCase())
  return !p.includes(String(tool || "").toLowerCase())
}

function normalizeCity(s: string): string {
  const t = (s || "").trim().toLowerCase()
  if (t.includes("new york") || t.includes("nyc")) return "new york"
  if (t.includes("boston")) return "boston"
  if (t.includes("philadelphia") || t.includes("philly")) return "philadelphia"
  if (t.includes("washington") && (t.includes("dc") || t.includes("d.c"))) return "washington, d.c."
  return t
}

function locationCityMatches(jobCity: string, preferredCities: string[]): boolean {
  const j = normalizeCity(jobCity)
  const prefs = preferredCities.map(normalizeCity)
  return prefs.includes(j)
}

/**
 * Deterministic “Insights” detector:
 * This is intentionally simple and robust because job titles vary endlessly.
 */
function looksLikeInsightsRole(job: StructuredJobSignals): boolean {
  // best available structured hints without relying on raw job text
  const toolSignals = (job.requiredTools || []).concat(job.preferredTools || []).map((t) => t.toLowerCase())
  const hasQuantTools =
    toolSignals.includes("sql") ||
    toolSignals.includes("python") ||
    toolSignals.includes("tableau") ||
    toolSignals.includes("power bi") ||
    toolSignals.includes("excel")







  // market/consumer insights roles frequently show: Excel + SQL + Tableau/PowerBI, plus “insights” behavior
  // We cannot see the raw words here, so we approximate via tool demand + reporting emphasis.
  if (hasQuantTools && job.reportingSignals?.strong) return true

  // internship pattern: marketing + quant tools frequently means insights
  if (job.jobFamily === "Marketing" && hasQuantTools) return true

  return false
}

function computeBaseScore(job: StructuredJobSignals, profile: StructuredProfileSignals): number {
  // Neutral base
  let base = 70

  const familyMatch = profile.targetFamilies.includes(job.jobFamily)

  // Biggest positive: true family match
  if (familyMatch) base += 10
  else base -= 10 // stop “wrong family” roles from drifting into Apply

  // Early-career friendly
  if (!job.yearsRequired || job.yearsRequired <= 1) base += 5

  // Internship structure bonuses
  if (job.internship?.isInternship) base += 5
  if (job.internship?.isSummer) base += 3
  if (job.internship?.hasCapstone) base += 3
  if (job.internship?.isMarketingRotation) base += 2
  if (job.internship?.mentionsAITools) base += 1

  // Location positives
  const jobCity = job.location?.city ?? null
  const allowedCities = profile.locationPreference.allowedCities
  const hasCityPrefs = Array.isArray(allowedCities) && allowedCities.length > 0
  if (jobCity && hasCityPrefs && locationCityMatches(jobCity, allowedCities!)) {
    base += 6
  } else {
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

  const hasExplicitTools = (job.requiredTools?.length || 0) + (job.preferredTools?.length || 0) > 0

  const familyMatch = profile.targetFamilies.includes(job.jobFamily)
  const insightsLike = looksLikeInsightsRole(job)

  // ---------------- WHY evidence ----------------

  if (familyMatch) {
    whyCodes.push({
      code: "WHY_FAMILY_MATCH",
      job_fact: `Role family detected as ${job.jobFamily}.`,
      profile_fact: `Target families include ${profile.targetFamilies.join(", ")}.`,
      note: "The day-to-day work matches what you are targeting.",
      weight: 10,
    })
  }

  if (!job.yearsRequired || job.yearsRequired <= 1) {
    whyCodes.push({
      code: "WHY_EARLY_CAREER_FRIENDLY",
      job_fact: job.yearsRequired ? `Posting suggests ~${job.yearsRequired} years required.` : "No years-of-experience requirement detected.",
      profile_fact: profile.yearsExperienceApprox !== null ? `Profile experience approx ${profile.yearsExperienceApprox} years.` : "Early-career profile signal.",
      note: "The requirements look realistic for an early-career candidate.",
      weight: 5,
    })
  }

  // Location WHY
  {
    const jobCity = job.location?.city ?? null
    const allowedCities = profile.locationPreference.allowedCities

    const cityOk =
      typeof jobCity === "string" &&
      jobCity.trim().length > 0 &&
      Array.isArray(allowedCities) &&
      allowedCities.length > 0 &&
      locationCityMatches(jobCity, allowedCities)

    const modeOk =
      profile.locationPreference.mode !== "unclear" &&
      job.location.mode !== "unclear" &&
      profile.locationPreference.mode === job.location.mode

    if (cityOk || modeOk) {
      whyCodes.push({
        code: "WHY_LOCATION_MATCH",
        job_fact: cityOk ? `Job location indicates ${jobCity}.` : `Job work mode indicates ${job.location.mode}.`,
        profile_fact: cityOk ? `Allowed cities include ${allowedCities!.join(", ")}.` : `Preferred work mode is ${profile.locationPreference.mode}.`,
        note: "The work setup and location match your stated preference.",
        weight: cityOk ? 6 : 2,
      })
    }
  }

  // Tool WHY (only if job explicitly lists tools AND alignment is real)
  if (hasExplicitTools) {
    const requiredMissing = (job.requiredTools || []).filter((t) => toolMissing(profile.tools || [], t))
    const preferredMissing = (job.preferredTools || []).filter((t) => toolMissing(profile.tools || [], t))

    if (requiredMissing.length === 0 && preferredMissing.length <= 2) {
      whyCodes.push({
        code: "WHY_TOOL_MATCH",
        job_fact: `Posting lists tools such as: ${[...(job.requiredTools || []), ...(job.preferredTools || [])].slice(0, 6).join(", ")}.`,
        profile_fact: profile.tools?.length ? `Profile tools include: ${profile.tools.slice(0, 8).join(", ")}.` : "No tools listed in profile.",
        note: "Your current tools align with what the role actually uses.",
        weight: 2,
      })
    }
  }

  // Internship WHY
  if (job.internship?.isInternship && job.internship?.isSummer) {
    whyCodes.push({
      code: "WHY_SUMMER_INTERNSHIP_MATCH",
      job_fact: "Posting indicates internship and Summer timing.",
      profile_fact: "Profile indicates Summer internship targeting.",
      note: "The posting is a Summer internship and matches the timeline you are targeting.",
      weight: 3,
    })
  }

  if (
    job.internship?.isInPersonExplicit &&
    profile.constraints.hardNoFullyRemote &&
    (job.location.mode === "in_person" || job.location.mode === "hybrid")
  ) {
    whyCodes.push({
      code: "WHY_IN_PERSON_MATCH",
      job_fact: job.internship?.evidence?.inPersonLine || "Posting indicates in-person or hybrid setup.",
      profile_fact: "You have a no-remote constraint.",
      note: "The role is in-person or hybrid, which matches your no-remote constraint.",
      weight: 2,
    })
  }

  if (job.internship?.mentionsAITools) {
    whyCodes.push({
      code: "WHY_AI_TOOLS_MATCH",
      job_fact: job.internship?.evidence?.aiLine || "Posting explicitly mentions AI tools.",
      profile_fact: profile.tools?.includes("AI Tools") ? "Profile includes AI tools exposure." : "AI exposure not explicitly listed.",
      note: "The posting explicitly calls out AI tools, which aligns with your AI experience or training.",
      weight: 1,
    })
  }

  if (job.internship?.isMarketingRotation && profile.targetFamilies.includes("Marketing")) {
    whyCodes.push({
      code: "WHY_MARKETING_ROTATION_MATCH",
      job_fact: job.internship?.evidence?.deptLine || "Posting spans multiple marketing functions.",
      profile_fact: "Marketing-target profile.",
      note: "The internship spans multiple marketing functions, which fits your interest in broader brand and communications work.",
      weight: 2,
    })
  }

  // ---------------- Penalties ----------------

  // Location mismatch (strict city list only)
  {
    const profileConstrained = !!profile.locationPreference.constrained
    const jobCity = job.location?.city ?? null
    const allowedCities = profile.locationPreference.allowedCities

    if (
      profileConstrained &&
      typeof jobCity === "string" &&
      jobCity.trim().length > 0 &&
      Array.isArray(allowedCities) &&
      allowedCities.length > 0 &&
      !locationCityMatches(jobCity, allowedCities)
    ) {
      penalties.push({
        key: "location_mismatch_constrained",
        amount: computePenaltyAmount("location_mismatch_constrained"),
        note: `Constrained city mismatch (job: ${jobCity})`,
        risk: {
          code: "RISK_LOCATION",
          job_fact: `Job location indicates ${jobCity}.`,
          profile_fact: `Allowed cities are ${allowedCities.join(", ")}.`,
          risk: "Your location constraints do not match the job location.",
          severity: "high",
          weight: -computePenaltyAmount("location_mismatch_constrained"),
        },
      })
    }
  }

// Remote mismatch penalty (scoring alignment with gates)
// Your policy union does not include "remote_policy_mismatch" right now.
// Treat remote vs hard no-remote as a constrained location mismatch.
if (profile.constraints.hardNoFullyRemote && job.location.mode === "remote") {
  const k: PenaltyKey = "location_mismatch_constrained"
  const amt = computePenaltyAmount(k)

  penalties.push({
    key: k,
    amount: amt,
    note: "Hard no remote vs remote role",
    risk: {
      code: "RISK_LOCATION",
      job_fact: "Posting indicates remote work setup.",
      profile_fact: "You have a no-remote constraint.",
      risk: "Work setup conflicts with your stated constraint.",
      severity: "high",
      weight: -amt,
    },
  })
}

  

  if (profile.constraints.hardNoSales && job.isSalesHeavy) {
    penalties.push({
      key: "sales_mismatch",
      amount: computePenaltyAmount("sales_mismatch"),
      note: "Sales signals present",
      risk: {
        code: "RISK_SALES",
        job_fact: "Posting contains sales signals (quota/commission/pipeline/cold outreach).",
        profile_fact: "You have a hard no sales constraint.",
        risk: "Sales expectations conflict with your constraints.",
        severity: "high",
        weight: -computePenaltyAmount("sales_mismatch"),
      },
    })
  }

  if (profile.constraints.hardNoGovernment && job.isGovernment) {
    penalties.push({
      key: "government_mismatch",
      amount: computePenaltyAmount("government_mismatch"),
      note: "Government signals present",
      risk: {
        code: "RISK_GOVERNMENT",
        job_fact: "Posting contains government or clearance signals.",
        profile_fact: "You have a hard no government constraint.",
        risk: "Government environment conflicts with your constraints.",
        severity: "high",
        weight: -computePenaltyAmount("government_mismatch"),
      },
    })
  }

  if (profile.constraints.prefFullTime && job.isContract) {
    penalties.push({
      key: "contract_mismatch",
      amount: computePenaltyAmount("contract_mismatch"),
      note: "Contract vs full-time preference",
      risk: {
        code: "RISK_CONTRACT",
        job_fact: "Posting indicates contract/temporary structure.",
        profile_fact: "You prefer full-time roles.",
        risk: "Role structure conflicts with your work-type preference.",
        severity: "medium",
        weight: -computePenaltyAmount("contract_mismatch"),
      },
    })
  }

  if (profile.constraints.hardNoContract && job.isContract) {
    penalties.push({
      key: "contract_mismatch",
      amount: computePenaltyAmount("contract_mismatch") + 2,
      note: "Hard no contract",
      risk: {
        code: "RISK_CONTRACT",
        job_fact: "Posting indicates contract/temporary structure.",
        profile_fact: "You have a hard no contract constraint.",
        risk: "Role structure conflicts with your hard constraint.",
        severity: "high",
        weight: -(computePenaltyAmount("contract_mismatch") + 2),
      },
    })
  }

  if (profile.constraints.hardNoHourlyPay && job.isHourly) {
    penalties.push({
      key: "hourly_pay_mismatch",
      amount: computePenaltyAmount("hourly_pay_mismatch"),
      note: "Hourly pay signals present",
      risk: {
        code: "RISK_HOURLY",
        job_fact: "Posting indicates hourly compensation.",
        profile_fact: "You have a no hourly constraint.",
        risk: "Compensation structure conflicts with your preference.",
        severity: "medium",
        weight: -computePenaltyAmount("hourly_pay_mismatch"),
      },
    })
  }

  // Missing tools
  if (hasExplicitTools) {
    const requiredMissing = (job.requiredTools || []).filter((t) => toolMissing(profile.tools || [], t))
    const preferredMissing = (job.preferredTools || []).filter((t) => toolMissing(profile.tools || [], t))

    for (const tool of requiredMissing) {
      penalties.push({
        key: "missing_core_tool",
        amount: computePenaltyAmount("missing_core_tool"),
        note: `Missing required tool: ${tool}`,
        risk: {
          code: "RISK_MISSING_TOOLS",
          job_fact: `Posting lists ${tool} as required.`,
          profile_fact: profile.tools?.length ? `Profile tools: ${profile.tools.join(", ")}.` : null,
          risk: `You have not shown ${tool} yet, and it is listed as required.`,
          severity: "high",
          weight: -computePenaltyAmount("missing_core_tool"),
        },
      })
    }

    for (const tool of preferredMissing) {
      penalties.push({
        key: "missing_preferred_tool",
        amount: computePenaltyAmount("missing_preferred_tool"),
        note: `Missing preferred tool: ${tool}`,
        risk: {
          code: "RISK_MISSING_TOOLS",
          job_fact: `Posting lists ${tool} as preferred.`,
          profile_fact: profile.tools?.length ? `Profile tools: ${profile.tools.join(", ")}.` : null,
          risk: `You have not shown ${tool} yet, and it is listed as preferred.`,
          severity: "medium",
          weight: -computePenaltyAmount("missing_preferred_tool"),
        },
      })
    }
  }

 

  if (job.yearsRequired && profile.yearsExperienceApprox !== null) {
    if (profile.yearsExperienceApprox + 0.5 < job.yearsRequired) {
      penalties.push({
        key: "experience_years_gap",
        amount: computePenaltyAmount("experience_years_gap"),
        note: `Years required ${job.yearsRequired}, profile approx ${profile.yearsExperienceApprox}`,
        risk: {
          code: "RISK_EXPERIENCE",
          job_fact: `Posting suggests ~${job.yearsRequired} years of experience.`,
          profile_fact: `Profile experience approx ${profile.yearsExperienceApprox} years.`,
          risk: "Experience requirement may be above your current level.",
          severity: "medium",
          weight: -computePenaltyAmount("experience_years_gap"),
        },
      })
    }
  }

  if (job.mbaRequired) {
    penalties.push({
      key: "mba_required",
      amount: computePenaltyAmount("mba_required"),
      note: "MBA required",
      risk: {
        code: "RISK_MBA",
        job_fact: "Posting indicates MBA required.",
        profile_fact: null,
        risk: "MBA requirement likely blocks eligibility.",
        severity: "high",
        weight: -computePenaltyAmount("mba_required"),
      },
    })
  }

  if (job.gradYearHint && profile.gradYear) {
    const delta = Math.abs(profile.gradYear - job.gradYearHint)
    if (delta >= 2) {
      penalties.push({
        key: "grad_window_mismatch",
        amount: computePenaltyAmount("grad_window_mismatch"),
        note: "Graduation window mismatch",
        risk: {
          code: "RISK_GRAD_WINDOW",
          job_fact: `Posting screens for graduation year around ${job.gradYearHint}.`,
          profile_fact: `Profile graduation year is ${profile.gradYear}.`,
          risk: "Graduation timing likely does not match what the posting is screening for.",
          severity: "high",
          weight: -computePenaltyAmount("grad_window_mismatch"),
        },
      })
    }
  }

  // ---------------- stack caps + score ----------------

  const counts: Record<string, number> = {}
  const capped: Penalty[] = []
  for (const p of penalties) {
    const maxStack = POLICY.penalties[p.key].maxStackCount ?? 999
    counts[p.key] = (counts[p.key] || 0) + 1
    if (counts[p.key] <= maxStack) capped.push(p)
  }

  const rawPenaltySum = capped.reduce((s, p) => s + p.amount, 0)
  const diminished = applyDiminishingReturns(rawPenaltySum)
  const penaltySum = Math.min(POLICY.score.penaltyStackCap, diminished)

  const base = computeBaseScore(job, profile)
  let score = base - penaltySum
  score = clamp(score, POLICY.score.minScore, POLICY.score.maxScore)

  const riskCodes = dedupeByCode(capped.map((p) => p.risk))
  const whyOut = dedupeByCode(whyCodes)

  return {
    score: Math.round(score),
    penalties: capped,
    penaltySum,
    whyCodes: whyOut,
    riskCodes,
  }
}