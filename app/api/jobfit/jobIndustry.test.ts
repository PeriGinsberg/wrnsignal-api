#!/usr/bin/env tsx
// Job industry detection (extractJobSignals().jobIndustry). The eight industry
// regexes held literal backspace characters (0x08) where \b was meant, so none
// of them could ever match and jobIndustry was always null on the regex path.
// Run: npx tsx app/api/jobfit/jobIndustry.test.ts
//
// Synthetic text only; no résumé or JD from a real person.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractJobSignals } from "./extract"
import { runJobFit } from "../_lib/jobfitEvaluator"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const industry = (jobText: string, title = "Coordinator") =>
  extractJobSignals(jobText, { userJobTitle: title }).jobIndustry

// One sample posting per industry. Each names its industry once and avoids the
// terms of every industry checked before it (the first match wins).
const SAMPLES: [string, string][] = [
  ["sports", `We are an NBA franchise hiring a Partnerships Coordinator.

Responsibilities:
- Support sponsorship activations on game nights
- Track partner deliverables in a shared calendar`],
  ["entertainment", `Join our music industry team as a Marketing Coordinator.

Responsibilities:
- Coordinate release campaigns for new artists
- Report weekly on campaign results`],
  ["luxury/fashion", `A global luxury house is hiring a Merchandising Coordinator.

Responsibilities:
- Manage seasonal assortment plans with the buying team
- Prepare weekly sell-through reports`],
  ["consumer goods", `We are a CPG company hiring a Brand Coordinator.

Responsibilities:
- Support brand managers on retail launches
- Track shipments and promotional calendars`],
  ["technology", `We are a fast-growing SaaS business hiring an Operations Coordinator.

Responsibilities:
- Keep customer onboarding on schedule
- Maintain internal process documentation`],
  ["finance", `Our private equity firm is hiring an Investment Coordinator.

Responsibilities:
- Prepare materials for investment committee meetings
- Track portfolio company reporting deadlines`],
  ["healthcare", `A regional hospital is hiring a Patient Services Coordinator.

Responsibilities:
- Schedule patient appointments across departments
- Keep intake records accurate and complete`],
  ["real estate", `Our commercial real estate team is hiring a Leasing Coordinator.

Responsibilities:
- Track lease renewals and tenant requests
- Prepare monthly occupancy reports`],
]

console.log("each industry check matches a sample posting")
for (const [want, text] of SAMPLES) {
  const got = industry(text)
  ok(`${want} posting -> ${want}`, got === want, `got ${got}`)
}

console.log("\nword boundaries hold")
const NEUTRAL = `\n\nResponsibilities:\n- Keep the team calendar current\n- Prepare weekly status notes`
ok("'reit' inside 'reiterate' is not real estate",
  industry(`Please reiterate key messages to stakeholders.${NEUTRAL}`) === null,
  String(industry(`Please reiterate key messages to stakeholders.${NEUTRAL}`)))
ok("'nfl' inside 'unflagged' is not sports",
  industry(`Review unflagged items each morning.${NEUTRAL}`) === null,
  String(industry(`Review unflagged items each morning.${NEUTRAL}`)))
ok("a posting naming no industry is null", industry(`We are hiring an Office Coordinator.${NEUTRAL}`) === null)

console.log("\nbroad words need the employer, not just a mention")
// Industry is the employer's industry. Each of these is the wording that
// mislabelled a real posting: a wish list, a client list, a perk, a product,
// a requirement, a role title.
const notIndustry: [string, string][] = [
  ["candidate experience list", "Experience in PR ideally across sports, lifestyle, entertainment, or consumer brands."],
  ["client list", "Our clients span business, technology, luxury consumer products, entertainment and the nonprofit sector."],
  ["office perk", "Our office has smart entertainment systems and live plants."],
  ["on-site shoots", "Manage on-site film/tv shoots and media events."],
  ["a bonus background", "Bonus: mobile gaming background."],
  ["a candidate's passion", "You are passionate about luxury, chocolate, and French culture."],
  ["a role title", "Apparel and Design Chair for the student association."],
  ["a requirement list", "Experience in a regulated industry such as gaming, fintech, or financial services."],
  ["a benefits line", "Benefits include critical illness insurance and hospital indemnity insurance."],
  ["infrastructure software", "Experience with asset management software and concepts."],
]
for (const [what, line] of notIndustry) {
  const got = industry(`${line}${NEUTRAL}`)
  ok(`${what} is not an industry`, got === null, `got ${got}`)
}
const isIndustry: [string, string, string][] = [
  ["entertainment", "a gaming company", "Join a premier gaming company as a Marketing Associate."],
  ["entertainment", "a streaming service", "We are a global streaming service."],
  ["entertainment", "a film studio", "We are an independent film studio in Brooklyn."],
  ["luxury/fashion", "a luxury group", "Richemont is a leading luxury group."],
  ["luxury/fashion", "an apparel brand", "We are a fast-growing apparel brand."],
  ["technology", "a fintech organization", "A growing fintech organization is hiring an analyst."],
  ["finance", "asset management as the business", "One of the world's preeminent financial advisory and asset management firms."],
  ["healthcare", "a hospital as the employer", "Our hospital serves the region with 400 beds."],
]
for (const [want, what, line] of isIndustry) {
  const got = industry(`${line}${NEUTRAL}`)
  ok(`${what} -> ${want}`, got === want, `got ${got}`)
}

console.log("\nno control characters in the extractor source")
{
  // A raw 0x08 is invisible in most editors and is how these checks broke.
  const src = readFileSync(join(__dirname, "extract.ts"), "utf8")
  const bad = src.split("\n").flatMap((line, i) =>
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(line) ? [i + 1] : [])
  ok("extract.ts has no control characters", bad.length === 0, `lines ${bad.join(", ")}`)
}

async function interestMatch() {
  console.log("\na stated industry interest is a WHY, never a risk")
  const quiet = console.log
  console.log = () => {}
  const res: any = await runJobFit({
    profileText: `Name: Sample Candidate\nTarget roles: Partnerships Coordinator\n\nExperience\nMarketing Intern, Campus Athletics\n- Coordinated sponsor activations at 12 home games\n- Tracked partner deliverables in a shared calendar`,
    jobText: SAMPLES[0][1],
    userJobTitle: "Partnerships Coordinator",
    profileOverrides: { statedInterests: { targetRoles: ["Partnerships Coordinator"], adjacentRoles: [], targetIndustries: ["sports"] } },
  } as any)
  console.log = quiet
  const whys = (res.why_codes ?? []).map((w: any) => w.code)
  const risks = (res.risk_codes ?? []).map((r: any) => r.code)
  ok("WHY_INDUSTRY_MATCH is in why_codes", whys.includes("WHY_INDUSTRY_MATCH"), whys.join(", "))
  ok("WHY_INDUSTRY_MATCH is not in risk_codes", !risks.includes("WHY_INDUSTRY_MATCH"), risks.join(", "))
  ok("it comes after the evidence WHYs", whys.length < 2 || whys[whys.length - 1] === "WHY_INDUSTRY_MATCH", whys.join(", "))
}

interestMatch().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
})
