// jobfit/extract.ts

import crypto from "crypto"
import { POLICY } from "./policy"
import {
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
  return needles.some((n) => hay.includes(n.toLowerCase()))
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

  // Heuristic: if job says "required" near a tool, treat it as required.
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

export function extractJobSignals(jobTextRaw: string): StructuredJobSignals {
  const jobText = norm(jobTextRaw)
  const rawHash = stableHash(jobText)

  const jobFamily = detectJobFamily(jobText)
  const analytics = detectAnalytics(jobText)
  const location = detectLocationMode(jobText)
  const yearsRequired = extractYearsRequired(jobText)
  const gradYearHint = extractGradYearHint(jobText)
  const mbaRequired = includesAny(jobText, POLICY.extraction.mba.keywords)
  const isGovernment = includesAny(jobText, POLICY.extraction.government.keywords)
  const isSalesHeavy = includesAny(jobText, POLICY.extraction.sales.keywords)
  const isContract = includesAny(jobText, POLICY.extraction.contract.keywords)
  const isHourly = includesAny(jobText, POLICY.extraction.hourly.keywords)

  const { required, preferred } = extractTools(jobText)

  const reportingStrong = includesAny(jobText, ["weekly reporting", "monthly reporting", "dashboard ownership", "kpi ownership", "measurement framework"])

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
  }
}

export function extractProfileSignals(profileTextRaw: string, overrides?: Partial<StructuredProfileSignals>): StructuredProfileSignals {
  const t = norm(profileTextRaw)
  const rawHash = stableHash(t)

  // Default extraction is conservative. Most profile fields should be provided by your structured profile record.
  // This keeps extraction deterministic and avoids overfitting to messy resume prose.
  const base: StructuredProfileSignals = {
    rawHash,
    targetFamilies: ["Marketing"],
    locationPreference: { mode: "unclear", constrained: false },
    constraints: {
      hardNoSales: false,
      hardNoGovernment: false,
      hardNoContract: false,
      hardNoHourlyPay: false,
      hardNoFullyRemote: false,
      prefFullTime: true,
      preferNotAnalyticsHeavy: false,
    },
    gradYear: null,
    yearsExperienceApprox: null,
    tools: [],
  }

  return { ...base, ...(overrides || {}) }
}