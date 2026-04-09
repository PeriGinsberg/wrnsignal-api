#!/usr/bin/env tsx
// One-off retest: Reece Kauffman vs Pharmaceutical Sales Representative JD.
// Mirrors retest-026.ts but with the profile inline so the test data lives
// next to the script.

import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

const PROFILE_JSON = `[{"idx":37,"id":"5d15e03f-1067-4740-8604-5b66a7f5bf52","email":"peri+testreece1@workforcereadynow.com","profile_text":"Name:Reece Kauffman\\r\\n\\r\\nVery open to any role adjacent to clinical sales that will get him exposure to operatting rooms and surgical equipment.  Although not clearly stated in his resume, he does have some experience with operating rooms and surgical equipment.  Open to any shifts required.\\r\\nCurrent Status:Recent Graduate (0-12 months)\\r\\nUniversity:University of Colorado, Boulder\\r\\nJob Type Preference:Full Time Role\\r\\n\\r\\nPrimary Roles: Associate sales representative, Sales representative, clinical sales, medical sales, orthopedic sales, trauma sales, spinal sales, prostetic sales. Secondary Roles:\\r\\nRoles You Don't Want: \\r\\n\\r\\nBusiness Finance: Professional Services (General)\\r\\nTechnology:HealthTech\\r\\nMarketing Media:\\r\\nReal Estate Built Environment:\\r\\nHealthcare Lifesciences:Healthcare Services,Hospitals and Health Systems,Medical Devices\\r\\nConsumer Retail Lifestyle:\\r\\nIndustrial Manufacturing: \\r\\nScience Research: \\r\\nStartups:\\r\\nLaw: \\r\\n\\r\\nTarget Companies: \\r\\nAre You Open To Non Obvious Entry Points: Only if it is clearly connected\\r\\nPreferred Locations: South Florida specifically Fort Lauderdale\\r\\n\\r\\nTimeline: May 2026 Feedback Style: Direct & Blunt (don't sugarcoat it)\\r\\nResume Text: REECE KAUFFMAN\\r\\n(954) 494-0665 | reecekauffman@gmail.com | LinkedIn \\r\\n\\r\\nClinical Sales Representative candidate with active EMT experience and a B.A. in Integrative Physiology. Experienced communicating directly with physicians and medical teams in fast paced care environments and documenting clinical information accurately. Comfortable operating around medical equipment and navigating hospital settings. Brings prior B2B sales experience initiating professional conversations and building new accounts.\\r\\nEDUCATION\\r\\nUniversity of Colorado Boulder                                                    Boulder, CO\\r\\nB.A. Integrative Physiology                                                       May 2025\\r\\nRelevant Coursework: Human Anatomy Laboratory, Exercise Physiology, Immunology, Endocrinology, Medical Terminology, Physiology Lab, Biology, Chemistry, Physics\\r\\nCLINICAL EXPERIENCE\\r\\nAmerican Medical Response (AMR)                                                  Bronx, NY\\r\\nSpecial Events EMT                                                               January 2026 – Present\\r\\nProvide on site emergency medical care at large scale venues including Madison Square Garden and Radio City Music Hall\\r\\nAssess patients, monitored vital signs, and administered appropriate pre hospital interventions\\r\\nDocument patient care reports and communicated findings to receiving medical personnel\\r\\nCoordinate with event staff and supervisors to manage medical incidents in high traffic environments\\r\\nDr. Harris Gellman, Orthopedic Surgeon                                          Coral Springs, FL\\r\\nPhysician Shadow                                                                 May 2024\\r\\nPresent in operating room observing orthopedic surgical procedures and overall surgical workflow\\r\\nCommunicated directly with nurse practitioners, physician assistants, sales representatives, and scrub technicians\\r\\nObserved patient consultations and treatment planning in a specialty orthopedic practice\\r\\nCU Sports Medicine Facility                                                     Boulder, CO\\r\\nPhysical Therapy Intern                                                          Spring 2024\\r\\nAssisted with equipment setup and patient flow during treatment sessions\\r\\nShadowed patient evaluations and rehabilitation sessions in an outpatient clinical setting\\r\\nDocumented observations and supported therapists with session preparation\\r\\nSELECTED ACADEMIC PROJECT\\r\\nPhysiological Response to Music Tempo Study\\r\\nDesigned a controlled crossover experiment measuring heart rate, systolic blood pressure, and body temperature under varying tempo conditions\\r\\nCollected and analyzed physiological data using paired t tests in R and presented findings to faculty and peers\\r\\nSALES EXPERIENCE\\r\\nProfessional Sports Publications                                                 Manhattan, NY\\r\\nInside Sales Representative                                                      September 2025 – January 2026\\r\\nConducted 200 plus outbound cold calls daily to business owners and decision makers\\r\\nManaged approximately 400 active B2B prospects within a rotating pipeline\\r\\nClosed new advertising accounts through direct outreach and sales presentations\\r\\nMerrill Lynch, Stoss Hopper and Associates                                      Weston, FL\\r\\nIntern                                                                           June – July 2024\\r\\nSupported advisors by scheduling client meetings and maintaining client communication\\r\\nGenerated warm leads and referrals through outreach to existing contacts\\r\\nCERTIFICATIONS AND AFFILIATIONS\\r\\nCertified Emergency Medical Technician | EMT Utah | July 2025\\r\\nAmerican Red Cross Volunteer\\r\\nCover Letter Text:\\r\\n\\r\\nOther Concerns:Lack of sales experience, lack of connections to the industry \\r\\nStrengths: Work ethic, clinical knowledge, comfortability in emergency settings","active":true,"created_at":"2026-04-03 14:36:49.640439+00","updated_at":"2026-04-05 14:20:29.557+00","user_id":"11649dfa-90cf-474a-bc5d-abecb84cf9a9","name":"Reece Kauffman","job_type":"Full Time Role","target_roles":"Associate sales representative, Sales representative, clinical sales, medical sales, orthopedic sales, trauma sales, spinal sales, prostetic sales","target_locations":null,"preferred_locations":"South Florida specifically Fort Lauderdale","timeline":"May 2026","resume_text":"REECE KAUFFMAN","profile_structured":"{}","risk_overrides":null,"profile_version":1}]`

