#!/usr/bin/env tsx
// ISSUE-013 retest: Ryan Rudnet vs Hennion & Walsh Investment Associate.
// Original complaint: "The system randomly started saying that Ryan's
// financial profile was actually a marketing profile and marked a good
// fit job as a bad fit" — logged as Pass/50 with Marketing family.

import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

const PROFILE_JSON = `[{"idx":35,"id":"5938d75d-e10e-4757-a7f3-e8b50fd83ae0","email":"erin+testryan1@workforcereadynow.com","profile_text":"ryan rudnet is a full time candidate targeting wealth management roles in south florida, boca raton for summer 2026.\\r\\n\\r\\ntarget roles: wealth management roles\\r\\ntimeline: summer 2026\\r\\njob type: full time\\r\\n\\r\\nhard constraints: no remote roles\\r\\n\\r\\nstrengths: client relationship building. analytical skills. finance skills.\\r\\n\\r\\nconcerns: none stated.\\r\\n\\r\\nresume follows below.\\r\\n[see resume_text above]","active":true,"created_at":"2026-03-30 14:24:09.151975+00","updated_at":"2026-03-30 17:19:05.396+00","user_id":"c5751857-f530-405e-939a-1549084891ec","name":"ryan rudnet","job_type":"full time","target_roles":"wealth management roles","target_locations":"south florida, boca raton","preferred_locations":null,"timeline":"summer 2026","resume_text":"RYAN RUDNET\\r\\n(561) 797-1597 | rjrudnet@gmail.com | LinkedIn\\r\\n\\r\\nEDUCATION\\r\\nFlorida State University – Tallahassee, FL\\r\\nBachelor of Science in Finance | GPA: 3.7 May 2026\\r\\nStudy Abroad: FSU International Program at Valencia, Spain Summer 2024\\r\\nHonors/Awards: Dean's List | Intern of the Year | Counselor of the Year | Hospice-Trust Bridge, Compassion Magazine feature\\r\\nScholarships: Bright Futures | Megan F. Durtschi Memorial | J.M. Rubin | Boynton Beach Rotary Club | Valencia Shores | South Florida Fair | Burger King Scholar\\r\\nCertifications: Microsoft Office Specialist – Excel Associate | SIE preparation expected date: Spring 2026\\r\\n\\r\\nCORE COMPETENCIES\\r\\nFinancial Modeling | Investment Analysis | Portfolio Management | Valuation (DCF, NPV, IRR) | Capital Budgeting | Risk Management | Financial Reporting | Excel & Access | Regression Analysis | Linear Programming\\r\\n\\r\\nRELEVANT EXPERIENCE\\r\\nInvestments Intern – Florida State University Foundation, Division of University Advancement - FSU Apr 2025 – Present\\r\\nSupport investment operations for a $1B+ endowment, assisting with portfolio management and financial stewardship\\r\\nProcess stock gifts, charitable donations, capital calls, and distributions with accuracy and compliance\\r\\nPrepare daily receipts, journal entries, and SBA transactions in Financial Edge, strengthening operational accuracy\\r\\nConduct reporting and analysis in Excel/Access, providing performance reporting and insights to enhance portfolio transparency\\r\\n\\r\\nStock Portfolio Competition – FSU International Program at Valencia, Spain\\r\\nDeveloped and managed $100K stock portfolio, achieving the highest growth rate (7%) over six weeks\\r\\nConducted analysis to select stocks based on metrics including P/E ratio, dividend yield, historical returns, and market conditions\\r\\nTracked portfolio performance over six weeks by analyzing returns, cash and buying power, and market value to ensure optimal investment management decisions\\r\\n\\r\\nFinancial Management of the Firm\\r\\nAnalyzed corporate structures and strategies, evaluating organizational trade-offs impacting profitability and governance\\r\\nEmployed advanced financial analysis techniques (DCF, ratio analysis, time value of money) to evaluate capital investments\\r\\nApplied asset valuation models (CAPM, WACC) and capital budgeting techniques (NPV, IRR) to inform investment strategies\\r\\n\\r\\nADDITIONAL EXPERIENCE\\r\\nPurchasing and Sales Intern | OS2 Corp – Ft. Lauderdale, FL May 2023 - Aug 2023\\r\\nConducted research on government databases to identify and secure lucrative contracts, driving significant business growth\\r\\nShadowed CEO Al Levinstein, gaining insights into strategic purchasing decisions and operational leadership\\r\\nManaged departmental tasks, using organizational and delegation skills to enhance team productivity in a fast-paced setting\\r\\nRecognized as Intern of the Year for outstanding contributions to departmental success\\r\\n\\r\\nLEADERSHIP & INVOLVEMENT\\r\\nVice President & Co-Founder – Hearts for Healthcare, Student Organization - Tallahassee, FL Aug 2025 – Present\\r\\nFounded student-run nonprofit initiative supporting hospice patients through personalized cards distributed biannually\\r\\nBuilt partnerships with healthcare providers and engaged 50+ student volunteers\\r\\nOversee budgeting, event logistics, and outreach, ensuring sustained impact and effective stakeholder engagement\\r\\n\\r\\nExperience Camps – Blue Ridge, GA and Ft. Lauderdale, FL Jun 2020 - Present\\r\\nYouth Advisory Board Member, Fundraising Speaker, Counselor\\r\\nAdvocate for grieving youth by influencing program development and delivering impactful speeches to engage donors\\r\\nGuide campers in fostering teamwork and personal growth\\r\\nTook initiative to recruit new talent at FSU, successfully bringing on 7 student volunteers and counselors to expand program\\r\\n\\r\\nSigma Alpha Epsilon Fraternity | Executive Risk Officer, Member Mar 2023 - Present\\r\\nDevelop and enforce risk management policies for 300+ members while serving as liaison on risk-related issues to ensure compliance and safety\\r\\nLead training on emergency procedures, CPR, Narcan administration, and responsible behavior\\r\\n\\r\\nFSU Real Estate Club | FSU Financial Management Association (FMA) | Beta Alpha Psi Honor Society, Member\\r\\n\\r\\nSKILLS & INTERESTS\\r\\nSkills: Proficient: Microsoft Excel, Microsoft PowerPoint, and Microsoft Word, Google Suite\\r\\nInterests: Golf, Recreational Pickleball, International Traveling, Structured Weightlifting, Miami Dolphins Football","profile_structured":"{}","risk_overrides":null,"profile_version":1}]`

