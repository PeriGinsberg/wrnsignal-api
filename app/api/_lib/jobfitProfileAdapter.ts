// FILE: app/api/_lib/jobfitProfileAdapter.ts
// CLEAN REWRITE: deterministic, V4-compatible tool ingestion (tools map -> tools list)
// Key fix: Prefer structured tools map (ProfileStructured.tools) over any fallback inference.

import type { JobFamily, LocationMode, StructuredProfileSignals, ProfileConstraints } from "../jobfit/signals"

export const PROFILE_ADAPTER_STAMP = "PROFILE_ADAPTER_STAMP__TOOLS_MAP_FIX__V1"

type AnyObj = Record<string, any>

function norm(x: any): string {
  return String(x ?? "").trim()
}

function lower(x: any): string {
  return norm(x).toLowerCase()
}

/* ------------------------------ cities ------------------------------ */

function parseCities(text: string): string[] {
  const t = lower(text)
  const out: string[] = []
  const add = (x: string) => {
    if (!out.includes(x)) out.push(x)
  }

  if (t.includes("new york") || t.includes("nyc")) add("New York")
  if (t.includes("boston")) add("Boston")
  if (t.includes("philadelphia") || t.includes("philly")) add("Philadelphia")
  if (t.includes("washington") || t.includes("d.c") || t.includes("dc")) add("Washington, D.C.")
  if (t.includes("miami")) add("Miami")
  if (t.includes("chicago")) add("Chicago")
  if (t.includes("new jersey") || t.includes("nj")) add("New Jersey")

  return out
}

function normalizeAllowedCities(xs: any): string[] | undefined {
  if (!Array.isArray(xs)) return undefined
  const cleaned = xs.map(norm).filter(Boolean)
  return cleaned.length ? cleaned : undefined
}

function pickAllowedCities(args: {
  structuredAllowedCities?: any
  preferredLocations?: string | null
  profileText: string
}): string[] | undefined {
  const fromStructured = normalizeAllowedCities(args.structuredAllowedCities)

  const fromPreferred = parseCities(args.preferredLocations || "")
  const fromText = parseCities(args.profileText)

  if (fromStructured && fromStructured.length) return fromStructured
  if (fromPreferred.length) return fromPreferred
  if (fromText.length) return fromText

  return undefined
}

/* ------------------------------ families ------------------------------ */

function inferTargetFamilies(profileText: string, targetRoles?: string | null): JobFamily[] {
  const t = lower(profileText + " " + (targetRoles || ""))

  // Keep deterministic and simple.
  if (t.includes("marketing") || t.includes("brand") || t.includes("communications") || t.includes("pr")) return ["Marketing"]
  if (t.includes("accounting") || t.includes("accountant")) return ["Accounting"]
  if (t.includes("finance") || t.includes("asset management") || t.includes("investment")) return ["Finance"]
  if (t.includes("analytics") || t.includes("analyst") || t.includes("data")) return ["Analytics"]
  if (t.includes("sales") || t.includes("business development")) return ["Sales"]
  if (t.includes("government") || t.includes("public sector")) return ["Government"]
  if (t.includes("clinical") || t.includes("patient") || t.includes("pre-med") || t.includes("research assistant")) return ["PreMed"]

  return ["Other"]
}

/* ------------------------------ constraints ------------------------------ */

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

/* ------------------------------ location mode ------------------------------ */

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
  if (s === "in_person" || s === "in-person") return "in_person"
  if (s === "hybrid") return "hybrid"
  if (s === "remote") return "remote"
  if (s === "onsite" || s === "on_site" || s === "on-site") return "in_person"
  return "unclear"
}

/* ------------------------------ tools (CRITICAL FIX) ------------------------------ */

/**
 * V4 structured profile uses tools as a boolean dictionary:
 *   tools: { Excel: true, R: true, SQL: false, ... }
 *
 * Older/other code may use tools as a string[].
 *
 * This adapter supports both and NEVER falls back to the Canva-only inference if a structured tools map exists.
 */
