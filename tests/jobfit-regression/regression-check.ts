#!/usr/bin/env tsx
// tests/jobfit-regression/regression-check.ts
//
// Unified JobFit regression check. Runs:
//   - All 21 batch cases in issues/040926ProdIssues.csv
//   - All 5 one-off retest scripts (retest-013-ryan, retest-012-ryan,
//     retest-reece-01, retest-026, retest-emma-01)
//
// Compares each case's high-signal snapshot (decision, score, WHY/
// RISK counts, family, sub-families, gate type) against the committed
// baseline in `baseline.json` and exits non-zero on any unexplained
// change. Prints a clear diff table when drift is detected.
//
// USAGE:
//   npx tsx tests/jobfit-regression/regression-check.ts
//     Runs all cases and diffs against baseline.json. Exits 1 if any
//     snapshot differs. Exits 0 if clean.
//
//   npx tsx tests/jobfit-regression/regression-check.ts --update-baseline
//     Runs all cases and WRITES the results as the new baseline.json.
//     Use this after an intentional change that you have verified is
//     a true improvement / correction, not a regression.
//
//   npx tsx tests/jobfit-regression/regression-check.ts --verbose
//     Also prints the full snapshot table for every case, not just
//     the diffs. Useful for spot-checking.
//
// HOW TO UPDATE THE BASELINE
//   1. Make your change to the scoring engine.
//   2. Run `npx tsx tests/jobfit-regression/regression-check.ts`.
//   3. Review every diff line. Each one should be either:
//      (a) an intended improvement (write it down), or
//      (b) a regression that needs another fix before committing.
//   4. Once all diffs are intended improvements, run with
//      `--update-baseline` to snapshot the new state.
//   5. Commit baseline.json alongside the scoring code change.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"
import { runBatch } from "./run-csv-in-process"
import {
  type CaseSnapshot,
  toSnapshot,
  diffSnapshots,
  formatSnapshot,
} from "./lib/snapshot"

// Import test case constants from each retest script.
import { CASE as ryan013 } from "./retest-013-ryan"
import { CASE as ryan012 } from "./retest-012-ryan"
import { CASE as reece01 } from "./retest-reece-01"
import { CASE as case026 } from "./retest-026"
import { CASE as emma01 } from "./retest-emma-01"

const RETEST_CASES = [ryan013, ryan012, reece01, case026, emma01]
const BASELINE_PATH = join(__dirname, "baseline.json")
const BATCH_CSV_PATH = join(
  __dirname,
  "..",
  "..",
  "issues",
  "040926ProdIssues.csv"
)
const SYNTHETIC_CSV_PATH = join(
  __dirname,
  "fixtures",
  "synthetic-cases-4102026.csv"
)

// Run one of the inline retest cases through runJobFit and return a snapshot.
async function runRetestCase(c: typeof RETEST_CASES[number]): Promise<CaseSnapshot> {
  // Same tolerant-parse pattern as run-csv-in-process for concatenated arrays.
  let profileArray: any
  try {
    profileArray = JSON.parse(c.profileJson)
  } catch {
    let depth = 0, end = -1
    for (let k = 0; k < c.profileJson.length; k++) {
      const ch = c.profileJson[k]
      if (ch === "[") depth++
      else if (ch === "]") { depth--; if (depth === 0) { end = k; break } }
    }
    profileArray = JSON.parse(c.profileJson.slice(0, end + 1))
  }

  const p = Array.isArray(profileArray) ? profileArray[0] : profileArray
  const profileText = (String(p.profile_text || "").trim() + "\n\nResume:\n" + String(p.resume_text || "").trim()).trim()

  const profileOverrides = mapClientProfileToOverrides({
    profileText,
    profileStructured: typeof p.profile_structured === "string" ? JSON.parse(p.profile_structured || "null") : p.profile_structured,
    targetRoles: p.target_roles || null,
    preferredLocations: p.preferred_locations || p.target_locations || null,
  })

  const result: any = await runJobFit({
    profileText,
    jobText: c.jobText,
    profileOverrides,
    userJobTitle: c.userJobTitle,
    userCompanyName: c.userCompanyName,
  } as any)

  return toSnapshot(c.id, c.label, result)
}

