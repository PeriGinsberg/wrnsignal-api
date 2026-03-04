// src/experienceMismatch.ts
import { JobSignalsV1, ProfileSignalsV1 } from "./types"

export interface ExperienceMismatchResult {
  mismatch: boolean
  reason_codes: string[]
}

/**
 * Structural experience mismatch.
 *
 * IMPORTANT v1 rules:
 * - This is a TRUE structural blocker only when the job is clearly senior-level
 *   and the profile is clearly not at that level.
 * - Missing/unknown years must NOT trigger mismatch.
 * - Use ONE code for the concept to match regression + downstream logic.
 *
 * When mismatch is true → evaluator returns PASS with STRUCTURAL risk.
 */
export function runExperienceMismatch(job: JobSignalsV1, profile: ProfileSignalsV1): ExperienceMismatchResult {
  const reasons: string[] = []

  const stage = deriveStage(profile)
  const yrsRelevant = profile.experience?.years_relevant_est
  const minYears = job.requirements?.experience?.is_explicit ? job.requirements.experience.min_years : null
  const seniority = job.role?.seniority_hint ?? "unknown"

  // Gate 0: if we cannot determine stage (unknown years, unknown degree state), do not structural-fail.
  // v1 philosophy: unknown ≠ disqualified.
  if (stage === "unknown") {
    return { mismatch: false, reason_codes: [] }
  }

  // Rule A: Explicit min years that are clearly beyond entry-level.
  // Only enforce when BOTH:
  // - minYears is explicit AND >= 4
  // - we have known yrsRelevant AND it is meaningfully below (>=2-year gap)
  if (typeof minYears === "number" && minYears >= 4) {
    if (typeof yrsRelevant === "number") {
      const gap = minYears - yrsRelevant
      const clearlyBelow = gap >= 2

      // Only block students/interns/entry-level profiles
      if (clearlyBelow && (stage === "internship" || stage === "entry_level")) {
        reasons.push("RISK_EXPERIENCE_MISMATCH")
      }
    }
  }

  // Rule B: Seniority hint + strong senior ownership/management signals.
  // Only block when:
  // - job hint is senior/lead/manager/director/exec
  // - AND we see strong signals in clusters
  // - AND profile is internship/entry_level
  if (isSeniorHint(seniority)) {
    const signals = getSenioritySignals(job)

    // Require at least one strong signal so "senior" label alone doesn't nuke cases.
    if (signals.has_strong_signal && (stage === "internship" || stage === "entry_level")) {
      reasons.push("RISK_EXPERIENCE_MISMATCH")
    }
  }

  // Rule C: Explicit people management requirement (strong signal), no evidence in profile.
  // Only applies when job clusters explicitly indicate people management.
  if (requiresPeopleManagement(job)) {
    const hasMgmt = profileHasManagementEvidence(profile)
    // For early career and below, lacking mgmt evidence is a structural mismatch
    // (This is conservative; if your regression expects Tier2 instead, we should move this to tiering.)
    if (!hasMgmt && (stage === "internship" || stage === "entry_level" || stage === "early_career")) {
      reasons.push("RISK_EXPERIENCE_MISMATCH")
    }
  }

  // De-dupe reasons (single code anyway, but keep safe)
  const uniq = Array.from(new Set(reasons))

  return { mismatch: uniq.length > 0, reason_codes: uniq }
}

/* ----------------------------- Helpers (deterministic) ----------------------------- */

function deriveStage(profile: ProfileSignalsV1): "internship" | "entry_level" | "early_career" | "experienced" | "unknown" {
  const degree = profile.education?.degree_level ?? "unknown"
  const yrs = profile.experience?.years_relevant_est

  // In-progress degree implies student/internship track
  if (degree === "in_progress") return "internship"

  // If yrs is missing/unknown, we do NOT guess stage
  if (typeof yrs !== "number") return "unknown"

  if (yrs < 1) return "entry_level"
  if (yrs < 3) return "early_career"
  return "experienced"
}

function isSeniorHint(hint: string): boolean {
  return ["senior", "lead", "manager", "director", "exec"].includes(hint)
}

function getSenioritySignals(job: JobSignalsV1): { has_strong_signal: boolean } {
  const clusters = (job.responsibility_clusters ?? []).map((c) => (c || "").toLowerCase())

  // Strong signals only (avoid weak tokens like "client facing")
  const strong = clusters.some((c) =>
    c.includes("people management") ||
    c.includes("manage team") ||
    c.includes("team leadership") ||
    c.includes("ownership") ||
    c.includes("owns ") ||
    c.includes("leadership") ||
    c.includes("manager") ||
    c.includes("managing")
  )

  return { has_strong_signal: strong }
}

function requiresPeopleManagement(job: JobSignalsV1): boolean {
  const clusters = (job.responsibility_clusters ?? []).map((c) => (c || "").toLowerCase())
  return clusters.some(
    (c) =>
      c.includes("people management") ||
      c.includes("manage team") ||
      c.includes("team leadership") ||
      c.includes("managing direct reports") ||
      c.includes("direct reports")
  )
}

function profileHasManagementEvidence(profile: ProfileSignalsV1): boolean {
  const skills = (profile.skills_tools?.skills ?? []).map((s) => (s || "").toLowerCase())
  const executed = (profile.exposure_clusters?.executed ?? []).map((s) => (s || "").toLowerCase())

  // Evidence can come from either skills list or executed clusters
  const haystack = [...skills, ...executed]

  return haystack.some(
    (s) =>
      s.includes("people management") ||
      s.includes("managed") ||
      s.includes("manage") ||
      s.includes("led ") ||
      s.includes("lead ") ||
      s.includes("supervis")
  )
}