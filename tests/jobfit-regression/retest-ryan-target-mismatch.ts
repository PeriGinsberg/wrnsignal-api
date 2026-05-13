#!/usr/bin/env tsx
// PERMANENT REGRESSION FIXTURE — Fix A (target_role mismatch penalty), 2026-05-07.
//
// Ryan Rudnet (FSU finance student, target_roles="wealth management roles")
// vs UBS posting whose LinkedIn header is "Client Associate / Team Client
// Relationship Specialist" but whose body actually describes an Advisor
// Marketing & Content Associate role (writing, content, brand work).
//
// Pre-fix behavior: Priority Apply / 97. Engine title-detection grabbed
// the LinkedIn header → matched jobTitleIsFinance regex → assigned Finance
// family → Ryan got the +10 family-match bonus + no risks. Wrong-fit
// candidate scored higher than a marketing-target candidate (82) on the
// same JD because the title-classification was wrong AND there was no
// target-role-mismatch check.
//
// Post-fix assertion: score < 90 OR risk_codes contains
// RISK_TARGET_ROLE_MISMATCH. The runtime check below enforces this; the
// regression-check.ts snapshot also pins these values.
//
// JD body reconstructed from requirement_unit snippets captured in the
// original run record (id 556d81aa-be33-4c0e-852f-7995ca427f26) plus the
// product owner's quoted opening sentence. JD body is reconstructed, not
// the literal LinkedIn paste — what matters is that it triggers the same
// title-detection + family-classification + tag-extraction code paths
// that produced the original 97/Priority Apply.

import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

