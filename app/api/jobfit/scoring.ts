// FILE: app/api/jobfit/scoring.ts
//
// Evidence-first scoring for WHY pipeline.
// WHY bullets are created from matched proof objects, not category overlap.

import { POLICY, type PenaltyKey } from "./policy"
import type {
  EvidenceKind,
  JobRequirementUnit,
  MatchStrength,
  ProfileEvidenceUnit,
  RiskCode,
  StructuredJobSignals,
  StructuredProfileSignals,
  WhyCode,
} from "./signals"
import { getFinanceSubFamilyDistance } from "./extract"

export const SCORING_V5_STAMP =
  "SCORING_V5_STAMP__2026_03_14__CAPABILITY_COVERAGE_AND_DIRECTNESS"

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

type Severity = "low" | "medium" | "high"

type ToolOverlapResult = {
  overlap: string[]
  required: string[]
  preferred: string[]
  profile: string[]
}

type WhyEvidenceMatch = {
  code: string
  match_key: string
  match_kind: EvidenceKind
  match_strength: MatchStrength
  job_unit: JobRequirementUnit
  profile_unit: ProfileEvidenceUnit
  job_fact: string
  profile_fact: string
  note: string
  weight: number
  coverageScore: number
}

type RequirementCoverage = {
  jobUnit: JobRequirementUnit
  bestMatch: WhyEvidenceMatch | null
  coverageScore: number
  adequate: boolean
  nearMiss: boolean
}

const ADJACENCY: Record<string, string[]> = {
  brand_messaging: ["content_execution", "visual_communication", "communications_writing"],
  communications_writing: ["drafting_documentation", "stakeholder_coordination"],
  visual_communication: ["brand_messaging", "content_execution"],
  content_execution: ["brand_messaging", "visual_communication", "performance_optimization"],
  consumer_research: ["analysis_reporting", "policy_regulatory_research", "strategy_problem_solving"],
  analysis_reporting: ["financial_analysis", "performance_optimization", "consumer_research"],
  performance_optimization: ["analysis_reporting", "content_execution"],
  product_positioning: ["brand_messaging", "communications_writing"],

  prospecting_pipeline_management: ["account_management", "territory_execution", "client_commercial_work"],
  account_management: ["prospecting_pipeline_management", "post_sale_support", "client_commercial_work"],
  territory_execution: ["account_management", "hospital_or_environment", "prospecting_pipeline_management"],
  crm_usage: [],
  post_sale_support: ["account_management", "product_training_enablement"],
  product_training_enablement: ["post_sale_support", "clinical_stakeholder_fluency"],
  hospital_or_environment: ["clinical_stakeholder_fluency", "clinical_patient_work"],
  clinical_stakeholder_fluency: ["hospital_or_environment", "clinical_patient_work", "product_training_enablement"],
  med_device_industry_knowledge: ["hospital_or_environment", "product_training_enablement"],

  client_commercial_work: ["stakeholder_coordination", "account_management", "prospecting_pipeline_management"],
  policy_regulatory_research: ["drafting_documentation", "analysis_reporting", "communications_writing"],
  financial_analysis: ["analysis_reporting"],
  accounting_operations: ["analysis_reporting", "operations_execution"],
  operations_execution: ["stakeholder_coordination", "analysis_reporting", "drafting_documentation"],
  strategy_problem_solving: ["analysis_reporting", "consumer_research", "stakeholder_coordination"],
  stakeholder_coordination: ["operations_execution", "communications_writing", "account_management"],
  drafting_documentation: ["communications_writing", "policy_regulatory_research"],
  clinical_patient_work: ["hospital_or_environment", "clinical_stakeholder_fluency"],
}

const DIRECT_PROOF_REQUIRED_KEYS = new Set([
  "prospecting_pipeline_management",
  "account_management",
  "territory_execution",
  "crm_usage",
  "post_sale_support",
  "product_training_enablement",
  "med_device_industry_knowledge",
])

const OWNERSHIP_KEYS = new Set(["account_management", "territory_execution"])
const SYSTEM_KEYS = new Set(["crm_usage"])
const COMMERCIAL_EXECUTION_KEYS = new Set([
  "prospecting_pipeline_management",
  "account_management",
  "territory_execution",
  "post_sale_support",
  "product_training_enablement",
  "med_device_industry_knowledge",
])

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function norm(s: string | null | undefined): string {
  return String(s || "")
    .trim()
    .toLowerCase()
}

