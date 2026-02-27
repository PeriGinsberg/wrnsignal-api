// FILE: app/api/jobfit/deterministicBulletRendererV4.ts
import type { EvalOutput, Decision, WhyCode, RiskCode, StructuredJobSignals, StructuredProfileSignals } from "./signals"

export const RENDERER_V4_STAMP = "RENDERER_V4_STAMP__2026_02_27__A"

type RenderCaps = { whyMax: number; riskMax: number }
function capsForDecision(d: Decision): RenderCaps {
  if (d === "Apply") return { whyMax: 5, riskMax: 3 }
  if (d === "Review") return { whyMax: 5, riskMax: 4 }
  return { whyMax: 0, riskMax: 4 }
}

// Hard bans: codes you said are unacceptable client-facing
const BANNED_WHY_CODES = new Set<string>([
  "WHY_EARLY_CAREER_FRIENDLY", // explicitly banned concept
])

// Redundancy groups stop 3 bullets that say the same thing
type Group =
  | "core_work_match"
  | "proof_of_work"
  | "exec_comms"
  | "tools"
  | "location"
  | "internship"
  | "other"

function whyGroup(code: string): Group {
  if (code === "WHY_FAMILY_MATCH") return "core_work_match"
  if (code === "WHY_TOOL_MATCH") return "tools"
  if (code === "WHY_LOCATION_MATCH" || code === "WHY_IN_PERSON_MATCH") return "location"
  if (code === "WHY_SUMMER_INTERNSHIP_MATCH" || code === "WHY_MARKETING_ROTATION_MATCH" || code === "WHY_AI_TOOLS_MATCH")
    return "internship"
  return "other"
}

function riskGroup(code: string): Group {
  if (code === "RISK_LOCATION") return "location"
  if (code === "RISK_MISSING_TOOLS") return "tools"
  return "other"
}

// Priority weights enforce your gold-standard order (higher = earlier)
function whyPriority(code: string, out: EvalOutput): number {
  // Location should not be top unless constrained
  const constrained = out.location_constraint === "constrained"

  switch (code) {
    case "WHY_FAMILY_MATCH":
      return 100 // core work match proxy (until deeper work-loop signals exist)
    case "WHY_MARKETING_EXECUTION":
      return 90
    case "WHY_MEASUREMENT_LIGHT":
      return 85
    case "WHY_TOOL_MATCH":
      return 60
    case "WHY_SUMMER_INTERNSHIP_MATCH":
      return 55
    case "WHY_MARKETING_ROTATION_MATCH":
      return 50
    case "WHY_AI_TOOLS_MATCH":
      return 40
    case "WHY_IN_PERSON_MATCH":
      return constrained ? 45 : 10
    case "WHY_LOCATION_MATCH":
      return constrained ? 45 : 5
    default:
      return 20
  }
}

function riskPriority(code: string, r: RiskCode): number {
  // severity already exists on RiskCode; map to a base tier.
  const sev = r?.severity
  const sevWeight = sev === "high" ? 100 : sev === "medium" ? 60 : 30

  // Preferred tools should not dominate; we will down-rank tools risks unless high severity.
  const toolPenalty = code === "RISK_MISSING_TOOLS" && sev !== "high" ? -25 : 0

  return sevWeight + toolPenalty
}

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

function chooseBestEvidence(job: StructuredJobSignals | undefined, profile: StructuredProfileSignals | undefined, w: WhyCode): { jobEv: string; profileEv: string } {
  const jobEv = sanitize(w?.job_fact || "") || (job?.location?.evidence ? sanitize(job.location.evidence) : "")
  const profileEv = sanitize(w?.profile_fact || "")

  return {
    jobEv: usable(jobEv) ? jobEv : "",
    profileEv: usable(profileEv) ? profileEv : "",
  }
}

function chooseBestRiskEvidence(job: StructuredJobSignals | undefined, profile: StructuredProfileSignals | undefined, r: RiskCode): { jobEv: string; profileEv: string } {
  const jobEv = sanitize(r?.job_fact || "") || (job?.location?.evidence ? sanitize(job.location.evidence) : "")
  const profileEv = sanitize(r?.profile_fact || "")

  return {
    jobEv: usable(jobEv) ? jobEv : "",
    profileEv: usable(profileEv) ? profileEv : "",
  }
}

/**
 * Bullet format rule:
 * - 1 sentence
 * - must include job-side evidence + profile-side evidence when available
 * - no generic “looks realistic” or meta commentary
 */
