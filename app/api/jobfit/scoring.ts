// FILE: app/api/jobfit/scoring.ts
// V4 RULES:
// - No table-stakes positive scoring (internship/summer/early-career/location/tools).
// - Table-stakes only matter when NOT met, and only when mismatch proof exists.
// - Tools are NEVER score penalties. Tools are risk flags only when the job explicitly lists them and the profile does not.
// - Omission of info is never a negative.

import { POLICY, type PenaltyKey } from "./policy"
import type { RiskCode, StructuredJobSignals, StructuredProfileSignals, WhyCode } from "./signals"

export const SCORING_V4_STAMP = "SCORING_V4_STAMP__2026_02_27__TABLE_STAKES_NEUTRAL__TOOLS_RISK_ONLY__A"
console.log("[jobfit/scoring] loaded:", SCORING_V4_STAMP)

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

function hasAdjacentToolProof(profileTools: string[], missingTool: string): boolean {
  const p = (profileTools || []).map((x) => String(x || "").toLowerCase())
  const m = String(missingTool || "").toLowerCase()

  // adjacency map: “close enough” proof that reduces risk severity
  if (m === "python") return p.includes("r") || p.includes("sql")
  if (m === "tableau" || m === "power bi") return p.includes("excel") || p.includes("sql")
  if (m === "sql") return p.includes("python") || p.includes("r") || p.includes("excel")
  if (m === "google analytics" || m === "ga4") return p.includes("excel") || p.includes("sql")

  return false
}

function downgradeSeverity(sev: "low" | "medium" | "high"): "low" | "medium" | "high" {
  if (sev === "high") return "medium"
  if (sev === "medium") return "low"
  return "low"
}

function normalizeCity(s: string): string {
  const t = (s || "").trim().toLowerCase()
  if (t.includes("new york") || t.includes("nyc")) return "new york"
  if (t.includes("boston")) return "boston"
  if (t.includes("philadelphia") || t.includes("philly")) return "philadelphia"
  if (t.includes("washington") && (t.includes("dc") || t.includes("d.c"))) return "washington, d.c."
  if (t.includes("chicago")) return "chicago"
  if (t.includes("miami")) return "miami"
  return t
}

function locationCityMatches(jobCity: string, preferredCities: string[]): boolean {
  const j = normalizeCity(jobCity)
  const prefs = preferredCities.map(normalizeCity)
  return prefs.includes(j)
}

function normTool(s: string): string {
  return String(s || "").trim().toLowerCase()
}