function uniqueLower(xs: string[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs || []) {
    const t = norm(x)
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function computePenaltyAmount(key: PenaltyKey): number {
  const p = POLICY.penalties[key]
  return p.severity * p.multiplier
}

function applyDiminishingReturns(penaltySum: number): number {
  const softCap = POLICY.score.perPenaltySoftCap
  if (penaltySum <= softCap) return penaltySum
  const extra = penaltySum - softCap
  const reduced = extra * (1 - POLICY.score.diminishingReturnsRate)
  return softCap + reduced
}

function normalizeCity(s: string | null | undefined): string {
  const t = norm(s)
  if (!t) return ""
  if (t.includes("new york") || t.includes("nyc")) return "new york"
  if (t.includes("boston")) return "boston"
  if (t.includes("philadelphia") || t.includes("philly")) return "philadelphia"
  if (t.includes("washington") && (t.includes("dc") || t.includes("d.c"))) return "washington, d.c."
  if (t.includes("chicago")) return "chicago"
  if (t.includes("miami")) return "miami"
  if (t.includes("atlanta")) return "atlanta"
  if (t.includes("charlotte")) return "charlotte"
  if (t.includes("austin")) return "austin"
  if (t.includes("los angeles") || t === "la") return "los angeles"
  return t
}

function locationCityMatches(jobCity: string, preferredCities: string[]): boolean {
  const j = normalizeCity(jobCity)
  if (!j) return false
  const prefs = (preferredCities || []).map(normalizeCity).filter(Boolean)
  return prefs.includes(j)
}

function toolMissing(profileTools: string[], tool: string): boolean {
  const p = uniqueLower(profileTools)
  return !p.includes(norm(tool))
}

function hasAdjacentToolProof(profileTools: string[], missingTool: string): boolean {
  const p = uniqueLower(profileTools)
  const m = norm(missingTool)

  if (m === "python") return p.includes("r") || p.includes("sql")
  if (m === "tableau" || m === "power bi") return p.includes("excel") || p.includes("sql")
  if (m === "sql") return p.includes("python") || p.includes("r") || p.includes("excel")
  if (m === "google analytics") return p.includes("excel") || p.includes("sql")
  if (m === "crm") return p.includes("salesforce") || p.includes("hubspot")
  if (m === "salesforce") return p.includes("crm") || p.includes("hubspot")
  if (m === "hubspot") return p.includes("crm") || p.includes("salesforce")

  return false
}

function downgradeSeverity(sev: Severity): Severity {
  if (sev === "high") return "medium"
  if (sev === "medium") return "low"
  return "low"
}

function toolOverlap(job: StructuredJobSignals, profile: StructuredProfileSignals): ToolOverlapResult {
  const profileTools = uniqueLower(profile.tools || [])
  const required = uniqueLower(job.requiredTools || [])
  const preferred = uniqueLower(job.preferredTools || [])
  const jobTools = uniqueLower([...required, ...preferred])
  const overlap = jobTools.filter((t) => profileTools.includes(t))

  return {
    overlap,
    required,
    preferred,
    profile: profileTools,
  }
}

function cleanFactSnippet(s: string): string {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[.;:\s]+$/, "")
    .trim()
}

function profileFactFromUnit(unit: ProfileEvidenceUnit): string {
  return cleanFactSnippet(unit.snippet)
}

function jobFactFromUnit(unit: JobRequirementUnit): string {
  let text = cleanFactSnippet(unit.snippet)

  text = text
    .replace(/^(you will|responsibilities include|responsible for)\s+/i, "")
    .replace(/^to\s+/i, "")
    .trim()

  return text || unit.label
}

function isAdjacent(jobKey: string, profileKey: string): boolean {
  const jobAdj = ADJACENCY[jobKey] || []
  const profileAdj = ADJACENCY[profileKey] || []
  return jobAdj.includes(profileKey) || profileAdj.includes(jobKey)
}

function dedupeByMatch(items: WhyEvidenceMatch[]): WhyEvidenceMatch[] {
  const seen = new Set<string>()
  const out: WhyEvidenceMatch[] = []

  for (const item of items) {
    const k = `${item.code}|${item.match_key}|${item.job_unit.id}|${item.profile_unit.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }

  return out
}

function dedupeRiskCodes(risks: RiskCode[]): RiskCode[] {
  const seen = new Set<string>()
  const out: RiskCode[] = []

  for (const risk of risks) {
    const key = `${risk.code}|${risk.job_fact}|${risk.profile_fact || ""}|${risk.risk}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(risk)
  }

  return out
}

function evidenceShapeCompatible(jobUnit: JobRequirementUnit, profileUnit: ProfileEvidenceUnit): {
  compatible: boolean
  degradeToAdjacent: boolean
  boost: number
} {
  const j = jobUnit.key as string
  const p = norm(profileUnit.key)
  const text = norm(profileUnit.snippet)

  if (j !== p) {
    return { compatible: true, degradeToAdjacent: false, boost: 0 }
  }

  if (j === "crm_usage") {
    const explicit = /\b(crm|salesforce|hubspot|customer relationship management|pipeline tracking|opportunity tracking)\b/i.test(
      profileUnit.snippet
    )
    return { compatible: explicit, degradeToAdjacent: !explicit, boost: explicit ? 6 : -8 }
  }

  if (j === "territory_execution") {
    const explicit = /\b(territory|regional accounts|field sales|onsite customer visits|cover cases|assigned territory)\b/i.test(
      profileUnit.snippet
    )
    return { compatible: explicit, degradeToAdjacent: !explicit, boost: explicit ? 5 : -8 }
  }

  if (j === "account_management") {
    const explicit = /\b(account management|book of business|managed accounts|maintained accounts|customer success|account support)\b/i.test(
      profileUnit.snippet
    )
    return { compatible: explicit, degradeToAdjacent: !explicit, boost: explicit ? 4 : -6 }
  }

  if (j === "post_sale_support") {
    const explicit = /\b(post-sale|post sale|follow-up|follow up|implementation support|customer onboarding|replenishment|renewal support)\b/i.test(
      profileUnit.snippet
    )
    return { compatible: explicit, degradeToAdjacent: !explicit, boost: explicit ? 4 : -6 }
  }

  if (j === "product_training_enablement") {
    const explicit = /\b(training|trained|demo|demonstration|in-service|product intro|product introduction|education sessions)\b/i.test(
      profileUnit.snippet
    )
    return { compatible: explicit, degradeToAdjacent: !explicit, boost: explicit ? 5 : -7 }
  }

  if (j === "med_device_industry_knowledge") {
    const explicit = /\b(medical device|device sales|implant sales|orthopedic device|device portfolio|competitive device knowledge)\b/i.test(
      profileUnit.snippet
    )

    const purelyClinical =
      profileUnit.functionTag === "premed_clinical" &&
      !explicit

    return {
      compatible: explicit,
      degradeToAdjacent: !explicit || purelyClinical,
      boost: explicit ? 5 : -16,
    }
  }

  if (j === "client_commercial_work") {
    const adminOnly = /\b(scheduling client meetings|maintaining client communication|client meetings)\b/i.test(
      profileUnit.snippet
    )
    if (adminOnly) return { compatible: false, degradeToAdjacent: true, boost: -7 }
  }

  if (j === "hospital_or_environment") {
    const explicit = /\b(operating room|orthopedic|surgical|hospital|emt|surgeon|physician-facing|physician facing)\b/i.test(
      profileUnit.snippet
    )
    return { compatible: explicit, degradeToAdjacent: false, boost: explicit ? 3 : -3 }
  }

  if (j === "clinical_stakeholder_fluency") {
    const explicit = /\b(physician|surgeon|provider|clinical staff|worked with physicians|worked with surgeons)\b/i.test(
      profileUnit.snippet
    )
    return { compatible: explicit, degradeToAdjacent: !explicit, boost: explicit ? 3 : -4 }
  }

  return { compatible: true, degradeToAdjacent: false, boost: 0 }
}

function buildEvidenceMatches(job: StructuredJobSignals, profile: StructuredProfileSignals): WhyEvidenceMatch[] {
  const jobUnits = Array.isArray(job.requirement_units) ? job.requirement_units : []
  const profileUnits = Array.isArray(profile.profile_evidence_units) ? profile.profile_evidence_units : []
  const matches: WhyEvidenceMatch[] = []

  for (const ju of jobUnits) {
    for (const pu of profileUnits) {
      let matchStrength: MatchStrength | null = null

      if (ju.key === pu.key) {
        matchStrength = "direct"
      } else if (isAdjacent(ju.key, pu.key)) {
        matchStrength = "adjacent"
      }

      if (!matchStrength) continue

      const shape = evidenceShapeCompatible(ju, pu)

      if (matchStrength === "direct" && shape.degradeToAdjacent) {
        matchStrength = "adjacent"
      }

      if (DIRECT_PROOF_REQUIRED_KEYS.has(ju.key) && matchStrength === "direct" && !shape.compatible) {
        matchStrength = "adjacent"
      }

      const base = matchStrength === "direct" ? 78 : 58

      const kindBonus =
        ju.kind === "function" ? 10 :
        ju.kind === "execution" ? 9 :
        ju.kind === "deliverable" ? 8 :
        ju.kind === "stakeholder" ? 7 :
        ju.kind === "tool" ? 5 :
        4

      const requirednessBonus = ju.requiredness === "core" ? 10 : 4
      const strengthBonus = Math.min(10, Math.floor((ju.strength + pu.strength) / 2))
      const weight = clamp(base + kindBonus + requirednessBonus + strengthBonus + shape.boost, 0, 120)

      const coverageScore = clamp(
        (matchStrength === "direct" ? 72 : 48) +
          (ju.requiredness === "core" ? 8 : 4) +
          Math.min(8, Math.floor(pu.strength / 2)) +
          shape.boost,
        0,
        100
      )

      const code =
        ju.kind === "tool"
          ? "WHY_TOOL_PROOF"
          : matchStrength === "direct"
          ? "WHY_DIRECT_EXPERIENCE_PROOF"
          : ju.kind === "execution" || ju.kind === "deliverable" || ju.kind === "stakeholder"
          ? "WHY_EXECUTION_PROOF"
          : "WHY_ADJACENT_EXPERIENCE_PROOF"

      matches.push({
        code,
        match_key: ju.key,
        match_kind: ju.kind,
        match_strength: matchStrength,
        job_unit: ju,
        profile_unit: pu,
        job_fact: jobFactFromUnit(ju),
        profile_fact: profileFactFromUnit(pu),
        note:
          matchStrength === "direct"
            ? "Profile proof directly matches a concrete job requirement."
            : "Profile proof is adjacent but credibly transferable to a concrete job requirement.",
        weight,
        coverageScore,
      })
    }
  }

  return dedupeByMatch(matches).sort((a, b) => b.weight - a.weight)
}

function buildCoverage(job: StructuredJobSignals, allMatches: WhyEvidenceMatch[]): RequirementCoverage[] {
  const jobUnits = Array.isArray(job.requirement_units) ? job.requirement_units : []

  return jobUnits.map((ju) => {
    const matchesForUnit = allMatches
      .filter((m) => m.job_unit.id === ju.id)
      .sort((a, b) => b.coverageScore - a.coverageScore)

    const bestMatch = matchesForUnit[0] || null
    const minimumCoverage =
      ju.requiredness === "core"
        ? DIRECT_PROOF_REQUIRED_KEYS.has(ju.key)
          ? 70
          : 60
        : DIRECT_PROOF_REQUIRED_KEYS.has(ju.key)
        ? 62
        : 52

    const nearMissFloor =
      ju.requiredness === "core" ? minimumCoverage - 18 : minimumCoverage - 14

    const coverageScore = bestMatch?.coverageScore || 0
    const adequate = coverageScore >= minimumCoverage
    const nearMiss = !adequate && coverageScore >= nearMissFloor

    return {
      jobUnit: ju,
      bestMatch,
      coverageScore,
      adequate,
      nearMiss,
    }
  })
}

function buildMajorGapRisks(job: StructuredJobSignals, coverage: RequirementCoverage[]): RiskCode[] {
  const majorKinds = new Set(["function", "execution", "deliverable", "stakeholder", "tool"])

  const gapUnits = coverage
    .filter((c) => {
      if (!majorKinds.has(c.jobUnit.kind)) return false
      if (!(c.jobUnit.requiredness === "core" || c.jobUnit.strength >= 8)) return false
      return !c.adequate
    })
    .sort((a, b) => {
      const aCore = a.jobUnit.requiredness === "core" ? 1 : 0
      const bCore = b.jobUnit.requiredness === "core" ? 1 : 0
      if (bCore !== aCore) return bCore - aCore
      return b.jobUnit.strength - a.jobUnit.strength
    })
    .slice(0, 5)

  return gapUnits.map((c) => ({
    code: "RISK_MISSING_PROOF" as const,
    job_fact: c.jobUnit.label,
    profile_fact: c.bestMatch?.profile_fact || null,
    risk: c.nearMiss
      ? "You show adjacent evidence here, but not enough direct proof for the way this role uses it."
      : "The role emphasizes work where your profile does not yet show clear direct proof.",
    severity: c.jobUnit.requiredness === "core" ? "high" as const : "medium" as const,
    weight: 0,
  }))
}

function selectWhyMatches(all: WhyEvidenceMatch[], min = 3, max = 6): WhyEvidenceMatch[] {
  const picked: WhyEvidenceMatch[] = []
  const usedKeys = new Set<string>()
  const kindCounts: Record<string, number> = {}

  const ranked = [...all].sort((a, b) => {
    const priority = (m: WhyEvidenceMatch) => {
      let p = 0

      if (m.match_strength === "direct") p += 100
      else p += 40

      if (m.match_kind === "function") p += 40
      else if (m.match_kind === "deliverable") p += 28
      else if (m.match_kind === "execution") p += 20
      else if (m.match_kind === "stakeholder") p += 12
      else if (m.match_kind === "tool") p += 8

      if (m.code === "WHY_DIRECT_EXPERIENCE_PROOF") p += 20
      if (m.match_key === "product_positioning") p += 10
      if (m.match_key === "hospital_or_environment") p += 8
      if (m.match_key === "clinical_stakeholder_fluency") p += 8

      return p + (m.weight || 0)
    }

    return priority(b) - priority(a)
  })

  function badProfileFact(s: string): boolean {
    const t = norm(s)
    if (!t) return true
    if (t.length < 35) return true
    if (t.length > 320) return true
    if (t.includes("education")) return true
    if (t.includes("core competencies")) return true
    if (t.includes("linkedin")) return true
    if (t.includes("portfolio")) return true
    if (/@/.test(t)) return true
    if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(t)) return true
    if (/\|\s*[A-Z][a-z]+/.test(s)) return true
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b.*\b20\d{2}\b/.test(s)) return true
    return false
  }

  function badJobFact(s: string): boolean {
    const t = norm(s)
    if (!t) return true
    if (t.length < 18) return true
    if (t.length > 700) return true
    if (t.includes("about us")) return true
    if (t.includes("equal opportunity")) return true
    if (t.includes("benefits")) return true
    if (t.includes("bachelor's degree")) return true
    if (t.includes("bachelors degree")) return true
    if (t.includes("degree in")) return true
    return false
  }

  for (const match of ranked) {
    if (picked.length >= max) break
    if (!match.job_fact || !match.profile_fact) continue
    if (badProfileFact(match.profile_fact)) continue
    if (badJobFact(match.job_fact)) continue

    if (usedKeys.has(match.match_key)) {
      const alreadyPickedSameKey = picked.filter((p) => p.match_key === match.match_key)
      const allowSecondSameKey =
        alreadyPickedSameKey.length === 1 &&
        alreadyPickedSameKey[0].profile_fact !== match.profile_fact &&
        alreadyPickedSameKey[0].job_fact !== match.job_fact &&
        match.match_strength === "direct"

      if (!allowSecondSameKey) continue
    }

    const kindKey = match.match_kind
    if ((kindCounts[kindKey] || 0) >= 2 && match.match_kind !== "function") continue

    picked.push(match)
    usedKeys.add(match.match_key)
    kindCounts[kindKey] = (kindCounts[kindKey] || 0) + 1
  }

  if (picked.length < min) {
    for (const match of ranked) {
      if (picked.length >= min) break
      if (picked.some((p) => p.job_unit.id === match.job_unit.id && p.profile_unit.id === match.profile_unit.id)) continue
      if (!match.job_fact || !match.profile_fact) continue
      if (badProfileFact(match.profile_fact)) continue
      if (badJobFact(match.job_fact)) continue
      if (usedKeys.has(match.match_key)) continue
      picked.push(match)
      usedKeys.add(match.match_key)
    }
  }

  return picked.slice(0, max)
}

