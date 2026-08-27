#!/usr/bin/env tsx
// tests/jobfit-regression/regression-check.ts
//
// Unified JobFit regression check. Runs:
//   - All 21 batch cases in issues/040926ProdIssues.csv
//   - 41 synthetic cases in fixtures/synthetic-cases-4102026.csv
//   - All 6 one-off retest scripts (retest-013-ryan, retest-012-ryan,
//     retest-reece-01, retest-026, retest-emma-01, retest-zoe-paralegal)
//
// Captures a v2 STRUCTURED snapshot per case (decision, score, gate, the full
// requirement/profile units, the full match set, all WHY/RISK codes, the
// programmatic scalar manifest, and score_breakdown — see lib/snapshot.ts) and
// runs a TIERED tolerant diff against `baseline.json`:
//   HARD changes (decision, gate, per-match match_strength, WHY/RISK code-set,
//     scalar manifest, match/unit set, any unclassified path) FAIL (exit 1).
//   SOFT changes (score, weight, coverageScore, breakdown points) are reported
//     within tolerance bands and DO NOT fail the run (exit 0).
// A schema_version mismatch is refused with a re-baseline instruction (exit 2).
//
// LOCAL-ONLY SOURCES / CI MODE: the 21 batch cases
// (issues/040926ProdIssues.csv) and the 628-case prod corpus
// (prod-corpus.local.json) are LOCAL-ONLY / gitignored (real candidate PII).
// A dev machine has them and runs all 68 core + 628 prod cases.
//
//   CI unset  — an absent source is a HARD failure: its baseline entries show
//               up as missing and the run exits 1. This is deliberate. Locally,
//               a source that vanished means a broken checkout, not a pass.
//
//   CI=true   — an absent source is reported as SKIPPED with a case count and
//               its baseline entries are excluded from the comparison. Only
//               sources on LOCAL_ONLY_SOURCES may be skipped this way; a
//               committed source that fails to produce cases is still HARD.
//
// The frozen semantic verdicts are NOT a skippable source: the subset reached
// by committed cases lives in the TRACKED semantic-verdicts.committed.json, so
// the synthetic + retest cases score identically with or without the local
// cache. See lib/semantic-cache.ts and extract-committed-verdicts.ts.
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
import { frozenSemanticOption, verdictSourceStatus } from "./lib/semantic-cache"
import {
  type CaseSnapshot,
  type SnapshotDiff,
  toSnapshot,
  diffSnapshots,
  formatSnapshot,
  formatDiff,
} from "./lib/snapshot"

const SCHEMA_VERSION = 2

// Import test case constants from each retest script.
import { CASE as ryan013 } from "./retest-013-ryan"
import { CASE as ryan012 } from "./retest-012-ryan"
import { CASE as reece01 } from "./retest-reece-01"
import { CASE as case026 } from "./retest-026"
import { CASE as emma01 } from "./retest-emma-01"
import { CASE as zoeParalegal } from "./retest-zoe-paralegal"

const RETEST_CASES = [ryan013, ryan012, reece01, case026, emma01, zoeParalegal]
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
// 4th source — real prod (resume, JD) pairs. Inputs are LOCAL-ONLY/gitignored
// (PII); only the outputs-only baseline-prod.json is committed. Absent fixture
// => prod suite skipped entirely (clean checkout stays the fast 68-case gate).
const PROD_FIXTURE_PATH = join(__dirname, "prod-corpus.local.json")
const PROD_BASELINE_PATH = join(__dirname, "baseline-prod.json")

// ── CI mode ──────────────────────────────────────────────────────────────────
// Exactly `CI === "true"`, not merely "CI is set to something", so a stray
// CI=0 / CI=false in a local shell cannot silently soften the gate.
const IS_CI = process.env.CI === "true"

// The only sources whose absence CI is allowed to forgive, each paired with the
// baseline-id prefix its cases carry. Anything not listed here is committed and
// must produce its cases in every environment.
const LOCAL_ONLY_SOURCES: Array<{ name: string; path: string; idPrefix: string }> = [
  { name: "batch CSV (issues/040926ProdIssues.csv)", path: BATCH_CSV_PATH, idPrefix: "batch-" },
]

type SkippedSource = { name: string; idPrefix: string; baselineCases: number }

// 4 case sources overall: batch CSV, synthetic CSV, inline retests, prod corpus.
const TOTAL_SOURCES = 4

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
    semantic: frozenSemanticOption(),
    includeEngineTrace: true,
  } as any)

  return toSnapshot(c.id, c.label, result)
}

