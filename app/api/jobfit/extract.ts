// FILE: app/api/jobfit/extract.ts

import crypto from "crypto"
import { POLICY } from "./policy"
import type {
  JobFamily,
  LocationMode,
  StructuredJobSignals,
  StructuredProfileSignals,
  ProfileConstraints,
} from "./signals"

/**
 * NOTE:
 * This file is strict-TS safe.
 * Any POLICY-driven arrays are treated as string[] at the boundary to avoid implicit-any issues.
 */

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16)
}

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\+\$\/\.-]/g, "")
    .trim()
}

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  return x.map((v) => String(v || "").toLowerCase()).filter(Boolean)
}

function includesAny(hay: string, needles: string[]): boolean {
  const h = hay || ""
  return needles.some((n: string) => h.includes(String(n || "").toLowerCase()))
}

function snippetAround(t: string, idx: number, radius = 70): string {
  const start = Math.max(0, idx - radius)
  const end = Math.min(t.length, idx + radius)
  return t.slice(start, end).trim()
}

function firstSnippetFor(t: string, phrases: string[]): string | null {
  for (const p of phrases) {
    const needle = String(p || "").toLowerCase()
    const idx = t.indexOf(needle)
    if (idx >= 0) return snippetAround(t, idx)
  }
  return null
}

function extractYearsRequired(jobText: string): number | null {
  const patterns: RegExp[] = Array.isArray((POLICY as any)?.extraction?.years?.patterns)
    ? ((POLICY as any).extraction.years.patterns as RegExp[])
    : []

  for (const r of patterns) {
    const m = jobText.match(r)
    if (m && m[1]) {
      const v = parseInt(m[1], 10)
      if (!Number.isNaN(v) && v >= 0 && v <= 20) return v
    }
  }
  return null
}

function extractGradYearHint(jobText: string): number | null {
  const patterns: RegExp[] = Array.isArray((POLICY as any)?.extraction?.grad?.patterns)
    ? ((POLICY as any).extraction.grad.patterns as RegExp[])
    : []

  for (const r of patterns) {
    const m = jobText.match(r)
    const year = m?.find((x) => /20\d{2}/.test(String(x || ""))) || null
    if (year) {
      const v = parseInt(String(year), 10)
      if (!Number.isNaN(v)) return v
    }
  }
  return null
}

/* ------------------------ job text extractors ------------------------ */

// City extraction (deterministic heuristic)
function extractCity(t: string): string | null {
  if (/\bnyc\b/.test(t)) return "New York City"
  if (t.includes("new york city")) return "New York City"
  if (t.includes("new york, ny")) return "New York City"
  if (t.includes("ny office")) return "New York City"
  if (t.includes("nyc office")) return "New York City"
  return null
}

function detectLocationMode(jobText: string): {
  mode: LocationMode
  constrained: boolean
  city: string | null
  evidence: string | null
} {
  const t = jobText

  const constrainedPhrases = asStringArray((POLICY as any)?.extraction?.location?.constrainedPhrases)
  const remotePhrases = asStringArray((POLICY as any)?.extraction?.location?.remotePhrases)
  const hybridPhrases = asStringArray((POLICY as any)?.extraction?.location?.hybridPhrases)
  const onsitePhrases = asStringArray((POLICY as any)?.extraction?.location?.onsitePhrases)

  const constrained =
    includesAny(t, constrainedPhrases) ||
    t.includes("must be in") ||
    t.includes("required to be in") ||
    t.includes("local candidates only")

  const hasRemote = includesAny(t, remotePhrases)
  const hasHybrid = includesAny(t, hybridPhrases)
  const hasInPerson = includesAny(t, onsitePhrases) || t.includes("in-person") || t.includes("in person")

  let mode: LocationMode = "unclear"
  if (hasHybrid) mode = "hybrid"
  else if (hasRemote && !hasInPerson) mode = "remote"
  else if (hasInPerson && !hasRemote) mode = "in_person"
  else if (hasRemote && hasInPerson) mode = "hybrid"

  const city = extractCity(t)
  const evidence =
    firstSnippetFor(t, ["nyc office", "new york city", "in-person", "in person", "hybrid", "remote"]) || null

  return { mode, constrained, city, evidence }
}

function detectAnalytics(jobText: string): { isHeavy: boolean; isLight: boolean } {
  const t = jobText
  const heavyKeywords = asStringArray((POLICY as any)?.extraction?.analytics?.heavyKeywords)
  const lightKeywords = asStringArray((POLICY as any)?.extraction?.analytics?.lightKeywords)
  const heavy = includesAny(t, heavyKeywords)
  const light = includesAny(t, lightKeywords)
  return { isHeavy: heavy, isLight: light && !heavy }
}