function whyCodesFromMatches(matches: WhyEvidenceMatch[]): WhyCode[] {
  return matches.map((m) => ({
    code: m.code,
    job_fact: m.job_fact,
    profile_fact: m.profile_fact,
    note: m.note,
    weight: m.weight,
    match_key: m.match_key,
    match_kind: m.match_kind,
    match_strength: m.match_strength,
  }))
}

function computeBaseScore(job: StructuredJobSignals, profile: StructuredProfileSignals, whyMatches: WhyEvidenceMatch[], coverage: RequirementCoverage[]): number {
  let base = 56

  const familyMatch = profile.targetFamilies.includes(job.jobFamily)
  if (familyMatch) base += 10

 if (!familyMatch && profile.targetFamilies.length > 0) {
    base -= 12
  }

  const directCount = whyMatches.filter((m) => m.match_strength === "direct").length
  const adjacentCount = whyMatches.filter((m) => m.match_strength === "adjacent").length
  const toolCount = whyMatches.filter((m) => m.match_kind === "tool").length
  const adequateCoverageCount = coverage.filter((c) => c.adequate).length
  const coreCoverageCount = coverage.filter((c) => c.adequate && c.jobUnit.requiredness === "core").length

base += Math.min(24, directCount * 7)
base += Math.min(8, adjacentCount * 2)
base += Math.min(4, toolCount * 2)
base += Math.min(8, adequateCoverageCount)
base += Math.min(8, coreCoverageCount)

if (directCount >= 3 && coreCoverageCount >= 1 && base < 72) {
  base = 72
}
if (directCount >= 4 && adequateCoverageCount >= 3 && base < 78) {
  base = 78
}

  return clamp(base, POLICY.score.minScore, POLICY.score.maxScore)
}

