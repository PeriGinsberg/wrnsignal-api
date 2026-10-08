// lib/resumeWorkshop/prefill.ts
//
// Starting entries from the resume on file. The resume is split at its section
// headings (EDUCATION, EXPERIENCE, SKILLS...), and each section that maps to a
// discovery tab becomes one entry whose resume_excerpt is that section's text,
// word for word. The coach's notes start empty: imported resume text and what
// the coach writes are never mixed.
//
// Deliberately conservative: a section is only used when its heading is
// recognised. Anything else (contact details, summary, unrecognised headings)
// stays visible in the resume panel but makes no entry. Roles inside a section
// are not split apart: a wrong split would be worse than one entry the coach
// divides by hand.

import type { WorkshopTab } from "./model"

// Checked in this order, so "Leadership Experience" is leadership, not work,
// and "Relevant Coursework" is coursework, not education.
const HEADINGS: [WorkshopTab, RegExp][] = [
  ["coursework", /\bcoursework\b|\bcourses\b/],
  ["leadership", /\bleadership\b|\binvolvement\b|\bactivities\b|\bextracurricular\b|\bvolunteer(ing)?\b|\bcommunity( service)?\b/],
  ["honors", /\bhonou?rs\b|\bawards?\b/],
  ["certifications", /\bcertifications?\b|\bcertificates?\b|\blicen[cs]es?\b/],
  ["projects", /\bprojects?\b/],
  ["skills", /\bskills\b|\bcompetencies\b|\btechnical\b|\blanguages\b|\btools\b/],
  ["education", /\beducation\b|\bacademic background\b/],
  ["experience", /\bexperience\b|\bemployment\b|\bwork history\b|\binternships?\b|\bcareer history\b/],
]

const TITLE: Record<WorkshopTab, string> = {
  education: "Education (from resume)",
  coursework: "Coursework (from resume)",
  honors: "Honors and awards (from resume)",
  certifications: "Certifications (from resume)",
  experience: "Experience (from resume)",
  projects: "Projects (from resume)",
  skills: "Skills (from resume)",
  leadership: "Leadership and involvement (from resume)",
  other: "Other (from resume)",
}

/** A line that is a section heading, mapped to its tab, or null. */
export function headingTab(line: string): WorkshopTab | null {
  const t = line.trim().replace(/[:|\-_=*#]+$/g, "").replace(/^[#*\s]+/, "").trim()
  if (t.length < 3 || t.length > 45) return null
  if (/[.!?,;]$/.test(t) || /\d{3,}/.test(t) || t.split(/\s+/).length > 5) return null
  const lower = t.toLowerCase()
  for (const [tab, re] of HEADINGS) if (re.test(lower)) return tab
  return null
}

export type PrefillEntry = { tab: WorkshopTab; title: string; resume_excerpt: string }

export function prefillFromResume(resume: string | null | undefined): PrefillEntry[] {
  if (!resume?.trim()) return []
  const lines = resume.replace(/\r\n/g, "\n").split("\n")
  const out: PrefillEntry[] = []
  let current: { tab: WorkshopTab; heading: string; body: string[] } | null = null
  const close = () => {
    if (!current) return
    const text = current.body.join("\n").trim()
    if (text) {
      const same = out.find((e) => e.tab === current!.tab)
      // Two sections for the same tab (e.g. "Work Experience" and "Internships")
      // stay two entries, each titled by its own heading.
      out.push({
        tab: current.tab,
        title: same ? `${current.heading.trim()} (from resume)` : TITLE[current.tab],
        resume_excerpt: text,
      })
    }
    current = null
  }
  for (const line of lines) {
    const tab = headingTab(line)
    if (tab) {
      close()
      current = { tab, heading: line, body: [] }
    } else if (current) {
      current.body.push(line)
    }
  }
  close()
  return out
}
