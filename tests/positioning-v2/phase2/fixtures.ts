// tests/positioning-v2/phase2/fixtures.ts
//
// Canonical slices of the Catherine Lees fixture (jobfit_run
// 96722a07-9a11-445d-869c-b1bbd0957740 in dev Supabase, traced from
// phase2_runs 9d5ebb75-...). Provides real-shape happy-path data for
// the itemPopulator helper tests; synthetic edge-case fixtures stay
// local to the test file that exercises them.
//
// Don't expand to the full 1100-line result_json — slice only what each
// test actually needs. This file is bigger than typical fixtures because
// real why_structured / requirement_units entries are long-form strings.

import type {
  JobfitResultJson,
  WhyStructuredItem,
} from "@/lib/positioning/v2/types"

// ─── why_structured slices ────────────────────────────────────────

/**
 * Real why_structured entry from Catherine's fixture. Action begins
 * with "In your resume, retitle this project bullet" — should match
 * the "retitle" reframe-flavored phrase and produce a BulletCandidate
 * if the lead anchors to the resume.
 */
export const WHY_REFRAME_FLAVORED: WhyStructuredItem = {
  keyword: "ANALYSIS AND REPORTING EXECUTION",
  lead: "You performed industry, audience, and SWOT analyses for a boutique retail brand and presented findings through a professional client deck and written report.",
  connection:
    "This analytical rigor directly mirrors the data-driven decision-making and reporting Versant expects from finance and analytics interns supporting corporate strategy.",
  action:
    "In your resume, retitle this project bullet to emphasize 'data analysis' and 'strategic reporting' — use Versant's own language from the job description to signal you already think in metrics.",
}

/**
 * Real why_structured entry from Catherine's fixture. Action begins
 * with "Mention in your optional letter" — a cover letter direction,
 * NOT a resume reframe. Must be SKIPPED by extractBulletCandidates.
 */
export const WHY_NOT_REFRAME_FLAVORED: WhyStructuredItem = {
  keyword: "COLLABORATIVE TEAM OPERATIONS",
  lead: "You coordinated sponsorship, networking, and professional development events as one of 24 students selected from 300+ applicants for BPAD.",
  connection:
    "Versant values interns who thrive in fast-paced, collaborative environments — your track record managing events and stakeholder coordination shows you can execute operations under pressure.",
  action:
    "Mention in your optional letter that you're drawn to understanding how modern media companies coordinate across teams; reference your event coordination experience as proof you can handle a structured, team-based environment.",
}

/**
 * Real why_structured entry from Catherine's fixture. Action contains
 * "Frame this project" — should match the "frame this" reframe phrase.
 * Used in tests to confirm multi-phrase matching and to construct the
 * top-3 keywords array.
 */
export const WHY_FRAME_AS_FLAVORED: WhyStructuredItem = {
  keyword: "CLIENT COMMUNICATION AND STRATEGY",
  lead: "You collaborated on a brand communications audit including stakeholder interviews, brand immersion, and strategy development aligned with audience insights.",
  connection:
    "The people operations and workforce initiatives Versant interns shape require exactly this blend of research, stakeholder engagement, and strategic alignment — your audit framework transfers directly.",
  action:
    "Frame this project as 'stakeholder research and strategy development' in your cover letter; draw a line between understanding brand audiences and understanding employee/organizational needs in an HR context.",
}

// ─── requirement_units slices ─────────────────────────────────────

/**
 * Core requirement from Catherine's fixture: financial_analysis. Should
 * produce a GapCandidate against a resume that doesn't mention finance,
 * financial, analysis, or investment.
 */
export const REQ_CORE_FINANCIAL_ANALYSIS = {
  id: "b497f96b73f7a903",
  key: "financial_analysis",
  kind: "function",
  label: "financial analysis and investment work",
  snippet: "Finance role — financial analysis and reporting expected",
  strength: 8,
  functionTag: "finance_corp",
  requiredness: "core",
} as const

/**
 * Supporting requirement from Catherine's fixture. Should be SKIPPED
 * by extractGapCandidates (requiredness !== "core").
 */
