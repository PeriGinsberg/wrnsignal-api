#!/usr/bin/env tsx
// "Outreach" and "pipeline" are prospecting only with a sales object on the line.
// Prod 2026-11-04: a Junior Communications Coordinator ("promotional messaging and
// outreach initiatives") got a high-severity "prospecting, outreach, and pipeline
// management" risk; a Digital Marketing Coordinator's "story pipeline" did too.
// Run: npx tsx app/api/jobfit/outreachNotSales.test.ts
//
// Synthetic text only; no résumé or JD from a real person.

import { extractJobSignals } from "./extract"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const PROSPECTING = "prospecting_pipeline_management"
const keys = (jd: string, title: string) => extractJobSignals(jd, { userJobTitle: title }).requirement_units?.map((u) => u.key) ?? []

for (const [label, title, line] of [
  ["communications outreach", "Junior Communications Coordinator", "Help coordinate promotional messaging and outreach initiatives"],
  ["media outreach", "Public Relations Assistant", "Support media outreach efforts and press materials"],
  ["community outreach", "Research Analyst", "Engage in community outreach and public education"],
  ["editorial story pipeline", "Digital Marketing Coordinator", "Manage the weekly editorial meeting, overseeing story pipeline and content workflow"],
] as const) {
  const k = keys(`Key Responsibilities\n${line}\nDraft emails, announcements, and reports`, title)
  ok(`${label} is not prospecting`, !k.includes(PROSPECTING), k.join(","))
}

for (const [label, line] of [
  ["outreach to prospective clients", "Conduct outreach to prospective clients and book meetings"],
  ["outbound outreach", "Run high-volume outbound outreach to grow the book of business"],
  ["sales pipeline", "Build and manage a sales pipeline of new accounts"],
] as const) {
  const k = keys(`Key Responsibilities\n${line}\nMeet weekly activity targets`, "Sales Development Representative")
  ok(`${label} is prospecting`, k.includes(PROSPECTING), k.join(","))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
