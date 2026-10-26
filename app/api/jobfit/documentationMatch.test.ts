#!/usr/bin/env tsx
// A JD line that asks only for "documentation" (records, process or technical
// docs) is not direct-matched by press releases, memos or essays (REGISTER
// DEF-032, prod run 54236134: "solution design documentation" matched a
// press-release line at direct/104 and lifted a Review to Apply/93).
// Run: npx tsx app/api/jobfit/documentationMatch.test.ts
//
// Synthetic text only; no résumé or JD from a real person.

import { extractJobSignals, extractProfileSignals } from "./extract"
import { buildEvidenceMatches } from "./scoring"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

function docStrength(jd: string, resume: string): string {
  const job = extractJobSignals(jd, { userJobTitle: "Associate" })
  const profile = extractProfileSignals("Name: Test Person\n\nResume:\n" + resume)
  const m = buildEvidenceMatches(job, profile).filter((x) => x.job_unit.key === "drafting_documentation" && x.profile_unit.key === "drafting_documentation")
  if (!m.length) return "none"
  return m.some((x) => x.match_strength === "direct") ? "direct" : "adjacent"
}

const TECH_DOCS = `Responsibilities:
- Configure client platforms while supporting the creation of functional, technical, and solution design documentation`
const PRESS_DUTY = `Responsibilities:
- Draft press materials, media advisories, and talking points`

const PRESS_RESUME = `Experience
Communications Intern
- Wrote and pitched press releases and tracked coverage`
const DOCS_RESUME = `Experience
Operations Intern
- Wrote process documentation and SOPs for the onboarding workflow`

console.log("documentation-only JD line")
ok("press releases are adjacent, not direct", docStrength(TECH_DOCS, PRESS_RESUME) === "adjacent", docStrength(TECH_DOCS, PRESS_RESUME))
ok("process documentation stays direct", docStrength(TECH_DOCS, DOCS_RESUME) === "direct", docStrength(TECH_DOCS, DOCS_RESUME))

console.log("press-writing JD line")
ok("press releases stay direct", docStrength(PRESS_DUTY, PRESS_RESUME) === "direct", docStrength(PRESS_DUTY, PRESS_RESUME))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