export const REQ_SUPPORTING_OPERATIONS_EXECUTION = {
  id: "7c75bcfd5942f9f7",
  key: "operations_execution",
  kind: "execution",
  label: "operations, process, and workflow execution",
  snippet:
    "Versant Corporate Finance, Analytics & Human Resources interns get a front-row seat to how a modern media company runs - supporting financial strategy, people operations, and data-driven decision-making across brands like MS NOW, CNBC, Fandango, Rotten Tomatoes, USA Network, SyFy, Oxygen, E!, GolfNow, and Golf Channel.",
  strength: 6,
  functionTag: "operations_general",
  requiredness: "supporting",
} as const

/**
 * Another supporting requirement from Catherine's fixture. Should be
 * SKIPPED.
 */
export const REQ_SUPPORTING_ANALYSIS_REPORTING = {
  id: "8ef63e41b9c127d2",
  key: "analysis_reporting",
  kind: "execution",
  label: "analysis, reporting, and measurement work",
  snippet: "Finance role — reporting and analysis expected",
  strength: 7,
  functionTag: "finance_corp",
  requiredness: "supporting",
} as const

// ─── Resume text slice ────────────────────────────────────────────

/**
 * Plausible Catherine resume_text slice. Engineered so that:
 *   - WHY_REFRAME_FLAVORED.lead anchors to the "○ Performed industry..."
 *     line with high overlap (well above ANCHOR_MIN_OVERLAP=3).
 *   - WHY_FRAME_AS_FLAVORED.lead anchors to a different line (the PESO
 *     communications strategy line) with overlap ≥3.
 *   - WHY_NOT_REFRAME_FLAVORED is filtered out by the reframe filter
 *     before anchoring — so its anchor result doesn't matter.
 *   - REQ_CORE_FINANCIAL_ANALYSIS does NOT appear (neither the substring
 *     "financial_analysis" nor any of its label tokens "financial",
 *     "analysis", "investment", "work" are present), so it produces a
 *     GapCandidate.
 *
 * The "○ " bullet prefix on the SWOT line tests the verbatim invariant:
 * the prefix must survive untouched in the returned string.
 */
export const CATHERINE_RESUME_SLICE = `CATHERINE LEES
Summit, NJ | lees.65@osu.edu

EDUCATION
The Ohio State University | School of Communication – Columbus, OH
B.S. Communication, Strategic Communication | GPA: 3.63

Selected Academic Projects
● Client Communications & Brand Strategy
○ Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities for the boutique retail brand
○ Developed an integrated PESO communications strategy aligned with brand voice and audience insights
○ Presented findings through a professional client deck and written report

LEADERSHIP & INVOLVEMENT
Buckeye Professional Advancement & Development (BPAD) – Columbus, OH
Professional Relations Coordinator | Member Class Events Coordinator
● Selected as 1 of 24 students from 300+ applicants
● Coordinated sponsorship, networking, and professional development events`

/**
 * The exact verbatim line in CATHERINE_RESUME_SLICE that anchorBullet
 * should return for WHY_REFRAME_FLAVORED.lead. Used by tests to assert
 * the verbatim invariant: the returned string is a slice of the input
 * resume, preserving the "○ " bullet prefix, casing, and internal
 * whitespace.
 */
export const CATHERINE_RESUME_ANCHORED_LINE =
  "○ Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities for the boutique retail brand"

// ─── Composite jobfit fixtures ────────────────────────────────────

/**
 * Happy-path JobfitResultJson covering all three real why entries.
 * Use when a test needs a complete-looking JobfitResultJson rather than
 * isolated slices. Lacks requirement_units — see
 * CATHERINE_JOBFIT_WITH_UNITS for the gap-extractor fixture.
 *
 * risk_codes mirrors the live jobfit_run 96722a07 shape: V5 object entry
 * carrying RISK_FAMILY_MISMATCH. Phase 2 v1 build A1 reads risk_codes for
 * the headline synthesize-trigger; the entry is present so the trigger
 * fires whenever this fixture is paired with a resume that has no headline.
 */