// Build the live snapshot map from all 26 cases.
async function collectLiveSnapshots(): Promise<Record<string, CaseSnapshot>> {
  const out: Record<string, CaseSnapshot> = {}

  // Batch cases from the production issues CSV.
  const batch = await runBatch(BATCH_CSV_PATH, { verbose: false })
  for (const b of batch) {
    const id = `batch-${b.caseNo}`
    out[id] = toSnapshot(id, b.label, b.result)
  }

  // Synthetic cases from the generated CSV.
  if (existsSync(SYNTHETIC_CSV_PATH)) {
    const synthetic = await runBatch(SYNTHETIC_CSV_PATH, { verbose: false })
    for (const s of synthetic) {
      const id = `synthetic-${s.caseNo}`
      out[id] = toSnapshot(id, `[synthetic] ${s.label}`, s.result)
    }
  }

  // One-off retest cases.
  for (const c of RETEST_CASES) {
    out[c.id] = await runRetestCase(c)
  }

  return out
}

function readBaseline(): Record<string, CaseSnapshot> | null {
  if (!existsSync(BASELINE_PATH)) return null
  const raw = readFileSync(BASELINE_PATH, "utf8")
  try {
    return JSON.parse(raw) as Record<string, CaseSnapshot>
  } catch (e) {
    console.error("Failed to parse baseline.json:", (e as Error).message)
    return null
  }
}

function writeBaseline(snapshots: Record<string, CaseSnapshot>) {
  // Sort keys for stable diffs.
  const sorted: Record<string, CaseSnapshot> = {}
  for (const k of Object.keys(snapshots).sort()) sorted[k] = snapshots[k]
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8")
}

async function main() {
  const args = process.argv.slice(2)
  const updateBaseline = args.includes("--update-baseline")
  const verbose = args.includes("--verbose") || args.includes("-v")

  console.log("Running jobfit regression check...")
  const t0 = Date.now()
  const live = await collectLiveSnapshots()
  const ms = Date.now() - t0
  console.log(`Ran ${Object.keys(live).length} cases in ${(ms / 1000).toFixed(1)}s\n`)

  if (updateBaseline) {
    writeBaseline(live)
    console.log(`✓ Wrote baseline to ${BASELINE_PATH}`)
    console.log(`  ${Object.keys(live).length} case snapshots captured.`)
    console.log(`  Remember to commit baseline.json.`)
    return
  }

  const baseline = readBaseline()
  if (!baseline) {
    console.error(
      `\n✗ No baseline found at ${BASELINE_PATH}.\n` +
        `Run with --update-baseline to create one after verifying the current\n` +
        `results are correct.`
    )
    process.exit(2)
  }

  // Identify missing / new cases so we notice when the case set changes.
  const baselineIds = new Set(Object.keys(baseline))
  const liveIds = new Set(Object.keys(live))
  const newCases = [...liveIds].filter((id) => !baselineIds.has(id))
  const missingCases = [...baselineIds].filter((id) => !liveIds.has(id))

  // Diff each case that exists in both.
  const allDiffs: Array<{
    id: string
    label: string
    diffs: ReturnType<typeof diffSnapshots>
  }> = []
  for (const id of Object.keys(live)) {
    if (!baseline[id]) continue
    const d = diffSnapshots(baseline[id], live[id])
    if (d.length > 0) {
      allDiffs.push({ id, label: live[id].label, diffs: d })
    }
  }

  if (verbose) {
    console.log("=== All case snapshots ===")
    for (const id of Object.keys(live).sort()) {
      console.log("  " + formatSnapshot(live[id]))
    }
    console.log("")
  }

  let hasDrift = false

  if (newCases.length > 0) {
    console.log("⚠ New cases not in baseline:")
    for (const id of newCases) console.log("  + " + id + " — " + live[id].label)
    console.log("  (run with --update-baseline to include them)\n")
    hasDrift = true
  }

  if (missingCases.length > 0) {
    console.log("⚠ Baseline cases missing from live run:")
    for (const id of missingCases) console.log("  - " + id + " — " + baseline[id].label)
    console.log("")
    hasDrift = true
  }

  if (allDiffs.length === 0 && newCases.length === 0 && missingCases.length === 0) {
    console.log(`✓ All ${Object.keys(live).length} cases match baseline. No drift.`)
    return
  }

  if (allDiffs.length > 0) {
    console.log(`✗ ${allDiffs.length} case(s) drifted from baseline:\n`)
    for (const { id, label, diffs } of allDiffs) {
      console.log(`  ${id} — ${label}`)
      for (const d of diffs) {
        console.log(`    ${d.field}: ${JSON.stringify(d.baseline)} → ${JSON.stringify(d.live)}`)
      }
      console.log("")
    }
    hasDrift = true
  }

  if (hasDrift) {
    console.log("Next steps:")
    console.log("  - If these changes are INTENDED (a fix or improvement),")
    console.log("    review each diff manually, then run:")
    console.log("      npx tsx tests/jobfit-regression/regression-check.ts --update-baseline")
    console.log("  - If any change is UNINTENDED, fix the regression before committing.")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Fatal error in regression-check:", e)
  process.exit(2)
})
