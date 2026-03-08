// src/tiering.ts
import { Alignment, Exposure, JobSignalsV1, ProfileSignalsV1, RiskItem, RiskLevel } from "./types"

export interface TieringResult {
  risks: RiskItem[]
  t2_count: number
  has_structural: boolean
}

export function generateRisks(
  job: JobSignalsV1,
  profile: ProfileSignalsV1,
  alignment: Alignment,
  exposure: Exposure
): TieringResult {
  const risks: RiskItem[] = []

// ---- Tier2: experience gap when min_years is explicit but not a hard gate ----
const exp = job.requirements?.experience
if (exp?.is_explicit && exp.min_years != null && exp.min_years > 0) {
  const min = exp.min_years
  const yrs = profile.experience?.years_relevant_est ?? null
  const yrsVal = yrs ?? 0

  if (yrsVal < min) {
    const gap = min - yrsVal
    const wouldBeHardGate = min >= 4 || gap >= 2

    if (!wouldBeHardGate) {
      risks.push(
        risk(
          "ADDRESSABLE_GAP",
          "RISK_EXPERIENCE_GAP",
          "Experience gap vs stated minimum",
          `Role states ${min}+ years; your relevant experience is estimated at ${yrs ?? "unknown"}.`,
          "Apply only if you can show equivalent experience through internships, projects, or highly similar execution work, and network hard to offset the screen."
        )
      )
    }
  }
}

  // ---- Exposure risks ----
  if (exposure === "NONE") {
    risks.push(
      risk(
        "STRUCTURAL",
        "RISK_EXPOSURE_NONE",
        "No proof of core execution",
        "Profile shows no executed/adjacent/theoretical overlap with the job’s core responsibility clusters.",
        "Not addressable quickly. Only proceed if you can add credible proof (project, role, or experience) that matches core responsibilities."
      )
    )
  } else if (exposure === "THEORETICAL") {
    risks.push(
      risk(
        "ADDRESSABLE_GAP",
        "RISK_EXPOSURE_THEORETICAL_ONLY",
        "Mostly theoretical exposure",
        "Profile evidence is primarily coursework/theory rather than executed experience for the job’s core clusters.",
        "Build proof quickly: targeted project, portfolio artifact, or role-relevant execution example, then apply with tight positioning."
      )
    )
  }

  // ---- Tools: REQUIRED tools missing should be Tier2 even if just one ----
  const missingTools = missingRequiredTools(job, profile)
  if (missingTools.length >= 2) {
    risks.push(
      risk(
        "ADDRESSABLE_GAP",
        "RISK_TOOLS_MISSING_MULTIPLE",
        "Missing required tools",
        `Job lists required tools not clearly shown in profile: ${missingTools.join(", ")}.`,
        "Close the gap: add credible usage proof (project/work) and ensure tools appear explicitly in skills and bullets."
      )
    )
  } else if (missingTools.length === 1) {
    // IMPORTANT: this is Tier2 per your regression expectation (C04)
    risks.push(
      risk(
        "ADDRESSABLE_GAP",
        "RISK_TOOLS_MISSING_ONE",
        "Missing required tool",
        `Job lists a required tool not clearly shown in profile: ${missingTools[0]}.`,
        "If you have it, surface it explicitly in Skills and in at least one experience bullet. If you do not, close the gap before applying."
      )
    )
  }

  // ---- Alignment risks (keep as Tier2) ----
  if (alignment === "MISALIGNED") {
    risks.push(
      risk(
        "ADDRESSABLE_GAP",
        "RISK_ALIGNMENT_MISALIGNED",
        "Goal misalignment",
        "The role family does not match the profile’s stated targets, which will reduce credibility without a pivot story.",
        "Only proceed if you are intentionally changing direction. Make the pivot explicit and network before/after applying."
      )
    )
  } else if (alignment === "WEAK" && (exposure === "EXECUTED" || exposure === "ADJACENT")) {
    risks.push(
      risk(
        "ADDRESSABLE_GAP",
        "RISK_ALIGNMENT_WEAK",
        "Weak alignment to stated targets",
        "The role family is not a primary target for this profile, even though some transferable execution exists.",
        "Only proceed if you are intentionally pivoting. Tighten narrative and network hard to reduce skepticism."
      )
    )
  }
  const t2_count = risks.filter((r) => r.risk_level === "ADDRESSABLE_GAP").length
  const has_structural = risks.some((r) => r.risk_level === "STRUCTURAL")
  return { risks, t2_count, has_structural }
}

/* ----------------------------- Helpers ----------------------------- */

function risk(level: RiskLevel, code: string, label: string, evidence: string, mitigation: string): RiskItem {
  return { risk_level: level, code, label, evidence, mitigation }
}

function normalizeTool(t: string): string {
  const s = (t || "").toLowerCase().trim()
  if (!s) return ""

  // Remove skill-level suffixes
  const stripped = s
    .replace(/_basic$/g, "")
    .replace(/_intermediate$/g, "")
    .replace(/_advanced$/g, "")
    .replace(/\s+basic$/g, "")
    .replace(/\s+intermediate$/g, "")
    .replace(/\s+advanced$/g, "")

  if (stripped === "ms excel") return "excel"
  return stripped
}

function normalizeTools(xs: string[]): string[] {
  return xs.map(normalizeTool).filter(Boolean)
}

function missingRequiredTools(job: JobSignalsV1, profile: ProfileSignalsV1): string[] {
  const required = normalizeTools(job.skills_tools?.tools_required ?? [])
  if (required.length === 0) return []
  const have = new Set(normalizeTools(profile.skills_tools?.tools ?? []))
  return required.filter((t) => !have.has(t))
}