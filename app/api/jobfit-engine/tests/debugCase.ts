// tests/debugCase.ts
import { PROFILES, JOBS } from "./fixtures"
import cases from "./regressionCases.json"

import { evaluateJobFitV1 } from "../src/evaluateJobFitV1"
import { computeExposure } from "../src/exposure"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

// Shows the exact file Node/tsx is importing
console.log("RESOLVED hardGates:", require.resolve("../src/hardGates"))

const caseId = process.argv[2]
if (!caseId) {
  console.log("Usage: npx tsx tests/debugCase.ts C02")
  process.exit(1)
}

const c = (cases as any[]).find((x) => x.case_id === caseId)
if (!c) {
  console.log("Case not found:", caseId)
  process.exit(1)
}

const profile = (PROFILES as any)[c.profile_id]
const job = (JOBS as any)[c.job_id]

console.log("--------------------------------------------------")
console.log(`CASE: ${c.case_id} (${c.profile_id} x ${c.job_id})`)
console.log("--------------------------------------------------\n")

console.log("EXPECTED:")
console.log({
  decision: c.expected_decision,
  alignment: c.expected_alignment,
  exposure: c.expected_exposure,
  structural_risks: c.expected_structural_risk_codes ?? [],
  tier2_count: c.expected_tier2_risk_count,
  hard_gate: c.expected_hard_gate_triggered,
  gpa_flag: c.expected_gpa_flag,
})

console.log("\nJOB responsibility_clusters:")
console.log(job?.responsibility_clusters ?? [])

console.log("\nJOB required tools:")
console.log(job?.skills_tools?.tools_required ?? [])

console.log("\nPROFILE exposure clusters:")
console.log("executed:", profile?.exposure_clusters?.executed ?? [])
console.log("adjacent:", profile?.exposure_clusters?.adjacent ?? [])
console.log("theoretical:", profile?.exposure_clusters?.theoretical ?? [])

console.log("\nPROFILE tools:")
console.log(profile?.skills_tools?.tools ?? [])

console.log("\n---- RUNNING ENGINE ----\n")
const out = evaluateJobFitV1("v1.0", job, profile)

console.log("ENGINE OUTPUT:")
console.log({
  decision: out.decision,
  score: out.score,
  alignment: out.debug.alignment,
  exposure: out.debug.exposure,
  otherwise_qualified: out.debug.otherwise_qualified,
})

console.log("\nHARD GATES:")
console.log(out.debug.gates)

console.log("\nFLAGS:")
console.log(out.flags)

console.log("\nRISKS:")
console.log(out.risks.map((r) => ({ level: r.risk_level, code: r.code })))

console.log("\n---- EXPOSURE DIRECT TEST ----")
console.log(computeExposure(job, profile))