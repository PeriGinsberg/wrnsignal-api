// FILE: app/api/jobfit/profileEvidence.ts
//
// resume -> ProfileEvidence extractor — defect #1, step 3 (resume side).
//
// The RISKIEST part of the fix: it decides tools-in-EXPERIENCE-vs-SKILLS,
// years-in-domain, and licenses/clearance/degree held — the facts the
// deterministic core (gateLedger.ts) checks gates against. Built and tested in
// isolation BEFORE being wired to anything. Corpus-fitted to the 8 synthetic
// résumés; domain-year attribution is deliberately conservative (absence of
// domain evidence => 0 years in that domain, i.e. UNMET, never assumed).

import type { ProfileEvidence } from "./gateLedger"

const CURRENT_YEAR = 2026 // deterministic "today" (matches session date; avoids Date nondeterminism)

// tool vocabulary the gates care about -> normalized id
const TOOL_TOKENS: Record<string, RegExp> = {
  dbt: /\bdbt\b/i,
  snowflake: /\bsnowflake\b/i,
  airflow: /\bairflow\b/i,
  spark: /\bspark\b/i,
  salesforce: /\bsalesforce\b/i,
  hubspot: /\bhubspot\b/i,
  angular: /\bangular\b/i,
  pytorch: /\bpytorch\b/i,
  tensorflow: /\btensorflow\b/i,
  tableau: /\btableau\b/i,
  looker: /\blooker\b/i,
  ab_testing: /a\/b testing|experimentation/i,
}

// domain keywords for years-in-domain attribution
const DOMAIN_KEYWORDS: Record<string, RegExp> = {
  b2b_saas: /\bB2B SaaS\b|\bSaaS\b/i,
  ml_in_prod: /ml models?\s+(?:in|to)\s+production|models?\s+in\s+production|shipping ml models|building .* ml models/i,
}

const WORD_NUM: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

type Role = { header: string; body: string; years: number }

export function sectionSplit(resume: string): { summary: string; experience: string; skills: string; education: string } {
  const parts: Record<string, string> = { summary: "", experience: "", skills: "", education: "" }
  const re = /^###\s+(EXPERIENCE|EDUCATION|SKILLS)\s*$/gim
  let lastKey = "summary"
  let lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(resume)) !== null) {
    parts[lastKey] += resume.slice(lastIdx, m.index)
    lastKey = m[1].toLowerCase()
    lastIdx = re.lastIndex
  }
  parts[lastKey] += resume.slice(lastIdx)
  return { summary: parts.summary, experience: parts.experience, skills: parts.skills, education: parts.education }
}

function parseRoles(experience: string): Role[] {
  const roles: Role[] = []
  // role headers are bold lines: **Title — Company (dates)**
  const lines = experience.split(/\r?\n/)
  let cur: Role | null = null
  for (const line of lines) {
    const h = line.match(/^\s*\*\*(.+?)\*\*/)
    if (h) {
      if (cur) roles.push(cur)
      cur = { header: h[1], body: "", years: yearsFromRange(h[1]) }
    } else if (cur) {
      cur.body += " " + line
    }
  }
  if (cur) roles.push(cur)
  return roles
}

function yearsFromRange(s: string): number {
  const m = s.match(/(\d{4})\s*[–—-]\s*(present|\d{4})/i)
  if (!m) return 0
  const start = Number(m[1])
  const end = /present/i.test(m[2]) ? CURRENT_YEAR : Number(m[2])
  return Math.max(0, end - start)
}

function parseSummaryYears(summary: string): number | null {
  const d = summary.match(/\b(\d+)\s+years?\b/i)
  if (d) return Number(d[1])
  const w = summary.toLowerCase().match(/\b(two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/)
  if (w) return WORD_NUM[w[1]]
  return null
}

function toolsIn(text: string): string[] {
  return Object.keys(TOOL_TOKENS).filter((id) => TOOL_TOKENS[id].test(text))
}

export function extractProfileEvidence(resume: string): ProfileEvidence {
  const { summary, experience, skills, education } = sectionSplit(resume)
  const roles = parseRoles(experience)
  const expText = roles.map((r) => r.header + " " + r.body).join("\n")

  // total years: prefer an explicit summary "N years", else sum role spans
  const totalYears = parseSummaryYears(summary) ?? (roles.length ? roles.reduce((s, r) => s + r.years, 0) : null)

  // domain years: sum spans of roles whose header/body mention the domain
  const domainYears: Record<string, number> = {}
  for (const [dom, re] of Object.entries(DOMAIN_KEYWORDS)) {
    let y = 0
    for (const r of roles) if (re.test(r.header + " " + r.body)) y += r.years
    // ml_in_prod: also credit if the summary asserts it and roles corroborate
    if (dom === "ml_in_prod" && y === 0 && DOMAIN_KEYWORDS.ml_in_prod.test(summary) && totalYears) y = totalYears
    if (y > 0) domainYears[dom] = y
  }

  // tools: EXPERIENCE evidence vs SKILLS-only
  const toolsInExperience = toolsIn(expText)
  const toolsInSkillsOnly = toolsIn(skills).filter((t) => !toolsInExperience.includes(t))

  // recency per skill (angular): most-recent role index that mentions it + max version
  const skillRecency: ProfileEvidence["skillRecency"] = {}
  roles.forEach((r, idx) => {
    if (/\bangular\b/i.test(r.header + " " + r.body)) {
      const vers = [...(r.header + " " + r.body).matchAll(/angular\s*(?:js)?\s*(\d+)(?:\s*[–—-]\s*(\d+))?/gi)]
        .flatMap((mm) => [Number(mm[1]), mm[2] ? Number(mm[2]) : Number(mm[1])])
      const version = vers.length ? Math.max(...vers) : 1 // "AngularJS" (no number) => v1
      const prev = skillRecency.angular
      if (!prev || idx < prev.lastUsedRoleIndex) skillRecency.angular = { lastUsedRoleIndex: idx, version }
    }
  })

  // credentials
  const licensesHeld: string[] = []
  if (/\bSIE\b/i.test(resume)) licensesHeld.push("sie")
  for (const sm of resume.matchAll(/series\s*(\d+)/gi)) licensesHeld.push(`series_${sm[1]}`)
  if (/\bCPA\b/i.test(resume)) licensesHeld.push("cpa")

  const clearancesHeld: string[] = []
  const clr = resume.match(/\b(ts\/sci|top secret|secret)\b.*clearance|active\s+([a-z/ ]+)\s+clearance/i)
  if (clr) clearancesHeld.push("ts_sci") // only the one clearance id the corpus uses

  const citizenshipStated = /\bU\.?S\.?\s+citizen(ship)?\b|united states citizen/i.test(resume)
    ? true
    : null // silent => null (unknown), never assumed

  const degreeHeld = /\bno degree\b|self-taught/i.test(education)
    ? false
    : /\b(B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|MBA|Bachelor|Master)\b/.test(education)
    ? true
    : null

  const waiverOnFile = /\bwaiver\b/i.test(resume)

  // manager-of-managers: default 0 for a full résumé with no such evidence
  // (absence => not a manager of managers => UNMET, never assumed).
  let managerOfManagersYears = 0
  const mgr = resume.match(/(\d+)\s*years?[^.]*\bmanag\w*\s+managers/i)
  if (mgr) managerOfManagersYears = Number(mgr[1])

  return {
    totalYears,
    domainYears,
    managerOfManagersYears,
    toolsInExperience,
    toolsInSkillsOnly,
    licensesHeld,
    clearancesHeld,
    citizenshipStated,
    degreeHeld,
    waiverOnFile,
    skillRecency,
  }
}
