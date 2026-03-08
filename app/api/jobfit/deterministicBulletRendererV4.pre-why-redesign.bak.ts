// FILE: app/api/jobfit/deterministicBulletRendererV4.ts
//
// CLEAN REWRITE: V4 deterministic bullet renderer (million-dollar output)
// Core rules:
// - WHY bullets = real reasons to apply (not table stakes).
// - Table-stakes (internship/summer/location/early-career) never become WHY.
// - Tools are a WHY only when the job explicitly mentions them AND the profile shows them.
// - Tools are risk-only when job explicitly mentions them AND the profile does not show them.
// - Omission is never a negative: risk bullets require job-side proof.
// - Bullets are 1 sentence, human, interview-usable, not corporate.
//
// Output strategy (universal):
//   {Profile proof}; {Role demand}.
// Example:
//   "You’ve built DCF models and done diligence; this role requires financial modeling and hypothesis-driven research."

import type {
  EvalOutput,
  Decision,
  WhyCode,
  RiskCode,
  StructuredJobSignals,
  StructuredProfileSignals,
} from "./signals"

export const RENDERER_V4_STAMP = "RENDERER_V4_STAMP__2026_02_27__MILLION_DOLLAR__A"

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
 */
const BANNED_WHY_CODES = new Set<string>([
  "WHY_EARLY_CAREER_FRIENDLY",
  "WHY_LOCATION_MATCH",
  "WHY_IN_PERSON_MATCH",
  "WHY_SUMMER_INTERNSHIP_MATCH",
  "WHY_MARKETING_ROTATION_MATCH",
  "WHY_AI_TOOLS_MATCH",
])

/**
 * Allow-list: only substantive WHY codes.
 * Add more here when you introduce richer deterministic match drivers.
 */
const ALLOWED_WHY_CODES = new Set<string>([
  "WHY_FAMILY_MATCH",
  "WHY_TOOL_MATCH", // allowed now: only if job mentions tools AND profile shows them
  "WHY_MARKETING_EXECUTION",
  "WHY_MEASUREMENT_LIGHT",
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
    case "WHY_TOOL_MATCH":
      return 70
    default:
      return 10
  }
}

function riskPriority(code: string, r: RiskCode): number {
  const sev = r?.severity
  const sevWeight = sev === "high" ? 100 : sev === "medium" ? 60 : 30

  // Tool risks should not dominate unless high severity.
  const toolPenalty = code === "RISK_MISSING_TOOLS" && sev !== "high" ? -25 : 0
  return sevWeight + toolPenalty
}

/* ------------------------------ string helpers ------------------------------ */

function norm(s: any): string {
  return String(s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
}

function sentence(s: string): string {
  let t = norm(s)
  t = t.replace(/^[\-\u2022•\s]+/, "")
  t = t.replace(/\s*\.$/, "")
  if (!t) return ""
  t = t[0].toUpperCase() + t.slice(1)
  return t
}

function usable(s: string): boolean {
  const t = norm(s)
  if (!t) return false
  if (t.length < 14) return false
  return true
}

function list(xs: string[], n: number): string {
  const cleaned = (xs || []).map((x) => sentence(x)).filter(Boolean)
  return cleaned.slice(0, n).join(", ")
}

function lower(s: any): string {
  return norm(s).toLowerCase()
}

function uniqLower(xs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs || []) {
    const k = lower(x)
    if (!k) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(sentence(x))
  }
  return out
}

/* ------------------------------ evidence builders (human) ------------------------------ */

/**
 * These do NOT echo robotic job_fact/profile_fact strings.
 * They use structured signals when possible, because those are cleaner and universal.
 */
function buildFamilyProof(job: StructuredJobSignals | undefined, profile: StructuredProfileSignals | undefined): string | null {
  const jf = job?.jobFamily ? sentence(job.jobFamily) : ""
  const pf = Array.isArray(profile?.targetFamilies) ? profile!.targetFamilies.map(sentence) : []

  if (!jf || pf.length === 0) return null

  // If the profile actually targets that family, say it like a human.
  const targetsIt = pf.map((x) => lower(x)).includes(lower(jf))
  if (!targetsIt) return null

  // Human, universal, no “detected”
  // “You’re targeting Consulting; this role is Consulting.”
  return sentence(`You’re targeting ${jf}; this role is ${jf}`)
}

function buildToolsWhy(job: StructuredJobSignals | undefined, profile: StructuredProfileSignals | undefined): string | null {
  const jobTools = uniqLower([...(job?.requiredTools || []), ...(job?.preferredTools || [])])
  const profileTools = uniqLower(profile?.tools || [])

  if (jobTools.length === 0) return null
  if (profileTools.length === 0) return null

  // We only render a tools WHY if there is overlap (positive signal).
  const profileSet = new Set(profileTools.map((x) => lower(x)))
  const overlap = jobTools.filter((t) => profileSet.has(lower(t)))

  if (overlap.length === 0) return null

  const jobToolStr = list(jobTools, 4)
  const overlapStr = list(overlap, 4)

  // Human + tight + not “aligns with”
  // “You already use Excel and SQL; the role explicitly calls out Excel, SQL.”
  return sentence(`You already use ${overlapStr}; the role explicitly calls out ${jobToolStr}`)
}