function detectJobFamily(jobText: string): JobFamily {
  const t = jobText
  const gov = asStringArray((POLICY as any)?.extraction?.government?.keywords)

  if (includesAny(t, ["brand marketing", "email marketing", "content", "social", "campaign", "lifecycle"])) return "Marketing"
  if (includesAny(t, ["investment", "asset management", "financial analyst", "valuation", "lbo", "portfolio"])) return "Finance"
  if (includesAny(t, ["accounting", "audit", "tax", "general ledger", "reconciliation"])) return "Accounting"
  if (includesAny(t, ["data analyst", "business intelligence", "bi", "analytics", "sql", "dashboard"])) return "Analytics"
  if (includesAny(t, ["medical", "clinical", "patient", "scribe", "pre-med", "research assistant"])) return "PreMed"
  if (includesAny(t, ["sales", "account executive", "bdr", "sdr", "quota", "pipeline"])) return "Sales"
  if (includesAny(t, gov)) return "Government"

  return "Other"
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function hasTool(t: string, tool: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(tool.toLowerCase())}\\b`, "i")
  return pattern.test(t)
}

function extractTools(jobText: string): { required: string[]; preferred: string[] } {
  const t = jobText

  const core = Array.isArray((POLICY as any)?.tools?.core) ? ((POLICY as any).tools.core as string[]) : []
  const pref = Array.isArray((POLICY as any)?.tools?.preferred) ? ((POLICY as any).tools.preferred as string[]) : []

  const coreFound = core.filter((tool: string) => hasTool(t, tool))
  const prefFound = pref.filter((tool: string) => hasTool(t, tool))

  const required: string[] = []
  const preferred: string[] = []

  const all = Array.from(new Set([...coreFound, ...prefFound]))

  for (const tool of all) {
    const toolLower = tool.toLowerCase()
    const idx = t.indexOf(toolLower)
    if (idx >= 0) {
      const window = t.slice(Math.max(0, idx - 40), Math.min(t.length, idx + 40))
      if (/\b(required|must have|need to have)\b/i.test(window)) required.push(tool)
      else preferred.push(tool)
    }
  }

  return {
    required: Array.from(new Set(required)),
    preferred: Array.from(new Set(preferred.filter((x) => !required.includes(x)))),
  }
}

function extractInternshipDates(t: string): { dates: string | null; dateLine: string | null } {
  const m = t.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\s*[-–]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i
  )
  if (!m) return { dates: null, dateLine: null }
  const idx = t.indexOf(m[0].toLowerCase())
  return { dates: m[0], dateLine: idx >= 0 ? snippetAround(t, idx) : m[0] }
}

function extractPay(t: string): { pay: string | null; payLine: string | null } {
  const m = t.match(/\$\s*\d+(\.\d+)?\s*\/\s*hr\b/i) || t.match(/\$\s*\d+(\.\d+)?\s*\/\s*hour\b/i)
  if (!m) return { pay: null, payLine: null }
  const idx = t.indexOf(m[0].toLowerCase())
  return { pay: m[0], payLine: idx >= 0 ? snippetAround(t, idx) : m[0] }
}

function detectInternshipSignals(t: string) {
  const internshipKeywords = asStringArray((POLICY as any)?.extraction?.internship?.keywords)
  const summerKeywords = asStringArray((POLICY as any)?.extraction?.internship?.summerKeywords)
  const aiToolsKeywords = asStringArray((POLICY as any)?.extraction?.internship?.aiToolsKeywords)
  const rotationKeywords = asStringArray((POLICY as any)?.extraction?.internship?.marketingRotationKeywords)
  const inPersonInternKeywords = asStringArray((POLICY as any)?.extraction?.internship?.inPersonInternKeywords)

  const isInternship = internshipKeywords.some((k: string) => t.includes(k))
  const isSummer = summerKeywords.some((k: string) => t.includes(k))
  const mentionsAITools = aiToolsKeywords.some((k: string) => t.includes(k))

  const rotationHitCount = rotationKeywords.reduce((acc: number, k: string) => acc + (t.includes(k) ? 1 : 0), 0)
  const isMarketingRotation = rotationHitCount >= 3

  const isInPersonExplicit = inPersonInternKeywords.some((k: string) => t.includes(k))

  const departmentUniverse = [
    "pr",
    "events",
    "influencer",
    "digital marketing",
    "brand marketing",
    "global marketing",
    "partnerships",
    "visual merchandising",
    "key accounts",
  ]

  const departments: string[] = []
  for (const d of departmentUniverse) {
    if (t.includes(d)) {
      if (d === "pr") departments.push("PR")
      else if (d === "events") departments.push("Events")
      else if (d === "influencer") departments.push("Influencer Marketing")
      else if (d === "digital marketing") departments.push("Digital Marketing")
      else if (d === "brand marketing") departments.push("Brand Marketing")
      else if (d === "global marketing") departments.push("Global Marketing")
      else if (d === "partnerships") departments.push("Partnerships")
      else if (d === "visual merchandising") departments.push("Visual Merchandising")
      else if (d === "key accounts") departments.push("Key Accounts")
    }
  }

  const hasCapstone = t.includes("capstone project") || t.includes("capstone")
  const { dates, dateLine } = extractInternshipDates(t)
  const { pay, payLine } = extractPay(t)

  const evidence = {
    internshipLine: firstSnippetFor(t, ["marketing internship", "summer 2026", "internship"]) || null,
    inPersonLine: firstSnippetFor(t, ["in-person", "in person", "nyc office", "new york city office"]) || null,
    aiLine: firstSnippetFor(t, ["ai tools", "ai platforms", "artificial intelligence"]) || null,
    deptLine:
      firstSnippetFor(t, ["pr", "events", "influencer marketing", "digital marketing", "brand marketing"]) || null,
    capstoneLine: firstSnippetFor(t, ["capstone project", "capstone"]) || null,
    payLine,
    dateLine,
  }

  return {
    isInternship,
    isSummer,
    isInPersonExplicit,
    mentionsAITools,
    isMarketingRotation,
    departments,
    dates,
    pay,
    hasCapstone,
    evidence,
  }
}

/* ---------------------------- exported: job ---------------------------- */

export function extractJobSignals(jobTextRaw: string): StructuredJobSignals {
  const t = norm(jobTextRaw)
  const rawHash = stableHash(t)

  const jobFamily = detectJobFamily(t)
  const analytics = detectAnalytics(t)
  const location = detectLocationMode(t)
  const yearsRequired = extractYearsRequired(t)
  const gradYearHint = extractGradYearHint(t)

  const mbaKeywords = asStringArray((POLICY as any)?.extraction?.mba?.keywords)
  const govKeywords = asStringArray((POLICY as any)?.extraction?.government?.keywords)
  const salesKeywords = asStringArray((POLICY as any)?.extraction?.sales?.keywords)
  const contractKeywords = asStringArray((POLICY as any)?.extraction?.contract?.keywords)
  const hourlyKeywords = asStringArray((POLICY as any)?.extraction?.hourly?.keywords)

  const mbaRequired = includesAny(t, mbaKeywords)
  const isGovernment = includesAny(t, govKeywords)
  const isSalesHeavy = includesAny(t, salesKeywords)
  const isContract = includesAny(t, contractKeywords)
  const isHourly = includesAny(t, hourlyKeywords)

  const { required, preferred } = extractTools(t)

  const reportingStrong = includesAny(t, [
    "weekly reporting",
    "monthly reporting",
    "dashboard ownership",
    "kpi ownership",
    "measurement framework",
  ])

  const internship = detectInternshipSignals(t)

  return {
    rawHash,
    jobFamily,
    analytics,
    location,
    isGovernment,
    isSalesHeavy,
    isContract,
    isHourly,
    yearsRequired,
    mbaRequired,
    gradYearHint,
    requiredTools: required,
    preferredTools: preferred,
    reportingSignals: { strong: reportingStrong },
    internship,
  }
}

/* -------------------------- exported: profile -------------------------- */

export function extractProfileSignals(
  profileTextRaw: string,
  overrides?: Partial<StructuredProfileSignals>
): StructuredProfileSignals {
  const t = norm(profileTextRaw)

  const wantsInternship = t.includes("internship") || t.includes("internships") || t.includes("summer 2026")

  const base: StructuredProfileSignals = {
    targetFamilies: ["Marketing"],
    locationPreference: { mode: "unclear", constrained: false, allowedCities: undefined },
    constraints: defaultConstraintsFromText(t, wantsInternship),
    tools: [],
    gradYear: null,
    yearsExperienceApprox: null,
  }

  const merged: StructuredProfileSignals = {
    ...base,
    ...(overrides || {}),
    constraints: {
      ...base.constraints,
      ...(overrides?.constraints || {}),
    },
    locationPreference: {
      ...base.locationPreference,
      ...(overrides?.locationPreference || {}),
      allowedCities:
        Array.isArray(overrides?.locationPreference?.allowedCities) &&
        overrides.locationPreference!.allowedCities!.length > 0
          ? overrides.locationPreference!.allowedCities
          : base.locationPreference.allowedCities,
    },
    tools: Array.isArray(overrides?.tools) ? overrides.tools : base.tools,
  }

  return merged
}

function defaultConstraintsFromText(t: string, wantsInternship: boolean): ProfileConstraints {
  const hardNoFullyRemote = t.includes("no remote") || t.includes("no fully remote") || t.includes("no fully-remote")
  const hardNoSales = t.includes("no sales") || (t.includes("hard constraints") && t.includes("no sales"))
  const preferNotAnalyticsHeavy =
    t.includes("no heavy analytical") || t.includes("no heavy analytics") || t.includes("not analytics heavy")

  return {
    hardNoSales,
    hardNoGovernment: t.includes("no government"),
    hardNoContract: t.includes("no contract") || t.includes("no temporary") || t.includes("no temp"),
    hardNoHourlyPay: t.includes("no hourly"),
    hardNoFullyRemote,
    prefFullTime: wantsInternship ? false : t.includes("full-time") || t.includes("full time"),
    preferNotAnalyticsHeavy,
  }
}