// Build the live snapshot map from all 26 cases.
export async function collectLiveSnapshots(): Promise<Record<string, CaseSnapshot>> {
  const out: Record<string, CaseSnapshot> = {}

  // Batch cases from the production issues CSV. Skip silently when the
  // file is missing — the synthetic CSV + retests still provide coverage.
  if (existsSync(BATCH_CSV_PATH)) {
    const batch = await runBatch(BATCH_CSV_PATH, { verbose: false })
    for (const b of batch) {
      const id = `batch-${b.caseNo}`
      out[id] = toSnapshot(id, b.label, b.result)
    }
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

// Prod corpus (4th source). Reads the local-only fixture, replays today's
// engine on each (resume, JD) pair, returns v2 snapshots keyed `prod-<id>`.
// Tracks errored/skipped rows for the run summary. Gated by the caller on
// existsSync(PROD_FIXTURE_PATH).
async function collectProdSnapshots(): Promise<{
  snapshots: Record<string, CaseSnapshot>
  errored: Array<{ id: string; reason: string }>
  skipped: Array<{ id: string; reason: string }>
}> {
  const out: Record<string, CaseSnapshot> = {}
  const errored: Array<{ id: string; reason: string }> = []
  const skipped: Array<{ id: string; reason: string }> = []
  const rows = JSON.parse(readFileSync(PROD_FIXTURE_PATH, "utf8")) as any[]
  const SEM = frozenSemanticOption()
  for (const row of rows) {
    const key = `prod-${row.id}`
    const profileText = String(row.profileText || "")
    const jobText = String(row.jobText || "")
    if (profileText.trim().length === 0) {
      skipped.push({ id: key, reason: "empty profileText" })
      continue
    }
    if (jobText.trim().length === 0) {
      skipped.push({ id: key, reason: "empty jobText" })
      continue
    }
    try {
      const result: any = await runJobFit({
        profileText,
        jobText,
        profileOverrides: row.profileOverrides ?? undefined,
        userJobTitle: row.userJobTitle || undefined,
        userCompanyName: row.userCompanyName || undefined,
        semantic: SEM,
        includeEngineTrace: true,
      } as any)
      out[key] = toSnapshot(key, String(row.label || key), result)
    } catch (e: any) {
      errored.push({ id: key, reason: e?.message || String(e) })
    }
  }
  console.log(
    `[prod-corpus] ${rows.length} rows → ${Object.keys(out).length} scored, ` +
      `${errored.length} errored, ${skipped.length} skipped`
  )
  return { snapshots: out, errored, skipped }
}

function readBaseline(path: string): Record<string, CaseSnapshot> | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, CaseSnapshot>
  } catch (e) {
    console.error(`Failed to parse ${path}:`, (e as Error).message)
    return null
  }
}

function writeBaseline(path: string, snapshots: Record<string, CaseSnapshot>) {
  // Sort keys for stable diffs.
  const sorted: Record<string, CaseSnapshot> = {}
  for (const k of Object.keys(snapshots).sort()) sorted[k] = snapshots[k]
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n", "utf8")
}

