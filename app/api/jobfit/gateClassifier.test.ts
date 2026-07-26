#!/usr/bin/env tsx
// Tests for the JD-side regex classifier (defect #1, step 2).
// Asserts the GateCandidate[] each posting produces — kind / required / gate_id.
// No core, no extractor, no statuses. Run:
//   npx tsx app/api/jobfit/gateClassifier.test.ts

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { classifyRequirements } from "./gateClassifier"
import type { GateCandidate } from "./gateLedger"

const CASES_DIR = join(__dirname, "..", "..", "..", "Regression Testing July 2026", "cases")

let pass = 0
let fail = 0
function assertIds(label: string, got: GateCandidate[], wantIds: string[]) {
  const g = got.map((c) => c.gate_id).sort()
  const w = [...wantIds].sort()
  const ok = JSON.stringify(g) === JSON.stringify(w)
  if (ok) pass++
  else fail++
  console.log(`${ok ? "✓" : "✗"} ${label}`)
  for (const c of got) console.log(`      · ${c.gate_id}  [${c.spec.kind}]  ${JSON.stringify((c as any).spec)}`)
  if (!ok) console.log(`      got  ${JSON.stringify(g)}\n      want ${JSON.stringify(w)}`)
}

function jd(caseNo: string): string {
  const txt = readFileSync(join(CASES_DIR, `case-${caseNo}.input.md`), "utf8")
  const parts = txt.split(/##\s*JOB\s+POSTING/i)
  return parts[1] || txt
}

console.log("── synthetic (8) ──")
assertIds("01 Jordan/Threadline", classifyRequirements(jd("01")), ["b2b_saas_3yr", "dbt_handson", "crm_pipeline"])
assertIds("02 Priya/Meridian", classifyRequirements(jd("02")), ["ts_sci_clearance", "us_citizenship", "degree_or_waiver"])
assertIds("03 Marcus/Vantail", classifyRequirements(jd("03")), ["yoe_10", "manager_of_managers_5yr"])
assertIds("04 Dana/Corvel", classifyRequirements(jd("04")), ["recent_angular_v14_3yr"])
assertIds("05 Tyler/Highfield", classifyRequirements(jd("05")), ["snowflake_handson", "dbt_handson", "airflow_handson", "spark_handson"])
assertIds("06 Sofia/Nimbus", classifyRequirements(jd("06")), ["yoe_5"])
assertIds("07 Reyna/Threadline", classifyRequirements(jd("07")), ["b2b_saas_3yr", "dbt_handson", "crm_pipeline"])
assertIds("08 Omar/Fernwood", classifyRequirements(jd("08")), ["ml_in_prod_5yr", "experimentation_ab_testing"])

// wrap-fix spec checks: the clause on the wrapped 2nd physical line is now read.
function specCheck(label: string, cond: boolean) {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "✓" : "✗"} ${label}`)
}
const c02 = classifyRequirements(jd("02")).find((c) => c.gate_id === "degree_or_waiver")!
specCheck("02 degree_or_waiver waiverPath = 'specific' (sees DoD clause)",
  c02.spec.kind === "credential" && c02.spec.credentialType === "degree" && (c02.spec as any).waiverPath === "specific")
const c04 = classifyRequirements(jd("04")).find((c) => c.gate_id === "recent_angular_v14_3yr")!
specCheck("04 recency withinLastNRoles = 2 (sees 'last two roles')",
  c04.spec.kind === "experience" && (c04.spec as any).recency?.withinLastNRoles === 2)

// ── real postings (5 with text; Tessera omitted — text not supplied) ──────────
const BRIDGEWATER = `
We are looking to hire great talent for our Investment Associate roles.
Our investment associates are the core team. They are:
Relentlessly, obsessively—curious. To beat markets, you must have unique insight.
Deeply independent—bordering on iconoclastic—thinkers.
Conceptual and analytical. We are looking for exceptionally bright thinkers.
People who love collaborating, have a ton of grit, and are determined to grow.
For 50 years, Bridgewater has pursued one idea: the world can be understood.
Total compensation for this position is $71,000 for the 8-week internship.
Bridgewater Associates, LP is an Equal Opportunity Employer.
`

const JPM = `
Required Qualifications, Capabilities, And Skills
Pursuing a B.A., B.S., or 5th-year M.A. or M.S., with an expected graduation date of December 2027 or June 2028
Ability to thrive in a fast-paced, collaborative, and dynamic environment
Strong leadership, communication, interpersonal, and problem-solving skills
Digital-first mindset; proficiency in Excel and PowerPoint
Relevant internship experience and demonstrated leadership in academic or community organizations

Preferred Qualifications, Capabilities, And Skills
Minimum cumulative GPA of 3.2 on a 4.0 scale
Working knowledge of data analytics, visualization tools (such as Tableau, Alteryx, Python, etc.)

Locations you may join:
To be eligible for this program, you must be authorized to work in the U.S. We do not offer immigration sponsorship for this program.
`

const MACYS = `
Skills You Will Need
Passive Candidate Engagement & Brand Ambassadorship: Ability to engage passive candidates.
Recruiter Partnership & Intake Effectiveness: Strong ability to support recruiters.
Communication: Clear, concise written and verbal communication skills.

Who You Are
Candidates with a Bachelor's degree or equivalent work experience in a related field are encouraged to apply.
Early-career professional with an interest in building sourcing and recruiting expertise.
Able to work a flexible schedule based on department and company needs.
`

const ELF = `
Requirements:
Dedicated experience in consumer communication across social (primarily Instagram and TikTok but could also include Youtube, Pinterest, + Twitch)
Must have a strong interest in social media marketing and be an excellent written communicator with strong copywriting, editing and proofreading skills
Excellent knowledge of Tik Tok, Facebook, Twitter, LinkedIn, Pinterest, Instagram, and other social media emerging platforms
Prior experience in growing and scaling a digital community is a huge plus
Experience leveraging industry platforms and tools (ex. Hootsuite, Sprout, Dash Hudson, CreatorIQ, etc.)
`

const MERRILL = `
Required Qualifications:
Currently holds FINRA Securities Industry Essentials (SIE), Series 7, and Series 66 (63 and 65 accepted in lieu of 66)
Possesses advanced industry knowledge and an understanding of investment products
Demonstrates a client-centric mindset, always acting in the best interest of the client

Desired Qualifications:
Strong computer application skills, including proficiency with Microsoft Word, Excel, PowerPoint, and Salesforce
Demonstrates professional verbal and written communication skills

Skills:
Account Management
Pipeline Management
Client Solutions Advisory
`

console.log("\n── real (5) ──")
assertIds("Bridgewater IA (0)", classifyRequirements(BRIDGEWATER), [])
assertIds("JPM finance intern (0)", classifyRequirements(JPM), [])
assertIds("Macy's TA (0)", classifyRequirements(MACYS), [])
assertIds("e.l.f. Community Mgr (0)", classifyRequirements(ELF), [])
assertIds("Merrill CA (1)", classifyRequirements(MERRILL), ["finra_sie_series7_series66"])

console.log(`\n${pass}/${pass + fail} postings classified as expected`)
process.exit(fail > 0 ? 1 : 0)