function capabilityPenaltyKey(jobKey: string): PenaltyKey {
  if (SYSTEM_KEYS.has(jobKey)) return "missing_required_system_proof"
  if (OWNERSHIP_KEYS.has(jobKey)) return "missing_ownership_scope_proof"
  if (COMMERCIAL_EXECUTION_KEYS.has(jobKey)) return "missing_commercial_execution_proof"
  return "missing_core_capability_direct_proof"
}

function capabilitySeverity(jobUnit: JobRequirementUnit, nearMiss: boolean): Severity {
  if (jobUnit.requiredness === "core" && !nearMiss) return "high"
  if (jobUnit.requiredness === "core" && nearMiss) return "medium"
  if (!nearMiss) return "medium"
  return "low"
}

export function scoreJobFit(job: StructuredJobSignals, profile: StructuredProfileSignals): ScoreResult {
  const penalties: Penalty[] = []
  const riskOnlyCodes: RiskCode[] = []

  const allMatches = buildEvidenceMatches(job, profile)
  const coverage = buildCoverage(job, allMatches)
  const majorGapRisks = buildMajorGapRisks(job, coverage)
  const selectedMatches = selectWhyMatches(allMatches, 3, 6)
  const whyCodes = whyCodesFromMatches(selectedMatches)

  const hasExplicitTools =
    (job.requiredTools?.length || 0) + (job.preferredTools?.length || 0) > 0

  {
    const profileConstrained = !!profile.locationPreference.constrained
    const jobCity = job.location?.city ?? null
    const allowedCities = profile.locationPreference.allowedCities

    const hasJobCity =
      typeof jobCity === "string" && jobCity.trim().length > 0

    const hasAllowedCities =
      Array.isArray(allowedCities) && allowedCities.length > 0

    const cityMismatch =
      hasJobCity &&
      hasAllowedCities &&
      !locationCityMatches(jobCity, allowedCities)

    if (cityMismatch) {
      if (profileConstrained) {
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
      } else {
        riskOnlyCodes.push({
          code: "RISK_LOCATION",
          job_fact: `Job location indicates ${jobCity}.`,
          profile_fact: `Preferred cities are ${allowedCities.join(", ")}.`,
          risk: "The job location sits outside your stated preferred cities.",
          severity: "medium",
          weight: 0,
        })
      }
    }
  }

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

  if (profile.constraints.hardNoSales && job.isSalesHeavy) {
    const amt = computePenaltyAmount("sales_mismatch")
    penalties.push({
      key: "sales_mismatch",
      amount: amt,
      note: "Sales signals present",
      risk: {
        code: "RISK_SALES",
        job_fact: "Posting contains sales signals such as quota, commission, pipeline, or cold outreach.",
        profile_fact: "You have a hard no-sales constraint.",
        risk: "Sales expectations conflict with your constraints.",
        severity: "high",
        weight: -amt,
      },
    })
  }

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

  if (job.isContract && profile.constraints.hardNoContract) {
    const amt = computePenaltyAmount("contract_mismatch") + 6
    penalties.push({
      key: "contract_mismatch",
      amount: amt,
      note: "Hard no contract",
      risk: {
        code: "RISK_CONTRACT",
        job_fact: "Posting indicates contract or temporary structure.",
        profile_fact: "You have a hard no-contract constraint.",
        risk: "Role structure conflicts with your hard constraint.",
        severity: "high",
        weight: -amt,
      },
    })
  } else if (job.isContract) {
    // Contract roles always penalize students — regardless of stated preference
    // Most students targeting full-time should not be chasing contract work
    const isHardPreference = profile.constraints.prefFullTime
    const amt = computePenaltyAmount("contract_mismatch") + (isHardPreference ? 4 : 2)
    penalties.push({
      key: "contract_mismatch",
      amount: amt,
      note: "Contract role vs student seeking employment",
      risk: {
        code: "RISK_CONTRACT",
        job_fact: "Posting indicates contract or temporary structure.",
        profile_fact: isHardPreference ? "You prefer full-time roles." : "Contract roles are generally not ideal for early-career candidates.",
        risk: isHardPreference
          ? "Role structure conflicts with your work-type preference."
          : "This is a contract role, which is generally not the right move for early-career candidates building a full-time track record.",
        severity: isHardPreference ? "high" : "medium",
        weight: -amt,
      },
    })
  }

  if (job.isHourly) {
    if (profile.constraints.hardNoHourlyPay) {
      const amt = computePenaltyAmount("hourly_pay_mismatch")
      penalties.push({
        key: "hourly_pay_mismatch",
        amount: amt,
        note: "Hourly pay signals present — hard constraint",
        risk: {
          code: "RISK_HOURLY",
          job_fact: "Posting indicates hourly compensation.",
          profile_fact: "You have a no-hourly constraint.",
          risk: "Compensation structure conflicts with your preference.",
          severity: "high",
          weight: -amt,
        },
      })
    } else if (profile.constraints.prefFullTime) {
      const amt = computePenaltyAmount("hourly_pay_mismatch")
      penalties.push({
        key: "hourly_pay_mismatch",
        amount: amt,
        note: "Hourly gig work vs full-time preference",
        risk: {
          code: "RISK_HOURLY",
          job_fact: "Posting indicates hourly or gig-based compensation.",
          profile_fact: "You are targeting full-time career roles.",
          risk: "This is hourly or gig-based work. If you are building a full-time career track, this is not the right use of your application effort.",
          severity: "medium",
          weight: -amt,
        },
      })
    }
  }

  // Seniority mismatch — fire a risk flag when the job title signals a senior/manager
  // level and the candidate has <= 2 years of experience. This catches cases where
  // keyword match is strong but the role is structurally above the candidate's level.
  if (job.isSeniorRole && profile.yearsExperienceApprox !== null && profile.yearsExperienceApprox <= 2) {
    riskOnlyCodes.push({
      code: "RISK_EXPERIENCE",
      job_fact: "Job title indicates a senior, manager, or leadership-level role.",
      profile_fact: `Profile shows approximately ${profile.yearsExperienceApprox} year${profile.yearsExperienceApprox === 1 ? "" : "s"} of experience.`,
      risk: "This role is titled at a level above where early-career candidates are typically competitive. Strong keyword match alone does not overcome a seniority gap — hiring managers screen on title-level experience first.",
      severity: "medium",
      weight: -8,
    })
    console.log("[scoring] Seniority mismatch risk flag added — isSeniorRole + low experience")
  }

  if (job.yearsRequired !== null && profile.yearsExperienceApprox !== null) {
    const yearsGap = job.yearsRequired - profile.yearsExperienceApprox
    if (yearsGap > 0.5) {
      const baseAmt = computePenaltyAmount("experience_years_gap")
      // Scale penalty with how far under they are
      // 1 year under = base, 2 years under = 1.5x, 3+ years under = 2x
      const scaleFactor = yearsGap >= 3 ? 2.0 : yearsGap >= 2 ? 1.5 : 1.0
      const amt = Math.round(baseAmt * scaleFactor)
      const severity: "high" | "medium" = yearsGap >= 2 ? "high" : "medium"
      penalties.push({
        key: "experience_years_gap",
        amount: amt,
        note: `Years required ${job.yearsRequired}, profile approx ${profile.yearsExperienceApprox}, gap ${yearsGap}`,
        risk: {
          code: "RISK_EXPERIENCE",
          job_fact: `Posting requires ${job.yearsRequired}+ years of experience.`,
          profile_fact: `Profile experience approximates ${profile.yearsExperienceApprox} years.`,
          risk: yearsGap >= 2
            ? `This role requires ${job.yearsRequired}+ years of experience. You are currently about ${yearsGap} years short of that bar.`
            : "Experience requirement may be above your current level.",
          severity,
          weight: -amt,
        },
      })
    }
  }

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

  if (hasExplicitTools) {
    const profileTools = profile.tools || []
    const requiredMissing = (job.requiredTools || []).filter((t) => toolMissing(profileTools, t))
    const preferredMissing = (job.preferredTools || []).filter((t) => toolMissing(profileTools, t))

    for (const tool of requiredMissing) {
      let sev: Severity = "high"
      const hasAdjacent = hasAdjacentToolProof(profileTools, tool)
      if (hasAdjacent) sev = downgradeSeverity(sev)

      // Required tools subtract from score — not just a risk flag
      const toolPenaltyAmt = hasAdjacent ? 4 : 8
      penalties.push({
        key: "missing_core_capability_direct_proof",
        amount: toolPenaltyAmt,
        note: `Missing required tool: ${tool}`,
        risk: {
          code: "RISK_MISSING_TOOLS",
          job_fact: `Posting lists ${tool} as required.`,
          profile_fact: profileTools.length ? `Profile tools: ${profileTools.join(", ")}.` : null,
          risk: `You have not shown ${tool} yet, and it is prioritized in the posting.`,
          severity: sev,
          weight: -toolPenaltyAmt,
        },
      })
    }

    for (const tool of preferredMissing) {
      let sev: Severity = "medium"
      const hasAdjacent = hasAdjacentToolProof(profileTools, tool)
      if (hasAdjacent) sev = downgradeSeverity(sev)

      // Preferred tools: subtract smaller amount
      const toolPenaltyAmt = hasAdjacent ? 2 : 4
      penalties.push({
        key: "missing_core_capability_direct_proof",
        amount: toolPenaltyAmt,
        note: `Missing preferred tool: ${tool}`,
        risk: {
          code: "RISK_MISSING_TOOLS",
          job_fact: `Posting lists ${tool} as preferred.`,
          profile_fact: profileTools.length ? `Profile tools: ${profileTools.join(", ")}.` : null,
          risk: `You have not shown ${tool} yet, and it is called out in the posting.`,
          severity: sev,
          weight: -toolPenaltyAmt,
        },
      })
    }
  }

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

  // Finance sub-family mismatch penalty
  // Only fires when both job and profile are Finance and sub-families are misaligned
  if (job.jobFamily === "Finance" && job.financeSubFamily && profile.financeSubFamily) {
    const distance = getFinanceSubFamilyDistance(job.financeSubFamily, profile.financeSubFamily)
    if (distance >= 2) {
      // Heavy mismatch (e.g. IB vs FP&A) — penalize and surface risk
      const baseAmt = computePenaltyAmount("finance_subfamily_mismatch")
      const amt = distance === 3 ? baseAmt * 1.5 : baseAmt
      const jobSubLabel = job.financeSubFamily.replace("_", " ").replace("ib", "investment banking").replace("fpa", "FP&A")
      const profileSubLabel = profile.financeSubFamily.replace("_", " ").replace("ib", "investment banking").replace("fpa", "FP&A")
      penalties.push({
        key: "finance_subfamily_mismatch",
        amount: amt,
        note: `Finance sub-family mismatch: job=${job.financeSubFamily}, profile=${profile.financeSubFamily}`,
        risk: {
          code: "RISK_SUBFAMILY_MISMATCH",
          job_fact: `This is a ${jobSubLabel} role.`,
          profile_fact: `Your finance experience is primarily in ${profileSubLabel}.`,
          risk: `${jobSubLabel.charAt(0).toUpperCase() + jobSubLabel.slice(1)} and ${profileSubLabel} are different tracks within Finance. You have relevant analytical foundations, but the day-to-day work, career path, and required proof points are meaningfully different.`,
          severity: "medium",
          weight: -amt,
        },
      })
    } else if (distance === 1) {
      // Light mismatch — risk flag only, no score penalty
      const jobSubLabel = job.financeSubFamily.replace("_", " ").replace("ib", "investment banking").replace("fpa", "FP&A")
      const profileSubLabel = profile.financeSubFamily.replace("_", " ").replace("ib", "investment banking").replace("fpa", "FP&A")
      riskOnlyCodes.push({
        code: "RISK_SUBFAMILY_MISMATCH",
        job_fact: `This is a ${jobSubLabel} role.`,
        profile_fact: `Your finance experience is primarily in ${profileSubLabel}.`,
        risk: `Your ${profileSubLabel} background is adjacent to ${jobSubLabel}. The analytical skills transfer, but expect questions about the gap in deal-specific or domain-specific experience.`,
        severity: "low",
        weight: 0,
      })
    }
  }

  if (job.yearsRequired !== null && profile.yearsExperienceApprox !== null) {
    if (profile.yearsExperienceApprox + 1 < job.yearsRequired) {
      riskOnlyCodes.push({
        code: "RISK_SENIORITY_MISMATCH",
        job_fact: `Posting suggests ${job.yearsRequired}+ years experience.`,
        profile_fact: `Profile shows about ${profile.yearsExperienceApprox} years.`,
        risk: "This role may expect a more experienced candidate.",
        severity: "medium",
        weight: 0,
      })
    }
  }

  if (
    (job.requirement_units?.length || 0) === 0 &&
    job.yearsRequired === null &&
    (job.requiredTools?.length || 0) === 0 &&
    (job.preferredTools?.length || 0) === 0 &&
    job.location?.mode === "unclear" &&
    !job.isContract &&
    !job.isHourly &&
    !job.mbaRequired &&
    job.gradYearHint === null
  ) {
    riskOnlyCodes.push({
      code: "RISK_AMBIGUOUS_ROLE",
      job_fact: "Posting provides limited concrete detail on requirements or structure.",
      profile_fact: null,
      risk: "The role description is vague, which makes fit harder to evaluate confidently.",
      severity: "low",
      weight: 0,
    })
  }

  // New engine-level uncovered capability penalties
  for (const c of coverage) {
    if (c.adequate) continue
  if (c.jobUnit.requiredness !== "core") continue
    if (c.jobUnit.kind === "tool") continue

    const key = capabilityPenaltyKey(c.jobUnit.key)
    const amt = computePenaltyAmount(key) * (c.nearMiss ? 0.35 : 0.75)

    penalties.push({
      key,
      amount: amt,
      note: `Missing proof for ${c.jobUnit.key} (coverage=${c.coverageScore})`,
      risk: {
        code: "RISK_MISSING_PROOF",
        job_fact: c.jobUnit.label,
        profile_fact: c.bestMatch?.profile_fact || null,
        risk: c.nearMiss
          ? "You have adjacent evidence here, but not enough direct proof for this role's requirement."
          : "This role expects clearer direct proof in this capability than your profile currently shows.",
        severity: capabilitySeverity(c.jobUnit, c.nearMiss),
        weight: -amt,
      },
    })
  }

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

  const base = computeBaseScore(job, profile, selectedMatches, coverage)
  let score = base - penaltySum
  score = clamp(score, POLICY.score.minScore, POLICY.score.maxScore)

  const riskCodes = dedupeRiskCodes([...capped.map((p) => p.risk), ...riskOnlyCodes, ...majorGapRisks])

  return {
    score: Math.round(score),
    penalties: capped,
    penaltySum,
    whyCodes,
    riskCodes,
  }
}