// FILE: app/api/_lib/inferProfileOverridesFromResume.ts
//
// Haiku pre-pass that infers the same structured signals the paid intake
// form provides — target families, role targets, job-type preference,
// grad year, location preference, tools — directly from a resume.
//
// Used by the free-trial route to bridge the precision gap between the
// paid path (which feeds these into runJobFit as profileOverrides) and
// the trial path (which historically passed only profileText, losing
// meaningful scoring signal — title-match bonus, family classification,
// location preference, prefFullTime detection, etc.).
//
// Fails open: returns {} on any error so runJobFit falls back to its
// heuristic detectors. A partial result is still useful.

import type {
  StructuredProfileSignals,
  JobFamily,
  LocationMode,
} from "../jobfit/signals"

const MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 600

const VALID_FAMILIES: JobFamily[] = [
  "Consulting",
  "Marketing",
  "Finance",
  "Accounting",
  "Analytics",
  "Sales",
  "Operations",
  "HR",
  "Government",
  "PreMed",
  "Engineering",
  "IT_Software",
  "Healthcare",
  "Legal",
  "Trades",
  "Other",
]

const VALID_LOCATION_MODES: LocationMode[] = [
  "in_person",
  "hybrid",
  "remote",
  "unclear",
]

const SYSTEM_PROMPT =
  "You are a structured-data extractor. Read a resume and return JSON describing what the candidate is targeting. Return ONLY valid JSON — no markdown fences, no preamble, no commentary."

function buildPrompt(resumeText: string): string {
  // Truncate to keep cost predictable. 8000 chars covers any normal resume.
  const trimmed = resumeText.slice(0, 8000)
  return `Extract structured signals from this resume. Return ONLY valid JSON in exactly this shape:

{
  "targetRoles": string[],          // 2-5 specific role titles this candidate is targeting (infer from skills, recent positions, education trajectory, summary statements). Lowercase. Example: ["financial analyst", "investment banking analyst"]
  "targetFamilies": string[],       // 1-2 entries. Each entry MUST be one of these exact literal strings: ${VALID_FAMILIES.join(", ")}. If the resume doesn't clearly fit any, return []. Do NOT invent values, abbreviate, or substitute synonyms.
  "jobTypePreference": string,      // exactly one of: "internship", "full_time", "unclear"
  "gradYear": number | null,        // expected graduation year as a 4-digit number, or null if already graduated or not stated
  "locationPreference": {
    "mode": string,                 // exactly one of: ${VALID_LOCATION_MODES.join(", ")}
    "allowedCities": string[]       // explicit cities the resume names as targets or preferences. Empty array if none stated.
  },
  "tools": string[]                 // tools, software, programming languages, platforms named in the resume. Lowercase canonical names. Example: ["excel", "python", "salesforce", "tableau"]
}

Resume:
${trimmed}`
}

// Recover JSON from a Haiku response that may include markdown fences
// despite instructions. Returns parsed object or null.
function extractJson(rawText: string): any | null {
  // Strip markdown fences. Backtick chars built via fromCharCode to dodge
  // a Turbopack parser bug that misreads template literals containing
  // triple-backticks at module scope.
  const _t = String.fromCharCode(96)
  const _fence = _t + _t + _t
  const stripped = rawText
    .split(_fence + "json")
    .join("")
    .split(_fence)
    .join("")
    .trim()
  const firstBrace = stripped.indexOf("{")
  const lastBrace = stripped.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1) return null
  try {
    return JSON.parse(stripped.slice(firstBrace, lastBrace + 1))
  } catch {
    return null
  }
}

