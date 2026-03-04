// app/api/_lib/jobfitProfileAdapter.ts
//
// Purpose
// - Accepts "structured profile" blobs coming from the client (JobFit intake)
// - Produces deterministic overrides used by the JobFit evaluator
// - CRITICAL: tools must survive the adapter -> evaluator signal flow
//
// Notes
// - This file is intentionally dependency-light and defensive. The client payload can be messy.
// - We keep the existing exported function name `mapClientProfileToOverrides` to avoid breaking imports.
//
// Stamp for easy runtime verification
export const PROFILE_ADAPTER_STAMP = "PROFILE_ADAPTER_STAMP__TOOLS_FLOW_FIX__V3"

import type {
  JobFamily,
  LocationMode,
  StructuredProfileSignals,
  ProfileConstraints,
} from "../jobfit/signals"

type AnyObj = Record<string, any>

/* ------------------------------ small utils ------------------------------ */

function norm(x: any): string {
  return String(x ?? "").trim()
}
function lower(x: any): string {
  return norm(x).toLowerCase()
}
function uniq<T>(xs: T[]): T[] {
  const out: T[] = []
  for (const x of xs) if (!out.includes(x)) out.push(x)
  return out
}
function uniqStrings(xs: string[]): string[] {
  return uniq(xs.map((x) => norm(x)).filter(Boolean))
}

/* ------------------------------ JobFamily sanitizer ------------------------------ */

const JOB_FAMILY_ALLOWLIST: JobFamily[] = [
  "Consulting",
  "Marketing",
  "Analytics",
  "Finance",
  "Accounting",
  "Sales",
  "Government",
  "PreMed",
  "Other",
]

function isJobFamily(x: any): x is JobFamily {
  return JOB_FAMILY_ALLOWLIST.includes(x as JobFamily)
}

function sanitizeTargetFamilies(x: any): JobFamily[] | null {
  if (!Array.isArray(x)) return null
  const out: JobFamily[] = []
  for (const v of x) {
    const vv = norm(v)
    if (isJobFamily(vv) && !out.includes(vv)) out.push(vv)
  }
  return out.length ? out : null
}

/* ------------------------------ locations / cities ------------------------------ */

function parseCities(text: string): string[] {
  const t = lower(text)
  const out: string[] = []
  const add = (x: string) => {
    if (!out.includes(x)) out.push(x)
  }

  // Keep intentionally small; evaluator also has its own location logic.
  if (t.includes("new york") || t.includes("nyc")) add("New York")
  if (t.includes("boston")) add("Boston")
  if (t.includes("philadelphia") || t.includes("philly")) add("Philadelphia")
  if (t.includes("washington") || t.includes("d.c") || t.includes(" dc")) add("Washington, D.C.")
  if (t.includes("miami")) add("Miami")
  if (t.includes("chicago")) add("Chicago")
  if (t.includes("new jersey") || /\bnj\b/.test(t)) add("New Jersey")

  return out
}

function normalizeAllowedCities(xs: any): string[] | undefined {
  if (!Array.isArray(xs)) return undefined
  const cleaned = uniqStrings(xs)
  return cleaned.length ? cleaned : undefined
}

function pickAllowedCities(args: {
  structuredAllowedCities?: any
  preferredLocations?: string | null
  profileText: string
}): string[] | undefined {
  const fromStructured = normalizeAllowedCities(args.structuredAllowedCities)
  if (fromStructured && fromStructured.length) return fromStructured

  const fromPreferred = parseCities(args.preferredLocations || "")
  if (fromPreferred.length) return fromPreferred

  const fromText = parseCities(args.profileText)
  if (fromText.length) return fromText

  return undefined
}

/* ------------------------------ families inference ------------------------------ */

function inferTargetFamilies(profileText: string, targetRoles?: string | null): JobFamily[] {
  const t = lower(profileText + " " + (targetRoles || ""))

  // Order matters: consulting/strategy first so it doesn't get swallowed by finance keywords.
  if (
    t.includes("consulting") ||
    t.includes("management consulting") ||
    t.includes("strategy") ||
    t.includes("case interview")
  ) {
    return ["Consulting"]
  }

  if (t.includes("marketing") || t.includes("brand") || t.includes("communications") || t.includes("pr"))
    return ["Marketing"]

  if (t.includes("accounting") || t.includes("accountant")) return ["Accounting"]

  if (t.includes("finance") || t.includes("asset management") || t.includes("investment")) return ["Finance"]

  if (t.includes("analytics") || t.includes("analyst") || t.includes("data")) return ["Analytics"]

  if (t.includes("sales") || t.includes("business development")) return ["Sales"]

  if (t.includes("government") || t.includes("public sector")) return ["Government"]

  if (t.includes("clinical") || t.includes("patient") || t.includes("pre-med") || t.includes("research assistant"))
    return ["PreMed"]

  return ["Other"]
}

