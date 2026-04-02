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
  const roles = lower(targetRoles || "")
  const text = lower(profileText || "")

  const out: JobFamily[] = []

  // Primary inference should come from target roles, not broad resume text
  if (
    roles.includes("sales") ||
    roles.includes("business development") ||
    roles.includes("account executive") ||
    roles.includes("account manager") ||
    roles.includes("clinical sales") ||
    roles.includes("medical sales") ||
    roles.includes("orthopedic sales") ||
    roles.includes("associate sales representative") ||
    roles.includes("sales representative")
  ) {
    out.push("Sales")
  }

  if (
    roles.includes("clinical") ||
    roles.includes("medical") ||
    roles.includes("premed") ||
    roles.includes("pre-med") ||
    roles.includes("healthcare")
  ) {
    out.push("PreMed")
  }

  if (
    roles.includes("consulting") ||
    roles.includes("management consulting") ||
    roles.includes("strategy consulting")
  ) {
    out.push("Consulting")
  }

  if (
    roles.includes("marketing") ||
    roles.includes("brand") ||
    roles.includes("communications") ||
    roles.includes("pr") ||
    roles.includes("content") ||
    roles.includes("social media")
  ) {
    out.push("Marketing")
  }

  if (
    roles.includes("finance") ||
    roles.includes("investment") ||
    roles.includes("asset management") ||
    roles.includes("financial analyst") ||
    roles.includes("commercial real estate")
  ) {
    out.push("Finance")
  }

  if (
    roles.includes("accounting") ||
    roles.includes("audit") ||
    roles.includes("tax") ||
    roles.includes("assurance")
  ) {
    out.push("Accounting")
  }

  if (
    roles.includes("analytics") ||
    roles.includes("data analyst") ||
    roles.includes("business intelligence") ||
    roles.includes("tableau") ||
    roles.includes("power bi") ||
    roles.includes("sql")
  ) {
    out.push("Analytics")
  }

  if (
    roles.includes("government") ||
    roles.includes("public policy") ||
    roles.includes("government affairs") ||
    roles.includes("legislative")
  ) {
    out.push("Government")
  }

  // Fallback to profile text only if targetRoles is empty
  if (out.length === 0 && !roles) {
    if (text.includes("sales") || text.includes("business development")) out.push("Sales")
    if (text.includes("clinical") || text.includes("patient") || text.includes("medical device")) out.push("PreMed")
    if (text.includes("consulting") || text.includes("management consulting")) out.push("Consulting")
    if (text.includes("marketing") || text.includes("brand")) out.push("Marketing")
    if (text.includes("finance") || text.includes("investment")) out.push("Finance")
    if (text.includes("accounting") || text.includes("accountant")) out.push("Accounting")
    if (text.includes("analytics") || text.includes("data")) out.push("Analytics")
    if (text.includes("government") || text.includes("public sector")) out.push("Government")
  }

  const unique = Array.from(new Set(out))
  return unique.length ? unique.slice(0, 2) : ["Other"]
}/* ------------------------------ constraints inference ------------------------------ */

function inferConstraints(profileText: string): ProfileConstraints {
  const t = lower(profileText)

  const hardNoFullyRemote =
    t.includes("no remote") ||
    t.includes("no fully remote") ||
    (t.includes("hard constraints") && t.includes("no remote"))

  const hardNoSales =
    t.includes("no sales") ||
    (t.includes("hard constraints") && t.includes("no sales")) ||
    t.includes("no sales roles")

  const preferNotAnalyticsHeavy =
    t.includes("no heavy analytical") || t.includes("no heavy analytics") || t.includes("not analytics heavy")

  const prefFullTime =
    t.includes("full-time") ||
    t.includes("full time") ||
    t.includes("job type: full time") ||
    t.includes("looking for full time")

  // Explicit content/execution role exclusions
  const hardNoContentOnly =
    t.includes("no pure social media") ||
    t.includes("no content only") ||
    t.includes("no pure content") ||
    t.includes("no coordinator role") ||
    t.includes("no coordinator roles") ||
    t.includes("no social media content roles") ||
    (t.includes("hard constraints") && t.includes("content"))

  const hardNoPartTime =
    t.includes("no part time") ||
    t.includes("no part-time") ||
    t.includes("full time only") ||
    t.includes("full-time only")

  return {
    hardNoHourlyPay: t.includes("no hourly"),
    prefFullTime,
    hardNoContract: t.includes("no contract") || t.includes("no temp") || t.includes("no temporary"),
    hardNoSales,
    hardNoGovernment: t.includes("no government"),
    hardNoFullyRemote,
    preferNotAnalyticsHeavy,
    hardNoContentOnly,
    hardNoPartTime,
  }
}

/* ------------------------------ role archetype inference ------------------------------ */

