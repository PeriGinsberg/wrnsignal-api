// app/api/jobfit/evaluator.ts

import { POLICY, Decision } from "./policy"
import { extractJobSignals, extractProfileSignals } from "./extract"
import { evaluateGates } from "./constraints"
import { scoreJobFit } from "./scoring"
import { applyGateOverrides, applyRiskDowngrades, decisionFromScore } from "./decision"
import type { EvalOutput, RiskItem, WhyItem, StructuredProfileSignals, WhyCode, RiskCode } from "./signals"

function dedupe<T extends string>(xs: T[]): T[] {
  return Array.from(new Set(xs))
}

function nextStepForDecision(d: Decision): string {
  if (d === "Apply") return "Apply. Then send 2 targeted networking messages within 24 hours."
  if (d === "Review") return "Only proceed if you can reduce the top risks. If yes, apply and network immediately."
  return "Pass. Do not apply. Put that effort into a better-fit role."
}

export type EvaluateInput = {
  jobText: string
  profileText?: string
  profileOverrides?: Partial<StructuredProfileSignals>
}

function compactList(xs: string[], max = 4): string {
  const clean = xs.map((x) => String(x || "").trim()).filter(Boolean)
  return clean.slice(0, max).join(", ")
}

/**
 * Deterministic bullet rendering.
 * This is where we eliminate generic nonsense by grounding bullets in extracted evidence.
 */
function whyText(code: WhyCode, job: ReturnType<typeof extractJobSignals>, profile: ReturnType<typeof extractProfileSignals>): string | null {
  // If policy has a string and we don’t have a better evidence-based version, fallback to policy.
  const fallback = POLICY.bullets.why[code]

  // Tool-based bullets must be grounded. No tools in JD = no tool bullets.
  const hasToolsInJD = (job.requiredTools.length + job.preferredTools.length) > 0

  switch (code) {
    case "WHY_MARKETING_ROTATION_MATCH": {
      const depts = job.internship.departments || []
      if (depts.length < 3) return fallback // scoring logic already gates >=3 hits
      const deptStr = compactList(depts, 6)
      const where = job.location.city ? ` in ${job.location.city}` : ""
      return `Rotates across ${deptStr}${where}, so you can test-fit multiple marketing lanes instead of getting stuck doing one narrow task.`
    }

    case "WHY_SUMMER_INTERNSHIP_MATCH": {
      // If dates exist, use them. If not, use "Summer 2026" only.
      const dates = job.internship.dates
      if (dates) return `Runs ${dates}, which fits your Summer internship timeline.`
      return fallback
    }

    case "WHY_IN_PERSON_MATCH": {
      const where = job.location.city ? ` (${job.location.city})` : ""
      return `This is in-person or hybrid${where}, which matches your no-remote constraint.`
    }

    case "WHY_AI_TOOLS_MATCH": {
      // Only make this specific if we have the evidence line
      if (job.internship.evidence?.aiLine) {
        return `The posting explicitly calls out comfort with AI tools, which aligns with your AI training background.`
      }
      return fallback
    }

    case "WHY_TOOL_MATCH": {
      if (!hasToolsInJD) return null
      // grounded wording
      return `The job lists specific tools, and you are not missing the core ones it’s screening for.`
    }

    case "WHY_LOCATION_MATCH": {
      const city = job.location.city
      const allowed = profile.locationPreference.allowedCities || []
      // If we have city + allowedCities, be specific
      if (city && allowed.length > 0) {
        return `Location fits what you listed: this role is tied to ${city}, which is on your target city list.`
      }
      // Otherwise fallback to mode match only
      return fallback
    }

    case "WHY_MARKETING_EXECUTION": {
      // Make it less generic for marketing by pointing to the internship responsibilities structure
      // without quoting.
      if (job.internship.isInternship) {
        const hasCapstone = !!job.internship.hasCapstone
        if (hasCapstone) {
          return `This internship is built around real outputs (weekly tasks + a Capstone project), so you can leave with something portfolio-worthy, not just “shadowing.”`
        }
        return `This reads like real execution work (day-to-day ownership + cross-functional collaboration), not a passive “observe and learn” internship.`
      }
      return fallback
    }

    case "WHY_EARLY_CAREER_FRIENDLY": {
      if (!job.yearsRequired || job.yearsRequired <= 1) {
        // If internship, make it explicit
        if (job.internship.isInternship) return `The posting is structured for students (intern program + training + capstone), so it’s actually early-career realistic.`
        return fallback
      }
      return fallback
    }

    default:
      return fallback
  }
}

