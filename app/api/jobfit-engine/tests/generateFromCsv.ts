// tests/generateFromCsv.ts
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { JobSignalsV1, ProfileSignalsV1, RegressionCase } from "../src/types"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type Row = Record<string, string>

const DATA_DIR = path.join(__dirname, "data")
const REG_PATH = path.join(DATA_DIR, "regression.csv")
const PROFILES_PATH = path.join(DATA_DIR, "profiles.csv")
const JOBS_PATH = path.join(DATA_DIR, "jobs.csv")

const OUT_CASES_JSON = path.join(__dirname, "regressionCases.json")
const OUT_FIXTURES_TS = path.join(__dirname, "fixtures.ts")

/* ----------------------------- small helpers ----------------------------- */

const NONE_RE = /^none$/i

function clean(v: unknown): string {
  const s = String(v ?? "").trim()
  if (!s) return ""
  if (NONE_RE.test(s)) return ""
  return s
}

function normToken(s: string): string {
  return clean(s).replace(/\s+/g, " ").trim()
}

function splitPipe(v: unknown): string[] {
  const s = clean(v)
  if (!s) return []
  return s
    .split("|")
    .map((x) => normToken(x))
    .filter((x) => x.length > 0 && !NONE_RE.test(x))
}

function toBool(v: unknown): boolean {
  const s = clean(v).toLowerCase()
  return s === "y" || s === "yes" || s === "true" || s === "1"
}

function maybeNum(v: unknown): number | null {
  const s = clean(v)
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function maybeInt(v: unknown): number | null {
  const n = maybeNum(v)
  if (n == null) return null
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function coerceWorkAuth(raw: string): ProfileSignalsV1["work_authorization"]["status"] {
  const s = clean(raw).toLowerCase()
  if (!s) return "unknown"
  if (s.includes("citizen")) return "us_citizen"
  if (s.includes("permanent") || s.includes("green")) return "permanent_resident"
  if (s.includes("sponsor") || s.includes("needs")) return "needs_sponsorship"
  if (s.includes("auth") || s.includes("opt") || s.includes("cpt") || s.includes("visa")) return "has_work_auth"
  return "unknown"
}

/**
 * Minimal CSV parser:
 * - quoted fields
 * - commas in quotes
 * - CRLF/LF
 */
function parseCsv(text: string): Row[] {
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        const next = input[i + 1]
        if (next === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }

    if (ch === ",") {
      row.push(cell)
      cell = ""
      continue
    }

    if (ch === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }

    cell += ch
  }

  row.push(cell)
  if (!(row.length === 1 && row[0] === "")) rows.push(row)

  if (!rows.length) return []

  const headers = rows[0].map((h) => String(h ?? "").trim())
  const out: Row[] = []

  for (let r = 1; r < rows.length; r++) {
    const vals = rows[r]
    if (vals.every((v) => String(v ?? "").trim() === "")) continue

    const obj: Row = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]
      if (!key) continue
      obj[key] = String(vals[c] ?? "")
    }
    out.push(obj)
  }

  return out
}

async function readCsv(p: string): Promise<Row[]> {
  const text = await fs.readFile(p, "utf8")
  return parseCsv(text)
}

/* ----------------------------- schema mapping ----------------------------- */

function mapDegreeLevel(degRaw: string): ProfileSignalsV1["education"]["degree_level"] {
  const d = clean(degRaw).toLowerCase()
  if (!d) return "unknown"
  if (d.includes("in_progress") || d.includes("in progress") || d.includes("progress")) return "in_progress"
  if (d.includes("phd") || d.includes("doctor")) return "phd"
  if (d.includes("master")) return "master"
  if (d.includes("bachelor")) return "bachelor"
  if (d.includes("associate")) return "associate"
  if (d === "none") return "none"
  return "unknown"
}

function mapSeniorityHint(raw: string): JobSignalsV1["role"]["seniority_hint"] {
  const s = clean(raw).toLowerCase()
  if (!s) return "unknown"
  if (s.includes("intern")) return "intern"
  if (s.includes("entry")) return "entry"
  if (s.includes("early")) return "early"
  if (s.includes("mid")) return "mid"
  if (s.includes("senior")) return "senior"
  if (s.includes("lead")) return "lead"
  if (s.includes("manager")) return "manager"
  if (s.includes("director")) return "director"
  if (s.includes("exec")) return "exec"
  return "unknown"
}

function mapEmploymentTypeHint(seniority: JobSignalsV1["role"]["seniority_hint"]): JobSignalsV1["role"]["employment_type_hint"] {
  return seniority === "intern" ? "internship" : "full_time"
}

function mapLocationMode(raw: string): JobSignalsV1["requirements"]["location"]["mode"] {
  const s = clean(raw).toLowerCase()
  if (s === "remote") return "remote"
  if (s === "hybrid") return "hybrid"
  if (s === "onsite" || s === "on_site" || s === "on-site") return "onsite"
  return "unspecified"
}

