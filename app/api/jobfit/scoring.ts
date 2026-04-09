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

// Detects when a profile evidence snippet is a bare skills-list keyword
// rather than a narrative accomplishment. Used to cap WHY_TOOL_PROOF
// weight so that listing "Microsoft Office Suite · Google Workspace ·
// SharePoint" doesn't register as the same level of proof as "Built
// 3-statement financial model in Excel for board review".
//
// Heuristics (any ONE of these triggers skills-list treatment):
//   - 2+ occurrences of a bullet separator (·, |, •, ‣)
//   - 4+ comma-separated items that are each 1-3 words and contain no
//     action verb (built, developed, managed, designed, led, etc.)
//   - The snippet is very short (< 12 words) with 3+ items
function isSkillsListSnippet(snippet: string): boolean {
  const s = String(snippet || "").trim()
  if (!s) return false

  // U+FFFD is the replacement character — shows up when a CSV was saved
  // in Windows-1252 and read as UTF-8, so exotic separators like "·" or
  // "•" decode to "\ufffd". Include en-dash and em-dash as well since
  // some profiles use those as list separators.
  const separatorCount = (s.match(/[·•‣|\ufffd–—]/g) || []).length
  if (separatorCount >= 2) return true

  const wordCount = s.split(/\s+/).filter(Boolean).length
  const hasActionVerb =
    /\b(built|building|developed|developing|designed|managing|managed|led|leading|owned|owning|created|creating|launched|launching|drove|driving|implemented|implementing|executed|executing|delivered|delivering|shipped|shipping|analyzed|analyzing|researched|researching|presented|presenting|wrote|writing|authored|authoring|configured|configuring|optimized|optimizing|improved|improving|reduced|reducing|increased|increasing|scaled|scaling|migrated|migrating|architected|architecting|deployed|deploying|collaborated|collaborating)\b/i.test(s)

  if (hasActionVerb) return false

  // Short snippet with commas and no verbs → looks like a skills list
  const commaItems = s.split(/,/).map((x) => x.trim()).filter(Boolean)
  if (wordCount < 12 && commaItems.length >= 3) return true
  if (commaItems.length >= 4 && commaItems.every((c) => c.split(/\s+/).length <= 3)) return true

  return false
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
      let weight = clamp(base + kindBonus + requirednessBonus + strengthBonus + shape.boost, 0, 120)

      // Tool-proof inflation guard: when a WHY_TOOL_PROOF matches off a
      // bare skills-list keyword ("Microsoft Office Suite · Google
      // Workspace · SharePoint · Confluence"), the evidence is weak — the
      // candidate listed the tool but hasn't shown any narrative
      // accomplishment with it. Cap the weight so a skills-list match
      // cannot push the score into Priority Apply territory on tool
      // proofs alone. Narrative tool proofs (e.g. "Built 3-statement
      // model in Excel for board review") retain their full weight.
      if (ju.kind === "tool" && isSkillsListSnippet(pu.snippet)) {
        weight = Math.min(weight, 60)
      }

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

// Tokens that carry seniority / role-level metadata but no domain info.
// These are stripped before comparing target roles to job titles so that
// "Analytical Scientist I" and "analytical sciences associate" can be
// recognized as equivalent domain roles regardless of the "i" / "associate"
// level indicator.
const TITLE_NOISE_TOKENS = new Set([
  "i", "ii", "iii", "iv", "v",
  "jr", "junior", "sr", "senior", "entry", "level", "associate", "principal",
  "staff", "lead", "head", "chief", "vp", "svp", "evp",
  "manager", "director", "coordinator", "specialist", "generalist",
  "representative", "rep", "agent", "officer", "administrator", "assistant",
  "analyst", "consultant", "intern", "trainee", "apprentice",
  "the", "of", "in", "for", "at", "with", "and", "to", "a", "an",
])

// Common abbreviations / aliases that should be expanded before tokenizing.
// Add new pairs here whenever a new candidate's target-role terminology
// doesn't match the common title form used in job postings.
const TITLE_ALIAS_MAP: Array<[RegExp, string]> = [
  [/\bqc\b/gi, "quality control"],
  [/\br&d\b/gi, "research development"],
  [/\br and d\b/gi, "research development"],
  [/\bhrbp\b/gi, "hr business partner"],
  [/\bcos\b/gi, "chief of staff"],
  [/\bcs\b/gi, "customer success"],
  [/\bbd\b/gi, "business development"],
  [/\bae\b/gi, "account executive"],
  [/\bsdr\b/gi, "sales development representative"],
  [/\bae\b/gi, "account executive"],
  [/\bpm\b/gi, "product manager"],
  [/\bux\b/gi, "user experience"],
  [/\bui\b/gi, "user interface"],
]

function normalizeTitleTokens(s: string): Set<string> {
  if (!s) return new Set()
  let t = s.toLowerCase()
  for (const [rx, replacement] of TITLE_ALIAS_MAP) {
    t = t.replace(rx, replacement)
  }
  const tokens = t
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 0 && !TITLE_NOISE_TOKENS.has(tok))
  return new Set(tokens)
}