export const CATHERINE_JOBFIT: JobfitResultJson = {
  decision: "Review",
  score: 60,
  why_structured: [
    WHY_REFRAME_FLAVORED,
    WHY_NOT_REFRAME_FLAVORED,
    WHY_FRAME_AS_FLAVORED,
  ],
  risk_codes: [
    { code: "RISK_FAMILY_MISMATCH", severity: "medium" },
  ],
  job_signals: {
    jobTitle:
      "Versant Internship Program - Corporate Finance, Analytics & Human Resources",
    jobFamily: "HR",
    companyName: "VERSANT",
  },
  profile_signals: {
    targetFamilies: ["Other"],
  },
}

/**
 * Same as CATHERINE_JOBFIT but with no RISK_FAMILY_MISMATCH risk_code
 * (and risk_structured: []). Pair with CATHERINE_RESUME_NO_HEADLINE to
 * exercise the null-emission path of extractHeadlineCandidate (no
 * headline AND no synthesize-trigger → no headline item).
 */
export const CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH: JobfitResultJson = {
  ...CATHERINE_JOBFIT,
  risk_codes: [],
  risk_structured: [],
}

/**
 * Same shape as CATHERINE_JOBFIT but with requirement_units attached to
 * job_signals. requirement_units lives there at runtime but isn't in
 * the narrow JobfitResultJson.job_signals type (which only declares
 * Phase 1 fields) — extractGapCandidates reads it via duck-typing.
 * The unknown→JobfitResultJson cast is intentional and isolated to this
 * fixture.
 */
export const CATHERINE_JOBFIT_WITH_UNITS: JobfitResultJson = {
  ...CATHERINE_JOBFIT,
  job_signals: {
    ...(CATHERINE_JOBFIT.job_signals ?? {}),
    requirement_units: [
      REQ_SUPPORTING_OPERATIONS_EXECUTION,
      REQ_CORE_FINANCIAL_ANALYSIS,
      REQ_SUPPORTING_ANALYSIS_REPORTING,
    ],
  } as unknown as JobfitResultJson["job_signals"],
}

