#!/usr/bin/env tsx
// ISSUE-zoe retest: Zoe Siegel (OSU undergrad, philosophy/politics/economics
// major) vs DiCello Levitt Mass Tort Paralegal (Cleveland, OH).
//
// Original complaint: engine returned 89 / Apply on a posting that requires
// a Minimum of four (4) years as a paralegal + 1 year of mass tort litigation
// experience. Zoe is a current undergrad with student internships only —
// zero professional paralegal years. No experience-gap risk fired.
//
// Root cause: extractYearsRequired returned null because the regex patterns
// in policy.ts didn't handle (a) singular "year", (b) parenthetical-digit
// phrasing like "four (4) years" — the JD uses both. Without yearsRequired,
// the RISK_EXPERIENCE penalty at scoring.ts:1424 never triggered.
//
// Fix: policy.ts patterns updated to support `years?|yrs`, a new
// parenthetical-digit pattern, and "minimum of" phrasing. extract.ts gets
// a written-number expansion preprocessing pass (one→1, two→2, ..., ten→10)
// so written-form tenure clauses like "four years of experience" also parse.

import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

const PROFILE_JSON = `[{"id":"zoe-test","email":"zoe-test@example.com","profile_text":"zoe siegel is a full-time-target candidate seeking legal-adjacent roles for summer/post-grad 2026.\\n\\ntarget roles: legal intern, paralegal\\ntimeline: summer 2026\\njob type: full time\\n\\nresume follows below.\\n[see resume_text above]","active":true,"created_at":"2026-05-04 00:00:00+00","updated_at":"2026-05-04 00:00:00+00","user_id":null,"name":"zoe siegel","job_type":"full time","target_roles":"legal intern, paralegal","target_locations":"ohio","preferred_locations":null,"timeline":"summer 2026","resume_text":"ZOE C. SIEGEL\\n(561) 400-9335 | zoesiegel18@gmail.com | LinkedIn Profile\\n\\nEDUCATION\\nThe Ohio State University — Columbus, OH\\nBachelor of Arts and Sciences in Philosophy, Politics, and Economics — Exp. Graduation May 2026\\nGPA: 3.62\\nHonors: Dean's List, National Buckeye Scholarship\\nOxbridge Academic Program: Coursework in Art History and International Studies — Paris, France\\n\\nLEGAL EXPERIENCE\\nNational CASA GAL Association for Children — Columbus, OH\\nLegal Intern — Aug 2025 to Dec 2025\\nAnalyzed juvenile case files involving abuse and neglect to identify legal and factual issues\\nResearched statutory authority and case law including ICWA to support advocacy positions\\nPrepared case summaries and precedent research used in juvenile court hearings\\nTracked juvenile cases through multiple court hearings and coordinated case information effectively with prosecutors and attorneys\\n\\nEighth District Court of Appeals — Cleveland, OH\\nCourt Clerk Intern — May 2025 to Jul 2025\\nReviewed and organized appellate briefs and trial court records to support ongoing civil appeal cases\\nDrafted detailed bench memoranda analyzing legal issues, procedural posture, and standards of review to assist judges in decision-making\\nPrepared statements of facts and issue outlines for oral argument preparation\\nPresented case analyses to a sitting appellate judge during case conferences\\n\\nPOLICY AND ADVOCACY EXPERIENCE\\nAmerican Israel Public Affairs Committee — Washington, DC\\nPolitical Advocacy Intern — May 2024 to Aug 2024\\nConducted detailed legislative and policy research to support and inform government affairs and advocacy initiatives\\nPrepared comprehensive policy briefing summaries for effective staff engagement with congressional offices\\nDocumented and tracked advocacy meetings with members of Congress and staff\\nParticipated in meetings supporting passage of federal legislation\\n\\nBUCiPAC — The Ohio State University — Columbus, OH\\nPolitical Director — Aug 2024 to Present\\nCoordinated meetings between student leaders and state and federal elected officials\\nSupported advocacy efforts related to U.S. Israel legislative initiatives\\nWorked with national organizations to identify policy priorities and guest speakers\\n\\nLEADERSHIP AND INVOLVEMENT\\nCampus Engagement Intern | OSU Hillel — Aug 2023 to Aug 2024\\nExecuted 4 student engagement events in coordination with a 15 member team and tracked attendance outcomes\\nIncreased active membership by 60% through structured outreach and student follow up\\n\\nFreelance Writer | The Lantern — Aug 2024 to Aug 2025\\nWrote reported articles and opinion pieces on campus life under editorial review and deadlines\\n\\nWRITING AND RESEARCH\\nPrepared appellate bench memorandum analyzing juvenile offender classification under Ohio law\\nComposed policy briefs on economic and environmental legislation\\nDrafted legislative proposals presented to the Ohio Senate addressing mandated adoption and enforcement of harassment, intimidation, and bias protections for marginalized communities at Ohio State University\\nPublished opinion and investigative articles for The Lantern\\n\\nSKILLS\\nLegal research | Legal writing | Case law analysis | Microsoft Office | American Sign Language conversational proficiency","profile_structured":"{}","risk_overrides":null,"profile_version":1}]`