function toolsFromStructured(ps: AnyObj): string[] {
  const raw = ps?.tools

  // Case 1: boolean map { ToolName: true/false }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const out = Object.entries(raw)
      .filter(([, v]) => v === true)
      .map(([k]) => norm(k))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    return out
  }

  // Case 2: string[] tools
  if (Array.isArray(raw)) {
    return raw.map(norm).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }

  return []
}

/**
 * Last-resort inference from raw text (ONLY used when structured tools are absent).
 * This should be broad enough to catch Excel etc, not just Canva.
 */
function inferToolsFromText(profileText: string): string[] {
  const t = lower(profileText)
  const tools: string[] = []
  const add = (x: string) => {
    if (!tools.includes(x)) tools.push(x)
  }

  // Core business tools
  if (/\bexcel\b/.test(t) || /\bmicrosoft\s+excel\b/.test(t)) add("Excel")
  if (/\bpower\s*point\b/.test(t) || /\bpowerpoint\b/.test(t)) add("PowerPoint")
  if (/\bgoogle\s+sheets\b/.test(t)) add("Google Sheets")
  if (/\btableau\b/.test(t)) add("Tableau")
  if (/\bpower\s*bi\b/.test(t) || /\bpowerbi\b/.test(t)) add("Power BI")
  if (/\bsql\b/.test(t) || /\bmysql\b/.test(t) || /\bpostgres\b/.test(t)) add("SQL")
  if (/\bpython\b/.test(t)) add("Python")
  if (/\br\b/.test(t) || /\b r \(/.test(t) || t.includes("programming language), r")) add("R")

  // Design/creative
  if (t.includes("adobe")) add("Adobe Creative Cloud")
  if (t.includes("photoshop")) add("Photoshop")
  if (t.includes("illustrator")) add("Illustrator")
  if (t.includes("indesign")) add("InDesign")
  if (t.includes("canva")) add("Canva")

  // General
  if (t.includes("google workspace")) add("Google Workspace")
  if (t.includes("microsoft office")) add("Microsoft Office")

  return tools.sort((a, b) => a.localeCompare(b))
}

/* ------------------------------ grad year ------------------------------ */

function parseGradYear(profileText: string): number | null {
  const t = lower(profileText)
  const m =
    t.match(/\bgraduat(e|ing|ion)\b[^\d]{0,20}\b(20\d{2})\b/i) ||
    t.match(/\bclass of\s*(20\d{2})\b/i)

  if (!m) return null
  const y = Number(m[m.length - 1])
  return Number.isFinite(y) ? y : null
}

/* ------------------------------ export ------------------------------ */

export function mapClientProfileToOverrides(args: {
  profileText: string
  profileStructured: AnyObj | null
  targetRoles?: string | null
  preferredLocations?: string | null
}): Partial<StructuredProfileSignals> {
  const ps = (args.profileStructured || {}) as AnyObj

  const targetFamilies: JobFamily[] =
    (Array.isArray(ps?.targetFamilies) && ps.targetFamilies.length > 0
      ? (ps.targetFamilies as any[]).map(norm).filter(Boolean)
      : null) || inferTargetFamilies(args.profileText, args.targetRoles)

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

  // ✅ CRITICAL: prefer structured tools map/list first
  const structuredTools = toolsFromStructured(ps)
  const tools = structuredTools.length > 0 ? structuredTools : inferToolsFromText(args.profileText)

  const locationPreference: StructuredProfileSignals["locationPreference"] = {
    mode: normalizeMode(locStructured?.mode ?? fallbackMode.mode),
    constrained: Boolean(locStructured?.constrained ?? fallbackMode.constrained),
    allowedCities,
  }

  const gradYear = (Number.isFinite(ps?.gradYear) ? Number(ps.gradYear) : null) || parseGradYear(args.profileText)

  return {
    targetFamilies,
    constraints,
    locationPreference,
    tools,
    gradYear,
    yearsExperienceApprox: ps?.yearsExperienceApprox ?? null,
  }
}

console.log(`[jobfitProfileAdapter] loaded: ${PROFILE_ADAPTER_STAMP}`)