// Tiered structured diff + report for ONE suite. Prints a suite-prefixed
// report (HARD first, then SOFT). Returns true on a HARD failure (any hard
// diff / new / missing case). A schema_version skew exits 2 immediately.
function compareSuite(
  suiteName: string,
  live: Record<string, CaseSnapshot>,
  baselineRaw: Record<string, CaseSnapshot>,
  skipped: SkippedSource[] = []
): boolean {
  // CI only: drop the baseline entries belonging to an absent local-only
  // source so they are not reported as missing. Every other baseline entry is
  // still compared, so this narrows the case LIST without ever softening the
  // per-case diff for a case that did run.
  const baseline: Record<string, CaseSnapshot> = {}
  for (const [id, snap] of Object.entries(baselineRaw)) {
    if (skipped.some((sk) => id.startsWith(sk.idPrefix))) continue
    baseline[id] = snap
  }
  const versions = new Set(Object.values(baselineRaw).map((s: any) => s?.schema_version ?? 1))
  if (!(versions.size === 1 && versions.has(SCHEMA_VERSION))) {
    console.error(
      `\n✗ [${suiteName}] Baseline schema version mismatch.\n` +
        `  baseline: ${[...versions].join(", ")}   harness: ${SCHEMA_VERSION}\n` +
        `  Re-baseline after verifying current results: --update-baseline`
    )
    process.exit(2)
  }

  const baselineIds = new Set(Object.keys(baseline))
  const liveIds = new Set(Object.keys(live))
  const newCases = [...liveIds].filter((id) => !baselineIds.has(id))
  const missingCases = [...baselineIds].filter((id) => !liveIds.has(id))

  const perCase: Array<{ id: string; label: string; hard: SnapshotDiff[]; soft: SnapshotDiff[] }> = []
  for (const id of Object.keys(live)) {
    if (!baseline[id]) continue
    const d = diffSnapshots(baseline[id], live[id])
    if (d.length === 0) continue
    perCase.push({
      id,
      label: live[id].label,
      hard: d.filter((x) => x.tier === "hard"),
      soft: d.filter((x) => x.tier === "soft"),
    })
  }

  const hardCases = perCase.filter((c) => c.hard.length > 0)
  const softOnlyCases = perCase.filter((c) => c.hard.length === 0 && c.soft.length > 0)
  const hardFail = hardCases.length > 0 || newCases.length > 0 || missingCases.length > 0

  const skippedCases = skipped.reduce((n, sk) => n + sk.baselineCases, 0)
  console.log(
    `── suite: ${suiteName} (${liveIds.size} live, ${baselineIds.size} baseline` +
      (skippedCases > 0 ? `, ${skippedCases} skipped` : "") +
      `) ──`
  )
  for (const sk of skipped) {
    console.log(`  ○ skipped source: ${sk.name} — ${sk.baselineCases} baseline case(s) not run (CI=true)`)
  }
  if (newCases.length > 0) {
    console.log(`✗ [${suiteName}] New cases not in baseline (HARD):`)
    for (const id of newCases) console.log("  + " + id + " — " + live[id].label)
    console.log("  (run with --update-baseline to include them)\n")
  }
  if (missingCases.length > 0) {
    console.log(`✗ [${suiteName}] Baseline cases missing from live run (HARD):`)
    for (const id of missingCases) console.log("  - " + id + " — " + baseline[id].label)
    console.log("")
  }
  if (hardCases.length > 0) {
    console.log(`✗ [${suiteName}] ${hardCases.length} case(s) with HARD changes (fail):\n`)
    for (const { id, label, hard, soft } of hardCases) {
      console.log(`  ${id} — ${label}`)
      for (const d of hard) console.log(`    ${formatDiff(d)}`)
      for (const d of soft) console.log(`    ${formatDiff(d)}`)
      console.log("")
    }
  }
  if (softOnlyCases.length > 0) {
    console.log(`~ [${suiteName}] ${softOnlyCases.length} case(s) with SOFT drift only (informational):\n`)
    for (const { id, label, soft } of softOnlyCases) {
      console.log(`  ${id} — ${label}`)
      for (const d of soft) console.log(`    ${formatDiff(d)}`)
      console.log("")
    }
  }
  if (perCase.length === 0 && newCases.length === 0 && missingCases.length === 0) {
    console.log(`✓ [${suiteName}] All ${liveIds.size} cases match baseline. No drift.\n`)
  } else if (!hardFail) {
    console.log(`✓ [${suiteName}] No HARD changes. ${softOnlyCases.length} SOFT-only case(s) within tolerance.\n`)
  }
  return hardFail
}