// Classifies the candidate's stated target roles into an archetype.
// This is used to detect mismatches with job archetypes during scoring.
function inferRoleArchetype(targetRoles: string): "analytical" | "strategic" | "execution" | "mixed" | "unclear" {
  const t = lower(targetRoles)
  if (!t) return "unclear"

  const analyticalSignals = [
    "analyst", "analytics", "data", "research", "insights", "measurement",
    "quantitative", "intelligence", "bi ", "business intelligence",
    "market research", "consumer research", "marketing analyst",
    "marketing research", "data science", "reporting",
  ]
  const strategicSignals = [
    "strategy", "strategic", "brand strategy", "consulting", "planning",
    "brand management", "product marketing", "go-to-market", "gtm",
    "marketing strategy", "growth strategy", "business development",
    "corporate strategy", "market strategy",
  ]
  const executionSignals = [
    "coordinator", "content", "social media", "events", "operations",
    "community manager", "copywriter", "creative", "production",
    "campaign manager", "email marketing", "influencer",
  ]

  let analytical = 0
  let strategic = 0
  let execution = 0

  for (const s of analyticalSignals) if (t.includes(s)) analytical++
  for (const s of strategicSignals) if (t.includes(s)) strategic++
  for (const s of executionSignals) if (t.includes(s)) execution++

  const total = analytical + strategic + execution
  if (total === 0) return "unclear"

  // Dominant archetype — needs to be >60% of signals
  if (analytical >= strategic && analytical >= execution) {
    if (analytical / total >= 0.6) return "analytical"
  }
  if (strategic >= analytical && strategic >= execution) {
    if (strategic / total >= 0.6) return "strategic"
  }
  if (execution >= analytical && execution >= strategic) {
    if (execution / total >= 0.6) return "execution"
  }
  return "mixed"
}

// Parses target roles string into an array of individual roles
function parseTargetRoles(targetRoles: string | null | undefined): string[] {
  if (!targetRoles) return []
  return targetRoles
    .split(/[,;|\n\/]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

// Parses target industries from profile text
// Looks for explicit industry mentions in target roles or profile text
function parseTargetIndustries(profileText: string, targetRoles: string): string[] {
  const t = lower(profileText + " " + targetRoles)
  const industries: string[] = []

  const industryMap: Record<string, string[]> = {
    sports: ["sports", "nba", "nfl", "mlb", "nhl", "athletics", "espn", "sports marketing"],
    entertainment: ["entertainment", "music", "film", "media", "streaming", "gaming"],
    "consumer goods": ["consumer goods", "cpg", "fmcg", "retail", "ecommerce", "e-commerce"],
    technology: ["tech", "saas", "software", "startup", "fintech"],
    finance: ["finance", "financial services", "banking", "investment", "wealth management"],
    healthcare: ["healthcare", "health", "biotech", "pharma", "medical"],
    luxury: ["luxury", "fashion", "beauty", "lifestyle"],
    food: ["food", "beverage", "restaurant", "hospitality"],
  }

  for (const [industry, signals] of Object.entries(industryMap)) {
    if (signals.some(s => t.includes(s))) {
      industries.push(industry)
    }
  }

  return industries
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

  // Parse stated interests into structured form
  const targetRolesRaw = norm(args.targetRoles || "")
  const parsedTargetRoles = parseTargetRoles(targetRolesRaw)
  const roleArchetype = inferRoleArchetype(targetRolesRaw)
  const targetIndustries = parseTargetIndustries(args.profileText, targetRolesRaw)

  // The adapter receives the full profile_text including the hard constraints section.
  // extract.ts's defaultConstraintsFromText only receives resume text (not the profile header),
  // so constraints stated in the intake form ("no sales roles", "no pure social media content roles")
  // must be passed through from the adapter.
  const newConstraintFields = {
    hardNoSales: constraints.hardNoSales,
    hardNoContentOnly: constraints.hardNoContentOnly,
    hardNoPartTime: constraints.hardNoPartTime,
    prefFullTime: constraints.prefFullTime,
  }

  return {
    targetFamilies,
    constraints: newConstraintFields as any,
    locationPreference,
    tools,
    gradYear,
    yearsExperienceApprox: ps?.yearsExperienceApprox ?? null,
    // Fully exposed interest signals
    targetRolesRaw,
    roleArchetype,
    statedInterests: {
      targetRoles: parsedTargetRoles,
      adjacentRoles: [],
      targetIndustries,
    },
    // Pass resume text through for gate exemption checks
    resumeText: args.profileText,
    // Raw intake form text for fallback constraint detection in scoring
    profileHeaderText: args.profileText,
  }
}

// eslint-disable-next-line no-console
console.log(`[jobfitProfileAdapter] loaded: ${PROFILE_ADAPTER_STAMP}`)