/**
 * Robust stage → profile_type mapping.
 * This is critical: mislabeling "student" as "early_career" will cause experience hard gates to fire.
 */
function mapProfileType(stageRaw: string): ProfileSignalsV1["profile_type"] {
  const s = clean(stageRaw).toLowerCase()
  if (!s) return "unknown"

  const isStudentStage =
    s.includes("student") ||
    s.includes("intern") ||
    s.includes("undergrad") ||
    s.includes("in_school") ||
    s.includes("in school") ||
    s.includes("in_progress") ||
    s.includes("in progress") ||
    s.includes("grad") // catches "grad student" / "graduating"
  // Important: "graduate" can be early career, but we treat unknown "grad" as student unless explicitly "new grad"
  const isNewGrad =
    s.includes("new grad") ||
    s.includes("newgrad") ||
    s.includes("recent grad") ||
    s.includes("graduate program") ||
    s.includes("entry") ||
    s.includes("early career") ||
    s.includes("early_career")

  if (isNewGrad && !isStudentStage) return "early_career"
  if (isStudentStage) return "student"

  // if they literally put "experienced"
  if (s.includes("experienced")) return "experienced"

  // fallback: treat unknown stages as student? No. safer: unknown.
  return "unknown"
}

function buildProfiles(rows: Row[]): Record<string, ProfileSignalsV1> {
  const out: Record<string, ProfileSignalsV1> = {}

  for (const r of rows) {
    const profile_id = clean(r["Profile_ID"])
    if (!profile_id) continue

    const profile_type = mapProfileType(r["Stage"])

    // Location prefs parsing
    const locTokensLower = splitPipe(r["Location_Preferences"]).map((x) => x.toLowerCase())
    const remote_ok = locTokensLower.includes("remote_ok")
    // default is true unless explicitly "onsite_no" or "onsite=false"
    const onsite_ok =
      locTokensLower.includes("onsite_no") || locTokensLower.includes("onsite=false") || locTokensLower.includes("onsite_not_ok")
        ? false
        : true

    const preferred_regions = splitPipe(r["Location_Preferences"]).filter((x) => {
      const k = x.toLowerCase()
      return k !== "remote_ok" && k !== "onsite_ok" && k !== "onsite_no" && k !== "onsite=false" && k !== "onsite_not_ok"
    })

    out[profile_id] = {
      schema_version: "v1.0",
      profile_id,
      profile_type,
      targets: {
        role_families: splitPipe(r["Target_Role_Families"]),
        industries: splitPipe(r["Target_Industries"]),
        domains: [],
      },
      education: {
        degree_level: mapDegreeLevel(r["Degree"]),
        majors: [],
        grad_year: maybeInt(r["Grad_Year"]),
        gpa: maybeNum(r["GPA"]),
      },
      experience: {
        years_total_est: null,
        years_relevant_est: maybeNum(r["Years_Relevant"]),
        internships_count: maybeInt(r["Internships_Count"]) ?? 0,
        full_time_roles_count: maybeInt(r["FullTime_Count"]) ?? 0,
      },
      skills_tools: {
        tools: splitPipe(r["Tools"]),
        skills: splitPipe(r["Skills"]),
      },
      certifications: [],
      work_authorization: {
        status: coerceWorkAuth(r["Work_Auth"]),
      },
      location_preferences: {
        preferred_regions,
        remote_ok,
        onsite_ok,
      },
      exposure_clusters: {
        executed: splitPipe(r["Executed_Clusters"]),
        adjacent: splitPipe(r["Adjacent_Clusters"]),
        theoretical: splitPipe(r["Theoretical_Clusters"]),
      },
      resume_fingerprint: `${profile_id}_FP`,
    }
  }

  return out
}

/**
 * Jobs: do NOT invent explicit mins.
 * If Min_Years is blank or "0", treat as null (not explicit).
 */
function parseMinYears(raw: unknown): number | null {
  const n = maybeNum(raw)
  if (n == null) return null
  if (n <= 0) return null
  return n
}

