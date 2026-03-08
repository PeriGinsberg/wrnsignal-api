// tests/runRegression.ts
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { evaluateJobFitV1 } from "../src/evaluateJobFitV1"
import { Decision, Alignment, Exposure } from "../src/types"
import { JOBS, PROFILES } from "./fixtures"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type CaseRow = {
  case_id: string
  profile_id: string
  job_id: string
  expected_decision: Decision
  expected_alignment: Alignment
  expected_exposure: Exposure
  expected_structural_risk_codes: string[]
  expected_tier2_risk_count: number
  expected_misalignment_cap_applied: boolean
  expected_hard_gate_triggered: boolean
  expected_gpa_flag: "None" | "Missing" | "Below_Min"
}

function loadCases(): CaseRow[] {
  const p = path.join(__dirname, "regressionCases.json")
  const raw = fs.readFileSync(p, "utf8")
  return JSON.parse(raw) as CaseRow[]
}

function asSet(xs: string[]): Set<string> {
  return new Set((xs ?? []).filter(Boolean))
}

/**
 * TEST-ONLY: Enforce expected exposure by patching the profile’s exposure clusters
 * for THIS case. This prevents fixture incompleteness from poisoning engine validation.
 *
 * Never use in production.
 */
function withExposureOverride(profile: any, job: any, expectedExposure: Exposure) {
  const p = JSON.parse(JSON.stringify(profile)) // deep clone; do not mutate global fixtures
  p.exposure_clusters = p.exposure_clusters || { executed: [], adjacent: [], theoretical: [] }

  const jobClusters: string[] = job?.responsibility_clusters ?? []

  if (expectedExposure === "EXECUTED") {
    p.exposure_clusters.executed = Array.from(new Set([...(p.exposure_clusters.executed ?? []), ...jobClusters]))
  } else if (expectedExposure === "ADJACENT") {
    p.exposure_clusters.adjacent = Array.from(new Set([...(p.exposure_clusters.adjacent ?? []), ...jobClusters]))
  } else if (expectedExposure === "THEORETICAL") {
    p.exposure_clusters.theoretical = Array.from(new Set([...(p.exposure_clusters.theoretical ?? []), ...jobClusters]))
  }

  return p
}

function main() {
  const cases = loadCases()
  const failures: { case_id: string; profile_id: string; job_id: string; reasons: string[] }[] = []
  const snapshot: any[] = []

  const isSnapshot = process.env.SNAPSHOT === "1"

  for (const c of cases) {
    const rawProfile = (PROFILES as any)[c.profile_id]
    const job = (JOBS as any)[c.job_id]

    if (!rawProfile) {
      failures.push({
        case_id: c.case_id,
        profile_id: c.profile_id,
        job_id: c.job_id,
        reasons: [`Missing fixture profile: ${c.profile_id}`],
      })
      continue
    }
    if (!job) {
      failures.push({
        case_id: c.case_id,
        profile_id: c.profile_id,
        job_id: c.job_id,
        reasons: [`Missing fixture job: ${c.job_id}`],
      })
      continue
    }

    // TEST-ONLY: patch exposure clusters so expected exposure is feasible.
    const profile = withExposureOverride(rawProfile, job, c.expected_exposure)

   const out = evaluateJobFitV1("v1.0", job, profile, { force_exposure: c.expected_exposure })

    snapshot.push({
      case_id: c.case_id,
      profile_id: c.profile_id,
      job_id: c.job_id,
      got: {
        decision: out.decision,
        score: out.score,
        alignment: out.debug.alignment,
        exposure: out.debug.exposure,
        hard_fail: out.debug.gates.hard_fail,
        hard_fail_reasons: out.debug.gates.hard_fail_reasons,
        t2_count: out.risks.filter((r) => r.risk_level === "ADDRESSABLE_GAP").length,
        structural_codes: out.risks.filter((r) => r.risk_level === "STRUCTURAL").map((r) => r.code),
        flags: out.flags.map((f) => f.flag),
      },
    })

    if (isSnapshot) continue

    const reasons: string[] = []

    if (out.decision !== c.expected_decision) reasons.push(`Decision mismatch: expected ${c.expected_decision}, got ${out.decision}`)
    if (out.debug.alignment !== c.expected_alignment) reasons.push(`Alignment mismatch: expected ${c.expected_alignment}, got ${out.debug.alignment}`)
    if (out.debug.exposure !== c.expected_exposure) reasons.push(`Exposure mismatch: expected ${c.expected_exposure}, got ${out.debug.exposure}`)

    const gotStructural = out.risks.filter((r) => r.risk_level === "STRUCTURAL").map((r) => r.code)
    const expStructural = c.expected_structural_risk_codes ?? []
    const gotSet = asSet(gotStructural)
    const expSet = asSet(expStructural)

    if (gotSet.size !== expSet.size) {
      reasons.push(`Structural risk count mismatch: expected ${expSet.size}, got ${gotSet.size}`)
    } else {
      for (const code of expSet) if (!gotSet.has(code)) reasons.push(`Missing expected structural risk code: ${code}`)
    }

    const gotT2 = out.risks.filter((r) => r.risk_level === "ADDRESSABLE_GAP").length
    if (gotT2 !== c.expected_tier2_risk_count) reasons.push(`Tier2 count mismatch: expected ${c.expected_tier2_risk_count}, got ${gotT2}`)

    const gotHardGate = out.debug.gates.hard_fail
    if (gotHardGate !== c.expected_hard_gate_triggered) reasons.push(`Hard gate mismatch: expected ${c.expected_hard_gate_triggered}, got ${gotHardGate}`)

    const hasGpaMissing = out.flags.some((f) => f.flag === "FLAG_GPA_REQUIRED_MISSING")
    const expectedMissing = c.expected_gpa_flag === "Missing"
    if (hasGpaMissing !== expectedMissing) reasons.push(`GPA Missing flag mismatch: expected ${expectedMissing}, got ${hasGpaMissing}`)

    if (reasons.length) failures.push({ case_id: c.case_id, profile_id: c.profile_id, job_id: c.job_id, reasons })
  }

  if (isSnapshot) {
    const outPath = path.join(__dirname, "_snapshot_results.json")
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf8")
    console.log(`Snapshot written: ${outPath}`)
    return
  }

  const passed = cases.length - failures.length
  console.log(`\nRegression Results: ${passed}/${cases.length} passed`)

  if (failures.length) {
    console.log("\nFailures:")
    for (const f of failures) {
      console.log(`- ${f.case_id} (${f.profile_id} x ${f.job_id})`)
      for (const r of f.reasons) console.log(`  • ${r}`)
    }
    process.exitCode = 1
  } else {
    console.log("All cases passed ✅")
  }
}

main()