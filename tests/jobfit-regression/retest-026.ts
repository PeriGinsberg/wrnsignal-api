#!/usr/bin/env tsx
// ISSUE-026 retest: Josselyn Chavez vs Fanatics Senior Manager,
// Strategy and Business Operations. Originally produced Priority
// Apply/97 with 0 risks when the JD explicitly requires prior
// experience at a top management consulting firm or investment
// bank — a hard screen gate Josselyn does not meet.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

// Profile loaded from a fixture file so this module can be imported
// without re-reading the production CSV (previous version did a
// top-level CSV scan which ran as a side effect at import time).
const PROFILE_JSON = readFileSync(
  join(__dirname, "fixtures", "joss-profile.json"),
  "utf8"
)

const JOB_TEXT = `Senior Manager, Strategy and Business Operations
Miami, FL, United States (On-site)
Job Description
In collaboration and close partnership with leadership across the Fanatics Specialty Businesses Vertical, focused on enabling our integrated platform vison, offers support to our business units in strategy development, operational optimization, select deal negotiations, and explores growth opportunities in new verticals that are important to the sports fan. This role is extremely high visible across the organization and provides high strategic, transactional, and operational exposure.

What You'll Do:
Develop compelling presentations that transform complex data and analysis into clear and concise narratives for senior internal and external executives
Research and analyze market trends, competitor strategies, and industry dynamics to identify insights on how it impacts Fanatics' businesses
Build and maintain financial models to assess the financial impact of strategic initiatives
Project management of certain initiatives from start to finish
Analyze cross-platform key performance indicators and operational metrics to evaluate business performance and identify areas of opportunities
Manage competing priorities & provide level-headed guidance during unexpected events
This job will require occasional travel.

What We're Looking For:
3 - 5 years relevant experience in a Management Consulting or Financial Analyst/Associate role within top advisory firm or bank
Experience demonstrating problem solving and root cause analysis coupled with ability to collect relevant information, analyze, and "connect the dots" to facilitate collaboration across different parts of the business
Highly analytical, detail oriented and strong business sense; proven ability to develop new ideas / creative solutions and demonstrated experience implementing those solutions
Demonstrated financial acumen and/or analytical experience including familiarity with concepts of forecasting, valuations, and/or data interpretation and analysis
Expertise using Excel and PowerPoint to analyze data and drive business insights
Insightful, consistent, and considerate communication skills, both verbal and written
Ability to meet tight deadlines, prioritize workload and achieve effective results in a fast-paced, dynamic, ever-growing and often ambiguous environment; effective multi-tasking skills are vital
Familiarity and fluency with company reporting documents and public filings
Team player with the ability to develop relationships at various levels internally and externally, and champion our company culture
Strong work ethic with a sense of urgency to resolve issues promptly
Comfortable managing the strategic aspects as well as the tactical details of the business
Natural curiosity and drive, with a proactive approach toward what may make sense even if not specifically requested
Maturity to handle sensitive information and manage dialogues at the highest level of the organization
Interest in sports and/or entertainment business models is preferable, but not a must
Location: Miami / Fort Lauderdale, FL area

About Us
Fanatics is building a leading global digital sports platform. We ignite the passions of global sports fans and maximize the presence and reach for our hundreds of sports partners globally by offering products and services across Fanatics Commerce, Fanatics Collectibles, and Fanatics Betting & Gaming.
`

async function main() {
  // Tolerant profile parse (some CSV exports include concatenated arrays).
  let profileArray: any
  try {
    profileArray = JSON.parse(PROFILE_JSON)
  } catch {
    let depth = 0, end = -1
    for (let k = 0; k < PROFILE_JSON.length; k++) {
      const ch = PROFILE_JSON[k]
      if (ch === "[") depth++
      else if (ch === "]") { depth--; if (depth === 0) { end = k; break } }
    }
    profileArray = JSON.parse(PROFILE_JSON.slice(0, end + 1))
  }
  const p = Array.isArray(profileArray) ? profileArray[0] : profileArray
  if (!p) { console.error("profile not found"); process.exit(2) }

  const profileText = (String(p.profile_text || "").trim() + "\n\nResume:\n" + String(p.resume_text || "").trim()).trim()
  const profileOverrides = mapClientProfileToOverrides({
    profileText,
    profileStructured: typeof p.profile_structured === "string" ? JSON.parse(p.profile_structured || "null") : p.profile_structured,
    targetRoles: p.target_roles || null,
    preferredLocations: p.preferred_locations || null,
  })

  const result: any = await runJobFit({
    profileText,
    jobText: JOB_TEXT,
    profileOverrides,
    userJobTitle: "Senior Manager, Strategy and Business Operations",
    userCompanyName: "Fanatics",
  } as any)

  console.log("\n=== ISSUE-026 Retest ===")
  console.log("Decision:", result.decision, "/ Score:", result.score)
  console.log("Gate:", result.gate_triggered?.type)
  console.log("Job family:", result.job_signals.jobFamily)
  console.log("Profile targetFamilies:", result.profile_signals.targetFamilies)
  console.log("isSeniorRole:", result.job_signals.isSeniorRole)
  console.log("yearsRequired:", result.job_signals.yearsRequired)
  console.log("profileYears:", result.profile_signals.yearsExperienceApprox)
  console.log("functionTags:", result.job_signals.function_tags)
  console.log("\nWHY codes (" + (result.why_codes || []).length + "):")
  for (const w of result.why_codes || []) {
    console.log(`  [${w.code}] ${w.match_key} (${w.match_strength}, w=${w.weight})`)
    console.log("    job:", String(w.job_fact || "").slice(0, 140))
    console.log("    prof:", String(w.profile_fact || "").slice(0, 140))
  }
  console.log("\nRISK codes (" + (result.risk_codes || []).length + "):")
  for (const r of result.risk_codes || []) {
    console.log(`  [${r.code}] sev=${r.severity} w=${r.weight}`)
    console.log("   ", String(r.risk || "").slice(0, 200))
  }
}

export const CASE = {
  id: "retest-026",
  label: "ISSUE-026 Josselyn Chavez vs Fanatics Senior Manager Strategy",
  profileJson: PROFILE_JSON,
  jobText: JOB_TEXT,
  userJobTitle: "Senior Manager, Strategy and Business Operations",
  userCompanyName: "Fanatics",
}

const isMainEntryPoint = (process.argv[1] || "").replace(/\\/g, "/").endsWith("/retest-026.ts")
if (isMainEntryPoint) {
  main().catch((e) => { console.error(e); process.exit(2) })
}