function buildJobs(rows: Row[]): Record<string, JobSignalsV1> {
  const out: Record<string, JobSignalsV1> = {}

  for (const r of rows) {
    const job_id = clean(r["Job_ID"])
    if (!job_id) continue

    const roleFamilies = splitPipe(r["Role_Family"])
    const seniority_hint = mapSeniorityHint(r["Seniority"])
    const employment_type_hint = mapEmploymentTypeHint(seniority_hint)

    const minYears = parseMinYears(r["Min_Years"])
    const gpaReq = maybeNum(r["GPA_Required"])
    const locationMode = mapLocationMode(r["Location_Type"])
    const locationHard = toBool(r["Location_Hard"])

    // Safer title/company/description for downstream fingerprint + bullets
    const titleRaw = clean(r["Job_Title"])
    const companyRaw = clean(r["Company"])
    const notes = clean(r["Notes"])

    const title = titleRaw || `${roleFamilies[0] ?? "Role"} (${seniority_hint})`
    const company = companyRaw || "GenericCo"
    const description = notes || ""

    out[job_id] = {
      schema_version: "v1.0",
      job_id,
      normalized: {
        title,
        company,
        description,
      },
      role: {
        seniority_hint,
        employment_type_hint,
        role_families: roleFamilies,
      },
      requirements: {
        experience: {
          min_years: minYears,
          max_years: null,
          is_explicit: minYears != null,
          evidence: [],
        },
        education: {
          is_required: false,
          degree_level_min: "unknown",
          fields_preferred: [],
          evidence: [],
        },
        gpa: {
          is_required: gpaReq != null,
          minimum: gpaReq,
          evidence: [],
        },
        certifications: { required: [], preferred: [], evidence: [] },
        work_authorization: { is_specified: false, restriction_type: "unknown", evidence: [] },
        location: {
          mode: locationMode,
          is_hard_requirement: locationHard,
          evidence: [],
        },
      },
      skills_tools: {
        tools_required: splitPipe(r["Required_Tools"]),
        tools_preferred: [],
        skills_required: [],
        skills_preferred: [],
      },
      responsibility_clusters: splitPipe(r["Core_Clusters"]),
      extraction_quality: { confidence_overall: "high", warnings: [] },
    }
  }

  return out
}

function normalizeGpaFlag(v: unknown): RegressionCase["expected_gpa_flag"] {
  const s = clean(v).toLowerCase()
  if (!s) return "None"
  if (s === "missing") return "Missing"
  if (s === "below_min" || s === "belowmin" || s === "below minimum") return "Below_Min"
  return "None"
}

function buildRegressionCases(rows: Row[]): Omit<RegressionCase, "profile" | "job">[] {
  return rows.map((r) => ({
    case_id: clean(r["Case_ID"]),
    profile_id: clean(r["Profile_ID"]),
    job_id: clean(r["Job_ID"]),
    expected_decision: clean(r["Expected_Decision"]) as any,
    expected_alignment: clean(r["Expected_Alignment"]) as any,
    expected_exposure: (clean(r["Expected_Exposure"]) || "NONE") as any,
    expected_structural_risk_codes: splitPipe(r["Structural_Risk_Codes"]),
    expected_tier2_risk_count: maybeInt(r["Tier2_Risk_Count"]) ?? 0,
    expected_misalignment_cap_applied: toBool(r["Misalignment_Cap_Applied"]),
    expected_hard_gate_triggered: toBool(r["Hard_Gate_Triggered"]),
    expected_gpa_flag: normalizeGpaFlag(r["GPA_Flag"]),
    notes: clean(r["Notes"]),
  }))
}

async function main() {
  const [regRows, profileRows, jobRows] = await Promise.all([
    readCsv(REG_PATH),
    readCsv(PROFILES_PATH),
    readCsv(JOBS_PATH),
  ])

  const PROFILES = buildProfiles(profileRows)
  const JOBS = buildJobs(jobRows)
  const cases = buildRegressionCases(regRows)

  // Quick sanity guardrails (fail fast instead of silently poisoning fixtures)
  for (const c of cases) {
    if (!PROFILES[c.profile_id]) {
      throw new Error(`[generateFromCsv] missing profile fixture for ${c.profile_id} (case ${c.case_id})`)
    }
    if (!JOBS[c.job_id]) {
      throw new Error(`[generateFromCsv] missing job fixture for ${c.job_id} (case ${c.case_id})`)
    }
  }

  await fs.writeFile(OUT_CASES_JSON, JSON.stringify(cases, null, 2) + "\n", "utf8")

  const fixturesTs =
    `/* eslint-disable */\n` +
    `// AUTO-GENERATED by tests/generateFromCsv.ts — DO NOT EDIT BY HAND.\n\n` +
    `import type { JobSignalsV1, ProfileSignalsV1 } from "../src/types"\n\n` +
    `export const PROFILES: Record<string, ProfileSignalsV1> = ${JSON.stringify(PROFILES, null, 2)}\n\n` +
    `export const JOBS: Record<string, JobSignalsV1> = ${JSON.stringify(JOBS, null, 2)}\n`

  await fs.writeFile(OUT_FIXTURES_TS, fixturesTs, "utf8")

  console.log("[generateFromCsv] wrote:")
  console.log(" - cases:", cases.length)
  console.log(" - profiles:", Object.keys(PROFILES).length)
  console.log(" - jobs:", Object.keys(JOBS).length)
  console.log(" -", path.relative(process.cwd(), OUT_CASES_JSON))
  console.log(" -", path.relative(process.cwd(), OUT_FIXTURES_TS))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})