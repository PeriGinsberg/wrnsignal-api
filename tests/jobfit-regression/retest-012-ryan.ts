#!/usr/bin/env tsx
// ISSUE-012 retest: Ryan Rudnet vs Raymond James Client Service Associate.
// Original complaint: "Gave a score of Review but I think it's a good match.
// The system has trouble recognizing the difference between required skills
// and just descriptive lists of skills you will learn (this is an entry
// level job)".

import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

const PROFILE_JSON = `[{"idx":35,"id":"5938d75d-e10e-4757-a7f3-e8b50fd83ae0","email":"erin+testryan1@workforcereadynow.com","profile_text":"ryan rudnet is a full time candidate targeting wealth management roles in south florida, boca raton for summer 2026.\\r\\n\\r\\ntarget roles: wealth management roles\\r\\ntimeline: summer 2026\\r\\njob type: full time\\r\\n\\r\\nhard constraints: no remote roles\\r\\n\\r\\nstrengths: client relationship building. analytical skills. finance skills.\\r\\n\\r\\nconcerns: none stated.\\r\\n\\r\\nresume follows below.\\r\\n[see resume_text above]","active":true,"created_at":"2026-03-30 14:24:09.151975+00","updated_at":"2026-03-30 17:19:05.396+00","user_id":"c5751857-f530-405e-939a-1549084891ec","name":"ryan rudnet","job_type":"full time","target_roles":"wealth management roles","target_locations":"south florida, boca raton","preferred_locations":null,"timeline":"summer 2026","resume_text":"RYAN RUDNET\\r\\n(561) 797-1597 | rjrudnet@gmail.com | LinkedIn\\r\\n\\r\\nEDUCATION\\r\\nFlorida State University – Tallahassee, FL\\r\\nBachelor of Science in Finance | GPA: 3.7 May 2026\\r\\nStudy Abroad: FSU International Program at Valencia, Spain Summer 2024\\r\\nHonors/Awards: Dean's List | Intern of the Year | Counselor of the Year | Hospice-Trust Bridge, Compassion Magazine feature\\r\\nScholarships: Bright Futures | Megan F. Durtschi Memorial | J.M. Rubin | Boynton Beach Rotary Club | Valencia Shores | South Florida Fair | Burger King Scholar\\r\\nCertifications: Microsoft Office Specialist – Excel Associate | SIE preparation expected date: Spring 2026\\r\\n\\r\\nCORE COMPETENCIES\\r\\nFinancial Modeling | Investment Analysis | Portfolio Management | Valuation (DCF, NPV, IRR) | Capital Budgeting | Risk Management | Financial Reporting | Excel & Access | Regression Analysis | Linear Programming\\r\\n\\r\\nRELEVANT EXPERIENCE\\r\\nInvestments Intern – Florida State University Foundation, Division of University Advancement - FSU Apr 2025 – Present\\r\\nSupport investment operations for a $1B+ endowment, assisting with portfolio management and financial stewardship\\r\\nProcess stock gifts, charitable donations, capital calls, and distributions with accuracy and compliance\\r\\nPrepare daily receipts, journal entries, and SBA transactions in Financial Edge, strengthening operational accuracy\\r\\nConduct reporting and analysis in Excel/Access, providing performance reporting and insights to enhance portfolio transparency\\r\\n\\r\\nStock Portfolio Competition – FSU International Program at Valencia, Spain\\r\\nDeveloped and managed $100K stock portfolio, achieving the highest growth rate (7%) over six weeks\\r\\nConducted analysis to select stocks based on metrics including P/E ratio, dividend yield, historical returns, and market conditions\\r\\nTracked portfolio performance over six weeks by analyzing returns, cash and buying power, and market value to ensure optimal investment management decisions\\r\\n\\r\\nFinancial Management of the Firm\\r\\nAnalyzed corporate structures and strategies, evaluating organizational trade-offs impacting profitability and governance\\r\\nEmployed advanced financial analysis techniques (DCF, ratio analysis, time value of money) to evaluate capital investments\\r\\nApplied asset valuation models (CAPM, WACC) and capital budgeting techniques (NPV, IRR) to inform investment strategies\\r\\n\\r\\nADDITIONAL EXPERIENCE\\r\\nPurchasing and Sales Intern | OS2 Corp – Ft. Lauderdale, FL May 2023 - Aug 2023\\r\\nConducted research on government databases to identify and secure lucrative contracts, driving significant business growth\\r\\nShadowed CEO Al Levinstein, gaining insights into strategic purchasing decisions and operational leadership\\r\\nManaged departmental tasks, using organizational and delegation skills to enhance team productivity in a fast-paced setting\\r\\nRecognized as Intern of the Year for outstanding contributions to departmental success\\r\\n\\r\\nLEADERSHIP & INVOLVEMENT\\r\\nVice President & Co-Founder – Hearts for Healthcare, Student Organization - Tallahassee, FL Aug 2025 – Present\\r\\nFounded student-run nonprofit initiative supporting hospice patients through personalized cards distributed biannually\\r\\nBuilt partnerships with healthcare providers and engaged 50+ student volunteers\\r\\nOversee budgeting, event logistics, and outreach, ensuring sustained impact and effective stakeholder engagement\\r\\n\\r\\nExperience Camps – Blue Ridge, GA and Ft. Lauderdale, FL Jun 2020 - Present\\r\\nYouth Advisory Board Member, Fundraising Speaker, Counselor\\r\\nAdvocate for grieving youth by influencing program development and delivering impactful speeches to engage donors\\r\\nGuide campers in fostering teamwork and personal growth\\r\\nTook initiative to recruit new talent at FSU, successfully bringing on 7 student volunteers and counselors to expand program\\r\\n\\r\\nSigma Alpha Epsilon Fraternity | Executive Risk Officer, Member Mar 2023 - Present\\r\\nDevelop and enforce risk management policies for 300+ members while serving as liaison on risk-related issues to ensure compliance and safety\\r\\nLead training on emergency procedures, CPR, Narcan administration, and responsible behavior\\r\\n\\r\\nFSU Real Estate Club | FSU Financial Management Association (FMA) | Beta Alpha Psi Honor Society, Member\\r\\n\\r\\nSKILLS & INTERESTS\\r\\nSkills: Proficient: Microsoft Excel, Microsoft PowerPoint, and Microsoft Word, Google Suite\\r\\nInterests: Golf, Recreational Pickleball, International Traveling, Structured Weightlifting, Miami Dolphins Football","profile_structured":"{}","risk_overrides":null,"profile_version":1}]`