// ─── Full Catherine resume_text (live DB, persona_version 3) ──────
//
// Byte-exact mirror of client_personas.resume_text on persona
// f283397c-f26d-43bc-9095-0f77c7d9cea9 in dev Supabase, as of
// updated_at 2026-05-19T16:40:42 (4430 chars). Generated via
// `scripts/emit-catherine-fixture.mjs` to avoid hand-transcription of
// tabs, curly apostrophes (U+2019), and en-dashes (U+2013).
//
// Structure (line indices):
//   L000  CATHERINE LEES
//   L001  Summit, NJ | catherine.b.lees12@gmail.com | … (contact)
//   L002  (blank)
//   L003  Strategic Communication junior… (3-sentence headline, one line)
//   L004  EDUCATION
//   … (EDUCATION body, CORE COMPETENCIES, CREATIVE EXPERIENCE,
//      LEADERSHIP & INVOLVEMENT, ADDITIONAL EXPERIENCE)
//
// Used by extractHeadlineCandidate replace-path tests and the
// item-populator headline-replace test. Verbatim invariant holds:
// the captured headline string is character-for-character present.
export const CATHERINE_RESUME_TEXT =
  "CATHERINE LEES\nSummit, NJ | catherine.b.lees12@gmail.com | 908.477.5138 | LinkedIn  | Portfolio \n\nStrategic Communication junior with strong skills in visual storytelling, graphic design, and content creation. Experienced in editorial photography, brand messaging, and campaign development. Seeking a creative internship to apply hands-on content creation and strategic communication skills in entertainment marketing.\nEDUCATION\n\nThe Ohio State University | School of Communication – Columbus, OH\nB.S. Communication, Strategic Communication | GPA: 3.63 \t\t\t\t\t\t            \t             May 2027\nHonors: Dean’s List (4 semesters)\nStudy Abroad: Accademia Italiana Florence – Florence, Italy \t\t\t\t\t\t          \t          Spring 2026\nFocus: Visual Design, Fashion Design, Photography, Architecture\nCertificates & Tools : Muck Rack Fundamentals of Media Relations Certification | Adobe Creative Cloud (Photoshop, InDesign, Illustrator) | Canva | Google Workspace | Microsoft Office\nRelevant Coursework: Strategic Message Design | Writing for Strategic Communication | Visual Communication Design | Advertising & Creative Strategy | Media & Society | Design Aesthetics of Fashion and Retail\nAI Academy by Smarter X: Enrolled in foundational training in AI assisted content creation, prompt development, and ethical use of AI in creative and strategic communication\nCORE COMPETENCIES\n\nBrand Messaging & Storytelling | Creative Strategy | Visual Communication | Graphic Design | Audience Research | PR Writing & Media Relations | Campaign Development | Social Media Content (TikTok, Instagram) | Client Communication  | Photography\nCREATIVE EXPERIENCE\n\nGraphic Designer & Photographer | Scarlette Fashion Magazine – Columbus, OH                                                                       Sep 2023 – Present\nLead photographer for editorial shoots, managing creative direction and execution to engage audiences\nDesigned magazine spreads for digital and print publication\nRepresented the publication at Columbus Fashion Week as part of the press team\nCatherine Lees Photography – Freelance\t\t\t\t\t\t                                                  Jan 2023 – Present\nDelivered photography for 30+ client events, managing creative execution and client communication\nBuilt and promoted a personal creative brand through visual storytelling\nSelected Academic Projects\nClient Communications & Brand Strategy \nCollaborated with team on a client-based communications audit for a boutique retail brand, including brand immersion and stakeholder interviews\nPerformed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities\nDeveloped an integrated PESO communications strategy aligned with brand voice and audience insights\nPresented findings through a professional client deck and written report\nVisual Communication & Creative Design\nConcepted and designed creative visual campaigns aligned with strategic objectives\nCreated digital assets and animated GIFs to drive emotional engagement and message clarity\nApplied design principles across layout, typography, color, and composition\nProduced polished creative work using Adobe Photoshop across multiple formats\nWriting, PR & Media Relations\nProduced a professional writing portfolio including press releases and feature articles\nWrote AP-style news releases with emphasis on clarity, ethics, and audience alignment\nPracticed media relations and message control through simulated press conference scenarios\nLEADERSHIP & INVOLVEMENT\n\nBuckeye Professional Advancement & Development (BPAD) – Columbus, OH\nProfessional Relations Coordinator | Member Class Events Coordinator\t\t                                                                  Sep 2024 – Present\nSelected as 1 of 24 students from 300+ applicants\nCoordinated sponsorship, networking, and professional development events\nKappa Kappa Gamma Sorority – Columbus, OH\nMerchandise Committee | Social Media Coordinator\t\t                                                                                                   Feb 2024 – Present\nDesigned 30+ branded merchandise concepts annually\nCreated and scheduled social media content to support engagement and brand consistency\nADDITIONAL EXPERIENCE\n\nVolunteer | Summit Luminary Fund - Summit, NJ   \t\t\t\t\t\t                                 Dec 2016 - Present\nBartender | Summit Elks Lodge - Summit, NJ\t\t\t\t\t\t\t                             May 2025 - Aug 2025\n"

/**
 * The exact captured headline block expected from
 * extractHeadlineCandidate(CATHERINE_RESUME_TEXT, ...). The full L003
 * paragraph (3 sentences) joined into a single string. Used for
 * verbatim-invariant assertions and content-match assertions in the
 * replace-path tests.
 */
export const CATHERINE_RESUME_HEADLINE_BLOCK =
  "Strategic Communication junior with strong skills in visual storytelling, graphic design, and content creation. Experienced in editorial photography, brand messaging, and campaign development. Seeking a creative internship to apply hands-on content creation and strategic communication skills in entertainment marketing."

/**
 * Synthetic variant: same as CATHERINE_RESUME_TEXT with the L003 headline
 * paragraph removed. Contact line + blank line stay; EDUCATION immediately
 * follows. Used by the synthesize-path test (paired with CATHERINE_JOBFIT
 * which carries RISK_FAMILY_MISMATCH → triggers synthesize) and the
 * null-emission test (paired with CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH
 * → no synthesize-trigger → returns null).
 *
 * Length: 4109 chars (CATHERINE_RESUME_TEXT length minus the 320-char
 * headline minus 1 newline).
 */
