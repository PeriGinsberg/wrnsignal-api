// FILE: app/api/jobfit/deterministicBulletRendererV4.ts
//
// CLEAN REWRITE: V4 deterministic bullet renderer
// Goals (per your rules):
// - Table-stakes NEVER become WHY bullets (internship/summer/location/early-career/tools).
// - WHY bullets only exist when there is real “reason to apply” substance.
// - Tools are NEVER a WHY. Tools are risk-only when the job explicitly mentions them.
// - Omission is never a negative: risk bullets require job-side proof (we already enforce jobEv).
// - No “You’ve shown this through:” phrasing. No meta commentary.
// - Location WHY only allowed when constrained (kept as a hard rule, but location is table-stakes so excluded anyway).

import type {
  EvalOutput,
  Decision,
  WhyCode,
  RiskCode,
  StructuredJobSignals,
  StructuredProfileSignals,
} from "./signals"

export const RENDERER_V4_STAMP = "RENDERER_V4_STAMP__2026_02_27__B__TABLE_STAKES_STRIPPED"

type RenderCaps = { whyMax: number; riskMax: number }
function capsForDecision(d: Decision): RenderCaps {
  if (d === "Apply") return { whyMax: 4, riskMax: 3 }
  if (d === "Review") return { whyMax: 4, riskMax: 4 }
  return { whyMax: 0, riskMax: 4 }
}

/* ------------------------------ TABLE-STAKES RULES ------------------------------ */
/**
 * WHY bullets should represent “reasons to apply”, not table stakes.
 * Table-stakes can be RISK when mismatched (with proof), but not WHY.
 *
 * So: allow-list WHY codes that are *substantive*.
 * Everything else is excluded from WHY rendering (even if present in why_codes).
 */
const ALLOWED_WHY_CODES = new Set([
  "WHY_FAMILY_MATCH",
  "WHY_TOOL_MATCH",
  "WHY_MARKETING_EXECUTION",
  "WHY_MEASUREMENT_LIGHT",
])

/**
 * Explicit hard bans (even if they ever show up with weight > 0).
 * These are table-stakes or concepts you banned.
 */
const BANNED_WHY_CODES = new Set<string>([
  "WHY_EARLY_CAREER_FRIENDLY",
  
  "WHY_LOCATION_MATCH",
  "WHY_IN_PERSON_MATCH",
  "WHY_SUMMER_INTERNSHIP_MATCH",
  "WHY_MARKETING_ROTATION_MATCH",
  "WHY_AI_TOOLS_MATCH",
])

/* ------------------------------ redundancy groups ------------------------------ */

type Group = "core_work_match" | "tools" | "location" | "internship" | "other"

function whyGroup(code: string): Group {
  if (code === "WHY_FAMILY_MATCH") return "core_work_match"
  if (code === "WHY_TOOL_MATCH") return "tools"
  if (code === "WHY_LOCATION_MATCH" || code === "WHY_IN_PERSON_MATCH") return "location"
  if (
    code === "WHY_SUMMER_INTERNSHIP_MATCH" ||
    code === "WHY_MARKETING_ROTATION_MATCH" ||
    code === "WHY_AI_TOOLS_MATCH"
  ) return "internship"
  return "other"
}

function riskGroup(code: string): Group {
  if (code === "RISK_LOCATION") return "location"
  if (code === "RISK_MISSING_TOOLS") return "tools"
  if (code === "RISK_SALES") return "other"
  if (code === "RISK_GOVERNMENT") return "other"
  if (code === "RISK_CONTRACT") return "other"
  if (code === "RISK_HOURLY") return "other"
  if (code === "RISK_EXPERIENCE") return "other"
  if (code === "RISK_MBA") return "other"
  if (code === "RISK_GRAD_WINDOW") return "other"
  if (code === "RISK_REPORTING_SIGNALS") return "other"
  return "other"
}

/* ------------------------------ priorities ------------------------------ */

function whyPriority(code: string): number {
  switch (code) {
    case "WHY_FAMILY_MATCH":
      return 100
    case "WHY_MARKETING_EXECUTION":
      return 90
    case "WHY_MEASUREMENT_LIGHT":
      return 85
    default:
      return 10
  }
}

