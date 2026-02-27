// FILE: app/api/jobfit/scoring.ts
//
// V4 RULES IMPLEMENTED:
// - Table-stakes do NOT add points.
// - Omission is NEVER a negative (no penalties without mismatch proof).
// - Tools are NEVER score penalties.
// - Tools become risk flags ONLY when the job explicitly lists tools and the profile does not mention them.
// - City/location/remote only penalize on proven mismatch (not missing info).
//
// IMPORTANT:
// This rewrite keeps your existing penalty keys + policy usage to avoid cascading breakage.
// It removes positive scoring for internship/summer/early-career/location and removes tool penalties entirely.

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

/* ------------------------------ tools (risk-only) ------------------------------ */

function toolMissing(profileTools: string[], tool: string): boolean {
  const p = (profileTools || []).map((x) => String(x || "").toLowerCase())
  return !p.includes(String(tool || "").toLowerCase())
}

function hasAdjacentToolProof(profileTools: string[], missingTool: string): boolean {
  const p = (profileTools || []).map((x) => String(x || "").toLowerCase())
  const m = String(missingTool || "").toLowerCase()

  // adjacency map: “close enough” proof that reduces severity
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

function pushToolRisk(args: {
  list: RiskCode[]
  tool: string
  isRequired: boolean
  profileTools: string[]
}) {
  const tool = String(args.tool || "").trim()
  if (!tool) return

  let sev: "low" | "medium" | "high" = args.isRequired ? "high" : "medium"
  if (hasAdjacentToolProof(args.profileTools, tool)) sev = downgradeSeverity(sev)

  args.list.push({
    code: "RISK_TOOLS_NOT_MENTIONED",
    job_fact: args.isRequired
      ? `Posting lists ${tool} as required.`
      : `Posting lists ${tool} as preferred.`,
    profile_fact: args.profileTools.length
      ? `Profile tools shown: ${args.profileTools.join(", ")}.`
      : "No tools shown in profile.",
    risk: args.isRequired
      ? `${tool} is required, but it is not mentioned in your materials yet.`
      : `${tool} is preferred, but it is not mentioned in your materials yet.`,
    severity: sev,
    weight: 0,
  })
}

/* ------------------------------ location helpers ------------------------------ */

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

/* ------------------------------ base score (no table-stakes bonuses) ------------------------------ */

function computeBaseScore(job: StructuredJobSignals, profile: StructuredProfileSignals): number {
  // Neutral starting point.
  // Family match is the only additive driver in V4 scoring.
  let base = 70

  const familyMatch = profile.targetFamilies.includes(job.jobFamily)

  if (familyMatch) base += 12
  else base -= 12 // wrong family should not drift into Apply

  // No positives for:
  // - early-career friendliness
  // - internship/summer
  // - location match
  // - tool match
  // These are table stakes. They only matter when mismatched (penalty/gate), and only with proof.

  return base
}

/* ------------------------------ main scoring ------------------------------ */

export function scoreJobFit(job: StructuredJobSignals, profile: StructuredProfileSignals): ScoreResult {
  const penalties: Penalty[] = []
  const whyCodes: WhyCode[] = []
  const riskOnlyCodes: RiskCode[] = []

  const hasExplicitTools = (job.requiredTools?.length || 0) + (job.preferredTools?.length || 0) > 0
  const familyMatch = profile.targetFamilies.includes(job.jobFamily)

  // ---------------- WHY evidence (deterministic, non-inflationary) ----------------

  if (familyMatch) {
    whyCodes.push({
      code: "WHY_FAMILY_MATCH",
      job_fact: `Role family detected as ${job.jobFamily}.`,
      profile_fact: `Target families include ${profile.targetFamilies.join(", ")}.`,
      note: "The day-to-day work matches what you are targeting.",
      weight: 12,
    })
  }

  // We keep these WHY codes for bullet quality, but they do NOT add to score anymore.
  // They can be shown as “why this works” without turning into numeric inflation.

  if (!job.yearsRequired || job.yearsRequired <= 1) {
    whyCodes.push({
      code: "WHY_EARLY_CAREER_FRIENDLY",
      job_fact: job.yearsRequired
        ? `Posting suggests ~${job.yearsRequired} years required.`
        : "No years-of-experience requirement detected.",
      profile_fact:
        profile.yearsExperienceApprox !== null
          ? `Profile experience approx ${profile.yearsExperienceApprox} years.`
          : "Early-career profile signal.",
      note: "The requirements look realistic for an early-career candidate.",
      weight: 0,
    })
  }

  // Location WHY (informational only, not scored)
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
        profile_fact: cityOk
          ? `Allowed cities include ${allowedCities!.join(", ")}.`
          : `Preferred work mode is ${profile.locationPreference.mode}.`,
        note: "The work setup and location match your stated preference.",
        weight: 0,
      })
    }
  }

  // Tool WHY (informational only; no score)
  if (hasExplicitTools) {
    const requiredMissing = (job.requiredTools || []).filter((t) => toolMissing(profile.tools || [], t))
    const preferredMissing = (job.preferredTools || []).filter((t) => toolMissing(profile.tools || [], t))

    if (requiredMissing.length === 0 && preferredMissing.length <= 2) {
      whyCodes.push({
        code: "WHY_TOOL_MATCH",
        job_fact: `Posting lists tools such as: ${[...(job.requiredTools || []), ...(job.preferredTools || [])]
          .slice(0, 6)
          .join(", ")}.`,
        profile_fact: profile.tools?.length
          ? `Profile tools include: ${profile.tools.slice(0, 8).join(", ")}.`
          : "No tools listed in profile.",
        note: "Your current tools align with what the role actually uses.",
        weight: 0,
      })
    }
  }

  // Internship WHY (informational only; no score)
  if (job.internship?.isInternship && job.internship?.isSummer) {
    whyCodes.push({
      code: "WHY_SUMMER_INTERNSHIP_MATCH",
      job_fact: "Posting indicates internship and Summer timing.",
      profile_fact: "Profile indicates Summer internship targeting.",
      note: "The posting is a Summer internship and matches the timeline you are targeting.",
      weight: 0,
    })
  }

  // ---------------- Penalties (ONLY with mismatch proof) ----------------

  // Location mismatch (ONLY if profile is constrained AND job city is known AND not in allowed cities)
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

  // Remote mismatch penalty (ONLY if job explicitly says remote AND profile has hard no-remote)
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

  // Contract penalties ONLY if job explicitly indicates contract
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

  // Hourly penalty ONLY if job explicitly indicates hourly
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

  // Experience gap penalty ONLY if job explicitly provides years AND profile has years estimate
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

  // ---------------- Tools: risk-only (no score impact) ----------------

  if (hasExplicitTools) {
    const profileTools = profile.tools || []
    const requiredMissing = (job.requiredTools || []).filter((t) => toolMissing(profileTools, t))
    const preferredMissing = (job.preferredTools || []).filter((t) => toolMissing(profileTools, t))

    for (const tool of requiredMissing) {
      pushToolRisk({ list: riskOnlyCodes, tool, isRequired: true, profileTools })
    }

    for (const tool of preferredMissing) {
      pushToolRisk({ list: riskOnlyCodes, tool, isRequired: false, profileTools })
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