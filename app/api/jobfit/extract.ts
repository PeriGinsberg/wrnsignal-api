// jobfit/extract.ts

import crypto from "crypto"
import { POLICY } from "./policy"
import type {
  JobFamily,
  LocationMode,
  StructuredJobSignals,
  StructuredProfileSignals,
} from "./signals"

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

function includesAny(hay: string, needles: string[]): boolean {
  const h = hay || ""
  return needles.some((n) => h.includes(String(n || "").toLowerCase()))
}

function extractYearsRequired(jobText: string): number | null {
  for (const r of POLICY.extraction.years.patterns) {
    const m = jobText.match(r)
    if (m && m[1]) {
      const v = parseInt(m[1], 10)
      if (!Number.isNaN(v) && v >= 0 && v <= 20) return v
    }
  }
  return null
}

function extractGradYearHint(jobText: string): number | null {
  for (const r of POLICY.extraction.grad.patterns) {
    const m = jobText.match(r)
    const year = m?.find((x) => /20\d{2}/.test(x || "")) || null
    if (year) {
      const v = parseInt(year, 10)
      if (!Number.isNaN(v)) return v
    }
  }
  return null
}

function detectLocationMode(jobText: string): { mode: LocationMode; constrained: boolean } {
  const t = jobText
  const constrained =
    includesAny(t, POLICY.extraction.location.constrainedPhrases) ||
    t.includes("must be in") ||
    t.includes("required to be in")

  const hasRemote = includesAny(t, POLICY.extraction.location.remotePhrases)
  const hasHybrid = includesAny(t, POLICY.extraction.location.hybridPhrases)
  const hasOnsite = includesAny(t, POLICY.extraction.location.onsitePhrases)

  if (hasHybrid) return { mode: "hybrid", constrained }
  if (hasRemote && !hasOnsite) return { mode: "remote", constrained }
  if (hasOnsite && !hasRemote) return { mode: "onsite", constrained }
  if (hasRemote && hasOnsite) return { mode: "hybrid", constrained }
  return { mode: "unclear", constrained }
}

function detectAnalytics(jobText: string): { isHeavy: boolean; isLight: boolean } {
  const t = jobText
  const heavy = includesAny(t, POLICY.extraction.analytics.heavyKeywords)
  const light = includesAny(t, POLICY.extraction.analytics.lightKeywords)
  return { isHeavy: heavy, isLight: light && !heavy }
}

function detectJobFamily(jobText: string): JobFamily {
  const t = jobText

  if (includesAny(t, ["brand marketing", "email marketing", "content", "social", "campaign", "lifecycle"])) return "Marketing"
  if (includesAny(t, ["investment", "asset management", "financial analyst", "valuation", "lbo", "portfolio"])) return "Finance"
  if (includesAny(t, ["accounting", "audit", "tax", "general ledger", "reconciliation"])) return "Accounting"
  if (includesAny(t, ["data analyst", "business intelligence", "bi", "analytics", "sql", "dashboard"])) return "Analytics"
  if (includesAny(t, ["medical", "clinical", "patient", "scribe", "pre-med", "research assistant"])) return "PreMed"
  if (includesAny(t, ["sales", "account executive", "bdr", "sdr", "quota", "pipeline"])) return "Sales"
  if (includesAny(t, POLICY.extraction.government.keywords)) return "Government"

  return "Other"
}

function extractTools(jobText: string): { required: string[]; preferred: string[] } {
  const t = jobText

  const found = (list: string[]) => list.filter((tool) => t.includes(tool.toLowerCase()))
  const core = found(POLICY.tools.core)
  const pref = found(POLICY.tools.preferred)

  const required: string[] = []
  const preferred: string[] = []

  const all = Array.from(new Set([...core, ...pref]))
  for (const tool of all) {
    const toolLower = tool.toLowerCase()
    const idx = t.indexOf(toolLower)
    if (idx >= 0) {
      const window = t.slice(Math.max(0, idx - 25), Math.min(t.length, idx + 25))
      if (window.includes("required") || window.includes("must have")) required.push(tool)
      else preferred.push(tool)
    }
  }

  return {
    required: Array.from(new Set(required)),
    preferred: Array.from(new Set(preferred.filter((x) => !required.includes(x)))),
  }
}

function detectInternshipSignals(t: string) {
  const internshipKeywords = POLICY.extraction.internship.keywords
  const summerKeywords = POLICY.extraction.internship.summerKeywords
  const aiToolsKeywords = POLICY.extraction.internship.aiToolsKeywords
  const rotationKeywords = POLICY.extraction.internship.marketingRotationKeywords
  const inPersonInternKeywords = POLICY.extraction.internship.inPersonInternKeywords

  const isInternship = internshipKeywords.some((k) => t.includes(k))
  const isSummer = summerKeywords.some((k) => t.includes(k))
  const mentionsAITools = aiToolsKeywords.some((k) => t.includes(k))

  const rotationHitCount = rotationKeywords.reduce(
    (acc, k) => acc + (t.includes(k) ? 1 : 0),
    0
  )
  const isMarketingRotation = rotationHitCount >= 3

  const isInPersonExplicit = inPersonInternKeywords.some((k) => t.includes(k))

  return { isInternship, isSummer, isInPersonExplicit, mentionsAITools, isMarketingRotation }
}

export function extractJobSignals(jobTextRaw: string): StructuredJobSignals {
  const t = norm(jobTextRaw)
  const rawHash = stableHash(t)

  const jobFamily = detectJobFamily(t)
  const analytics = detectAnalytics(t)
  const location = detectLocationMode(t)
  const yearsRequired = extractYearsRequired(t)
  const gradYearHint = extractGradYearHint(t)

  const mbaRequired = includesAny(t, POLICY.extraction.mba.keywords)
  const isGovernment = includesAny(t, POLICY.extraction.government.keywords)
  const isSalesHeavy = includesAny(t, POLICY.extraction.sales.keywords)
  const isContract = includesAny(t, POLICY.extraction.contract.keywords)
  const isHourly = includesAny(t, POLICY.extraction.hourly.keywords)

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

export function extractProfileSignals(
  profileTextRaw: string,
  overrides?: Partial<StructuredProfileSignals>
): StructuredProfileSignals {
  const t = norm(profileTextRaw)
  const rawHash = stableHash(t)

  const wantsInternship =
    t.includes("internship") || t.includes("internships") || t.includes("summer 2026")

  const hardNoFullyRemote =
    t.includes("no remote") || t.includes("no fully remote") || t.includes("no fully-remote")

  const hardNoSales =
    t.includes("no sales") || (t.includes("hard constraints") && t.includes("no sales"))

  const preferNotAnalyticsHeavy =
    t.includes("no heavy analytical") || t.includes("no heavy analytics") || t.includes("not analytics heavy")

  const base: StructuredProfileSignals = {
    rawHash,

    // Default stays conservative; overrides should supply the real structured values.
    targetFamilies: ["Marketing"],

    locationPreference: { mode: "unclear", constrained: false },

    constraints: {
      hardNoSales,
      hardNoGovernment: t.includes("no government"),
      hardNoContract: t.includes("no contract") || t.includes("no temporary") || t.includes("no temp"),
      hardNoHourlyPay: t.includes("no hourly"),
      hardNoFullyRemote,
      prefFullTime: wantsInternship ? false : t.includes("full-time") || t.includes("full time"),
      preferNotAnalyticsHeavy,
    },

    gradYear: null,
    yearsExperienceApprox: null,
    tools: [],
  }

  // Deep merge to avoid clobbering nested objects
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
    },
  }

  return merged
}