/* ------------------------------ render WHY ------------------------------ */

function renderWhyBullet(out: EvalOutput, w: WhyCode): string | null {
  const code = norm(w?.code)
  if (!code) return null
  if (BANNED_WHY_CODES.has(code)) return null
  if (!ALLOWED_WHY_CODES.has(code)) return null

  // Weight rule: if weight exists and is <= 0, do not render.
  // This keeps “present but table-stakes” from leaking into bullets.
  const weight = (w as any)?.weight
  if (typeof weight === "number" && weight <= 0) return null

  const job = out.job_signals
  const profile = out.profile_signals

  // Code-specific human bullets (preferred)
  if (code === "WHY_FAMILY_MATCH") {
    const s = buildFamilyProof(job, profile)
    return s && usable(s) ? s : null
  }

  if (code === "WHY_TOOL_MATCH") {
    const s = buildToolsWhy(job, profile)
    return s && usable(s) ? s : null
  }

  // Generic fallback (only for future allowed codes you add)
  const jobEv = sentence(w?.job_fact || "")
  const profileEv = sentence(w?.profile_fact || "")

  if (!usable(jobEv) || !usable(profileEv)) return null
  return sentence(`${profileEv}; ${jobEv}`)
}

/* ------------------------------ render RISK ------------------------------ */

function renderRiskBullet(out: EvalOutput, r: RiskCode): string | null {
  const code = norm(r?.code)
  if (!code) return null

  const jobEv = sentence(r?.job_fact || "")
  const profileEv = sentence(r?.profile_fact || "")

  // Require job-side proof anchor for all risk bullets.
  if (!usable(jobEv)) return null

  // Prefer explicit risk line if it’s concrete.
  const riskText = sentence(r?.risk || "")
  const hasConcreteRisk =
    usable(riskText) && !riskText.toLowerCase().includes("may") && !riskText.toLowerCase().includes("might")

  // Tools risk: keep it blunt and factual.
  // Example: “Posting calls out Tableau; your profile doesn’t show Tableau yet.”
  if (code === "RISK_MISSING_TOOLS") {
    if (usable(profileEv)) return sentence(`${jobEv}; ${profileEv}`)
    return sentence(jobEv)
  }

  if (hasConcreteRisk && usable(profileEv)) return sentence(`${riskText} ${jobEv} ${profileEv}`)
  if (hasConcreteRisk) return sentence(`${riskText} ${jobEv}`)
  if (usable(profileEv)) return sentence(`${jobEv}; ${profileEv}`)
  return sentence(jobEv)
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

  // Sort WHY: strict priority, then weight
  whyCodesIn.sort((a, b) => {
    const pa = whyPriority(norm(a?.code))
    const pb = whyPriority(norm(b?.code))
    const wa = typeof (a as any)?.weight === "number" ? (a as any).weight : 0
    const wb = typeof (b as any)?.weight === "number" ? (b as any).weight : 0
    return pb - pa || wb - wa
  })

  // Sort RISK: severity tier, then down-rank tool gaps unless high severity
  riskCodesIn.sort((a, b) => {
    const pa = riskPriority(norm(a?.code), a)
    const pb = riskPriority(norm(b?.code), b)
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
      const code = norm(w?.code)
      if (!code) continue

      if (BANNED_WHY_CODES.has(code)) continue
      if (!ALLOWED_WHY_CODES.has(code)) continue

      const weight = (w as any)?.weight
      if (typeof weight === "number" && weight <= 0) continue

      const g = whyGroup(code)
      if (usedWhyGroups.has(g) && g !== "other") continue

      const b = renderWhyBullet(out, w)
      if (!b || !usable(b)) continue

      // Keep old hard rule: location WHY cannot appear unless constrained.
      // (Location is table-stakes anyway so it should never appear here.)
      if (g === "location" && out.location_constraint !== "constrained") continue

      usedWhyGroups.add(g)
      why.push(b)
    }
  }

  // RISK selection with redundancy control
  if (riskMax > 0) {
    for (const r of riskCodesIn) {
      if (risk.length >= riskMax) break
      const code = norm(r?.code)
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

  // Debug trace so you can see exactly what was excluded and why
  const why_trace = whyCodesIn.map((w) => {
    const code = norm(w?.code)
    const g = code ? whyGroup(code) : "other"
    const weight = (w as any)?.weight
    const rendered = code ? renderWhyBullet(out, w) : null
    return {
      code,
      group: g,
      allowed: ALLOWED_WHY_CODES.has(code),
      banned: BANNED_WHY_CODES.has(code),
      weight: typeof weight === "number" ? weight : null,
      rendered,
      rendered_usable: rendered ? usable(rendered) : false,
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