// Check whether the user-provided job title matches any of the candidate's
// stated target roles. Returns the best (highest-overlap) matched role
// and an overlap score in [0, 1]. A single shared non-noise token counts
// as a match — this is intentional because domain tokens (e.g. "clinical",
// "analytical", "biomedical") are rare and discriminating.
function matchTargetRoleToJobTitle(
  targetRoles: string[],
  jobTitle: string
): { matched: boolean; matchedRole: string | null; overlap: number } {
  if (!jobTitle || !targetRoles || targetRoles.length === 0) {
    return { matched: false, matchedRole: null, overlap: 0 }
  }

  const titleTokens = normalizeTitleTokens(jobTitle)
  if (titleTokens.size === 0) {
    return { matched: false, matchedRole: null, overlap: 0 }
  }

  let bestRole: string | null = null
  let bestOverlap = 0

  for (const role of targetRoles) {
    const roleTokens = normalizeTitleTokens(role)
    if (roleTokens.size === 0) continue

    let shared = 0
    for (const tok of roleTokens) {
      if (titleTokens.has(tok)) shared++
    }

    // Overlap ratio relative to the smaller token set so a short target
    // role like "QC Analyst" can fully match a long title like "Quality
    // Control Analyst Level II".
    const overlap = shared / Math.min(roleTokens.size, titleTokens.size)

    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestRole = role
    }
  }

  // Threshold: at least one shared domain token. With noise words stripped,
  // any overlap is meaningful because domain tokens are rare.
  return {
    matched: bestOverlap > 0,
    matchedRole: bestRole,
    overlap: bestOverlap,
  }
}

