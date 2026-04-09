#!/usr/bin/env tsx
// One-off retest: Emma Stein (UF Sophomore, Pre-Law) vs
// Richemont Americas Legal Intern (Summer 2026)

import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

const PROFILE_JSON = `[{"idx":28,"id":"446eb24b-2ebd-47b1-88f8-a9191c01e06c","email":"emmastein310@gmail.com","profile_text":"Name:Emma Stein\\r\\n\\r\\r\\nCurrent Status:Sophomore\\r\\nUniversity:University of Florida\\r\\nJob Type Preference:Internship\\r\\n\\r\\nPrimary Roles: anything that gets her legal experience.Secondary Roles:\\r\\nRoles You Don't Want: \\r\\n\\r\\nBusiness Finance: \\r\\nTechnology:\\r\\nMarketing Media:\\r\\nReal Estate Built Environment:\\r\\nHealthcare Lifesciences:\\r\\nConsumer Retail Lifestyle:\\r\\nIndustrial Manufacturing: \\r\\nScience Research: \\r\\nStartups:\\r\\nLaw: In House Council,Private Practice\\r\\n\\r\\nTarget Companies: \\r\\nAre You Open To Non Obvious Entry Points: Only if it is clearly connected\\r\\nPreferred Locations: South Florida (around Boca/Delray/Ft. Lauderdale)\\r\\n\\r\\nTimeline: Summer 2026 Feedback Style: Direct & Blunt (don't sugarcoat it)\\r\\nResume Text: Emma Stein\\nDelray Beach, FL | 561 901 5370 | emmastein@ufl.edu |LinkedIn\\n\\nEDUCATION\\nUniversity of Florida, Gainesville, FL\\nBachelor of Arts, History and Political Science | Pre Law Track\\t\\t                                               Exp. Graduation: May 2028\\nGPA 3.78/4.0  \\nAwards: Dean's List (every semester),  Florida's Bright Futures Full Tuition Scholarship\\nRelevant Coursework: Argument and Persuasion, Writing Strategic Communications, International Relations, Comparative Politics\\nRELEVANT EXPERIENCE\\nFlorida Blue Homecoming and Gator Growl\\nDeputy Chief of Staff, Accountability - Feb 2026 - Present\\nOversee cross-functional coordination across 50+ staff members by managing departmental responsibilities, attendance, and execution progress while maintaining a centralized task-tracking system to assign ownership, monitor deadlines, and ensure on-time delivery across all teams\\nUniversity of Florida Student Government Cabinet\\nAssistant Director, Student Engagement - Aug 2025 to Present\\nSupport planning and execution of campus wide programs involving multiple student organizations and administrators\\nCoordinate event logistics, timelines, and written communications for recurring student government initiatives\\nDraft written summaries explaining policies and initiatives for a non specialized student audience\\nUniversity of Florida Student Government Senate\\nOff Campus Senator - Aug 2025 to Present\\nRepresent off campus students during Senate sessions and committee discussions\\nReview proposals and listened to reports from student organizations and executive branch representatives\\nDocument concerns raised and collaborated with senators to track follow up actions\\nFlorida Blue Key Speech and Debate\\nAssistant Director, Round Robin - Aug 2025 to Present\\nCoordinate logistics for a statewide invitational debate tournament with approximately 200 participants\\nManage schedules, judge assignments, and issue resolution under fixed deadlines\\nCommunicate requirements and updates to participating schools and judges\\nRESEARCH AND WRITING EXPERIENCE\\nAcademic Research and Writing, University of Florida\\nConducted primary and secondary source research using archival documents, academic journals, and historical records\\nAnalyzed complex source material to identify patterns, arguments, and supporting evidence\\nProduced long form research papers and presentations requiring structured argumentation and formal citation\\nADDITIONAL EXPERIENCE\\nPizzeria Sophia, Delray Beach, FL\\nServer and Hostess - Sep 2023 to Apr 2024\\nManage multiple tables in a high-volume environment\\nLEADERSHIP AND ACTIVITIES\\nDance Marathon, University of Florida | Morale Captain and Emerging Leader - Aug 2024 to Present\\nDelta Phi Epsilon Sorority | Secretary - Jan 2025 to Dec 2025\\nMaintained official chapter records and managed attendance tracking for over 200 members\\nJewish Student Union, University of Florida | Assistant Director - Aug 2025 to Present\\nPanhellenic Council, University of Florida Panhellenic Counselor - Aug 2025 to Present\\n\\nOther Concerns: competition\\nStrengths: hungry to learn, quick on her feet, very observant, quick learner.","active":true,"name":"Emma Stein","job_type":"Internship","target_roles":"In House Council, Private Practice, legal intern, legal internship","target_locations":"South Florida (around Boca/Delray/Ft. Lauderdale)","preferred_locations":"South Florida (around Boca/Delray/Ft. Lauderdale)","timeline":"Summer 2026","profile_structured":"{}"}]`