function uniqueLower(xs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs || []) {
    const t = normTool(x)
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function toolOverlap(job: StructuredJobSignals, profile: StructuredProfileSignals): {
  overlap: string[]
  required: string[]
  preferred: string[]
} {
  const profileTools = uniqueLower(profile.tools || [])
  const required = uniqueLower(job.requiredTools || [])
  const preferred = uniqueLower(job.preferredTools || [])
  const jobTools = uniqueLower([...required, ...preferred])

  const overlap = jobTools.filter((t) => profileTools.includes(t))
  return { overlap, required, preferred }
}

/**
 * Base score is intentionally conservative.
 * Family match can move it upward.
 * Everything else is neutral unless mismatch proof exists (penalty) or job explicitly lists a risk (risk flag).
 */
function computeBaseScore(job: StructuredJobSignals, profile: StructuredProfileSignals): number {
  let base = 60

  const familyMatch = profile.targetFamilies.includes(job.jobFamily)
  if (familyMatch) base += 12
  else base -= 12

  // Tools positive ONLY when job explicitly lists tools AND profile overlaps.
  const hasExplicitTools = (job.requiredTools?.length || 0) + (job.preferredTools?.length || 0) > 0
  if (hasExplicitTools) {
    const { overlap } = toolOverlap(job, profile)

    // Small bump. This is “you can do the work”, not “you’re special”.
    // Cap it so tools can’t dominate.
    const bump = Math.min(6, overlap.length * 2) // 1 match = +2, 2 matches = +4, 3+ = +6 cap
    base += bump
  }

  return base
}

export function scoreJobFit(job: StructuredJobSignals, profile: StructuredProfileSignals): ScoreResult {
  const penalties: Penalty[] = []
  const whyCodes: WhyCode[] = []
  const riskOnlyCodes: RiskCode[] = []

  const hasExplicitTools = (job.requiredTools?.length || 0) + (job.preferredTools?.length || 0) > 0

  const familyMatch = profile.targetFamilies.includes(job.jobFamily)

  /* ---------------- WHY (deterministic, non-table-stakes) ---------------- */

  if (familyMatch) {
    whyCodes.push({
      code: "WHY_FAMILY_MATCH",
      job_fact: `Role family detected as ${job.jobFamily}.`,
      profile_fact: `Target families include ${profile.targetFamilies.join(", ")}.`,
      note: "The day-to-day work matches what you are targeting.",
      weight: 12,
    })
  }
  // Tool WHY (only when job explicitly lists tools AND there is real overlap)
  if (hasExplicitTools) {
    const { overlap } = toolOverlap(job, profile)
    if (overlap.length > 0) {
      whyCodes.push({
        code: "WHY_TOOL_MATCH",
        job_fact: `Posting lists tools such as: ${[...(job.requiredTools || []), ...(job.preferredTools || [])].slice(0, 6).join(", ")}.`,
        profile_fact: profile.tools?.length ? `Profile tools include: ${profile.tools.slice(0, 8).join(", ")}.` : null,
        note: "Your current tools align with what the role actually uses.",
        weight: 0, // weight can be 0 because renderer uses priority rules; this is a legit bullet either way
      })
    }
  }

  /* ---------------- Penalties (ONLY with mismatch proof) ---------------- */

  // Location mismatch (only when profile is constrained AND job city is known AND mismatch is proven)
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
      const amt = computePenaltyAmount("location_mismatch_constrained")
      penalties.push({
        key: "location_mismatch_constrained",
        amount: amt,
        note: `Constrained city mismatch (job: ${jobCity})`,
        risk: {
          code: "RISK_LOCATION",
          job_fact: `Job location indicates ${jobCity}.`,
          profile_fact: `Allowed cities are ${allowedCities.join(", ")}.`,
          risk: "Your location constraints do not match the job location.",
          severity: "high",
          weight: -amt,
        },
      })
    }
  }

  // Remote mismatch (only when job explicitly indicates remote AND profile hard-no-remote is true)
  if (profile.constraints.hardNoFullyRemote && job.location?.mode === "remote") {
    const k: PenaltyKey = "location_mismatch_constrained"
    const amt = computePenaltyAmount(k)
    penalties.push({
      key: k,
      amount: amt,
      note: "Hard no-remote vs remote role",
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

  // Sales mismatch (only when job has explicit sales-heavy signal AND profile has hard-no-sales)
  if (profile.constraints.hardNoSales && job.isSalesHeavy) {
    const amt = computePenaltyAmount("sales_mismatch")
    penalties.push({
      key: "sales_mismatch",
      amount: amt,
      note: "Sales signals present",
      risk: {
        code: "RISK_SALES",
        job_fact: "Posting contains sales signals (quota/commission/pipeline/cold outreach).",
        profile_fact: "You have a hard no-sales constraint.",
        risk: "Sales expectations conflict with your constraints.",
        severity: "high",
        weight: -amt,
      },
    })
  }

  // Government mismatch (only when job has explicit gov signal AND profile has hard-no-government)
  if (profile.constraints.hardNoGovernment && job.isGovernment) {
    const amt = computePenaltyAmount("government_mismatch")
    penalties.push({
      key: "government_mismatch",
      amount: amt,
      note: "Government signals present",
      risk: {
        code: "RISK_GOVERNMENT",
        job_fact: "Posting contains government or clearance signals.",
        profile_fact: "You have a hard no-government constraint.",
        risk: "Government environment conflicts with your constraints.",
        severity: "high",
        weight: -amt,
      },
    })
  }

  // Contract mismatch (only when job explicitly indicates contract AND profile has full-time preference or hard-no-contract)
  if (job.isContract && profile.constraints.hardNoContract) {
    const amt = computePenaltyAmount("contract_mismatch") + 2
    penalties.push({
      key: "contract_mismatch",
      amount: amt,
      note: "Hard no contract",
      risk: {
        code: "RISK_CONTRACT",
        job_fact: "Posting indicates contract/temporary structure.",
        profile_fact: "You have a hard no-contract constraint.",
        risk: "Role structure conflicts with your hard constraint.",
        severity: "high",
        weight: -amt,
      },
    })
  } else if (job.isContract && profile.constraints.prefFullTime) {
    const amt = computePenaltyAmount("contract_mismatch")
    penalties.push({
      key: "contract_mismatch",
      amount: amt,
      note: "Contract vs full-time preference",
      risk: {
        code: "RISK_CONTRACT",
        job_fact: "Posting indicates contract/temporary structure.",
        profile_fact: "You prefer full-time roles.",
        risk: "Role structure conflicts with your work-type preference.",
        severity: "medium",
        weight: -amt,
      },
    })
  }

  // Hourly mismatch (only when job explicitly indicates hourly AND profile has hard-no-hourly)
  if (profile.constraints.hardNoHourlyPay && job.isHourly) {
    const amt = computePenaltyAmount("hourly_pay_mismatch")
    penalties.push({
      key: "hourly_pay_mismatch",
      amount: amt,
      note: "Hourly pay signals present",
      risk: {
        code: "RISK_HOURLY",
        job_fact: "Posting indicates hourly compensation.",
        profile_fact: "You have a no-hourly constraint.",
        risk: "Compensation structure conflicts with your preference.",
        severity: "medium",
        weight: -amt,
      },
    })
  }

  // Experience gap (only when BOTH job yearsRequired and profile yearsExperienceApprox exist)
  if (job.yearsRequired !== null && profile.yearsExperienceApprox !== null) {
    if (profile.yearsExperienceApprox + 0.5 < job.yearsRequired) {
      const amt = computePenaltyAmount("experience_years_gap")
      penalties.push({
        key: "experience_years_gap",
        amount: amt,
        note: `Years required ${job.yearsRequired}, profile approx ${profile.yearsExperienceApprox}`,
        risk: {
          code: "RISK_EXPERIENCE",
          job_fact: `Posting suggests ~${job.yearsRequired} years of experience.`,
          profile_fact: `Profile experience approx ${profile.yearsExperienceApprox} years.`,
          risk: "Experience requirement may be above your current level.",
          severity: "medium",
          weight: -amt,
        },
      })
    }
  }

  // MBA required (explicit posting signal)
  if (job.mbaRequired) {
    const amt = computePenaltyAmount("mba_required")
    penalties.push({
      key: "mba_required",
      amount: amt,
      note: "MBA required",
      risk: {
        code: "RISK_MBA",
        job_fact: "Posting indicates MBA required.",
        profile_fact: null,
        risk: "MBA requirement likely blocks eligibility.",
        severity: "high",
        weight: -amt,
      },
    })
  }

  // Grad window mismatch (only when BOTH exist)
  if (job.gradYearHint !== null && profile.gradYear !== null) {
    const delta = Math.abs(profile.gradYear - job.gradYearHint)
    if (delta >= 2) {
      const amt = computePenaltyAmount("grad_window_mismatch")
      penalties.push({
        key: "grad_window_mismatch",
        amount: amt,
        note: "Graduation window mismatch",
        risk: {
          code: "RISK_GRAD_WINDOW",
          job_fact: `Posting screens for graduation year around ${job.gradYearHint}.`,
          profile_fact: `Profile graduation year is ${profile.gradYear}.`,
          risk: "Graduation timing likely does not match what the posting is screening for.",
          severity: "high",
          weight: -amt,
        },
      })
    }
  }

  /* ---------------- Risk-only flags (NO SCORE IMPACT) ---------------- */

  // Tools: ONLY when the job explicitly lists tools.
  if (hasExplicitTools) {
    const profileTools = profile.tools || []
    const requiredMissing = (job.requiredTools || []).filter((t) => toolMissing(profileTools, t))
    const preferredMissing = (job.preferredTools || []).filter((t) => toolMissing(profileTools, t))

    for (const tool of requiredMissing) {
      let sev: "low" | "medium" | "high" = "high"
      if (hasAdjacentToolProof(profileTools, tool)) sev = downgradeSeverity(sev)

      riskOnlyCodes.push({
        code: "RISK_MISSING_TOOLS",
        job_fact: `Posting lists ${tool} as required.`,
        profile_fact: profileTools.length ? `Profile tools: ${profileTools.join(", ")}.` : null,
        risk: `You have not shown ${tool} yet, and it is prioritized in the posting.`,
        severity: sev,
        weight: 0,
      })
    }

    for (const tool of preferredMissing) {
      let sev: "low" | "medium" | "high" = "medium"
      if (hasAdjacentToolProof(profileTools, tool)) sev = downgradeSeverity(sev)

      riskOnlyCodes.push({
        code: "RISK_MISSING_TOOLS",
        job_fact: `Posting lists ${tool} as preferred.`,
        profile_fact: profileTools.length ? `Profile tools: ${profileTools.join(", ")}.` : null,
        risk: `You have not shown ${tool} yet, and it is called out in the posting.`,
        severity: sev,
        weight: 0,
      })
    }
  }

  // Analytics-heavy risk-only (only when profile explicitly prefers not analytics-heavy AND job is tagged heavy)
  if (profile.constraints.preferNotAnalyticsHeavy && job.analytics?.isHeavy) {
    riskOnlyCodes.push({
      code: "RISK_ANALYTICS_HEAVY",
      job_fact: "Posting contains analytics-heavy signals.",
      profile_fact: "You prefer not analytics-heavy roles.",
      risk: "This reads like an analytics-heavy role that conflicts with your stated preference.",
      severity: "medium",
      weight: 0,
    })
  }

  /* ---------------- stack caps + score ---------------- */

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

  // Risk codes include penalty-tied risks plus risk-only flags.
  const riskCodes = dedupeByCode([...capped.map((p) => p.risk), ...riskOnlyCodes])
  const whyOut = dedupeByCode(whyCodes)

  return {
    score: Math.round(score),
    penalties: capped,
    penaltySum,
    whyCodes: whyOut,
    riskCodes,
  }
}