#!/usr/bin/env tsx
// Consulting title family + work-authorization boilerplate (REGISTER DEF-014,
// DEF-015, case C005: UBS Group Internal Consulting Graduate Talent Program).
// Run: npx tsx app/api/jobfit/jobFamilyAndBoilerplate.test.ts
//
// Synthetic text only; no résumé or JD from a real person.

import { extractJobSignals, filterJobTextToRequirements, isLegalBoilerplate } from "./extract"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const BODY = `Your Role:
You'll work as part of an engagement team, supporting the delivery of change at scale.

Requirements:
- Experience working in a project-based environment
- Strategic thinker with strong communication skills`

const family = (title: string, body = BODY) => extractJobSignals(body, { userJobTitle: title }).jobFamily

console.log("consulting in the title")
ok("bare 'consulting' in the title is Consulting",
  family("2027 Group Internal Consulting Graduate Talent Program") === "Consulting",
  family("2027 Group Internal Consulting Graduate Talent Program"))
ok("'Consulting Intern' is Consulting", family("Consulting Intern") === "Consulting")
ok("the compound titles still work", family("Associate Consultant") === "Consulting")
ok("'Consulting Engineer' is not made Consulting", family("Consulting Engineer") !== "Consulting", family("Consulting Engineer"))
{
  const blurb = `We are a leading firm providing consulting services to clients worldwide.\n\n${BODY}`
  ok("'consulting' only in the body does not make the job Consulting",
    family("Operations Coordinator", blurb) === "Operations", family("Operations Coordinator", blurb))
}

console.log("\nwork authorization is not a requirement")
const NOTE = "Note: This position is not eligible for any employment-based immigration sponsorship. UBS will not provide any assistance or sign any documentation in support of any other form of immigration sponsorship including optional practical training (OPT) or curricular practical training (CPT)."
for (const line of [
  NOTE,
  "Candidates must be authorized to work in the United States.",
  "We are unable to sponsor H-1B visas for this role.",
  "Work authorization required; no visa sponsorship available.",
]) ok(`boilerplate: "${line.slice(0, 50)}…"`, isLegalBoilerplate(line))
for (const line of [
  "Manage event sponsorships and partner activations",
  "Experience in sponsorship sales preferred",
  "Opt in to the mentorship program",
]) ok(`kept: "${line}"`, !isLegalBoilerplate(line))
{
  const { filteredText } = filterJobTextToRequirements(`${BODY}\n\nProgram Details:\n${NOTE}`)
  ok("the note is gone from requirement text", !/sponsorship|documentation/i.test(filteredText))
  ok("the requirements stay", /project-based environment/.test(filteredText))
  const units = extractJobSignals(`${BODY}\n\nProgram Details:\n${NOTE}`, { userJobTitle: "Consulting Analyst" }).requirement_units ?? []
  ok("no drafting_documentation unit is built from the note",
    !units.some((u) => u.key === "drafting_documentation"), units.map((u) => u.key).join(","))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
