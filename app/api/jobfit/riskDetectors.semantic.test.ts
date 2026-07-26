#!/usr/bin/env tsx
// Defect #3 step 2 — semantic detectors (people_mgmt, scope_inversion),
// adjacency_inflation, and the seniority severity bump. Fires on 01/03,
// controls (07/08/09) clean. Run:
//   npx tsx app/api/jobfit/riskDetectors.semantic.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyRequirements } from "./gateClassifier"
import { extractProfileEvidence } from "./profileEvidence"
import { extractVerbEvidence } from "./verbEvidence"
import { detectSemanticRisks, bumpSeniorityIfExtreme } from "./riskDetectors"
import type { RiskCode } from "./signals"

const DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")
function split(n: string) {
  const md = readFileSync(join(DIR, `case-${n}.input.md`), "utf8")
  const [before, jd] = md.split(/##\s*JOB\s+POSTING/i)
  return { profileText: before.split(/##\s*RESUME/i)[1] || before, jobText: jd || "" }
}
function risks(n: string): string[] {
  const { profileText, jobText } = split(n)
  return detectSemanticRisks({
    jobText, profileText,
    candidates: classifyRequirements(jobText),
    evidence: extractProfileEvidence(profileText),
    verbBullets: extractVerbEvidence(profileText),
  }).map((r) => `${r.code}:${r.severity}`)
}

let pass = 0, fail = 0
function eq(name: string, got: string[], want: string[]) {
  const g = [...got].sort(), w = [...want].sort()
  const ok = JSON.stringify(g) === JSON.stringify(w)
  ok ? pass++ : fail++
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    got  ${JSON.stringify(g)}\n    want ${JSON.stringify(w)}`}`)
}

for (const n of ["01", "03", "07", "08", "09"]) console.log(`${n}: ${JSON.stringify(risks(n))}`)
console.log("")

// 01 Jordan — mgmt (duty→MEDIUM), scope, adjacency
eq("01 Jordan", risks("01"), ["RISK_PEOPLE_MGMT_ABSENT:medium", "RISK_SCOPE_INVERSION:medium", "RISK_ADJACENCY_INFLATION:medium"])
// 03 Marcus — mgmt (requirement→HIGH), scope; no adjacency
eq("03 Marcus", risks("03"), ["RISK_PEOPLE_MGMT_ABSENT:high", "RISK_SCOPE_INVERSION:medium"])
// controls — the case-09 edit MUST keep Alex clean of mgmt/scope
eq("07 Reyna clean", risks("07"), [])
eq("08 Omar clean", risks("08"), [])
eq("09 Alex clean (has 'Hired and manage one junior analyst' → mgmt/scope clear)", risks("09"), [])

// seniority bump — Marcus actually emits RISK_EXPERIENCE (also maps to seniority_gap)
const sen: RiskCode[] = [{ code: "RISK_EXPERIENCE", severity: "medium", job_fact: "", risk: "" }]
eq("extreme gap (10 vs 2) → HIGH",
  bumpSeniorityIfExtreme(sen, { yearsRequired: 10, yearsExperience: 2, jobText: "Senior role" }).map((r) => r.severity), ["high"])
eq("03 real path: yearsRequired null + Director + 2yr → HIGH (fallback)",
  bumpSeniorityIfExtreme(sen, { yearsRequired: null, yearsExperience: 2, jobText: "Director of Engineering; managing managers" }).map((r) => r.severity), ["high"])
eq("mild gap (5 vs 3), non-senior role → stays MEDIUM",
  bumpSeniorityIfExtreme(sen, { yearsRequired: 5, yearsExperience: 3, jobText: "Analyst role" }).map((r) => r.severity), ["medium"])

console.log(`\n${pass}/${pass + fail} step-2 assertions passed`)
process.exit(fail > 0 ? 1 : 0)
