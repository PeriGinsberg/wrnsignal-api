// src/hardGates.ts
import { JobSignalsV1, ProfileSignalsV1 } from "./types"

export type GPAFlag = "None" | "Missing" | "Below_Min"

export interface HardGateResult {
  // "hard_fail" means BLOCKING.
  hard_fail: boolean
  // "hard_fail_reasons" means GATE TRIGGERED reasons (blocking or not).
  // Regression expects "hard_gate_triggered" when this is non-empty,
  // even if hard_fail is false.
  hard_fail_reasons: string[]
  gpa_flag: GPAFlag
}

/**
 * Hard gates run first.
 *
 * IMPORTANT SEMANTICS:
 * - hard_fail_reasons = triggered "gate" reasons (can be non-blocking)
 * - hard_fail = whether any triggered reason is truly blocking
 *
 * Experience:
 * - If explicit min_years exists and candidate is below it -> trigger RISK_EXPERIENCE_MISMATCH
 * - Blocking only when clearly beyond stage: min_years >= 4 OR (min_years - yrs_relevant_est) >= 2
 *   This preserves: "we shouldn't hard gate a 2 year minimum for students/early career"
 *
 * GPA:
 * - Missing when required is NOT a hard fail (caller can downgrade)
 * - Below minimum IS blocking (FLAG_GPA_REQUIRED_BELOW_MIN)
 */
export function runHardGates(job: JobSignalsV1, profile: ProfileSignalsV1): HardGateResult {
  const triggered: string[] = []
  let blocking = false

  // ---------- Experience minimum ----------
  const exp = job.requirements?.experience
  if (exp?.is_explicit && exp.min_years != null && exp.min_years > 0) {
    const min = exp.min_years
    const yrs = profile.experience?.years_relevant_est ?? null

    // If we can measure and it's below the explicit min, trigger the gate.
    if (yrs != null && yrs < min) {
      triggered.push("RISK_EXPERIENCE_MISMATCH")

      const gap = min - yrs
      const isBlocking = min >= 4 || gap >= 2
      if (isBlocking) blocking = true
    }
  }

  // ---------- Degree required (explicit only) ----------
  const edu = job.requirements?.education
  if (edu?.is_required) {
    const required = edu.degree_level_min
    const have = profile.education?.degree_level ?? "unknown"

    const order: Record<string, number> = {
      none: 0,
      associate: 1,
      bachelor: 2,
      master: 3,
      phd: 4,
      in_progress: 2,
      unknown: 99,
    }

    const requiredRank = order[required] ?? 99
    const haveRank = order[have] ?? 99

    if (have !== "unknown" && haveRank < requiredRank) {
      triggered.push("RISK_HARDREQ_DEGREE_MISSING")
      blocking = true
    }
  }

  // ---------- Certifications required (explicit only) ----------
  const certs = job.requirements?.certifications
  if (certs?.required?.length) {
    const haveCerts = new Set((profile.certifications ?? []).map((c) => (c || "").toLowerCase().trim()))
    const missing = certs.required.some((r) => !haveCerts.has((r || "").toLowerCase().trim()))
    if (missing) {
      triggered.push("RISK_HARDREQ_CERT_REQUIRED_MISSING")
      blocking = true
    }
  }

  // ---------- Work authorization restriction (explicit only) ----------
  const wa = job.requirements?.work_authorization
  if (wa?.is_specified) {
    const status = profile.work_authorization?.status ?? "unknown"
    const restriction = wa.restriction_type

    if (restriction === "requires_sponsorship_not_available" && status === "needs_sponsorship") {
      triggered.push("RISK_HARDREQ_VISA_RESTRICTED")
      blocking = true
    }

    if (restriction === "us_only") {
      if (status !== "unknown" && status !== "us_citizen" && status !== "permanent_resident") {
        triggered.push("RISK_HARDREQ_VISA_RESTRICTED")
        blocking = true
      }
    }
  }

  // ---------- Location hard requirement (explicit only) ----------
  const loc = job.requirements?.location
  if (loc?.is_hard_requirement) {
    const mode = loc.mode
    const remoteOk = profile.location_preferences?.remote_ok ?? false
    const onsiteOk = profile.location_preferences?.onsite_ok ?? true

    if (mode === "remote" && !remoteOk) {
      triggered.push("RISK_HARDREQ_LOCATION_REQUIRED_MISMATCH")
      blocking = true
    }
    if ((mode === "onsite" || mode === "hybrid") && !onsiteOk) {
      triggered.push("RISK_HARDREQ_LOCATION_REQUIRED_MISMATCH")
      blocking = true
    }
  }

  // ---------- GPA rule (explicit only) ----------
  let gpa_flag: GPAFlag = "None"
  const gpaReq = job.requirements?.gpa
  if (gpaReq?.is_required && gpaReq.minimum != null) {
    const gpa = profile.education?.gpa ?? null

    if (gpa == null) {
      gpa_flag = "Missing"
      // Not blocking
    } else if (gpa < gpaReq.minimum) {
      gpa_flag = "Below_Min"
      triggered.push("FLAG_GPA_REQUIRED_BELOW_MIN")
      blocking = true
    }
  }

  return {
    hard_fail: blocking,
    hard_fail_reasons: triggered,
    gpa_flag,
  }
}