export const CATHERINE_RESUME_NO_HEADLINE =
  "CATHERINE LEES\nSummit, NJ | catherine.b.lees12@gmail.com | 908.477.5138 | LinkedIn  | Portfolio \n\nEDUCATION\n\nThe Ohio State University | School of Communication – Columbus, OH\nB.S. Communication, Strategic Communication | GPA: 3.63 \t\t\t\t\t\t            \t             May 2027\nHonors: Dean’s List (4 semesters)\nStudy Abroad: Accademia Italiana Florence – Florence, Italy \t\t\t\t\t\t          \t          Spring 2026\nFocus: Visual Design, Fashion Design, Photography, Architecture\nCertificates & Tools : Muck Rack Fundamentals of Media Relations Certification | Adobe Creative Cloud (Photoshop, InDesign, Illustrator) | Canva | Google Workspace | Microsoft Office\nRelevant Coursework: Strategic Message Design | Writing for Strategic Communication | Visual Communication Design | Advertising & Creative Strategy | Media & Society | Design Aesthetics of Fashion and Retail\nAI Academy by Smarter X: Enrolled in foundational training in AI assisted content creation, prompt development, and ethical use of AI in creative and strategic communication\nCORE COMPETENCIES\n\nBrand Messaging & Storytelling | Creative Strategy | Visual Communication | Graphic Design | Audience Research | PR Writing & Media Relations | Campaign Development | Social Media Content (TikTok, Instagram) | Client Communication  | Photography\nCREATIVE EXPERIENCE\n\nGraphic Designer & Photographer | Scarlette Fashion Magazine – Columbus, OH                                                                       Sep 2023 – Present\nLead photographer for editorial shoots, managing creative direction and execution to engage audiences\nDesigned magazine spreads for digital and print publication\nRepresented the publication at Columbus Fashion Week as part of the press team\nCatherine Lees Photography – Freelance\t\t\t\t\t\t                                                  Jan 2023 – Present\nDelivered photography for 30+ client events, managing creative execution and client communication\nBuilt and promoted a personal creative brand through visual storytelling\nSelected Academic Projects\nClient Communications & Brand Strategy \nCollaborated with team on a client-based communications audit for a boutique retail brand, including brand immersion and stakeholder interviews\nPerformed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities\nDeveloped an integrated PESO communications strategy aligned with brand voice and audience insights\nPresented findings through a professional client deck and written report\nVisual Communication & Creative Design\nConcepted and designed creative visual campaigns aligned with strategic objectives\nCreated digital assets and animated GIFs to drive emotional engagement and message clarity\nApplied design principles across layout, typography, color, and composition\nProduced polished creative work using Adobe Photoshop across multiple formats\nWriting, PR & Media Relations\nProduced a professional writing portfolio including press releases and feature articles\nWrote AP-style news releases with emphasis on clarity, ethics, and audience alignment\nPracticed media relations and message control through simulated press conference scenarios\nLEADERSHIP & INVOLVEMENT\n\nBuckeye Professional Advancement & Development (BPAD) – Columbus, OH\nProfessional Relations Coordinator | Member Class Events Coordinator\t\t                                                                  Sep 2024 – Present\nSelected as 1 of 24 students from 300+ applicants\nCoordinated sponsorship, networking, and professional development events\nKappa Kappa Gamma Sorority – Columbus, OH\nMerchandise Committee | Social Media Coordinator\t\t                                                                                                   Feb 2024 – Present\nDesigned 30+ branded merchandise concepts annually\nCreated and scheduled social media content to support engagement and brand consistency\nADDITIONAL EXPERIENCE\n\nVolunteer | Summit Luminary Fund - Summit, NJ   \t\t\t\t\t\t                                 Dec 2016 - Present\nBartender | Summit Elks Lodge - Summit, NJ\t\t\t\t\t\t\t                             May 2025 - Aug 2025\n"

/**
 * Verbatim SWOT-anchor line as it appears in CATHERINE_RESUME_TEXT. The
 * line has no bullet glyph prefix in this version of the resume (the
 * older CATHERINE_RESUME_SLICE prefixes with "○ "; the v3 resume Peri
 * uploaded omits all bullet glyphs). Used by the item-populator test's
 * bullet verbatim-invariant assertion when paired with the full
 * CATHERINE_RESUME_TEXT.
 */
export const CATHERINE_TEXT_SWOT_LINE =
  "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities"