/* ------------------------------ constraints inference ------------------------------ */

function inferConstraints(profileText: string): ProfileConstraints {
  const t = lower(profileText)

  const hardNoFullyRemote =
    t.includes("no remote") ||
    t.includes("no fully remote") ||
    (t.includes("hard constraints") && t.includes("no remote"))

  const hardNoSales = t.includes("no sales") || (t.includes("hard constraints") && t.includes("no sales"))

  const preferNotAnalyticsHeavy =
    t.includes("no heavy analytical") || t.includes("no heavy analytics") || t.includes("not analytics heavy")

  const prefFullTime = t.includes("full-time") || t.includes("full time")

  return {
    hardNoHourlyPay: t.includes("no hourly"),
    prefFullTime,
    hardNoContract: t.includes("no contract") || t.includes("no temp") || t.includes("no temporary"),
    hardNoSales,
    hardNoGovernment: t.includes("no government"),
    hardNoFullyRemote,
    preferNotAnalyticsHeavy,
  }
}

/* ------------------------------ location mode inference ------------------------------ */

function inferWorkMode(profileText: string): { mode: LocationMode; constrained: boolean } {
  const t = lower(profileText)

  const noRemote = t.includes("no remote") || t.includes("no fully remote")
  const okHybrid = t.includes("ok with hybrid") || t.includes("hybrid and in person")
  const inPerson = t.includes("in person") || t.includes("in-person")

  if (noRemote && inPerson) return { mode: okHybrid ? "hybrid" : "in_person", constrained: true }
  if (t.includes("remote only") || t.includes("only remote")) return { mode: "remote", constrained: true }

  return { mode: "unclear", constrained: false }
}

function normalizeMode(x: any): LocationMode {
  const s = lower(x)
  if (s === "in_person" || s === "in-person" || s === "onsite" || s === "on-site" || s === "on_site")
    return "in_person"
  if (s === "hybrid") return "hybrid"
  if (s === "remote") return "remote"
  return "unclear"
}

/* ------------------------------ tools (MOST IMPORTANT) ------------------------------ */

// Canonical tokens should match the evaluator's tool extraction/matching conventions:
// - lower-case
// - common names (e.g., "power bi", "google analytics", "adobe")
// - no punctuation
const TOOL_ALIASES: Record<string, string> = {
  "ms excel": "excel",
  "microsoft excel": "excel",
  excel: "excel",

  powerpoint: "powerpoint",
  "power point": "powerpoint",
  "ms powerpoint": "powerpoint",
  "microsoft powerpoint": "powerpoint",

  "google sheets": "google sheets",
  sheets: "google sheets",

  tableau: "tableau",
  "power bi": "power bi",
  powerbi: "power bi",

  sql: "sql",
  mysql: "sql",
  postgres: "sql",
  postgresql: "sql",

  python: "python",
  "r programming": "r",
  "programming language r": "r",
  r: "r",

  "google analytics": "google analytics",
  ga4: "google analytics",

  salesforce: "salesforce",
  hubspot: "hubspot",

  figma: "figma",
  canva: "canva",

  "adobe creative cloud": "adobe",
  adobe: "adobe",
  photoshop: "photoshop",
  illustrator: "illustrator",
  indesign: "indesign",
}

function canonToolName(x: any): string | null {
  const raw = lower(x)
  if (!raw) return null

  // normalize whitespace + punctuation noise
  const cleaned = raw.replace(/[_\-\/]+/g, " ").replace(/\s+/g, " ").trim()
  if (!cleaned) return null

  // direct alias hit
  if (TOOL_ALIASES[cleaned]) return TOOL_ALIASES[cleaned]

  // heuristic: remove leading "ms"/"microsoft"
  const stripped = cleaned.replace(/^(ms|microsoft)\s+/, "")
  if (TOOL_ALIASES[stripped]) return TOOL_ALIASES[stripped]

  // fallback: keep cleaned token (lowercase)
  return cleaned
}

/**
 * Supports:
 * 1) tools map: { Excel: true, SQL: false }   -> ["excel"]
 * 2) tools list: ["Excel","SQL"]             -> ["excel","sql"]
 */