const JOB_TEXT = `Pharmaceutical Sales Representative (Entry level or Experienced)

We are a national Pharmaceutical CSO company bring life-changing medicines to those who need them, as well as improve the understanding and management of disease.  We give our best effort to our work, and we put our sales people first. We're looking for sales professionals who want to work on our Pharmaceutical Sales Rep team and who are determined to make life better for patients.

Responsibilities – Pharmaceutical Sales Representative

Have you demonstrated your ability to achieve results in a challenging and progressive environment? Are you a self-starter with the desire to achieve and win?

Key Pharmaceutical Sales Responsibilities:

Partner with health care professionals and those involved with patient care as a product expert to tailor solutions for patient therapy
Work in your own pharmaceutical sales territory and also partner with team members and alliance partners for success in the territory
Sell in a changing health care environment, utilizing critical thinking and a strategic mindset to understand the environment (payer, health systems, business) and gain access to the customers to make an impact on patients' lives
Achieve sales growth in territory and deliver on strong sales results
Operate with high integrity and comply with pharmaceutical sales industry policies and procedures

Requirements
Key Pharmaceutical Sales Requirements:

Basic Qualifications – Pharmaceutical Sales Rep

A degree as well as Professional certification or license required to perform this position (if required by a specific state)
Successfully completed the Pre-Employment Screen
Qualified candidates must be legally authorized to be employed in the United States.

Additional Information – Pharmaceutical Sales Rep

Ability to provide secure and temperature controlled location for product samples may be required
We are an EEO/Affirmative Action Employer and does not discriminate on the basis of age, race, color, religion, gender, sexual orientation, gender identity, gender expression, national origin, protected veteran status, disability or any other legally protected status.

Additional Skills/Preferences – Pharmaceutical Sales Rep

Live within territory or within 30 miles of territory boundaries
Demonstrated business insight
Completion of some kind of pharmaceutical sales training or education
Excellent communication and organizational skills
Ability to collaborate in a team environment
`

async function main() {
  const arr = JSON.parse(PROFILE_JSON)
  const p = arr[0]
  const profileText = String(p.profile_text || "").trim()

  const profileOverrides = mapClientProfileToOverrides({
    profileText,
    profileStructured: null,
    targetRoles: p.target_roles || null,
    preferredLocations: p.preferred_locations || null,
  })

  const result: any = await runJobFit({
    profileText,
    jobText: JOB_TEXT,
    profileOverrides,
    userJobTitle: "Pharmaceutical Sales Representative",
    userCompanyName: "(Unknown Pharma CSO)",
  } as any)

  console.log("\n=== Reece 01 — Pharmaceutical Sales Representative ===")
  console.log("Decision:", result.decision, "/ Score:", result.score)
  console.log("Gate:", result.gate_triggered?.type)
  console.log("Job family:", result.job_signals.jobFamily)
  console.log("Profile targetFamilies:", result.profile_signals.targetFamilies)
  console.log("isSeniorRole:", result.job_signals.isSeniorRole)
  console.log("yearsRequired:", result.job_signals.yearsRequired)
  console.log("profileYears:", result.profile_signals.yearsExperienceApprox, "gradYear:", result.profile_signals.gradYear)
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
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
