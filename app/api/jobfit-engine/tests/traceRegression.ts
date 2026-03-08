// tests/traceRegression.ts
import cases from "./regressionCases.json"
import { JOBS, PROFILES } from "./fixtures"

import { evaluateJobFitV1 } from "../src/evaluateJobFitV1"
import { computeAlignment } from "../src/alignment"
import { computeExposure } from "../src/exposure"
import { runHardGates } from "../src/hardGates"
import { runExperienceMismatch } from "../src/experienceMismatch"
import { generateRisks } from "../src/tiering"

// Env controls
const CASE_ID = (process.env.CASE_ID || "").trim() // e.g., "C03"
const ONLY_FAILS = (process.env.ONLY_FAILS || "") === "1"
const JSON_OUT = (process.env.JSON_OUT || "") === "1" // if 1, print JSON summary at end

type TraceItem = {
  case_id: string
  profile_id: string
  job_id: string
  mismatchReasons: string[]
  expected: any
  got: any
  inputs: any
  hard: any
  experienceMismatch: any
  alignmentDebug: any
  exposureDebug: any
  tieringDebug: any
}

function isCaseSelected(caseId: string): boolean {
  if (!CASE_ID) return true
  return caseId === CASE_ID
}

function main() {
  const failures: TraceItem[] = []
  const printed: number[] = []

  for (const c of cases as any[]) {
    if (!isCaseSelected(c.case_id)) continue

    const profile = (PROFILES as any)[c.profile_id]
    const job = (JOBS as any)[c.job_id]
    if (!profile || !job) continue

    const hard = runHardGates(job, profile)
    const mismatch = runExperienceMismatch(job, profile)
    const a = computeAlignment(job, profile)
    const e = computeExposure(job, profile)
    const tiering = generateRisks(job, profile, a.alignment, e.exposure)

    const out = evaluateJobFitV1("v1.0", job, profile)

    const gotStructural = out.risks.filter((r: any) => r.risk_level === "STRUCTURAL").map((r: any) => r.code)
    const gotT2 = out.risks.filter((r: any) => r.risk_level === "ADDRESSABLE_GAP").length

    const mismatchReasons: string[] = []
    if (out.debug.alignment !== c.expected_alignment) mismatchReasons.push("ALIGNMENT")
    if (out.debug.exposure !== c.expected_exposure) mismatchReasons.push("EXPOSURE")
    if (out.decision !== c.expected_decision) mismatchReasons.push("DECISION")
    if (gotT2 !== c.expected_tier2_risk_count) mismatchReasons.push("TIER2_COUNT")
    if (hard.hard_fail !== c.expected_hard_gate_triggered) mismatchReasons.push("HARD_GATE")

    const expectedStructural = c.expected_structural_risk_codes ?? []
    if (expectedStructural.length !== gotStructural.length) mismatchReasons.push("STRUCTURAL_COUNT")
    for (const code of expectedStructural) {
      if (!gotStructural.includes(code)) mismatchReasons.push(`STRUCTURAL_MISSING:${code}`)
    }

    const isFail = mismatchReasons.length > 0
    if (ONLY_FAILS && !isFail) continue

    const item: TraceItem = {
      case_id: c.case_id,
      profile_id: c.profile_id,
      job_id: c.job_id,
      mismatchReasons,
      expected: {
        decision: c.expected_decision,
        alignment: c.expected_alignment,
        exposure: c.expected_exposure,
        tier2_count: c.expected_tier2_risk_count,
        structural: expectedStructural,
        hard_gate: c.expected_hard_gate_triggered,
      },
      got: {
        decision: out.decision,
        alignment: out.debug.alignment,
        exposure: out.debug.exposure,
        tier2_count: gotT2,
        structural: gotStructural,
        hard_gate: hard.hard_fail,
      },
      inputs: {
        job_role_families: job.role?.role_families ?? [],
        profile_target_families: profile.targets?.role_families ?? [],
        job_clusters: job.responsibility_clusters ?? [],
        profile_exec: profile.exposure_clusters?.executed ?? [],
        profile_adj: profile.exposure_clusters?.adjacent ?? [],
        profile_theory: profile.exposure_clusters?.theoretical ?? [],
        job_required_tools: job.skills_tools?.tools_required ?? [],
        profile_tools: profile.skills_tools?.tools ?? [],
        job_exp: job.requirements?.experience ?? null,
        profile_years_relevant_est: profile.experience?.years_relevant_est ?? null,
      },
      hard,
      experienceMismatch: mismatch,
      alignmentDebug: a,
      exposureDebug: e,
      tieringDebug: {
        has_structural: tiering.has_structural,
        t2_count: tiering.t2_count,
        risks: tiering.risks.map((r: any) => ({ level: r.risk_level, code: r.code })),
      },
    }

    if (isFail) failures.push(item)

    // Print one clean, grep-friendly block per printed case
    const header = `TRACE_CASE ${c.case_id} (${c.profile_id} x ${c.job_id}) ${isFail ? "FAIL" : "PASS"}`
    console.log(header)
    if (isFail) {
      console.log("MISMATCH_REASONS", mismatchReasons.join(", "))
      console.log("EXPECTED", JSON.stringify(item.expected))
      console.log("GOT     ", JSON.stringify(item.got))
      console.log("INPUTS  ", JSON.stringify(item.inputs))
      console.log("ALIGNMENT_DEBUG", JSON.stringify(item.alignmentDebug))
      console.log("EXPOSURE_DEBUG ", JSON.stringify(item.exposureDebug))
      console.log("HARD_GATES     ", JSON.stringify(item.hard))
      console.log("EXP_MISMATCH   ", JSON.stringify(item.experienceMismatch))
      console.log("TIERING_DEBUG  ", JSON.stringify(item.tieringDebug))
    }
    console.log("----")

    printed.push(1)

    // If they set CASE_ID, stop after the first matching case (no accidental spam)
    if (CASE_ID) break
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ failures: failures.length, items: failures }, null, 2))
  } else {
    console.log(`TRACE_DONE printed=${printed.length} failures=${failures.length} (CASE_ID=${CASE_ID || "ALL"} ONLY_FAILS=${ONLY_FAILS ? "1" : "0"})`)
  }
}

main()