function riskPriority(code: string, r: RiskCode): number {
  const sev = r?.severity
  const sevWeight = sev === "high" ? 100 : sev === "medium" ? 60 : 30

  // Tools risks are important but should not dominate unless high severity.
  const toolPenalty = code === "RISK_MISSING_TOOLS" && sev !== "high" ? -25 : 0

  return sevWeight + toolPenalty
}

/* ------------------------------ string helpers ------------------------------ */

function norm(s: string): string {
  return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
}

function sanitize(s: string): string {
  let t = norm(s)
  t = t.replace(/^[\-\u2022•\s]+/, "")
  t = t.replace(/\s*\.$/, "")
  if (t.length > 0) t = t[0].toUpperCase() + t.slice(1)
  return t
}

function usable(s: string): boolean {
  const t = norm(s)
  if (!t) return false
  if (t.length < 16) return false
  return true
}

function chooseBestEvidence(
  job: StructuredJobSignals | undefined,
  profile: StructuredProfileSignals | undefined,
  w: WhyCode
): { jobEv: string; profileEv: string } {
  const jobEv = sanitize(w?.job_fact || "") || (job?.location?.evidence ? sanitize(job.location.evidence) : "")
  const profileEv = sanitize(w?.profile_fact || "")
  return {
    jobEv: usable(jobEv) ? jobEv : "",
    profileEv: usable(profileEv) ? profileEv : "",
  }
}

function chooseBestRiskEvidence(
  job: StructuredJobSignals | undefined,
  profile: StructuredProfileSignals | undefined,
  r: RiskCode
): { jobEv: string; profileEv: string } {
  const jobEv = sanitize(r?.job_fact || "") || (job?.location?.evidence ? sanitize(job.location.evidence) : "")
  const profileEv = sanitize(r?.profile_fact || "")
  return {
    jobEv: usable(jobEv) ? jobEv : "",
    profileEv: usable(profileEv) ? profileEv : "",
  }
}

/* ------------------------------ render WHY ------------------------------ */
/**
 * WHY bullet rule:
 * - Must be a real “reason to apply”, not table stakes.
 * - Must include job-side anchor. No job anchor = skip.
 * - If profile-side anchor exists, make it one clean sentence.
 * - No “You’ve shown this through”.
 */
function renderWhyBullet(out: EvalOutput, w: WhyCode): string | null {
  const code = String(w?.code || "").trim()
  if (!code) return null

  // Hard stop: banned or not allowed
  if (BANNED_WHY_CODES.has(code)) return null
  if (!ALLOWED_WHY_CODES.has(code)) return null

  // Weight rule: if weight exists and is <= 0, never render
  const weight = (w as any)?.weight
if (typeof weight === "number" && weight < 0) return null

  const job = out.job_signals
  const profile = out.profile_signals
  const { jobEv, profileEv } = chooseBestEvidence(job, profile, w)

  // Require job anchor
  if (!jobEv) return null

  // Prefer concise, single-sentence, usable phrasing
  if (profileEv) {
    // Example: "Role family detected as Consulting; your targets include Consulting."
    return sanitize(`${jobEv}; ${profileEv}`)
  }

  // If no profile anchor, only allow for core work match (still useful as a single anchor).
  if (code === "WHY_FAMILY_MATCH") return sanitize(jobEv)

  return null
}

/* ------------------------------ render RISK ------------------------------ */
/**
 * RISK bullet rule:
 * - Must tie to job-side proof (jobEv).
 * - Prefer concrete “risk” line if available; otherwise job+profile facts.
 * - Keep it 1 clean sentence.
 */
function renderRiskBullet(out: EvalOutput, r: RiskCode): string | null {
  const code = String(r?.code || "").trim()
  if (!code) return null

  const job = out.job_signals
  const profile = out.profile_signals
  const { jobEv, profileEv } = chooseBestRiskEvidence(job, profile, r)

  // Require job anchor (proof exists)
  if (!jobEv) return null

  const riskText = sanitize(r?.risk || "")
  const hasConcreteRisk =
    usable(riskText) && !riskText.toLowerCase().includes("may") && !riskText.toLowerCase().includes("might")

  // Tools: keep format tight and obvious.
  if (code === "RISK_MISSING_TOOLS") {
    // Prefer: "Posting emphasizes X; your profile does not show X yet."
    if (profileEv) return sanitize(`${jobEv}; ${profileEv}`)
    return sanitize(jobEv)
  }

  if (hasConcreteRisk && profileEv) return sanitize(`${riskText} ${jobEv} ${profileEv}`)
  if (hasConcreteRisk) return sanitize(`${riskText} ${jobEv}`)

  if (profileEv) return sanitize(`${jobEv}; ${profileEv}`)
  return sanitize(jobEv)
}

