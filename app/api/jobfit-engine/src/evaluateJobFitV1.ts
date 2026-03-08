// src/evaluateJobFitV1.ts
import {
  Alignment,
  Decision,
  Exposure,
  FlagItem,
  JobFitResponseV1,
  JobSignalsV1,
  ProfileSignalsV1,
  RiskItem,
} from "./types"

import { runHardGates } from "./hardGates"
import { runExperienceMismatch } from "./experienceMismatch"
import { computeAlignment } from "./alignment"
import { computeExposure } from "./exposure"
import { generateRisks } from "./tiering"
import { matrixDecision } from "./matrix"
import { computeScore } from "./score"
import { buildWhyAndNextStep } from "./bullets"
import { generateFingerprint } from "./fingerprint"

const ENGINE_VERSION: "v1.0" = "v1.0"

export function evaluateJobFitV1(
  schema_version: "v1.0",
  job: JobSignalsV1,
  profile: ProfileSignalsV1,
  opts?: { force_exposure?: Exposure }
): JobFitResponseV1 {
  const flags: FlagItem[] = []
  const fingerprint = generateFingerprint(ENGINE_VERSION, job, profile)

  // Compute these ONCE and keep them for reporting even on PASS (hard gates).
  const a = computeAlignment(job, profile)
  const e0 = computeExposure(job, profile)
  const exposure: Exposure = opts?.force_exposure ?? e0.exposure

  // Step 1: Hard gates
  const hard = runHardGates(job, profile)

  if (hard.gpa_flag === "Missing") {
    flags.push({
      flag: "FLAG_GPA_REQUIRED_MISSING",
      severity: "WARNING",
      detail: "Job requires a minimum GPA, but profile GPA is missing.",
    })
  }

  const gpaBelowMin = hard.gpa_flag === "Below_Min"

  // If hard gate triggers → decision PASS, but DO NOT lie about alignment/exposure.
  if (hard.hard_fail || gpaBelowMin) {
    const decision: Decision = "PASS"

    const hardRisks: RiskItem[] = hard.hard_fail_reasons.map((code) => ({
      risk_level: "STRUCTURAL",
      code,
      label: "Hard requirement not met",
      evidence: "A required qualification is explicitly stated and not met.",
      mitigation: "Not addressable quickly. Only proceed if the requirement changes or you become qualified.",
    }))

    const built = buildWhyAndNextStep(job, profile, a.alignment, exposure, hardRisks, decision)

    return {
      engine_version: ENGINE_VERSION,
      job_id: job.job_id,
      profile_id: profile.profile_id,
      decision,
      score: computeScore(decision, 0),
      why: [], // optional: you can include built.why here, but keep stable for now
      risks: hardRisks,
      flags,
      next_step: built.next_step,
      debug: {
        fingerprint,
        gates: { hard_fail: true, hard_fail_reasons: hard.hard_fail_reasons },
        alignment: a.alignment,
        exposure,
        otherwise_qualified: false,
      },
    }
  }

  // Step 2: Structural experience mismatch module (separate from hard gates)
  const mismatch = runExperienceMismatch(job, profile)
  if (mismatch.mismatch) {
    const decision: Decision = "PASS"

    const mismatchRisks: RiskItem[] = mismatch.reason_codes.map((code) => ({
      risk_level: "STRUCTURAL",
      code,
      label: "Experience level mismatch",
      evidence: "The role’s seniority exceeds the profile stage.",
      mitigation: "Not addressable quickly. Target roles aligned to your current stage.",
    }))

    const built = buildWhyAndNextStep(job, profile, a.alignment, exposure, mismatchRisks, decision)

    return {
      engine_version: ENGINE_VERSION,
      job_id: job.job_id,
      profile_id: profile.profile_id,
      decision,
      score: computeScore(decision, 0),
      why: [],
      risks: mismatchRisks,
      flags,
      next_step: built.next_step,
      debug: {
        fingerprint,
        gates: { hard_fail: false, hard_fail_reasons: [] },
        alignment: a.alignment,
        exposure,
        otherwise_qualified: false,
      },
    }
  }

  // Step 3: Risks
  const tiering = generateRisks(job, profile, a.alignment, exposure)

  // Step 4: Matrix mapping
  const baseline = matrixDecision(a.alignment, exposure)

  // Priority Apply rule: only when Tier2 count is 0
  let decision: Decision = baseline
  if (decision === "PRIORITY_APPLY" && tiering.t2_count > 0) decision = "APPLY"

  // GPA missing forces REVIEW
  if (hard.gpa_flag === "Missing" && decision !== "PASS") decision = "REVIEW"

  // Structural risks cap to PASS (if you use that rule)
  if (tiering.has_structural) decision = "PASS"

  const score = computeScore(decision, tiering.t2_count)
  const built = buildWhyAndNextStep(job, profile, a.alignment, exposure, tiering.risks, decision)

  return {
    engine_version: ENGINE_VERSION,
    job_id: job.job_id,
    profile_id: profile.profile_id,
    decision,
    score,
    why: built.why,
    risks: tiering.risks,
    flags,
    next_step: built.next_step,
    debug: {
      fingerprint,
      gates: { hard_fail: false, hard_fail_reasons: [] },
      alignment: a.alignment,
      exposure,
      otherwise_qualified: true,
    },
  }
}