const JOB_TEXT = `Investment Associate (Financial Services Career Development Program)

Boca Raton, FL · On-site · Full-time

About the job
Investment Associate

People often ask us what an Investment Associate at Hennion & Walsh does. As an Investment Associate, you will experience a comprehensive 18-month financial services career development program designed to enable a yet-to-be registered individual to thrive in the financial services industry. We pay you while you study and prepare to take the various exams needed to be a licensed financial advisor. Once you have passed the examinations, your salary continues while you begin learning and understanding the skills it takes to succeed as an advisor at Hennion & Walsh. Hennion & Walsh provides ongoing training and support to all of our advisors. We have a proven success model that enables you to build a long-term career.

If you are a highly motivated individual and looking to join a vibrant growing company, Hennion & Walsh, Inc. may be the right choice for you. We are looking for performance-driven personalities and entrepreneurs in spirit who are looking to build a career helping the individual investor achieve their financial goals and dreams.

Overview

Hennion & Walsh is an advocate to the individual investor. We believe in putting the client first. At Hennion & Walsh, we know individual investors want a personal relationship with their advisor, and we believe in guiding our clients to achieve their financial goals and dreams through conservative income and growth strategies.

We are searching for highly talented and motivated individuals of all educational backgrounds to join our dynamic workforce as Investment Associates. Our ideal candidates thrive in a fast-paced environment, are goal-oriented, possess a great attitude, and communicate extremely well. We have immediate openings!

Opportunity

Work for a successful investment firm dedicated to performance, integrity, service, and innovation
Gain business expertise and market knowledge through our comprehensive training and mentoring program
Perform in an energetic, open environment
Succeed in an achievement-based culture

Qualifications

Bachelor's degree
Personal or professional track record of achievement
Highly professional work ethic
Ability to handle multiple responsibilities and take initiative
Excellent organizational and time management skills

Benefits

Competitive compensation
Open and supportive team-based environment
Full medical and dental benefits
401(k) plan with company match

The base salary range for this trainee position is $30,000.00-61,000.00 per year, plus variable compensation. Please note this role requires in-person attendance.

About the company
Hennion & Walsh
Financial Services, 51-200 employees
Hennion & Walsh was founded in 1990 with a single goal in mind: to become the nation's premier provider of investment services and a strong advocate for individual investors. For over 35 years, our disciplined, personalized approach has helped thousands of individuals grow and protect their investments by aligning strategies with their unique goals. Our heritage is rooted in municipal bonds, where we are recognized as a leading independent specialist serving individual investors in the municipal bond market. Today, we build on that foundation through our focus on municipal bonds and asset management, helping clients take a more complete and thoughtful approach to their overall financial picture.
`