const JOB_TEXT = `About the job
At Richemont Americas, we aspire to reflect the ever-changing world around us.

Embark on an enriching journey this summer by joining our dynamic and highly engaged Summer internship program at Richemont!

WE WELCOME Passionate and enthusiastic students eager to gain firsthand experience and contribute to the daily operations and exciting projects within the high-end luxury sector, spanning jewelry, timepieces, fashion, and accessories.

INTERNSHIP TITLE Richemont Americas Legal Intern

ROLE OVERVIEW As an intern on the Richemont Americas legal team, you will be fully immersed into Richemont's vibrant organization and unique culture, contributing to the daily operations and exciting projects of a dynamic and fast paced legal department. You will play a vital role in supporting the team across various initiatives, including the rollout of corporate governance platforms, revamping of an internal legal platform, assisting with compliance initiatives, streamlining legal processes, processing third-party subpoena requests, and drafting and reviewing various commercial agreements with guidance. This role offers a unique opportunity to gain firsthand experience in the exciting and intricate world of luxury.

Key Responsibilities
Supporting the rollout and adoption of the new Group corporate governance platform, which involved entity data validation, reviewing governance records, and supporting user testing and documentation for our region.
Supporting the revamping of the legal hub.
Contributing to drafting and reviewing commercial agreements and customer release letters.
Supporting and processing third-party subpoena requests, ensuring compliance with applicable laws, regulations, and internal policies.
Assisting with the implementation of a Contract Lifecycle Management (CLM) tool to streamline contract intake workflows and providing support for its rollout and user training.
Support any other operation tasks if needed.

YOUR PROFILE

Currently enrolled in an accredited university or college program, pursuing a degree
Technologically proficient with strong computer skills, including Microsoft Office Suite, Adobe Creative Suite, CRM systems.
Exceptional written and verbal communication abilities, with a keen eye for detail.
An innovative and proactive thinker, thriving in a dynamic, fast-paced environment.
A collaborative team player, eager to contribute, empower others, and achieve collective success.
Highly energetic and enthusiastic about supporting diverse projects and initiatives.
Available to commit to a full-time schedule throughout the entire duration of our Summer Internship Program from June 1st to August 7th.
Legally authorized to work in the United States. Please note: International students must possess a current work visa; Richemont North America does not sponsor work visas for summer internships.
Must be 18 years of age or older by the start of the program.

WE OFFER
A stimulating and engaging work environment, surrounded by passionate professionals dedicated to excellence.
The opportunity to gain invaluable insights into the luxury goods industry, laying a strong foundation for your future career.
Benefit from a dedicated Mentor, a subject matter expert and leader, who will guide your immersion and ensure a rich, supportive learning experience.
This is a paid internship, offering competitive compensation.
Compensation: $25/hourly.
`

async function main() {
  const arr = JSON.parse(PROFILE_JSON)
  const p = arr[0]
  const profileText = String(p.profile_text || "").trim()

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
    userJobTitle: "Legal Intern",
    userCompanyName: "Richemont Americas",
  } as any)

  console.log("\n=== Emma Stein vs Richemont Legal Intern ===")
  console.log("Decision:", result.decision, "/ Score:", result.score)
  console.log("Gate:", result.gate_triggered?.type, result.gate_triggered?.gateCode || "")
  console.log("Job family:", result.job_signals.jobFamily)
  console.log("Profile targetFamilies:", result.profile_signals.targetFamilies)
  console.log("isSeniorRole:", result.job_signals.isSeniorRole)
  console.log("isTrainingProgram:", result.job_signals.isTrainingProgram)
  console.log("isInternship (job side):", result.job_signals.internship?.isInternship)
  console.log("yearsRequired:", result.job_signals.yearsRequired, "profileYears:", result.profile_signals.yearsExperienceApprox, "gradYear:", result.profile_signals.gradYear)
  console.log("location:", JSON.stringify(result.job_signals.location))
  console.log("profileLoc:", JSON.stringify(result.profile_signals.locationPreference))
  console.log("isHourly:", result.job_signals.isHourly)
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
  console.log("\nJob requirement units (top 12):")
  for (const ju of (result.job_signals.requirement_units || []).slice(0, 12)) {
    console.log(`  [${ju.key}] ${ju.kind} req=${ju.requiredness} s=${ju.strength} :`, String(ju.snippet || "").slice(0, 120))
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