const PROFILE_JSON = `[{"id":"ryan-test","email":"peri+testryan1@workforcereadynow.com","name":"ryan rudnet","profile_text":"ryan rudnet is a full time candidate targeting wealth management roles in south florida, boca raton for summer 2026.\\r\\n\\r\\ntarget roles: wealth management roles\\r\\ntimeline: summer 2026\\r\\njob type: full time\\r\\n\\r\\nhard constraints: no remote roles\\r\\n\\r\\nstrengths: client relationship building. analytical skills. finance skills.\\r\\n\\r\\nconcerns: none stated.\\r\\n\\r\\nresume follows below.\\r\\n[see resume_text above]","resume_text":"RYAN RUDNET\\r\\n(561) 797-1597 | rjrudnet@gmail.com | LinkedIn\\r\\n\\r\\nEDUCATION\\r\\nFlorida State University – Tallahassee, FL\\r\\nBachelor of Science in Finance | GPA: 3.7 May 2026\\r\\nStudy Abroad: FSU International Program at Valencia, Spain Summer 2024\\r\\nHonors/Awards: Dean's List | Intern of the Year | Counselor of the Year | Hospice-Trust Bridge, Compassion Magazine feature\\r\\nScholarships: Bright Futures | Megan F. Durtschi Memorial | J.M. Rubin | Boynton Beach Rotary Club | Valencia Shores | South Florida Fair | Burger King Scholar\\r\\nCertifications: Microsoft Office Specialist – Excel Associate | SIE preparation expected date: Spring 2026\\r\\n\\r\\nCORE COMPETENCIES\\r\\nFinancial Modeling | Investment Analysis | Portfolio Management | Valuation (DCF, NPV, IRR) | Capital Budgeting | Risk Management | Financial Reporting | Excel & Access | Regression Analysis | Linear Programming\\r\\n\\r\\nRELEVANT EXPERIENCE\\r\\nInvestments Intern – Florida State University Foundation, Division of University Advancement - FSU Apr 2025 – Present\\r\\nSupport investment operations for a $1B+ endowment, assisting with portfolio management and financial stewardship\\r\\nProcess stock gifts, charitable donations, capital calls, and distributions with accuracy and compliance\\r\\nPrepare daily receipts, journal entries, and SBA transactions in Financial Edge, strengthening operational accuracy\\r\\nConduct reporting and analysis in Excel/Access, providing performance reporting and insights to enhance portfolio transparency\\r\\n\\r\\nStock Portfolio Competition – FSU International Program at Valencia, Spain\\r\\nDeveloped and managed $100K stock portfolio, achieving the highest growth rate (7%) over six weeks\\r\\nConducted analysis to select stocks based on metrics including P/E ratio, dividend yield, historical returns, and market conditions\\r\\nTracked portfolio performance over six weeks by analyzing returns, cash and buying power, and market value to ensure optimal investment management decisions\\r\\n\\r\\nFinancial Management of the Firm\\r\\nAnalyzed corporate structures and strategies, evaluating organizational trade-offs impacting profitability and governance\\r\\nEmployed advanced financial analysis techniques (DCF, ratio analysis, time value of money) to evaluate capital investments\\r\\nApplied asset valuation models (CAPM, WACC) and capital budgeting techniques (NPV, IRR) to inform investment strategies\\r\\n\\r\\nADDITIONAL EXPERIENCE\\r\\nPurchasing and Sales Intern | OS2 Corp – Ft. Lauderdale, FL May 2023 - Aug 2023\\r\\nConducted research on government databases to identify and secure lucrative contracts, driving significant business growth\\r\\nShadowed CEO Al Levinstein, gaining insights into strategic purchasing decisions and operational leadership\\r\\nManaged departmental tasks, using organizational and delegation skills to enhance team productivity in a fast-paced setting\\r\\nRecognized as Intern of the Year for outstanding contributions to departmental success\\r\\n\\r\\nLEADERSHIP & INVOLVEMENT\\r\\nVice President & Co-Founder – Hearts for Healthcare, Student Organization - Tallahassee, FL Aug 2025 – Present\\r\\nFounded student-run nonprofit initiative supporting hospice patients through personalized cards distributed biannually\\r\\nBuilt partnerships with healthcare providers and engaged 50+ student volunteers\\r\\nOversee budgeting, event logistics, and outreach, ensuring sustained impact and effective stakeholder engagement\\r\\n\\r\\nExperience Camps – Blue Ridge, GA and Ft. Lauderdale, FL Jun 2020 - Present\\r\\nYouth Advisory Board Member, Fundraising Speaker, Counselor\\r\\nAdvocate for grieving youth by influencing program development and delivering impactful speeches to engage donors\\r\\nGuide campers in fostering teamwork and personal growth\\r\\nTook initiative to recruit new talent at FSU, successfully bringing on 7 student volunteers and counselors to expand program\\r\\n\\r\\nSigma Alpha Epsilon Fraternity | Executive Risk Officer, Member Mar 2023 - Present\\r\\nDevelop and enforce risk management policies for 300+ members while serving as liaison on risk-related issues to ensure compliance and safety\\r\\nLead training on emergency procedures, CPR, Narcan administration, and responsible behavior\\r\\n\\r\\nFSU Real Estate Club | FSU Financial Management Association (FMA) | Beta Alpha Psi Honor Society, Member\\r\\n\\r\\nSKILLS & INTERESTS\\r\\nSkills: Proficient: Microsoft Excel, Microsoft PowerPoint, and Microsoft Word, Google Suite\\r\\nInterests: Golf, Recreational Pickleball, International Traveling, Structured Weightlifting, Miami Dolphins Football","target_roles":"wealth management roles","target_locations":"south florida, boca raton","preferred_locations":null,"timeline":"summer 2026","job_type":"full time","profile_structured":"{}","risk_overrides":null,"active":true}]`

const JOB_TEXT = `Client Associate / Team Client Relationship Specialist

UBS

We are seeking a highly motivated Advisor Marketing & Content Associate to support a Private Wealth Management (PWM) team focused on delivering differentiated, high quality client experiences. This role is ideal for a strong writer and organized marketer who is passionate about helping advisors connect with clients in meaningful ways.

The ideal candidate has a strong understanding of financial services, a passion for storytelling, and a desire to partner closely with advisors to elevate their brand, voice, and outreach.

The team delivers customized wealth management strategies, investment solutions, and planning services tailored to complex client needs, with a strong emphasis on collaboration, long term relationships, and disciplined portfolio management.

Key Responsibilities:
- Marketing initiatives feel cohesive, intentional, and aligned with the team's brand
- Track marketing initiatives and assist with reporting and analysis to measure effectiveness
- Draft and refine client communications, presentations, and outreach materials
- Coordinate with advisors to ensure messaging is on-brand and timely
- Comfort with internal systems, documentation & client data

Qualifications:
- Bachelor's degree or relevant experience in Marketing, Communications, Business, Journalism, or a related field
- Proficiency in Microsoft Office, Copilot, and other relevant tools
- Strong written and verbal communication skills`