const JOB_TEXT = `Client Service Associate

Boca Raton, FL · On-site · Full-time

Job Description Summary

Under direct supervision, uses intermediate skills obtained through experience and training to assist Financial Advisors and provide clients with quality service. Follows established procedures to perform routine tasks and receives general guidance and direction to perform a variety of non-routine tasks with limited decision making responsibility. Routine contact with internal and external customers is required to obtain, clarify or provide facts and information.

Job Summary

Celebrating more than 60 years of rich history and recognition for service and excellence in the Financial Services industry, Raymond James is seeking a dynamic Client Service Associate who is a motivated, detail oriented and creative problem solver to join our growing team. This essential role helps to provide high quality/high touch critical administrative support to Financial Advisors, their prospective and existing clients and other branch staff team members. The ideal candidate will have effective communication skills across multiple platforms (phone, email, in-person, virtual), as well as the ability to organize, manage, and track multiple, detailed tasks and assignments with frequently changing priorities and deadlines in a fast-paced, task-oriented work environment.

Essential Duties And Responsibilities

Services a high volume of daily interactions, including basic inquiries and scheduling of meetings, with prospective and existing clients on the phone, in-person, virtually and through mailings.
Works both independently and within a dynamic team environment to provide crucial support to the financial advisors and branch office.
With a high level of organization and accuracy, processes client financial transactions and financial advisor and branch office expenses and expense reports.
Opens new client accounts and researches client and security information using internal databases and other technologies.
For proper maintenance and to meet firm and industry requirements, ensures client paperwork and documentation is accurate and correct prior to submission and processing. Follows up to ensure accurate completion.
Prepares letters, forms and reports to assist with servicing existing clients and prospecting for new clients.
Prepares various business summary reports and client-specific reporting as needed for review by the financial advisor.
Creates and maintains records and files utilizing Client Relationship Management (CRM) software.
Assists Financial Advisors with marketing efforts including seminars and other client-facing events.
May enter orders at the direction of the Financial Advisor.
Actively engages in available training/cross-training and educational and/or professional development opportunities to remain current on firm and industry policies and procedures.
Performs other duties and responsibilities as assigned.

Knowledge of

Company's working structure, policies, mission, and strategies.
General office practices, procedures, and methods.
Investment concepts, practices and procedures used in the securities industry.
Financial markets, products and industry regulations.

Skill in

Client Relationship Management (CRM) software, or similar contact management software.
Excel, including developing spreadsheets as needed and for ongoing reporting.
Effective communication across multiple client interactive platforms (in-person, virtual, phone and mail)

Ability to

Operate standard office equipment and using required software applications to produce correspondence, reports, electronic communication, spreadsheets, and databases.
Analyze and research account information.
Organize, manage, and track multiple, detailed tasks and assignments with frequently changing priorities and deadlines in a fast-paced, task-oriented work environment.
Identify time sensitive items and assess competing priorities.
Take initiative and proactively follow up on submitted items to ensure completion; resolve errors, questions or concerns.
Handle stressful situations and provide a high level of customer service in a calm and professional manner.
Analyze problems and establish solutions in a fast paced environment.
Use mathematics sufficient to process account and transaction information.
Use appropriate interpersonal styles and communicate effectively, both orally and in writing, with all organizational levels, in person and virtually.
Work both independently and as part of a cohesive team.
Provide a high level of customer service.

Education/Previous Experience

High School Diploma or equivalent and one (1) or more years securities industry or related work experience preferred, or an equivalent combination of experience, education, and/or training as approved by Human Resources.

Education

High School (HS) (Required)

Work Experience

General Experience - 0 to 3 months

Travel

Less than 25%

Workstyle

Resident

About the company
Raymond James
Financial Services, 10001+ employees
Founded in 1962 and a public company since 1983, Raymond James Financial, Inc. is a Florida-based diversified holding company providing financial services to individuals, corporations and municipalities through its subsidiary companies engaged primarily in investment and financial planning, in addition to capital markets and asset management. The firm's stock is traded on the New York Stock Exchange (RJF).
`

