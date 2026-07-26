#!/usr/bin/env tsx
// Defect #3 step 1 — presence-based risk detectors. Fires on 01/04, controls
// (07/08/09) stay clean. Run:
//   npx tsx app/api/jobfit/riskDetectors.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyRequirements } from "./gateClassifier"
import { extractProfileEvidence } from "./profileEvidence"
import { detectPresenceRisks } from "./riskDetectors"

const DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")
function split(n: string) {
  const md = readFileSync(join(DIR, `case-${n}.input.md`), "utf8")
  const [before, jd] = md.split(/##\s*JOB\s+POSTING/i)
  return { profileText: before.split(/##\s*RESUME/i)[1] || before, jobText: jd || "" }
}
function risks(n: string): string[] {
  const { profileText, jobText } = split(n)
  return detectPresenceRisks({
    jobText, profileText,
    candidates: classifyRequirements(jobText),
    evidence: extractProfileEvidence(profileText),
  }).map((r) => `${r.code}:${r.severity}`)
}

let pass = 0, fail = 0
function eq(name: string, got: string[], want: string[]) {
  const g = [...got].sort(), w = [...want].sort()
  const ok = JSON.stringify(g) === JSON.stringify(w)
  ok ? pass++ : fail++
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`}`)
}

for (const n of ["01", "02", "04", "07", "08", "09"]) console.log(`${n}: ${JSON.stringify(risks(n))}`)
console.log("")

// 01 Jordan — 3 HIGH presence gaps, no stale
eq("01 Jordan", risks("01"), ["RISK_DOMAIN_GAP:high", "RISK_CRM_ABSENT:high", "RISK_REVENUE_METRICS_ABSENT:high"])
// 02 Priya — required credential absent (clearance/degree/citizenship)
eq("02 Priya hard_credential_absent", risks("02"), ["RISK_HARD_CREDENTIAL_ABSENT:high"])
// 04 Dana — stale skill only
eq("04 Dana", risks("04"), ["RISK_STALE_SKILL:medium"])
// 08 Omar — preferred PyTorch missing (LOW, non-blocking)
eq("08 Omar preferred_item_missing (LOW)", risks("08"), ["RISK_PREFERRED_ITEM_MISSING:low"])
// controls — clean (no credential/preferred demands they miss)
eq("07 Reyna clean", risks("07"), [])
eq("09 Alex clean", risks("09"), [])

console.log(`\n${pass}/${pass + fail} step-1 assertions passed`)
process.exit(fail > 0 ? 1 : 0)