/* ------------------------------ export ------------------------------ */

export function renderBulletsV4(out: EvalOutput): {
  why: string[]
  risk: string[]
  renderer_debug: any
} {
  const d = out.decision
  const { whyMax, riskMax } = capsForDecision(d)

  const whyCodesIn = Array.isArray(out.why_codes) ? out.why_codes.slice() : []
  const riskCodesIn = Array.isArray(out.risk_codes) ? out.risk_codes.slice() : []

  // Sort WHY by strict policy priority first, then weight
  whyCodesIn.sort((a, b) => {
    const pa = whyPriority(String(a?.code || ""))
    const pb = whyPriority(String(b?.code || ""))
    const wa = typeof (a as any)?.weight === "number" ? (a as any).weight : 0
    const wb = typeof (b as any)?.weight === "number" ? (b as any).weight : 0
    return pb - pa || wb - wa
  })

  // Sort RISK by severity tier, down-rank tool gaps unless high severity
  riskCodesIn.sort((a, b) => {
    const pa = riskPriority(String(a?.code || ""), a)
    const pb = riskPriority(String(b?.code || ""), b)
    return pb - pa
  })

  const usedWhyGroups = new Set<Group>()
  const usedRiskGroups = new Set<Group>()

  const why: string[] = []
  const risk: string[] = []

  // WHY selection with redundancy control
  if (whyMax > 0) {
    for (const w of whyCodesIn) {
      if (why.length >= whyMax) break
      const code = String(w?.code || "").trim()
      if (!code) continue

      // Hard rules
      if (BANNED_WHY_CODES.has(code)) continue
      if (!ALLOWED_WHY_CODES.has(code)) continue
      const weight = (w as any)?.weight
      if (typeof weight === "number" && weight <= 0) continue

      const g = whyGroup(code)
      if (usedWhyGroups.has(g) && g !== "other") continue

      const b = renderWhyBullet(out, w)
      if (!b || !usable(b)) continue

      // Keep your old hard rule even though location is excluded anyway
      if (g === "location" && out.location_constraint !== "constrained") continue

      usedWhyGroups.add(g)
      why.push(b)
    }
  }

  // RISK selection with redundancy control
  if (riskMax > 0) {
    for (const r of riskCodesIn) {
      if (risk.length >= riskMax) break
      const code = String(r?.code || "").trim()
      if (!code) continue

      const g = riskGroup(code)
      if (usedRiskGroups.has(g) && g !== "other") continue

      // Tool gap cannot be top risk unless high severity
      if (code === "RISK_MISSING_TOOLS" && risk.length === 0 && r.severity !== "high") continue

      const b = renderRiskBullet(out, r)
      if (!b || !usable(b)) continue

      usedRiskGroups.add(g)
      risk.push(b)
    }
  }

const whyCodes = whyCodesIn
const riskCodes = riskCodesIn

  const why_trace = whyCodesIn.map((w) => {
    const code = String(w?.code || "").trim()
    const g = code ? whyGroup(code) : "other"
    const rendered = code ? renderWhyBullet(out, w) : null
    return {
      code,
      group: g,
      banned: BANNED_WHY_CODES.has(code),
      location_constraint: out.location_constraint,
      rendered,
      rendered_usable: rendered ? usable(rendered) : false,
      job_fact: w?.job_fact ?? null,
      profile_fact: w?.profile_fact ?? null,
    }
  })

  return {
    why,
    risk,
        renderer_debug: {
      renderer_stamp: RENDERER_V4_STAMP,
      decision: out.decision,
      location_constraint: out.location_constraint,
     why_codes_in: whyCodesIn.map((x) => x.code),
risk_codes_in: riskCodesIn.map((x) => x.code),
      why_count: why.length,
      risk_count: risk.length,
      why_trace,
    },
  }
}