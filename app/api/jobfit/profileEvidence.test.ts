#!/usr/bin/env tsx
// Tests for the resume -> ProfileEvidence extractor (defect #1, step 3).
// Prints the evidence each of the 8 synthetic résumés produces + asserts the
// load-bearing facts. No classifier, no core, no wiring. Run:
//   npx tsx app/api/jobfit/profileEvidence.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractProfileEvidence } from "./profileEvidence"
import type { ProfileEvidence } from "./gateLedger"

const CASES_DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")

function resume(caseNo: string): string {
  const txt = readFileSync(join(CASES_DIR, `case-${caseNo}.input.md`), "utf8")
  const beforeJd = txt.split(/##\s*JOB\s+POSTING/i)[0]
  return beforeJd.split(/##\s*RESUME/i)[1] || beforeJd
}

const NAMES: Record<string, string> = {
  "01": "Jordan", "02": "Priya", "03": "Marcus", "04": "Dana",
  "05": "Tyler", "06": "Sofia", "07": "Reyna", "08": "Omar",
}

const ev: Record<string, ProfileEvidence> = {}
for (const n of Object.keys(NAMES)) ev[n] = extractProfileEvidence(resume(n))

// ── evidence table ───────────────────────────────────────────────────────────
console.log("── ProfileEvidence per résumé ──\n")
for (const n of Object.keys(NAMES)) {
  const e = ev[n]
  console.log(`${n} ${NAMES[n]}`)
  console.log(`   totalYears=${e.totalYears}  domainYears=${JSON.stringify(e.domainYears)}  mgrOfMgrs=${e.managerOfManagersYears}`)
  console.log(`   tools[EXPERIENCE]=${JSON.stringify(e.toolsInExperience)}`)
  console.log(`   tools[SKILLS-only]=${JSON.stringify(e.toolsInSkillsOnly)}`)
  console.log(`   degreeHeld=${e.degreeHeld}  clearances=${JSON.stringify(e.clearancesHeld)}  citizenship=${e.citizenshipStated}  waiver=${e.waiverOnFile}  licenses=${JSON.stringify(e.licensesHeld)}`)
  if (Object.keys(e.skillRecency).length) console.log(`   skillRecency=${JSON.stringify(e.skillRecency)}`)
  console.log("")
}

// ── assertions ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0
function ok(name: string, cond: boolean) {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✓" : "✗"} ${name}`)
}

// The two the reviewer explicitly wants to see BEFORE wiring:
ok("Jordan reads 0 years B2B SaaS (domainYears has no b2b_saas)", ev["01"].domainYears.b2b_saas === undefined)
ok("Tyler reads the 4 required tools in SKILLS-only, none in EXPERIENCE",
  ["snowflake", "dbt", "airflow", "spark"].every((t) => ev["05"].toolsInSkillsOnly.includes(t)) &&
  ["snowflake", "dbt", "airflow", "spark"].every((t) => !ev["05"].toolsInExperience.includes(t)))

// symmetric evidence (Guard 4): Reyna's tools ARE credited from EXPERIENCE
ok("Reyna reads dbt/hubspot/salesforce in EXPERIENCE",
  ["dbt", "hubspot", "salesforce"].every((t) => ev["07"].toolsInExperience.includes(t)))
ok("Reyna reads >=3 years B2B SaaS", (ev["07"].domainYears.b2b_saas ?? 0) >= 3)

// credentials (02 Priya)
ok("Priya degreeHeld=false ('No degree')", ev["02"].degreeHeld === false)
ok("Priya no clearance held", ev["02"].clearancesHeld.length === 0)
ok("Priya citizenship silent -> null", ev["02"].citizenshipStated === null)
ok("Priya no waiver on file", ev["02"].waiverOnFile === false)

// recency (04 Dana)
ok("Dana angular version=5, lastUsedRoleIndex=1 (stale, older version)",
  ev["04"].skillRecency.angular?.version === 5 && ev["04"].skillRecency.angular?.lastUsedRoleIndex === 1)

// 03 Marcus seniority
ok("Marcus totalYears=2", ev["03"].totalYears === 2)
ok("Marcus managerOfManagersYears=0 (IC, not mgr-of-mgrs)", ev["03"].managerOfManagersYears === 0)

// 08 Omar
ok("Omar reads ab_testing in EXPERIENCE", ev["08"].toolsInExperience.includes("ab_testing"))
ok("Omar reads >=5 years ml_in_prod", (ev["08"].domainYears.ml_in_prod ?? 0) >= 5)

console.log(`\n${pass}/${pass + fail} evidence assertions passed`)
process.exit(fail > 0 ? 1 : 0)