function riskText(code: RiskCode, job: ReturnType<typeof extractJobSignals>, profile: ReturnType<typeof extractProfileSignals>, scoring: ReturnType<typeof scoreJobFit>): string | null {
  const fallback = POLICY.bullets.risk[code]
  const hasToolsInJD = (job.requiredTools.length + job.preferredTools.length) > 0

  switch (code) {
    case "RISK_MISSING_TOOLS": {
      // If JD never listed tools, this risk is invalid. Drop it.
      if (!hasToolsInJD) return null

      // If the scoring penalties contain missing tool notes, render specific tools.
      const missing = scoring.penalties
        .filter((p) => p.key === "missing_core_tool" || p.key === "missing_preferred_tool")
        .map((p) => p.note.replace(/^Missing (required|preferred) tool:\s*/i, "").trim())
        .filter(Boolean)

      if (missing.length === 0) return null

      const uniq = Array.from(new Set(missing))
      const list = compactList(uniq, 5)
      return `The posting names tools you have not shown yet (${list}). If you actually have them, your profile is underselling you.`
    }

    case "RISK_LOCATION": {
      // Only meaningful when we have city + constrained preference list
      const city = job.location.city
      const allowed = profile.locationPreference.allowedCities || []
      if (profile.locationPreference.constrained && city && allowed.length > 0) {
        return `Your location constraint is explicit, and this job is tied to ${city}, which is not on your allowed city list.`
      }
      // Otherwise we drop it (your scoring should already be strict, but this is belt-and-suspenders)
      return null
    }

    default:
      return fallback
  }
}

export function evaluateJobFit(input: EvaluateInput): EvalOutput {
  const job = extractJobSignals(input.jobText)
  const profile = extractProfileSignals(input.profileText || "", input.profileOverrides)

  const gate = evaluateGates(job, profile)
  const scoring = scoreJobFit(job, profile)

  let decision = decisionFromScore(scoring.score)
  decision = applyGateOverrides(decision, gate)
  decision = applyRiskDowngrades(decision, scoring.penaltySum)

  const location_constraint =
    job.location.constrained || profile.locationPreference.constrained
      ? ("constrained" as const)
      : job.location.mode === "unclear" && profile.locationPreference.mode === "unclear"
      ? ("unclear" as const)
      : ("not_constrained" as const)

  if (decision === "Pass") {
    const passText =
      gate.type === "force_pass"
        ? POLICY.bullets.pass[gate.gateCode] || "Pass. Hard mismatch."
        : "Pass. The risks outweigh the upside for your profile."

    return {
      decision,
      score: scoring.score,
      bullets: [passText],
      risk_flags: [],
      next_step: nextStepForDecision(decision),
      location_constraint,
      why_codes: dedupe(scoring.whyCodes),
      risk_codes: dedupe(scoring.riskCodes),
      gate_triggered: gate.type === "none" ? { type: "none" } : { type: gate.type, gateCode: gate.gateCode },
    }
  }

  // WHY bullets (rendered with evidence)
  const whyItems: WhyItem[] = scoring.whyCodes
    .map((c) => {
      const text = whyText(c, job, profile)
      return text ? ({ code: c, text } as WhyItem) : null
    })
    .filter(Boolean) as WhyItem[]

  // RISK bullets (rendered with evidence + invalid-risk filtering)
  const riskItems: RiskItem[] = scoring.riskCodes
    .map((c) => {
      const text = riskText(c, job, profile, scoring)
      return text ? ({ code: c, text } as RiskItem) : null
    })
    .filter(Boolean) as RiskItem[]

  const bullets = dedupe(whyItems.map((x) => x.text)).slice(0, 6)
  const risk_flags = dedupe(riskItems.map((x) => x.text)).slice(0, 6)

  // Also clean up codes so debug output matches what you actually show
  const shownWhyCodes = dedupe(whyItems.map((x) => x.code))
  const shownRiskCodes = dedupe(riskItems.map((x) => x.code))

  return {
    decision,
    score: scoring.score,
    bullets,
    risk_flags,
    next_step: nextStepForDecision(decision),
    location_constraint,
    why_codes: shownWhyCodes,
    risk_codes: shownRiskCodes,
    gate_triggered: gate.type === "none" ? { type: "none" } : { type: gate.type, gateCode: gate.gateCode },
  }
}