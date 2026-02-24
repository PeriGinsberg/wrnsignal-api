import type { StructuredProfileSignals } from "../jobfit/signals"

type AnyObj = Record<string, any>

function norm(s: any) {
  return String(s || "").trim()
}

function parseCities(text: string): string[] {
  const t = (text || "").toLowerCase()
  const out: string[] = []
  const add = (x: string) => { if (!out.includes(x)) out.push(x) }

  if (t.includes("new york") || t.includes("nyc")) add("New York")
  if (t.includes("boston")) add("Boston")
  if (t.includes("philadelphia") || t.includes("philly")) add("Philadelphia")
  if (t.includes("washington") || t.includes("d.c") || t.includes("dc")) add("Washington, D.C.")
  if (t.includes("miami")) add("Miami")

  return out
}

function inferTargetFamilies(profileText: string, targetRoles?: string | null): ("Marketing" | "Finance" | "Accounting" | "Analytics" | "Sales" | "Government" | "Other")[] {
  const t = (profileText + " " + (targetRoles || "")).toLowerCase()
  if (t.includes("marketing") || t.includes("brand") || t.includes("communications") || t.includes("pr")) return ["Marketing"]
  if (t.includes("accounting") || t.includes("accountant")) return ["Accounting"]
  if (t.includes("finance") || t.includes("asset management") || t.includes("investment")) return ["Finance"]
  if (t.includes("analytics") || t.includes("analyst")) return ["Analytics"]
  if (t.includes("sales") || t.includes("business development")) return ["Sales"]
  if (t.includes("government") || t.includes("public sector")) return ["Government"]
  return ["Other"]
}

function inferConstraints(profileText: string) {
  const t = profileText.toLowerCase()

  const hardNoFullyRemote =
    t.includes("no remote") ||
    t.includes("no fully remote") ||
    (t.includes("hard constraints") && t.includes("no remote"))

  const hardNoSales =
    t.includes("no sales") ||
    (t.includes("hard constraints") && t.includes("no sales"))

  const preferNotAnalyticsHeavy =
    t.includes("no heavy analytical") ||
    t.includes("no heavy analytics") ||
    t.includes("not analytics heavy")

  const prefFullTime =
    t.includes("full-time") || t.includes("full time")

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

function inferWorkMode(profileText: string): { mode: "onsite" | "hybrid" | "remote" | "unclear"; constrained: boolean } {
  const t = profileText.toLowerCase()
  const noRemote = t.includes("no remote") || t.includes("no fully remote")
  const okHybrid = t.includes("ok with hybrid") || t.includes("hybrid and in person")
  const inPerson = t.includes("in person") || t.includes("in-person")
  if (noRemote && inPerson) return { mode: okHybrid ? "hybrid" : "onsite", constrained: true }
  if (t.includes("remote only") || t.includes("only remote")) return { mode: "remote", constrained: true }
  return { mode: "unclear", constrained: false }
}

function inferTools(profileText: string): string[] {
  const t = profileText.toLowerCase()
  const tools: string[] = []
  const add = (x: string) => { if (!tools.includes(x)) tools.push(x) }

  if (t.includes("adobe")) add("Adobe Creative Cloud")
  if (t.includes("photoshop")) add("Photoshop")
  if (t.includes("illustrator")) add("Illustrator")
  if (t.includes("indesign")) add("InDesign")
  if (t.includes("canva")) add("Canva")
  if (t.includes("google workspace")) add("Google Workspace")
  if (t.includes("microsoft office")) add("Microsoft Office")
  if (t.includes("muck rack") || t.includes("muckrack")) add("Muck Rack")
  if (t.includes("ai academy") || t.includes("prompt")) add("AI Tools")

  return tools
}

function parseGradYear(profileText: string): number | null {
  const t = profileText.toLowerCase()
  const m =
    t.match(/\bgraduat(e|ing|ion)\b[^\d]{0,20}\b(20\d{2})\b/i) ||
    t.match(/\bclass of\s*(20\d{2})\b/i)
  if (!m) return null
  const y = Number(m[m.length - 1])
  return Number.isFinite(y) ? y : null
}

export function mapClientProfileToOverrides(args: {
  profileText: string
  profileStructured: AnyObj | null
  targetRoles?: string | null
  preferredLocations?: string | null
}): Partial<StructuredProfileSignals> {
  const ps = (args.profileStructured || {}) as AnyObj

  const targetFamilies =
    (Array.isArray(ps?.targetFamilies) && ps.targetFamilies.length > 0 && ps.targetFamilies) ||
    inferTargetFamilies(args.profileText, args.targetRoles)

  const constraints =
    (ps?.constraints && typeof ps.constraints === "object" && ps.constraints) ||
    inferConstraints(args.profileText)

  const locStructured = ps?.locationPreference
  const fallbackMode = inferWorkMode(args.profileText)
  const allowedCities =
    (Array.isArray(locStructured?.allowedCities) && locStructured.allowedCities.map(norm).filter(Boolean)) ||
    parseCities(args.preferredLocations || "") ||
    parseCities(args.profileText)

  const locationPreference = {
    mode: (locStructured?.mode as any) || fallbackMode.mode,
    constrained: Boolean(locStructured?.constrained ?? fallbackMode.constrained),
    allowedCities,
  }

  const tools =
    (Array.isArray(ps?.tools) && ps.tools.map(norm).filter(Boolean)) ||
    inferTools(args.profileText)

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