function computeBaseScore(job: StructuredJobSignals, profile: StructuredProfileSignals, whyMatches: WhyEvidenceMatch[], coverage: RequirementCoverage[]): number {
  let base = 56

  const familyMatch = profile.targetFamilies.includes(job.jobFamily)
  if (familyMatch) base += 10

  // Hard technical families get a steeper penalty for mismatch
  const HARD_TECH = new Set(["Engineering", "IT_Software", "Healthcare", "Trades"])
  const isTechnicalJob = HARD_TECH.has(job.jobFamily)

  if (!familyMatch && profile.targetFamilies.length > 0) {
    base -= isTechnicalJob ? 30 : 12
  }

  // ── Direct target-role ↔ job-title matching ─────────────────────────
  // When the candidate's stated target roles contain tokens that appear in
  // the (user-provided) job title, that's the strongest positive signal
  // possible — the user explicitly told us "this is the kind of role I
  // want" and the title matches. Adds up to +18 base score to recognize
  // the intent-level match that the tag/keyword extraction often misses.
  //
  // Uses the user-provided jobTitle (required by /api/jobfit route handler).
  // Also helps offset the bare-word false-positive inflation from the
  // WHY code matchers until those phrase lists are tightened.
  const targetRoles = profile.statedInterests?.targetRoles ?? []
  const titleMatch = matchTargetRoleToJobTitle(targetRoles, job.jobTitle || "")
  if (titleMatch.matched) {
    // Scale bonus by overlap strength: 1.0 overlap (full token match) → +18,
    // 0.5 overlap (half tokens shared) → +9, etc.
    const bonus = Math.round(titleMatch.overlap * 18)
    base += bonus

    // When the title match is strong AND the family is a hard-technical
    // mismatch (e.g. a scientist targeting QC Analyst gets classified as
    // IT_Software), soften the family penalty because the title match is
    // the stronger signal.
    if (!familyMatch && isTechnicalJob && titleMatch.overlap >= 0.5) {
      base += 18 // Cancel most of the -30 technical mismatch penalty
    }
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

// Training program bonus — when the job is a training program (e.g. wealth advisor
// development program, FINRA-sponsored entry level), the JD typically has few
// extractable hard requirements because everything is taught on the job. In that
// case, score the candidate based on profile-to-family alignment instead of
// requirement-unit matching.
const isTrainingProgram = (job as any).isTrainingProgram === true
if (isTrainingProgram && familyMatch) {
  // Count strong profile evidence units in the matching family
  const profileEvidenceCount = (profile.profile_evidence_units || []).filter(
    (u: any) => u.strength >= 6 && u.functionTag
  ).length
  // Each strong unit adds 2 points, capped at 20 — gives well-qualified
  // candidates a path to Apply even with sparse JD requirements
  const trainingBonus = Math.min(20, profileEvidenceCount * 2)
  base += trainingBonus
  // Floor at Review for training programs with family match — don't bury
  // qualified candidates just because the JD is light on extractable requirements
  if (base < 65) base = 65
}

// Floor rules — only apply when the family actually matches.
// Generic keyword overlap across different fields should not guarantee a high score.
if (familyMatch || !isTechnicalJob) {
  if (directCount >= 3 && coreCoverageCount >= 1 && base < 72) {
    base = 72
  }
  if (directCount >= 4 && adequateCoverageCount >= 3 && base < 78) {
    base = 78
  }
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

  // Fallback constraint detection from raw intake form text
  const profileHeaderText = (((profile as any)?.profileHeaderText as string) || "").toLowerCase()
  const hardNoSalesEffective =
    profile.constraints.hardNoSales ||
    profileHeaderText.includes("no sales roles") ||
    profileHeaderText.includes("no sales role")

  if (hardNoSalesEffective && job.isSalesHeavy) {
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
    // Seniority mismatch reduces the score directly — a Manager/Director/Senior title
    // requires experience the candidate doesn't have yet. This should be reflected in
    // the score, not just surfaced as a risk flag. Penalty of 18 brings a near-perfect
    // keyword match (97) down to solid Apply range (~79).
    const seniorityPenaltyAmt = 18
    const seniorityRisk: RiskCode = {
      code: "RISK_EXPERIENCE",
      job_fact: "Job title indicates a senior, manager, or leadership-level role.",
      profile_fact: `Profile shows approximately ${profile.yearsExperienceApprox} year${profile.yearsExperienceApprox === 1 ? "" : "s"} of experience.`,
      risk: "This role is titled at a level above where early-career candidates are typically competitive. Strong keyword match alone does not overcome a seniority gap — hiring managers screen on title-level experience first.",
      severity: "medium",
      weight: -seniorityPenaltyAmt,
    }
    penalties.push({
      key: "experience_years_gap",
      amount: seniorityPenaltyAmt,
      note: "Seniority mismatch — manager/senior-level title vs early-career profile",
      risk: seniorityRisk,
    })
    console.log("[scoring] Seniority mismatch penalty applied — score impact:", -seniorityPenaltyAmt)
  }

  // Domain industry experience requirement — fires a risk flag when the job
  // explicitly requires experience in a specific industry vertical. Generic
  // detector covers AEC, healthcare, legal, financial services, biotech,
  // real estate, media, and others. Not a score penalty — candidate may still
  // apply but should address the gap directly in their cover letter.
  if ((job as any).requiresDomainIndustryExperience) {
    const domain = (job as any).detectedDomain || "this specific industry"
    riskOnlyCodes.push({
      code: "RISK_DOMAIN_EXPERIENCE",
      job_fact: `Job requires prior experience in ${domain}.`,
      profile_fact: "Profile does not show the required industry background.",
      risk: `This role explicitly requires experience in ${domain}. Without prior exposure, you will need to address this gap directly in your cover letter — highlight any adjacent experience or transferable skills that demonstrate familiarity with the industry context.`,
      severity: "medium",
    })
    console.log("[scoring] Domain industry experience risk flag added:", domain)
  }

  // Advisory / consulting / banking background requirement. Human
  // recruiters use "within a top advisory firm or bank" as a hard screen
  // gate. If the profile shows no evidence of management consulting,
  // investment banking, or one of the well-known firm names, fire a
  // high-severity risk. This is the kind of gap that sinks applications
  // regardless of how well the candidate's general skills align.
  if ((job as any).requiresAdvisoryBackground) {
    const ADVISORY_FIRM_RE = /\b(mckinsey|bain\b|bcg|boston consulting|deloitte|pwc|pricewaterhouse|ey\b|ernst\s*&\s*young|kpmg|accenture|oliver wyman|l\.?e\.?k\.?|roland berger|goldman sachs|morgan stanley|j\.?p\.?\s*morgan|jpmorgan|citi(group)?|bank of america|barclays|credit suisse|ubs|deutsche bank|lazard|evercore|moelis|centerview|rothschild|houlihan lokey|guggenheim|jefferies|perella|blackstone|kkr|carlyle)\b/i
    const ADVISORY_DISCIPLINE_RE = /\b(management consulting|strategy consulting|investment banking|financial analyst|banking analyst|equity research|m&a advisory|corporate finance advisory|restructuring advisory|transaction advisory)\b/i
    const profileHasAdvisory =
      ADVISORY_FIRM_RE.test(profileHeaderText) ||
      ADVISORY_DISCIPLINE_RE.test(profileHeaderText)
    if (!profileHasAdvisory) {
      const amt = 12
      penalties.push({
        key: "advisory_background_missing" as any,
        amount: amt,
        note: "JD requires top advisory/consulting/banking background; profile shows none",
        risk: {
          code: "RISK_ADVISORY_BACKGROUND",
          job_fact: "Job explicitly requires prior experience at a top management consulting firm or investment bank.",
          profile_fact: "Profile does not show management consulting, investment banking, or equivalent advisory firm experience.",
          risk: "This role uses 'within a top advisory firm or bank' as a screening gate. Without prior experience at McKinsey/Bain/BCG/Big 4, a bulge-bracket bank, or an equivalent firm, this application is likely to be screened out regardless of other qualifications. Consider whether transferable experience can credibly be positioned as advisory work — if not, this is probably not the right use of your application effort.",
          severity: "high" as const,
          weight: -amt,
        },
      })
      riskOnlyCodes.push({
        code: "RISK_ADVISORY_BACKGROUND",
        job_fact: "Job explicitly requires prior experience at a top management consulting firm or investment bank.",
        profile_fact: "Profile does not show management consulting, investment banking, or equivalent advisory firm experience.",
        risk: "This role uses 'within a top advisory firm or bank' as a screening gate. Without prior experience at McKinsey/Bain/BCG/Big 4, a bulge-bracket bank, or an equivalent firm, this application is likely to be screened out regardless of other qualifications. Consider whether transferable experience can credibly be positioned as advisory work — if not, this is probably not the right use of your application effort.",
        severity: "high",
        weight: -amt,
      })
      console.log("[scoring] Advisory background risk fired — profile lacks consulting/banking evidence")
    }
  }

  // Financial modeling / valuations / public filings requirement.
  // Distinct from generic analysis_reporting — this is concrete corporate
  // finance work. If the JD asks for it and the profile doesn't show
  // narrative evidence of financial modeling, fire a medium risk.
  if ((job as any).requiresFinancialModeling) {
    const FIN_MODELING_RE = /\b(financial model(s|ing)?|three[-\s]?statement|3[-\s]?statement|dcf|discounted cash flow|valuation(s)?|lbo|m&a (model|analysis)|equity research|sec filings?|10[-\s]?k\b|10[-\s]?q\b|forecasting models?|corporate finance)\b/i
    const profileHasFinModeling = FIN_MODELING_RE.test(profileHeaderText)
    if (!profileHasFinModeling) {
      const amt = 6
      penalties.push({
        key: "financial_modeling_missing" as any,
        amount: amt,
        note: "JD requires financial modeling / valuations; profile shows no narrative proof",
        risk: {
          code: "RISK_FINANCIAL_MODELING",
          job_fact: "Job asks for financial modeling, valuations, forecasting, or familiarity with company reporting / public filings.",
          profile_fact: "Profile does not show narrative evidence of building financial models, valuations, or working with SEC filings.",
          risk: "This role requires concrete financial modeling work — building 3-statement models, DCF / valuation analysis, or working with public filings. Generic operations or analysis experience is not the same thing. If your modeling experience is informal or light, address this directly in your cover letter and highlight any exposure you do have.",
          severity: "medium" as const,
          weight: -amt,
        },
      })
      riskOnlyCodes.push({
        code: "RISK_FINANCIAL_MODELING",
        job_fact: "Job asks for financial modeling, valuations, forecasting, or familiarity with company reporting / public filings.",
        profile_fact: "Profile does not show narrative evidence of building financial models, valuations, or working with SEC filings.",
        risk: "This role requires concrete financial modeling work — building 3-statement models, DCF / valuation analysis, or working with public filings. Generic operations or analysis experience is not the same thing. If your modeling experience is informal or light, address this directly in your cover letter and highlight any exposure you do have.",
        severity: "medium",
        weight: -amt,
      })
      console.log("[scoring] Financial modeling risk fired — profile lacks modeling evidence")
    }
  }

  // ── Role archetype mismatch ─────────────────────────────────────────────────
  // Fires when the job archetype conflicts with the candidate's stated role targets.
  const profileRoleArchetype = (profile as any)?.roleArchetype as string | null
  const jobArchetype = (job as any)?.jobArchetype as string | null
  const profileTargetRoles = ((profile as any)?.statedInterests?.targetRoles || []) as string[]
  const hardNoContentOnlyFromConstraints = (profile as any)?.constraints?.hardNoContentOnly as boolean
  const hardNoContentOnly =
    hardNoContentOnlyFromConstraints ||
    profileHeaderText.includes("no pure social media") ||
    profileHeaderText.includes("no social media content roles")

  if (profileRoleArchetype && jobArchetype && profileRoleArchetype !== "unclear" && jobArchetype !== "unclear") {
    // For "mixed" archetypes, check if the mix is analytical+strategic (not execution)
    // and the job is execution — that's still a meaningful mismatch
    const profileIsNonExecution =
      profileRoleArchetype === "analytical" ||
      profileRoleArchetype === "strategic" ||
      (profileRoleArchetype === "mixed" &&
        profileTargetRoles.some(r =>
          r.includes("analyst") || r.includes("research") || r.includes("strategy") ||
          r.includes("data") || r.includes("insights") || r.includes("brand strategy")
        ) &&
        !profileTargetRoles.some(r =>
          r.includes("coordinator") || r.includes("content") || r.includes("social media")
        ))

    const mismatch =
      profileIsNonExecution && jobArchetype === "execution"

    if (mismatch) {
      const archetypeLabels: Record<string, string> = {
        analytical: "analytics, research, and data-driven work",
        strategic: "brand strategy and planning",
        execution: "content creation, events, and coordination",
        mixed: "analytical and strategic marketing work",
      }
      const profileLabel = archetypeLabels[profileRoleArchetype] || "the roles you are targeting"
      const jobLabel = archetypeLabels[jobArchetype] || jobArchetype

      penalties.push({
        key: "role_archetype_mismatch" as any,
        amount: 12,
        note: `Role archetype mismatch: profile=${profileRoleArchetype}, job=${jobArchetype}`,
        risk: {
          code: "RISK_ROLE_ARCHETYPE",
          job_fact: `This role is primarily focused on ${jobLabel}.`,
          profile_fact: `Your stated target roles focus on ${profileLabel}.`,
          risk: `This role is structured around ${jobLabel} — a different track than what you said you are targeting. You have the skills to do this work, but taking this role may pull your career away from the ${profileLabel} direction you want to go.`,
          severity: "medium" as const,
        },
      })
      riskOnlyCodes.push({
        code: "RISK_ROLE_ARCHETYPE",
        job_fact: `This role is primarily focused on ${jobLabel}.`,
        profile_fact: `Your stated target roles focus on ${profileLabel}.`,
        risk: `This role is structured around ${jobLabel} — a different track than what you said you are targeting. You have the skills to do this work, but taking this role may pull your career away from the ${profileLabel} direction you want to go.`,
        severity: "medium",
      })
      console.log("[scoring] Role archetype mismatch:", profileRoleArchetype, "vs", jobArchetype)
    }
  }

  // ── Content execution constraint ────────────────────────────────────────────
  // Candidate said "no pure social media content roles" — penalize if job is content-heavy.
  console.log("[scoring] Content constraint check:", { hardNoContentOnly, isContentExecutionHeavy: (job as any)?.isContentExecutionHeavy })
  if (hardNoContentOnly && (job as any)?.isContentExecutionHeavy) {
    penalties.push({
      key: "content_role_conflict",
      amount: 18,
      note: "Content-only role conflicts with candidate constraint",
      risk: {
        code: "RISK_CONTENT_ROLE_CONFLICT",
        job_fact: "This role is primarily content creation, social media, and event coordination.",
        profile_fact: "You stated you do not want pure social media content roles.",
        risk: "You told us you are not looking for pure content or social media roles. This role is primarily content execution and event coordination — not the analytical or strategy-focused work you are targeting.",
        severity: "high" as const,
      },
    })
    riskOnlyCodes.push({
      code: "RISK_CONTENT_ROLE_CONFLICT",
      job_fact: "This role is primarily content creation, social media, and event coordination.",
      profile_fact: "You stated you do not want pure social media content roles.",
      risk: "You told us you are not looking for pure content or social media roles. This role is primarily content execution and event coordination — not the analytical or strategy-focused work you are targeting.",
      severity: "high",
    })
    console.log("[scoring] Content execution constraint penalty applied")
  }

  // ── Industry interest alignment ─────────────────────────────────────────────
  // When a job's industry matches stated target industries, surface a positive signal.
  const targetIndustries = ((profile as any)?.statedInterests?.targetIndustries || []) as string[]
  const jobIndustry = (job as any)?.jobIndustry as string | null
  if (jobIndustry && targetIndustries.length > 0) {
    const industryMatch = targetIndustries.some(i =>
      jobIndustry.toLowerCase().includes(i.toLowerCase()) ||
      i.toLowerCase().includes(jobIndustry.toLowerCase())
    )
    if (industryMatch) {
      riskOnlyCodes.push({
        code: "WHY_INDUSTRY_MATCH",
        job_fact: `This role is in the ${jobIndustry} industry.`,
        profile_fact: `You stated interest in ${jobIndustry} roles.`,
        risk: `This role is in the ${jobIndustry} space — an area you have specifically said you want to work in. That alignment matters beyond keyword matching.`,
        severity: "low",
      })
      console.log("[scoring] Industry interest match:", jobIndustry)
    }
  }

  // Soft credential gap — CFA, CFP, PMP, LCSW etc. Not a legal barrier but
  // a meaningful gap worth flagging. Risk only, no score penalty.
  if ((job as any).requiresSoftCredential && (job as any).softCredentialDetail) {
    const detail = (job as any).softCredentialDetail
    riskOnlyCodes.push({
      code: "RISK_CREDENTIAL_PREFERRED",
      job_fact: `Job lists ${detail} as a requirement or strong preference.`,
      profile_fact: "Profile does not show this certification.",
      risk: `${detail} is listed as a requirement. While you can apply without it, expect this to come up — address it directly in your cover letter and show you understand what the certification requires.`,
      severity: "low",
    })
    console.log("[scoring] Soft credential risk flag added:", detail)
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
    const maxStack = POLICY.penalties[p.key]?.maxStackCount ?? 999
    counts[p.key] = (counts[p.key] || 0) + 1
    if (counts[p.key] <= maxStack) capped.push(p)
  }

  const rawPenaltySum = capped.reduce((s, p) => s + p.amount, 0)
  const diminished = applyDiminishingReturns(rawPenaltySum)
  const penaltySum = Math.min(POLICY.score.penaltyStackCap, diminished)

  // ── Surface hidden score-affecting penalties as visible risk codes ──
  // These don't add new penalties — they make existing penalties explainable.

  // Family mismatch — surfaces the silent -12/-30 penalty in computeBaseScore.
  // Suppressed when the job_title strongly matches a target role because the
  // title match is the stronger signal and the family may have been wrongly
  // classified (common for life sciences / pharma roles that tag-based
  // inference routes to IT_Software or Marketing).
  const familyMatch = profile.targetFamilies.includes(job.jobFamily)
  const targetRolesForFamily = profile.statedInterests?.targetRoles ?? []
  const titleMatchForFamily = matchTargetRoleToJobTitle(
    targetRolesForFamily,
    job.jobTitle || ""
  )
  const strongTitleMatch = titleMatchForFamily.matched && titleMatchForFamily.overlap >= 0.5

  if (!familyMatch && profile.targetFamilies.length > 0 && !strongTitleMatch) {
    const HARD_TECH = new Set(["Engineering", "IT_Software", "Healthcare", "Trades"])
    const isTechnicalJob = HARD_TECH.has(job.jobFamily)
    // Expose the actual hidden penalty magnitude so the user understands
    // why their score dropped. Previously weight was 0 which made this
    // risk a cosmetic label hiding a real -12/-30 penalty in base score.
    const hiddenWeight = isTechnicalJob ? -30 : -12
    riskOnlyCodes.push({
      code: "RISK_FAMILY_MISMATCH",
      job_fact: `This role is in the ${job.jobFamily} field.`,
      profile_fact: `Your stated target field${profile.targetFamilies.length === 1 ? " is" : "s are"} ${profile.targetFamilies.join(", ")}.`,
      risk: isTechnicalJob
        ? `This is a specialized ${job.jobFamily} role that typically requires direct field experience. Your profile targets a different field.`
        : `The role's field doesn't match your stated targets. You can still apply, but expect more scrutiny on transferable skills in interviews.`,
      severity: isTechnicalJob ? "high" : "medium",
      weight: hiddenWeight,
    })
  }

  // Sparse evidence floor — when there are very few why_codes generated,
  // surface that as the explanation for the lower score
  if (selectedMatches.length === 0) {
    riskOnlyCodes.push({
      code: "RISK_LIMITED_MATCH_EVIDENCE",
      job_fact: "This role's stated requirements are difficult to map to your profile.",
      profile_fact: "No direct or adjacent matches found.",
      risk: "Either the job description is too vague to extract clear requirements, or your profile lacks evidence that maps to what they describe. Read the JD carefully before deciding to apply.",
      severity: "high",
      weight: 0,
    })
  } else if (selectedMatches.length < 2) {
    riskOnlyCodes.push({
      code: "RISK_LIMITED_MATCH_EVIDENCE",
      job_fact: "Only a small number of direct matches between your profile and this role's requirements.",
      profile_fact: "Limited evidence overlap.",
      risk: "Your profile shows some alignment but not enough specific proof points to make this a strong match. Consider whether you have unstated experience that fills the gap.",
      severity: "medium",
      weight: 0,
    })
  }

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