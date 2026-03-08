// src/bullets.ts
import { Alignment, Exposure, JobSignalsV1, ProfileSignalsV1, RiskItem, WhyItem } from "./types"

export interface BulletBuildResult {
  why: WhyItem[]
  next_step: string
}

/**
 * Deterministic bullet generation tied to codes.
 * v1 uses small template sets to preserve stability.
 */
export function buildWhyAndNextStep(
  job: JobSignalsV1,
  profile: ProfileSignalsV1,
  alignment: Alignment,
  exposure: Exposure,
  risks: RiskItem[],
  finalDecision: "PRIORITY_APPLY" | "APPLY" | "REVIEW" | "PASS"
): BulletBuildResult {
  const why: WhyItem[] = []

  // Alignment bullet
  why.push({
    code: `WHY_ALIGNMENT_${alignment}`,
    label: "Role alignment",
    evidence: `Alignment classified as ${alignment} based on job role families (${job.role.role_families.join(", ")}) vs targets (${profile.targets.role_families.join(", ")}).`,
  })

  // Exposure bullet
  why.push({
    code: `WHY_EXPOSURE_${exposure}`,
    label: "Exposure level",
    evidence: `Exposure classified as ${exposure} based on overlap between job responsibility clusters and profile exposure clusters.`,
  })

  // Tool match bullet (only if job lists tools)
  const requiredTools = job.skills_tools?.tools_required ?? []
  if (requiredTools.length) {
    why.push({
      code: "WHY_TOOLS_BASELINE",
      label: "Tool baseline",
      evidence: `Job lists required tools: ${requiredTools.join(", ")}. Profile tools include: ${(profile.skills_tools?.tools ?? []).join(", ")}.`,
    })
  }

  // Trim why count to spec-friendly range (deterministic)
  // REVIEW tends to want more; PASS wants less.
  const maxWhy = finalDecision === "REVIEW" ? 6 : finalDecision === "PASS" ? 3 : 5
  const trimmedWhy = why.slice(0, maxWhy)

  const next_step = buildNextStep(finalDecision, risks)

  return { why: trimmedWhy, next_step }
}

function buildNextStep(
  decision: "PRIORITY_APPLY" | "APPLY" | "REVIEW" | "PASS",
  risks: RiskItem[]
): string {
  if (decision === "PRIORITY_APPLY") return "Apply now and start networking immediately after applying."
  if (decision === "APPLY") return "Apply, then network within 24–72 hours to increase visibility."

  if (decision === "REVIEW") {
    const top = risks
      .filter((r) => r.risk_level !== "COSMETIC")
      .slice(0, 2)
      .map((r) => r.label)
      .filter(Boolean)

    if (top.length) {
      return `Only proceed if you can reduce the top risks: ${top.join("; ")}. If yes, apply and network immediately.`
    }
    return "Only proceed if you can reduce the top risks. If yes, apply and network immediately."
  }

  // PASS
  const structural = risks.find((r) => r.risk_level === "STRUCTURAL")
  if (structural) return "Pass for now. This is not competitive without a major change in qualification or target direction."
  return "Pass for now. Focus on roles that better match your target and proven execution."
}