const JOB_TEXT = `About the job
Are you an experienced Paralegal with at least 1 year experience in Mass Tort litigation and can you work 4 days a week onsite in Mentor, OH?

Are you looking for a career where your work makes a meaningful difference in people's lives and your community? This role plays a vital part in supporting justice in all its dimensions.

If the answer is YES, we want to talk to you - Apply Today

Join a firm that is shaping front-page headlines pursuing justice every day, whether litigating some of the most significant civil and human rights cases of our time or ensuring that companies take responsibility for their actions and remediate the harm they have caused.

DiCello Levitt, a nationally prominent, Chambers and Benchmark-rated law firm with offices nationwide, is seeking a full-time Paralegal in our Cleveland, Ohio office supporting the Mass Tort practice group.

Firm Description
DiCello Levitt is a leading national plaintiffs' law firm representing clients in class action, business-to-business, public client, whistleblower, personal injury, civil rights, and mass tort litigation. The firm has delivered $20B+ in awards and settlements to our clients and has been recognized for our excellence in litigation by Chambers USA, Law360, Benchmark Litigation, Lawdragon, and The National Law Journal.

Role and Responsibilities
This listing is for a full-time experienced mass tort paralegal. Medical malpractice and nursing home negligence experience is also beneficial for this role.
Ideal candidates will have significant experience communicating with clients; maintaining files; working with Adobe, Excel, PowerPoint and Word; managing a mass tort docket and drafting correspondence and other preliminary matters. This role requires great attention to detail, management of large data sets, ability to generate and track reporting, and to work in a multi-office team environment. Experience with a large document and/or case management system is highly preferred.

Responsibilities will include:
Organize and maintain case files, track deadlines, and ensure all necessary documentation is up-to-date and accessible. Maintain regular communication with clients, providing updates, gathering information, and addressing inquiries in a timely and professional manner.
Conduct legal research to support case preparation, including statutes, case law, and other legal references relevant to ongoing cases.
Accurately enter and update case-related data into case management systems, ensuring that all information is properly logged and easily accessible for ongoing casework.
Manage multiple projects simultaneously, prioritizing tasks and meeting deadlines, while maintaining attention to detail and high standards of accuracy.
Draft, proofread, and file legal documents such as pleadings, motions, discovery requests, and responses.
Review case documents for relevance, accuracy, and completeness, ensuring all pertinent information is captured and organized effectively.
Draft and send a high volume of written correspondence, including letters, emails, and status updates, to clients, opposing counsel, and court personnel in a clear, professional, and timely manner.
Performs other duties as assigned.

Desired Skills and Qualifications
The successful candidate should have the following qualifications:
Skilled in organizing and maintaining electronic case files.
Strong written and verbal communication for drafting documents and client interaction.
Proficient with legal research tools and Microsoft Office Suite (Word, Excel, Outlook), with the ability to adapt to new technologies as needed.
Familiar with court rules, filing deadlines, and legal processes.
Able to thrive and maintain organization while managing competing priorities and working under pressure in a dynamic, high-volume setting.
Understanding of and adherence to ethical guidelines and confidentiality requirements, ensuring client information and case details are protected.
Commitment to continuing legal education and staying updated on industry trends and best practices.

Education and Experience
Associate degree or certification in Paralegal Studies, Legal Studies, or similar field of study preferred.
Minimum of four (4) years of experience as a paralegal, with a minimum of 1 year of mass tort litigation experience
Experience with case management systems, preferably Litify (Salesforce) or Needles.`

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
    userJobTitle: "Paralegal",
    userCompanyName: "DiCello Levitt",
  } as any)

  console.log("\n=== ZOE retest — Zoe Siegel / DiCello Levitt Mass Tort Paralegal ===")
  console.log("Decision:", result.decision, "/ Score:", result.score)
  console.log("Gate:", result.gate_triggered?.type, result.gate_triggered?.gateCode || "")
  console.log(
    "yearsRequired:",
    result.job_signals.yearsRequired,
    "/ profile yearsExperienceApprox:",
    result.profile_signals.yearsExperienceApprox
  )
  console.log("Job family:", result.job_signals.jobFamily)
  console.log("Profile targetFamilies:", result.profile_signals.targetFamilies)
  console.log("isSeniorRole:", result.job_signals.isSeniorRole)
  console.log("\nWHY codes (" + (result.why_codes || []).length + "):")
  for (const w of result.why_codes || []) {
    console.log(`  [${w.code}] ${w.match_key} (${w.match_strength}, w=${w.weight})`)
  }
  console.log("\nRISK codes (" + (result.risk_codes || []).length + "):")
  for (const r of result.risk_codes || []) {
    console.log(`  [${r.code}] severity=${r.severity}, w=${r.weight}`)
    console.log("    risk:", String(r.risk || "").slice(0, 200))
  }
}

export const CASE = {
  id: "retest-zoe-paralegal",
  label: "Zoe Siegel vs DiCello Levitt Mass Tort Paralegal",
  profileJson: PROFILE_JSON,
  jobText: JOB_TEXT,
  userJobTitle: "Paralegal",
  userCompanyName: "DiCello Levitt",
}

const isMainEntryPoint = (process.argv[1] || "")
  .replace(/\\/g, "/")
  .endsWith("/retest-zoe-paralegal.ts")
if (isMainEntryPoint) {
  main().catch((e) => {
    console.error(e)
    process.exit(2)
  })
}
