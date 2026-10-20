#!/usr/bin/env tsx
// Event coordination is a capability; résumé wording for event, vendor and
// client-service work reaches the rules (REGISTER DEF-027, prod run 936a360b:
// Event Sales Admin scored Pass/55 with zero matches).
// Run: npx tsx app/api/jobfit/eventCoordination.test.ts
//
// Synthetic text only; no résumé or JD from a real person.

import { extractJobSignals, extractProfileSignals } from "./extract"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const jobKeys = (jd: string) => extractJobSignals(jd, { userJobTitle: "Events Assistant" }).requirement_units.map((u) => u.key)
const profileKeys = (resume: string) =>
  extractProfileSignals("Name: Test Person\n\nResume:\n" + resume).profile_evidence_units.map((u) => u.key)

console.log("job side")
{
  const jd = `Responsibilities:
Assist the events team with client inquiries and bookings.
Coordinate event logistics, including scheduling and room setup.
Provide excellent guest service to every client.

Requirements:
Previous experience in event coordination is a plus.`
  const k = jobKeys(jd)
  ok("event coordination is a requirement", k.includes("event_coordination"), k.join(","))
  ok("guest service is a customer service requirement", k.includes("customer_service_guest_experience"), k.join(","))
}
{
  const jd = `Requirements:
1-3 years in private banking or a client service role.
Client service oriented with a drive to over-deliver.`
  const k = jobKeys(jd)
  ok("finance 'client service' is not a customer service requirement", !k.includes("customer_service_guest_experience"), k.join(","))
}

console.log("\nrésumé side")
{
  const k = profileKeys(`EXPERIENCE
Events Coordinator | Campus Association | 2024 - Present
Coordinated networking and professional development events for 200 members
Front Desk Concierge | Hotel | 2023 - 2024
Greeted 60+ guests per shift and resolved booking issues
Coordinated vendors, pricing, and timelines for 40 requests
SKILLS
Timeline & Logistics Coordination | Vendor Sourcing`)
  ok("events + a coordination verb is event coordination", k.includes("event_coordination"), k.join(","))
  ok("concierge / guests per shift is customer service", k.includes("customer_service_guest_experience"), k.join(","))
  ok("vendor coordination is operations execution", k.includes("operations_execution"), k.join(","))
}
{
  const k = profileKeys(`EXPERIENCE
Analyst | Bank | 2024 - Present
Attended industry events and conferences on behalf of the team
Built financial models for quarterly reviews`)
  ok("attending events is not event coordination", !k.includes("event_coordination"), k.join(","))
}
{
  const k = profileKeys(`SUMMARY
Seeking event planning roles in hospitality
EXPERIENCE
Analyst | Bank | 2024 - Present
Built financial models for quarterly reviews`)
  ok("an aspiration line is not event evidence", !k.includes("event_coordination"), k.join(","))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