async function main() {
  let arr: any
  try {
    arr = JSON.parse(PROFILE_JSON)
  } catch {
    let depth = 0,
      end = -1
    for (let k = 0; k < PROFILE_JSON.length; k++) {
      const ch = PROFILE_JSON[k]
      if (ch === "[") depth++
      else if (ch === "]") {
        depth--
        if (depth === 0) {
          end = k
          break
        }
      }
    }
    arr = JSON.parse(PROFILE_JSON.slice(0, end + 1))
  }

  const p = Array.isArray(arr) ? arr[0] : arr
  const profileText = (
    String(p.profile_text || "").trim() +
    "\n\nResume:\n" +
    String(p.resume_text || "").trim()
  ).trim()

  const profileOverrides = mapClientProfileToOverrides({
    profileText,
    profileStructured:
      typeof p.profile_structured === "string"
        ? JSON.parse(p.profile_structured || "null")
        : p.profile_structured,
    targetRoles: p.target_roles || null,
    preferredLocations: p.preferred_locations || p.target_locations || null,
  })

  const result: any = await runJobFit({
    profileText,
    jobText: JOB_TEXT,
    profileOverrides,
    userJobTitle: "Client Associate / Team Client Relationship Specialist",
    userCompanyName: "UBS",
  } as any)

  console.log("\n=== RYAN retest — Ryan Rudnet (wealth mgmt target) vs UBS marketing-content posting ===")
  console.log("Decision:", result.decision, "/ Score:", result.score)
  console.log("Job family:", result.job_signals.jobFamily)
  console.log("Profile target families:", result.profile_signals.targetFamilies)
  console.log("Profile target roles:", result.profile_signals.statedInterests?.targetRoles)
  console.log("\nrisk_codes:")
  for (const r of result.risk_codes || []) {
    console.log(`  [${r.code}] sev=${r.severity} w=${r.weight ?? "n/a"}`)
  }
  console.log("\nwhy_codes:")
  for (const w of result.why_codes || []) {
    console.log(`  [${w.code}] ${w.match_key} (${w.match_strength}, w=${w.weight})`)
  }

  // ── ASSERTION ─────────────────────────────────────────────────────────
  // Permanent guard against regression of Fix A (target_role mismatch).
  // Either the score must be < 90 OR the run must surface
  // RISK_TARGET_ROLE_MISMATCH. Both should be true post-fix; the OR is
  // there so future tweaks that score this lower without firing the risk
  // (e.g. a stronger family-mismatch detection) still pass.
  const score: number = Number(result.score || 0)
  const hasRoleMismatchRisk =
    (result.risk_codes || []).some(
      (r: any) => String(r.code) === "RISK_TARGET_ROLE_MISMATCH"
    ) === true
  const passed = score < 90 || hasRoleMismatchRisk

  console.log("\n── Regression assertion (Fix A — target role mismatch) ──")
  console.log(`  score < 90                  : ${score < 90} (score=${score})`)
  console.log(`  RISK_TARGET_ROLE_MISMATCH   : ${hasRoleMismatchRisk}`)
  console.log(`  → assertion ${passed ? "PASS ✓" : "FAIL ✗"}`)
  if (!passed) {
    console.error("\n✗ ASSERTION FAILED — Ryan UBS regression test")
    console.error("  Wrong-fit Priority Apply re-emerged. Investigate scoring + classification.")
    process.exit(1)
  }
}

export const CASE = {
  id: "retest-ryan-target-mismatch",
  label: "Ryan Rudnet (wealth mgmt target) vs UBS Advisor Marketing & Content Associate",
  profileJson: PROFILE_JSON,
  jobText: JOB_TEXT,
  userJobTitle: "Client Associate / Team Client Relationship Specialist",
  userCompanyName: "UBS",
}

const isMainEntryPoint = (process.argv[1] || "")
  .replace(/\\/g, "/")
  .endsWith("/retest-ryan-target-mismatch.ts")
if (isMainEntryPoint) {
  main().catch((e) => {
    console.error(e)
    process.exit(2)
  })
}
