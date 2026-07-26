#!/usr/bin/env tsx
// End-to-end: classifier (JD) + extractor (résumé) -> deterministic core.
// Defect #1, step 4. Asserts the §5 per-case gate STATUSES + the verdict cap,
// and the real-corpus gate counts (5 real -> 0, Merrill -> 1). Run:
//   npx tsx app/api/jobfit/gateLedger.e2e.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyRequirements } from "./gateClassifier"
import { extractProfileEvidence } from "./profileEvidence"
import { buildGateLedger, applyLedgerCap } from "./gateLedger"

const CASES_DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")
function caseFile(n: string) {
  return readFileSync(join(CASES_DIR, `case-${n}.input.md`), "utf8")
}
function splitCase(n: string) {
  const txt = caseFile(n)
  const [before, jd] = txt.split(/##\s*JOB\s+POSTING/i)
  const résuméPart = before.split(/##\s*RESUME/i)[1] || before
  return { resume: résuméPart, jd: jd || "" }
}

const NAMES: Record<string, string> = {
  "01": "Jordan/Threadline", "02": "Priya/Meridian", "03": "Marcus/Vantail", "04": "Dana/Corvel",
  "05": "Tyler/Highfield", "06": "Sofia/Nimbus", "07": "Reyna/Threadline", "08": "Omar/Fernwood",
}

// §5 target statuses + the verdict a starting "Apply" is capped to.
const EXPECT: Record<string, { verdict: string; gates: Record<string, string> }> = {
  "01": { verdict: "Pass", gates: { b2b_saas_3yr: "UNMET", dbt_handson: "UNMET", crm_pipeline: "UNMET" } },
  "02": { verdict: "Pass", gates: { ts_sci_clearance: "UNMET", degree_or_waiver: "UNMET", us_citizenship: "UNKNOWN" } },
  "03": { verdict: "Pass", gates: { yoe_10: "UNMET", manager_of_managers_5yr: "UNMET" } },
  "04": { verdict: "Pass", gates: { recent_angular_v14_3yr: "UNMET" } },
  "05": { verdict: "Pass", gates: { snowflake_handson: "UNMET", dbt_handson: "UNMET", airflow_handson: "UNMET", spark_handson: "UNMET" } },
  "06": { verdict: "Apply", gates: { yoe_5: "MET" } },
  "07": { verdict: "Apply", gates: { b2b_saas_3yr: "MET", dbt_handson: "MET", crm_pipeline: "MET" } },
  "08": { verdict: "Apply", gates: { ml_in_prod_5yr: "MET", experimentation_ab_testing: "MET" } },
}

let pass = 0, fail = 0
function ok(name: string, cond: boolean) {
  if (cond) pass++
  else fail++
  if (!cond) console.log(`   ✗ ${name}`)
}

console.log("── synthetic end-to-end (gate → status; cap of a starting 'Apply') ──\n")
for (const n of Object.keys(NAMES)) {
  const { resume, jd } = splitCase(n)
  const candidates = classifyRequirements(jd)
  const evidence = extractProfileEvidence(resume)
  const ledger = buildGateLedger(candidates, evidence)
  const verdict = applyLedgerCap("Apply", ledger)
  const exp = EXPECT[n]

  const got: Record<string, string> = {}
  for (const e of ledger) got[e.gate_id] = e.status
  const line = ledger.map((e) => `${e.gate_id}=${e.status}`).join("  ")
  const capMark = verdict === exp.verdict ? "" : `  !! cap got ${verdict}, want ${exp.verdict}`
  console.log(`${n} ${NAMES[n]}  ->  Apply capped to ${verdict}${capMark}`)
  console.log(`     ${line}`)

  ok(`${n} gate-id set`, JSON.stringify(ledger.map((e) => e.gate_id).sort()) === JSON.stringify(Object.keys(exp.gates).sort()))
  for (const [gid, st] of Object.entries(exp.gates)) ok(`${n} ${gid}=${st}`, got[gid] === st)
  ok(`${n} verdict cap -> ${exp.verdict}`, verdict === exp.verdict)
  console.log("")
}

// ── real postings: classify-only (no résumé) — gate counts ────────────────────
const BRIDGEWATER = `We are looking to hire great talent for our Investment Associate roles.
Our investment associates are the core team. They are:
Relentlessly, obsessively—curious. To beat markets, you must have unique insight.
For 50 years, Bridgewater has pursued one idea: the world can be understood.
Total compensation for this position is $71,000 for the 8-week internship.
Bridgewater Associates, LP is an Equal Opportunity Employer.`
const JPM = `Required Qualifications, Capabilities, And Skills
Pursuing a B.A., B.S., or 5th-year M.A. or M.S., with an expected graduation date of December 2027 or June 2028
Strong leadership, communication, interpersonal, and problem-solving skills
Digital-first mindset; proficiency in Excel and PowerPoint
Preferred Qualifications, Capabilities, And Skills
Minimum cumulative GPA of 3.2 on a 4.0 scale
Working knowledge of visualization tools (such as Tableau, Alteryx, Python, etc.)
To be eligible for this program, you must be authorized to work in the U.S.`
const MACYS = `Skills You Will Need
Communication: Clear, concise written and verbal communication skills.
Who You Are
Candidates with a Bachelor's degree or equivalent work experience in a related field are encouraged to apply.
Able to work a flexible schedule based on department and company needs.`
const ELF = `Requirements:
Dedicated experience in consumer communication across social (primarily Instagram and TikTok)
Must have a strong interest in social media marketing and be an excellent written communicator
Excellent knowledge of Tik Tok, Facebook, Twitter, LinkedIn, Pinterest, Instagram
Experience leveraging industry platforms and tools (ex. Hootsuite, Sprout, Dash Hudson, etc.)`
const MERRILL = `Required Qualifications:
Currently holds FINRA Securities Industry Essentials (SIE), Series 7, and Series 66 (63 and 65 accepted in lieu of 66)
Possesses advanced industry knowledge and an understanding of investment products
Desired Qualifications:
Strong computer application skills, including proficiency with Microsoft Word, Excel, PowerPoint, and Salesforce`

const REAL: Array<[string, string, number]> = [
  ["Tessera intern", "(text not supplied — omitted)", 0],
  ["Bridgewater IA", BRIDGEWATER, 0],
  ["JPM finance intern", JPM, 0],
  ["Macy's TA", MACYS, 0],
  ["e.l.f. Community Mgr", ELF, 0],
  ["Merrill CA", MERRILL, 1],
]
console.log("── real postings (classify-only; no résumé → count only) ──\n")
for (const [label, text, want] of REAL) {
  if (text.startsWith("(")) { console.log(`   ${label}: ${text}`); continue }
  const got = classifyRequirements(text)
  ok(`${label}: ${want} gate(s)`, got.length === want)
  console.log(`   ${label}: ${got.length} gate(s)${got.length ? " — " + got.map((c) => c.gate_id).join(", ") : ""}`)
}

console.log(`\n${pass}/${pass + fail} end-to-end assertions passed`)
process.exit(fail > 0 ? 1 : 0)