async function main() {
  const arr = JSON.parse(PROFILE_JSON)
  const p = arr[0]
  const profileText = String(p.profile_text || "").trim() + "\n\nResume:\n" + String(p.resume_text || "").trim()

  const profileOverrides = mapClientProfileToOverrides({
    profileText,
    profileStructured: null,
    targetRoles: p.target_roles || null,
    preferredLocations: p.preferred_locations || p.target_locations || null,
  })

  const result: any = await runJobFit({
    profileText,
    jobText: JOB_TEXT,
    profileOverrides,
    userJobTitle: "Investment Associate",
    userCompanyName: "Hennion & Walsh",
  } as any)

  console.log("\n=== ISSUE-013 Retest — Ryan Rudnet / Hennion & Walsh Investment Associate ===")
  console.log("Decision:", result.decision, "/ Score:", result.score)
  console.log("Gate:", result.gate_triggered?.type, result.gate_triggered?.gateCode || "")
  console.log("Job family:", result.job_signals.jobFamily, "subfamily:", result.job_signals.financeSubFamily || "-")
  console.log("Profile targetFamilies:", result.profile_signals.targetFamilies)
  console.log("Profile finance subfamily:", result.profile_signals.financeSubFamily || "-")
  console.log("isSeniorRole:", result.job_signals.isSeniorRole)
  console.log("isTrainingProgram:", result.job_signals.isTrainingProgram)
  console.log("credentialRequired:", result.job_signals.credentialRequired, "sponsored:", result.job_signals.credentialSponsored)
  console.log("credentialDetail:", result.job_signals.credentialDetail)
  console.log("yearsRequired:", result.job_signals.yearsRequired, "profileYears:", result.profile_signals.yearsExperienceApprox, "gradYear:", result.profile_signals.gradYear)
  console.log("location:", JSON.stringify(result.job_signals.location))
  console.log("profileLoc:", JSON.stringify(result.profile_signals.locationPreference))
  console.log("functionTags:", result.job_signals.function_tags)
  console.log("\nWHY codes (" + (result.why_codes || []).length + "):")
  for (const w of result.why_codes || []) {
    console.log(`  [${w.code}] ${w.match_key} (${w.match_strength}, w=${w.weight})`)
    console.log("    job :", String(w.job_fact || "").slice(0, 150))
    console.log("    prof:", String(w.profile_fact || "").slice(0, 150))
  }
  console.log("\nRISK codes (" + (result.risk_codes || []).length + "):")
  for (const r of result.risk_codes || []) {
    console.log(`  [${r.code}] sev=${r.severity} w=${r.weight}`)
    console.log("   ", String(r.risk || "").slice(0, 220))
  }

  console.log("\nProfile evidence units (top 20):")
  for (const pu of (result.profile_signals.profile_evidence_units || []).slice(0, 20)) {
    console.log(`  [${pu.key}] ${pu.kind} s=${pu.strength} :`, String(pu.snippet || "").slice(0, 120))
  }

  console.log("\nJob requirement units (top 15):")
  for (const ju of (result.job_signals.requirement_units || []).slice(0, 15)) {
    console.log(`  [${ju.key}] ${ju.kind} req=${ju.requiredness} s=${ju.strength} :`, String(ju.snippet || "").slice(0, 120))
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