export async function inferProfileOverridesFromResume(
  resumeText: string
): Promise<Partial<StructuredProfileSignals>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn(
      "[inferProfileOverridesFromResume] ANTHROPIC_API_KEY missing — returning empty overrides"
    )
    return {}
  }
  if (!resumeText || resumeText.trim().length < 50) {
    console.warn(
      "[inferProfileOverridesFromResume] resume too short — returning empty overrides"
    )
    return {}
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(resumeText) }],
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      console.error(
        "[inferProfileOverridesFromResume] Haiku API error:",
        res.status,
        errBody.slice(0, 200)
      )
      return {}
    }

    const json = await res.json()
    const rawText = (json.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => String(b.text ?? ""))
      .join("")

    const parsed = extractJson(rawText)
    if (!parsed) {
      console.error(
        "[inferProfileOverridesFromResume] JSON parse failed. Raw snippet:",
        rawText.slice(0, 200)
      )
      return {}
    }

    // Coerce + validate every field. Anything malformed is silently dropped
    // — partial overrides are still useful, and the engine has heuristic
    // fallbacks for everything we don't claim.
    const overrides: Partial<StructuredProfileSignals> = {}

    if (Array.isArray(parsed.targetRoles)) {
      const targetRoles = parsed.targetRoles
        .map((r: unknown) => String(r ?? "").trim().toLowerCase())
        .filter((r: string) => r.length > 0)
        .slice(0, 8)
      if (targetRoles.length > 0) {
        overrides.statedInterests = {
          targetRoles,
          adjacentRoles: [],
          targetIndustries: [],
        }
        overrides.targetRolesRaw = targetRoles.join(", ")
      }
    }

    if (Array.isArray(parsed.targetFamilies)) {
      const fams = parsed.targetFamilies
        .map((f: unknown) => String(f ?? "").trim())
        .filter((f: string) =>
          (VALID_FAMILIES as string[]).includes(f)
        ) as JobFamily[]
      if (fams.length > 0) overrides.targetFamilies = fams
    }

    // jobTypePreference -> constraints.prefFullTime. Mirrors the partial-
    // constraints pattern from jobfitProfileAdapter.ts:572-577 — we set
    // only the fields we can infer; the rest fall through to defaults.
    const jtp = String(parsed.jobTypePreference ?? "").trim().toLowerCase()
    if (jtp === "full_time" || jtp === "internship" || jtp === "unclear") {
      overrides.constraints = {
        prefFullTime: jtp === "full_time",
        // Not inferred from resume body; default false. The engine still
        // detects these from profileText body via defaultConstraintsFromText
        // when an override doesn't claim them.
        hardNoSales: false,
        hardNoContentOnly: false,
        hardNoPartTime: false,
      } as any
    }

    if (
      typeof parsed.gradYear === "number" &&
      parsed.gradYear > 1990 &&
      parsed.gradYear < 2100
    ) {
      overrides.gradYear = parsed.gradYear
    }

    if (
      parsed.locationPreference &&
      typeof parsed.locationPreference === "object"
    ) {
      const modeRaw = String(parsed.locationPreference.mode ?? "unclear").trim()
      const allowedCities = Array.isArray(parsed.locationPreference.allowedCities)
        ? parsed.locationPreference.allowedCities
            .map((c: unknown) => String(c ?? "").trim())
            .filter((c: string) => c.length > 0)
            .slice(0, 6)
        : []
      const mode: LocationMode = (VALID_LOCATION_MODES as string[]).includes(
        modeRaw
      )
        ? (modeRaw as LocationMode)
        : "unclear"
      overrides.locationPreference = {
        mode,
        constrained: allowedCities.length > 0,
        allowedCities,
      }
    }

    if (Array.isArray(parsed.tools)) {
      const tools = parsed.tools
        .map((t: unknown) => String(t ?? "").trim().toLowerCase())
        .filter((t: string) => t.length > 0 && t.length < 60)
        .slice(0, 30)
      if (tools.length > 0) overrides.tools = tools
    }

    console.log("[inferProfileOverridesFromResume] inferred:", {
      targetFamilies: overrides.targetFamilies,
      targetRoles: overrides.statedInterests?.targetRoles,
      jobTypePreference: jtp || "(missing)",
      gradYear: overrides.gradYear ?? null,
      locationMode: overrides.locationPreference?.mode,
      toolCount: overrides.tools?.length ?? 0,
    })

    return overrides
  } catch (err: any) {
    console.error(
      "[inferProfileOverridesFromResume] unexpected error:",
      err?.message || String(err)
    )
    return {}
  }
}