function toolsFromStructured(ps: AnyObj): string[] {
  const raw = ps?.tools

  // Case 1: boolean map
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out: string[] = []
    for (const [k, v] of Object.entries(raw)) {
      if (v !== true) continue
      const c = canonToolName(k)
      if (c && !out.includes(c)) out.push(c)
    }
    return out.sort((a, b) => a.localeCompare(b))
  }

  // Case 2: string[]
  if (Array.isArray(raw)) {
    const out: string[] = []
    for (const item of raw) {
      const c = canonToolName(item)
      if (c && !out.includes(c)) out.push(c)
    }
    return out.sort((a, b) => a.localeCompare(b))
  }

  return []
}

/**
 * Last resort inference from raw text (ONLY when no structured tools exist).
 */
function inferToolsFromText(profileText: string): string[] {
  const t = lower(profileText)
  const tools: string[] = []
  const add = (x: string) => {
    const c = canonToolName(x)
    if (c && !tools.includes(c)) tools.push(c)
  }

  if (/\bexcel\b/.test(t) || /\bmicrosoft\s+excel\b/.test(t)) add("excel")
  if (/\bpower\s*point\b/.test(t) || /\bpowerpoint\b/.test(t)) add("powerpoint")
  if (/\bgoogle\s+sheets\b/.test(t)) add("google sheets")
  if (/\btableau\b/.test(t)) add("tableau")
  if (/\bpower\s*bi\b/.test(t) || /\bpowerbi\b/.test(t)) add("power bi")
  if (/\bsql\b/.test(t) || /\bmysql\b/.test(t) || /\bpostgres\b/.test(t)) add("sql")
  if (/\bpython\b/.test(t)) add("python")
  if (/\br\b/.test(t) && (t.includes("r,") || t.includes(" r ") || t.includes("r programming"))) add("r")

  if (t.includes("google analytics") || t.includes("ga4")) add("google analytics")

  if (t.includes("salesforce")) add("salesforce")
  if (t.includes("hubspot")) add("hubspot")

  if (t.includes("figma")) add("figma")
  if (t.includes("canva")) add("canva")

  if (t.includes("adobe")) add("adobe")
  if (t.includes("photoshop")) add("photoshop")
  if (t.includes("illustrator")) add("illustrator")
  if (t.includes("indesign")) add("indesign")

  return tools.sort((a, b) => a.localeCompare(b))
}

/* ------------------------------ grad year ------------------------------ */

function parseGradYear(profileText: string): number | null {
  const t = (profileText || "").replace(/\u202f/g, " ")
  const m =
    t.match(/\bclass of\s*(20\d{2})\b/i) ||
    t.match(/\bgraduat(?:e|ing|ion)\b[^\d]{0,20}\b(20\d{2})\b/i)

  if (!m) return null
  const yearStr = m[m.length - 1]
  const y = Number(yearStr)
  return Number.isFinite(y) ? y : null
}

/* ------------------------------ export (keep name stable) ------------------------------ */

export function mapClientProfileToOverrides(args: {
  profileText: string
  profileStructured: AnyObj | null
  targetRoles?: string | null
  preferredLocations?: string | null
}): Partial<StructuredProfileSignals> {
  const ps = (args.profileStructured || {}) as AnyObj

  const structuredFamilies = sanitizeTargetFamilies(ps?.targetFamilies)
  const targetFamilies: JobFamily[] = structuredFamilies ?? inferTargetFamilies(args.profileText, args.targetRoles)

  const constraints: ProfileConstraints =
    (ps?.constraints && typeof ps.constraints === "object" ? (ps.constraints as ProfileConstraints) : null) ||
    inferConstraints(args.profileText)

  const locStructured = ps?.locationPreference
  const fallbackMode = inferWorkMode(args.profileText)

  const allowedCities = pickAllowedCities({
    structuredAllowedCities: locStructured?.allowedCities,
    preferredLocations: args.preferredLocations ?? null,
    profileText: args.profileText,
  })

  // ✅ prefer structured tools map/list first; fall back to text inference
  const structuredTools = toolsFromStructured(ps)
  const tools = structuredTools.length > 0 ? structuredTools : inferToolsFromText(args.profileText)

  const locationPreference: StructuredProfileSignals["locationPreference"] = {
    mode: normalizeMode(locStructured?.mode ?? fallbackMode.mode),
    constrained: Boolean(locStructured?.constrained ?? fallbackMode.constrained),
    allowedCities,
  }

  const gradYear =
    (Number.isFinite(ps?.gradYear) ? Number(ps.gradYear) : null) ||
    parseGradYear(args.profileText)

  return {
    targetFamilies,
    constraints,
    locationPreference,
    tools,
    gradYear,
    yearsExperienceApprox: ps?.yearsExperienceApprox ?? null,
  }
}

// eslint-disable-next-line no-console
console.log(`[jobfitProfileAdapter] loaded: ${PROFILE_ADAPTER_STAMP}`)
