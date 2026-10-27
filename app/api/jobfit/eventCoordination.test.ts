#!/usr/bin/env tsx
// Event coordination and procurement are capabilities; résumé wording for event, vendor and
// client-service work reaches the rules (REGISTER DEF-027, prod run 936a360b:
// Event Sales Admin scored Pass/55 with zero matches) and procurement (DEF-028:
// Buyer I / Procurement Specialist scored Pass with a procurement résumé).
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

const jobKeys = (jd: string) => extractJobSignals(jd, { userJobTitle: "Events Assistant" }).requirement_units?.map((u) => u.key) ?? []
const profileKeys = (resume: string) =>
  extractProfileSignals("Name: Test Person\n\nResume:\n" + resume).profile_evidence_units?.map((u) => u.key) ?? []

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

// ── procurement (DEF-028) ────────────────────────────────────────────────────
console.log("\nprocurement: job side")
const keysFor = (jd: string, title: string) => extractJobSignals(jd, { userJobTitle: title }).requirement_units?.map((u) => u.key) ?? []
const familyFor = (jd: string, title: string) => extractJobSignals(jd, { userJobTitle: title }).jobFamily
{
  const jd = `Key Responsibilities:
- Place and reschedule purchase orders with approved suppliers
- Request and evaluate quotes from suppliers on cost and delivery`
  ok("buyer duties are a procurement requirement", keysFor(jd, "Buyer I").includes("procurement_sourcing"), keysFor(jd, "Buyer I").join(","))
  ok("'Buyer I' is Operations", familyFor(jd, "Buyer I") === "Operations", familyFor(jd, "Buyer I"))
  ok("'Procurement Consultant Intern' is not made Operations", familyFor(jd, "Procurement Consultant Intern") !== "Operations", familyFor(jd, "Procurement Consultant Intern"))
}
{
  const media = `Responsibilities:
- Plan TV and digital ad placements for brand campaigns
- Track campaign delivery and report results to the client team`
  ok("'Media Buyer' is not made Operations by the buyer title", familyFor(media, "Media Buyer") !== "Operations", familyFor(media, "Media Buyer"))
}
{
  const jd = `Responsibilities:
- Rotate across Construction Project Management, Engineering, Procurement, and Estimating
- Assist with broadcast segments, including sourcing products and drafting talking points
- Collaborate on music selection and stock imagery sourcing`
  const k = keysFor(jd, "Analyst Intern")
  ok("a department list, product sourcing and stock imagery are not procurement", !k.includes("procurement_sourcing"), k.join(","))
}

console.log("\nprocurement: résumé side")
{
  const k = profileKeys(`EXPERIENCE
Account Manager | Supply Firm | 2024 - 2026
Sourced, priced, and quoted 150+ bids for public-sector clients
Compared 1 to 10 vendors per request on cost and lead time`)
  ok("sourcing and quoting bids is procurement", k.includes("procurement_sourcing"), k.join(","))
}
{
  const k = profileKeys(`EXPERIENCE
Recruiting Intern | Staffing Agency | 2025
Sourced 40+ candidates per week for technical roles`)
  ok("sourcing candidates is not procurement", !k.includes("procurement_sourcing"), k.join(","))
}

console.log("\nhotel front desk (DEF-036)")
{
  const cs = "customer_service_guest_experience"
  const has = (line: string) => profileKeys(line).includes(cs)
  ok("reservations, check-ins and check-outs are guest service",
    has("Managed all reservations with no central booking team, plus check-ins, check-outs, and credit card payments in HMS"))
  ok("a front desk job title is guest service", has("Front Desk Associate | Hotel Yellowstone | Jackson, WY"))
  ok("resolving guest concerns is guest service", has("Resolved guest concerns as Manager on Duty with authority to issue comps"))
  ok("promoting reservations in a marketing campaign is not", !has("Supported marketing campaigns promoting reservations at state park systems"))
  ok("weekly check-ins with a manager are not", !has("Held weekly check-ins with my manager to review project status"))
  ok("JD guest registration is a guest service duty",
    extractJobSignals("Front Desk Agents are responsible for the guest registration process and communication of hotel services.", { userJobTitle: "Front Desk Agent" })
      .requirement_units?.some((u) => u.key === cs) === true)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