async function main() {
  const arr = JSON.parse(PROFILE_JSON)
  const p = arr[0]
  const profileText = (String(p.profile_text || "").trim() + "\n\nResume:\n" + String(p.resume_text || "").trim()).trim()

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
    userJobTitle: "Client Service Associate",
    userCompanyName: "Raymond James",
  } as any)

  console.log("\n=== ISSUE-012 Retest — Ryan Rudnet / Raymond James Client Service Associate ===")
  console.log("Decision:", result.decision, "/ Score:", result.score)
  console.log("Gate:", result.gate_triggered?.type, result.gate_triggered?.gateCode || "")
  console.log("Job family:", result.job_signals.jobFamily, "subfamily:", result.job_signals.financeSubFamily || "-")
  console.log("Profile targetFamilies:", result.profile_signals.targetFamilies)
  console.log("Profile finance subfamily:", result.profile_signals.financeSubFamily || "-")
  console.log("isSeniorRole:", result.job_signals.isSeniorRole)
  console.log("isTrainingProgram:", result.job_signals.isTrainingProgram)
  console.log("credentialRequired:", result.job_signals.credentialRequired, "sponsored:", result.job_signals.credentialSponsored)
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
  console.log("\nProfile evidence units (top 15):")
  for (const pu of (result.profile_signals.profile_evidence_units || []).slice(0, 15)) {
    console.log(`  [${pu.key}] ${pu.kind} s=${pu.strength} :`, String(pu.snippet || "").slice(0, 120))
  }
  console.log("\nJob requirement units (top 15):")
  for (const ju of (result.job_signals.requirement_units || []).slice(0, 15)) {
    console.log(`  [${ju.key}] ${ju.kind} req=${ju.requiredness} s=${ju.strength} :`, String(ju.snippet || "").slice(0, 120))
  }
}

export const CASE = {
  id: "retest-012-ryan",
  label: "Ryan Rudnet vs Raymond James Client Service Associate",
  profileJson: PROFILE_JSON,
  jobText: JOB_TEXT,
  userJobTitle: "Client Service Associate",
  userCompanyName: "Raymond James",
}

const isMainEntryPoint = (process.argv[1] || "").replace(/\\/g, "/").endsWith("/retest-012-ryan.ts")
if (isMainEntryPoint) {
  main().catch((e) => { console.error(e); process.exit(2) })
}
