// tests/lanes/grad-year-check.ts
//
// deriveYearsMax() against the shapes real resumes use. Pure, offline, no DB.
//
// Run:
//   npx tsx tests/lanes/grad-year-check.ts
//
// Exists because this one function has been wrong four separate ways, each
// found only after it reached a real client:
//
//   1. "associate" matched the job title, not the degree — a Marketing
//      Associate Intern's 2026 became a graduation year.
//   2. The rule for the date line was keyed on wording nobody writes
//      ("expected graduation", a colon) and missed "Exp. Graduation May 2026".
//   3. "Expected May 2026" with no "graduation" word found no year at all, so
//      a current student's lane carried no ceiling.
//   4. The date sat on the SCHOOL line, and the only line that did match
//      handed over a study-abroad term — Alex Schwartz, May 2027, read as 2026.
//
// The section path fixed (4) and subsumes much of the rest; the line rules stay
// as the fallback for a resume with no EDUCATION header. Both paths are covered
// below, and the `via` column says which one answered.
//
// Cases marked (real) are taken from an actual client resume, verbatim in shape
// if not in wording.

import { deriveYearsMax } from "@/lib/laneProposal"

const mk = (...lines: string[]) => lines.join("\n") + "\n"

type Case = [label: string, resume: string, wantYear: string]

// --- section path: an EDUCATION header exists -------------------------------
const SECTION: Case[] = [
  ["(real) Alex: date on school line", mk(
    "EDUCATION",
    "Indiana University – Kelley School of Business  |  Bloomington, IN    May 2027",
    "Bachelor of Science in Business, Major: Finance  |  Study Abroad: IES Abroad Barcelona, Spain (Spring 2026)",
    "Relevant Coursework: Intermediate Corporate Finance (Fall 2026)",
    "",
    "EXPERIENCE",
    "M&A Intern  |  Well Labs  |  New York, NY    Jun 2026 – Jul 2026",
  ), "2027"],
  ["(real) lily: B.E. + GPA·date line", mk(
    "EDUCATION",
    "Vanderbilt University",
    "B.E. Biomedical Engineering",
    "GPA 3.8 · May 2026",
    "Universidad Carlos III",
    "Study Abroad · Madrid, Spain",
    "Jan – May 2025",
    "",
    "TOOLS",
    "Python · MATLAB",
  ), "2026"],
  ["(real) Maya: date on wrapped line", mk(
    "EDUCATION",
    "University of Illinois Chicago - BS Business Administration, Finance",
    "concentration, May 2026. GPA 3.6.",
    "",
    "EXPERIENCE",
    "Analyst — 2019",
  ), "2026"],
  ["(real) Jordan: Expected May 2026", mk(
    "EDUCATION",
    "Dartmouth College, Hanover, NH",
    "Bachelor of Arts in Economics, Minor in Mathematics",
    "Expected May 2026 | GPA: 3.6/4.0",
  ), "2026"],
  ["(real) JD outranks earlier BA", mk(
    "EDUCATION",
    "Emory University School of Law	Atlanta, GA",
    "Candidate for Juris Doctor	Expected May 2027",
    "Northeastern University	Boston, MA",
    "Bachelor of Arts, cum laude	May 2024",
  ), "2027"],
  // The leak that would make section scoping worse than what it replaced.
  ["graduated 2014, job 2025 — no leak", mk(
    "EDUCATION", "Bachelor of Arts in History, 2014", "",
    "EXPERIENCE", "Sales Associate, Target — 2016 – 2025",
  ), "2014"],
  ["ACADEMIC PROJECTS closes section", mk(
    "EDUCATION", "Kelley School of Business   May 2027", "",
    "ACADEMIC PROJECTS", "ICORE Capstone   Fall 2028",
  ), "2027"],
  ["SKILLS & TOOLS closes section", mk(
    "EDUCATION", "IU   May 2027", "", "SKILLS & TOOLS", "Excel since 2029",
  ), "2027"],
  ["LEADERSHIP & ACTIVITIES closes", mk(
    "EDUCATION", "IU   May 2027", "", "LEADERSHIP & ACTIVITIES", "Mentor   Sep 2028 – Present",
  ), "2027"],
  ["EDUCATION last, runs to EOF", mk(
    "EXPERIENCE", "Analyst, Acme — 2023 – 2025", "", "EDUCATION", "Bachelor of Science, 2022",
  ), "2022"],
  ["lowercase header", mk("Education", "Bachelor of Science, 2021", "", "Experience", "Analyst 2025"), "2021"],
  ["section with no year → fallback", mk(
    "EDUCATION", "University of Illinois Chicago - BS Business Administration", "",
    "EXPERIENCE", "Analyst — 2019",
  ), "none"],
]

// --- fallback path: no EDUCATION header -------------------------------------
const FALLBACK: Case[] = [
  ["degree line carries the year", "Bachelor of Science in Marketing, Expected May 2027\n", "2027"],
  ["Exp. Graduation May 2026", "Bachelor of Arts and Sciences in PPE     Exp. Graduation May 2026\n", "2026"],
  ["Graduation May 2027, no punct", "Graduation May 2027\n", "2027"],
  ["Graduated December 2025", "B.S., Management · University of Florida    Graduated December 2025\n", "2025"],
  ["class of", "Indiana University, Class of 2027\n", "2027"],
  ["graduating", "Graduating May 2027\n", "2027"],
  ["Expected May 2026, no grad word", "Bachelor of Arts in Economics\nExpected May 2026 | GPA: 3.6/4.0\n", "2026"],
  ["Expected Spring 2027", "Bachelor of Science\nExpected Spring 2027\n", "2027"],
  ["real associate degree kept", "Associate of Arts, Ivy Tech Community College, 2020\n", "2020"],
  ["associate's degree kept", "Associate's Degree in Business, 2019\n", "2019"],
  ["associate degree kept", "Associate Degree in Nursing, 2021\n", "2021"],
  ["sales associate ignored", "Sales Associate, Target — 2023 – 2024\n", "none"],
  ["associate producer ignored", "Associate Producer, Campus TV, 2025 – 2026\n", "none"],
  ["associate director ignored", "Associate Director of Ops, 2022\n", "none"],
  ["MS Excel on a skills line ignored", "MS Excel, Tableau — certified 2025\n", "none"],
  ["graduation ceremony prose ignored", "Volunteered at graduation ceremony in 2024\n", "none"],
  ["MBA 2022 outranks BA 2014", "Bachelor of Arts, 2014\nMBA, 2022\n", "2022"],
]

let failures = 0

function run(title: string, cases: Case[], wantVia: string | null) {
  console.log(`\n=== ${title} ===`)
  for (const [label, resume, want] of cases) {
    const r = deriveYearsMax(resume, null)
    const got = /graduated (\d{4})/.exec(r.rule)?.[1] ?? "none"
    const via = /\[([^\]]+)\]/.exec(r.rule)?.[1] ?? "-"
    // "none" cases fall through to career_stage, so no path is asserted there.
    const viaOk = wantVia === null || want === "none" || via === wantVia
    const ok = got === want && viaOk
    if (!ok) failures++
    console.log(
      `  ${ok ? "✓" : "✗"} ${label.padEnd(36)} want=${want.padEnd(5)} got=${got.padEnd(5)} via ${via}`
    )
  }
}

run("EDUCATION section present", SECTION, "education section")
run("no EDUCATION header — fallback", FALLBACK, "degree lines")

console.log()
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log(`all ${SECTION.length + FALLBACK.length} cases pass`)