function renderWhyBullet(out: EvalOutput, w: WhyCode): string | null {
  const code = String(w?.code || "").trim()
  if (!code) return null
  if (BANNED_WHY_CODES.has(code)) return null

  const job = out.job_signals
  const profile = out.profile_signals

  const { jobEv, profileEv } = chooseBestEvidence(job, profile, w)

  // Require at least one strong job-side anchor. No job anchor = too generic.
  if (!jobEv) return null

  // If we have both, stitch them into an interview-usable sentence.
  if (profileEv) {
    // “Job demands X; you’ve done Y.”
    return sanitize(`${jobEv} You’ve shown this through: ${profileEv}`)
  }

  // If profile evidence is missing, we allow only in low-stakes cases (internship tags, location constrained),
  // otherwise skip to prevent generic bullets.
  const okWithoutProfile = code === "WHY_SUMMER_INTERNSHIP_MATCH" || (code === "WHY_LOCATION_MATCH" && out.location_constraint === "constrained")
  if (!okWithoutProfile) return null

  return sanitize(jobEv)
}

function renderRiskBullet(out: EvalOutput, r: RiskCode): string | null {
  const code = String(r?.code || "").trim()
  if (!code) return null

  const job = out.job_signals
  const profile = out.profile_signals

  const { jobEv, profileEv } = chooseBestRiskEvidence(job, profile, r)

  // Require job anchor. Risk must tie to posting.
  if (!jobEv) return null

  // Prefer explicit risk text when it’s concrete.
  const riskText = sanitize(r?.risk || "")
  const hasConcreteRisk = usable(riskText) && !riskText.toLowerCase().includes("may") && !riskText.toLowerCase().includes("might")

  if (hasConcreteRisk && profileEv) return sanitize(`${riskText} ${jobEv} ${profileEv}`)
  if (hasConcreteRisk) return sanitize(`${riskText} ${jobEv}`)

  // If risk string is generic, anchor it with facts.
  if (profileEv) return sanitize(`${jobEv} ${profileEv}`)
  return sanitize(jobEv)
}

export function renderBulletsV4(out: EvalOutput): {
  why: string[]
  risk: string[]
  renderer_debug: any
} {
  const d = out.decision
  const { whyMax, riskMax } = capsForDecision(d)

  const whyCodes = Array.isArray(out.why_codes) ? out.why_codes.slice() : []
  const riskCodes = Array.isArray(out.risk_codes) ? out.risk_codes.slice() : []

  // Sort WHY by your policy layer (not raw weight alone)
  whyCodes.sort((a, b) => {
    const pa = whyPriority(String(a?.code || ""), out)
    const pb = whyPriority(String(b?.code || ""), out)
    const wa = typeof a?.weight === "number" ? a.weight : 0
    const wb = typeof b?.weight === "number" ? b.weight : 0
    return pb - pa || wb - wa
  })

  // Sort RISK by severity tier, then de-emphasize tool gaps
  riskCodes.sort((a, b) => {
    const pa = riskPriority(String(a?.code || ""), a)
    const pb = riskPriority(String(b?.code || ""), b)
    const wa = typeof a?.weight === "number" ? a.weight : 0
    const wb = typeof b?.weight === "number" ? b.weight : 0
    return pb - pa || wa - wb
  })

  const usedWhyGroups = new Set<Group>()
  const usedRiskGroups = new Set<Group>()

  const why: string[] = []
  const risk: string[] = []

  // WHY selection with redundancy control
  if (whyMax > 0) {
    for (const w of whyCodes) {
      if (why.length >= whyMax) break
      const code = String(w?.code || "").trim()
      if (!code) continue
      if (BANNED_WHY_CODES.has(code)) continue

      const g = whyGroup(code)
      if (usedWhyGroups.has(g) && g !== "other") continue

      const b = renderWhyBullet(out, w)
      if (!b || !usable(b)) continue

      // Location bullet cannot appear unless constrained (hard rule)
      if (g === "location" && out.location_constraint !== "constrained") continue

      usedWhyGroups.add(g)
      why.push(b)
    }
  }

  // RISK selection with redundancy control
  if (riskMax > 0) {
    for (const r of riskCodes) {
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

  return {
    why,
    risk,
    renderer_debug: {
      renderer_stamp: RENDERER_V4_STAMP,
      decision: out.decision,
      location_constraint: out.location_constraint,
      why_codes_in: whyCodes.map((x) => x.code),
      risk_codes_in: riskCodes.map((x) => x.code),
      why_count: why.length,
      risk_count: risk.length,
    },
  }
}