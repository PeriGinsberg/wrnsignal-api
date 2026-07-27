#!/usr/bin/env tsx
// Local-only probe: decompose the strength drop on prod-7adf78ff
// (Data Analyst @ UnitedHealth), the one case whose decision flipped
// Review/74 -> Pass/55 after the DEF-005 JD segmentation fix.
//
// Hypothesis: the drop (analysis_reporting 6->4, operations_execution 10->8)
// comes from `hits` (phrase-count accumulation on a long line), NOT from the
// raw character-length bonuses in scoreJobLine, because both the pre-split and
// post-split lines are comfortably over the 30-char bonus threshold — so the
// +3 length term applies in both runs and cancels.
//
// Run once on HEAD (new splitter), once with extract.ts/scoring.ts checked out
// at 966c797f~1 (old splitter), and compare the snippets.

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"

const FIXTURE = join(__dirname, "prod-corpus.local.json")
const TARGET = "7adf78ff"
const KEYS = ["software_engineering"]

async function main() {
  if (!existsSync(FIXTURE)) {
    console.error("prod-corpus.local.json absent — cannot probe")
    process.exit(1)
  }
  const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as any[]
  const row = rows.find((r) => String(r.id || "").startsWith(TARGET))
  if (!row) {
    console.error(`row ${TARGET} not found in fixture`)
    process.exit(1)
  }

  const r: any = await runJobFit({
    profileText: String(row.profileText || ""),
    jobText: String(row.jobText || ""),
    profileOverrides: row.profileOverrides ?? undefined,
    userJobTitle: row.userJobTitle || undefined,
    userCompanyName: row.userCompanyName || undefined,
  } as any)

  console.log(`\n=== prod-${row.id} — ${row.label || ""} ===`)
  console.log(`decision: ${r.decision} | score: ${r.score} | raw: ${r.score_breakdown.raw_score}`)

  const units = (r.job_signals.requirement_units || []).filter((u: any) => KEYS.includes(u.key))
  for (const u of units) {
    const snip = String(u.snippet || "")
    console.log(
      `\n  key=${u.key} strength=${u.strength} requiredness=${u.requiredness} kind=${u.kind}`
    )
    console.log(`  snippet len=${snip.length}  (>=30 char bonus applies: ${snip.length >= 30})`)
    console.log(`  snippet: ${snip.slice(0, 240)}${snip.length > 240 ? " …" : ""}`)
  }

  // Top-3 missing-proof gap ordering is what converts a strength wobble into a
  // user-visible severity change (scoring.ts:566 sort, :572 slice, :588 severity).
  const mp = (r.risk_codes || []).filter((x: any) => x.code === "RISK_MISSING_PROOF")
  console.log(`\n  RISK_MISSING_PROOF (${mp.length}):`)
  for (const x of mp) console.log(`    ${x.severity.padEnd(6)} ${x.job_fact}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