async function main() {
  const args = process.argv.slice(2)
  const updateBaseline = args.includes("--update-baseline")
  const verbose = args.includes("--verbose") || args.includes("-v")

  console.log("Running jobfit regression check...")
  const t0 = Date.now()

  // Which local-only sources are absent? In CI these become SKIPPED; with CI
  // unset the list stays empty and their baseline cases fail as missing.
  const absentSources = LOCAL_ONLY_SOURCES.filter((src) => !existsSync(src.path))
  const coreSkipped: SkippedSource[] = []
  if (IS_CI && absentSources.length > 0) {
    const baselinePeek = readBaseline(BASELINE_PATH) ?? {}
    for (const src of absentSources) {
      coreSkipped.push({
        name: src.name,
        idPrefix: src.idPrefix,
        baselineCases: Object.keys(baselinePeek).filter((id) => id.startsWith(src.idPrefix)).length,
      })
    }
  } else if (!IS_CI && absentSources.length > 0) {
    console.log(
      `  ! ${absentSources.length} local-only source(s) absent and CI is not "true" — ` +
        `their baseline cases will fail as missing:`
    )
    for (const src of absentSources) console.log(`      ${src.name}`)
    console.log("")
  }

  const verdicts = verdictSourceStatus()
  console.log(
    `  semantic verdicts: ${verdicts.committed} committed` +
      (verdicts.local > 0 ? ` + ${verdicts.local} local` : " + 0 local (CI/clean checkout)")
  )

  // Core 68-case suite (always). Prod corpus (4th source) only when the
  // local-only fixture is present.
  const core = await collectLiveSnapshots()
  const prodExists = existsSync(PROD_FIXTURE_PATH)
  let prod: Record<string, CaseSnapshot> = {}
  if (prodExists) {
    const res = await collectProdSnapshots()
    prod = res.snapshots
    if (res.errored.length > 0) {
      console.log(`[prod-corpus] errored rows:`)
      for (const e of res.errored.slice(0, 20)) console.log(`  ✗ ${e.id}: ${e.reason}`)
      if (res.errored.length > 20) console.log(`  …and ${res.errored.length - 20} more`)
    }
    if (res.skipped.length > 0) {
      console.log(`[prod-corpus] skipped rows:`)
      for (const s of res.skipped.slice(0, 20)) console.log(`  - ${s.id}: ${s.reason}`)
      if (res.skipped.length > 20) console.log(`  …and ${res.skipped.length - 20} more`)
    }
  }
  const ms = Date.now() - t0
  const skippedSourceCount = coreSkipped.length + (prodExists ? 0 : 1)
  const skippedCaseCount = coreSkipped.reduce((n, sk) => n + sk.baselineCases, 0)
  console.log(
    `Ran ${Object.keys(core).length} core` +
      (prodExists ? ` + ${Object.keys(prod).length} prod` : "") +
      ` cases in ${(ms / 1000).toFixed(1)}s`
  )
  console.log(
    `Sources: ${TOTAL_SOURCES} total, ${skippedSourceCount} skipped` +
      (skippedCaseCount > 0 ? ` (${skippedCaseCount} core case(s) held back)` : "") +
      (IS_CI ? "  [CI mode]" : "") +
      "\n"
  )

  if (updateBaseline) {
    writeBaseline(BASELINE_PATH, core)
    console.log(`✓ Wrote core baseline to ${BASELINE_PATH} (${Object.keys(core).length} cases)`)
    if (prodExists) {
      writeBaseline(PROD_BASELINE_PATH, prod)
      console.log(`✓ Wrote prod baseline to ${PROD_BASELINE_PATH} (${Object.keys(prod).length} cases)`)
    } else {
      console.log(`  (prod corpus fixture absent — baseline-prod.json not written)`)
    }
    console.log(`  Remember to commit baseline.json${prodExists ? " + baseline-prod.json" : ""}.`)
    return
  }

  if (verbose) {
    console.log("=== core snapshots ===")
    for (const id of Object.keys(core).sort()) console.log("  " + formatSnapshot(core[id]))
    console.log("")
  }

  const coreBaseline = readBaseline(BASELINE_PATH)
  if (!coreBaseline) {
    console.error(
      `\n✗ No baseline found at ${BASELINE_PATH}.\n` +
        `Run with --update-baseline to create one after verifying current results.`
    )
    process.exit(2)
  }
  let hardFail = compareSuite("core", core, coreBaseline, coreSkipped)

  if (prodExists) {
    const prodBaseline = readBaseline(PROD_BASELINE_PATH)
    if (!prodBaseline) {
      console.error(
        `\n✗ Prod corpus fixture present but no baseline at ${PROD_BASELINE_PATH}.\n` +
          `Run with --update-baseline to create it.`
      )
      process.exit(2)
    }
    hardFail = compareSuite("prod", prod, prodBaseline) || hardFail
  } else {
    console.log("── suite: prod — fixture absent (prod-corpus.local.json) → skipped, 0 cases ──\n")
  }

  if (hardFail) {
    console.log("Next steps:")
    console.log("  - HARD changes need adjudication. If INTENDED, review then run --update-baseline.")
    console.log("  - If any HARD change is UNINTENDED, fix the regression before committing.")
    process.exit(1)
  }
  console.log("✓ All suites pass (no HARD changes).")
}

// Only auto-run when executed directly, so extract-committed-verdicts.ts can
// import collectLiveSnapshots and trace the exact cases CI runs. Filename-based
// for tsx/CJS interop, matching run-csv-in-process.ts.
const isMainEntryPoint = (process.argv[1] || "").replace(/\\/g, "/").endsWith("/regression-check.ts")
if (isMainEntryPoint) {
  main().catch((e) => {
    console.error("Fatal error in regression-check:", e)
    process.exit(2)
  })
}
