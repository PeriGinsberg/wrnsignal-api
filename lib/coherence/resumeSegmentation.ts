// lib/coherence/resumeSegmentation.ts
//
// Resume-coherence detector — segmentation half. Pure, deterministic, no DB/LLM.
//
// Ported verbatim (logic-identical) from the validated scaffolding
// tests/concentration/{resumeIsolate,resumeConcentration}.mjs. The only change
// vs. the scaffolding is the removal of the `isolateResumeBody._lastMarkers`
// diagnostic side-channel (used only by the validation probes) and the addition
// of TypeScript types. Header/marker vocab is DATA-DRIVEN from the prod-corpus
// inventories (header-inventory / boundary-inventory / coursework-inventory).
//
// Pipeline:  raw → normalizeStructure → isolateResumeBody →
//            extractProfessionalExperienceText → segmentBlocks

export interface Block {
  title_line: string
  bullets: string[]
}

// ============================================================================
// Header vocabulary (mined). Case-sensitive ALL-CAPS phrases for the
// normalization re-break; case-insensitive variants for section scoping.
// ============================================================================

const PRO_MODS =
  "PROFESSIONAL|RELEVANT|WORK|ADDITIONAL|CREATIVE|CLINICAL|SALES|LEGAL|POLICY|EDITORIAL|RESEARCH|INTERNSHIP|EARLY CAREER|EARLIER CAREER|EARLIER|EARLY|CAREER|CONSULTING|DESIGN|MARKETING|FINANCE|INVESTMENT|OPERATIONS|PRODUCT|NURSING|TEACHING|BIOMEDICAL ENGINEERING|ARTS ADMINISTRATION|COMMUNICATIONS"

const ALL_MODS =
  "PROFESSIONAL|RELEVANT|WORK|ADDITIONAL|CREATIVE|CLINICAL|SALES|LEGAL|POLICY|EDITORIAL|RESEARCH|INTERNSHIP|EARLIER|EARLY|CAREER|CONSULTING|DESIGN|MARKETING|FINANCE|INVESTMENT|OPERATIONS|PRODUCT|NURSING|TEACHING|BIOMEDICAL|ARTS|COMMUNICATIONS|ACADEMIC|TECHNICAL|CORE|SELECTED|KEY|RELEVANT"

const HEADER_BASES =
  "EXPERIENCE|EMPLOYMENT|EDUCATION|SKILLS|PROJECTS?|LEADERSHIP|INVOLVEMENT|COMPETENCIES|SUMMARY|CERTIFICATIONS?|ACTIVITIES|TOOLS|INTERESTS|HIGHLIGHTS|OBJECTIVE|PROFILE|LANGUAGES|COURSEWORK|EXPERTISE|CREDENTIALS|AFFILIATIONS|AWARDS|HONORS|PUBLICATIONS|REFERENCES|QUALIFICATIONS|INFORMATION|VOLUNTEERISM|RESPONSIBILITY|DEVELOPMENT"

const HEADER_SUFFIX =
  "(?:\\s*(?:&|AND|,|/)\\s*(?:CAMPUS\\s+)?(?:INVOLVEMENT|INTERESTS|TOOLS|SKILLS|CERTIFICATIONS?|CREDENTIALS|ACTIVITIES|AWARDS|HONORS|COMMUNICATIONS|VOLUNTEERISM|RESPONSIBILITY|PLATFORMS|SYSTEMS|AFFILIATIONS|INFORMATION))*"

const HEADER_PHRASE = `(?:(?:${ALL_MODS})\\s+)?(?:${HEADER_BASES})${HEADER_SUFFIX}`

// ============================================================================
// normalizeStructure — un-escape literal \n + make glued headers standalone
// ============================================================================

export function normalizeStructure(rawText: string): string {
  if (!rawText) return ""
  let text = rawText.replace(/\r\n/g, "\n")

  // 1. Un-escape literal two-char "\n" sequences → real newlines.
  text = text.replace(/\\n/g, "\n")

  // 2. Insert a newline BEFORE a header phrase glued to preceding content. The
  //    negative lookbehind prevents splitting an already-standalone
  //    "MODIFIER BASE" header (e.g. "ACADEMIC PROJECTS") by matching only base.
  const beforeRx = new RegExp(
    `([^\\n])[ \\t]+(?<!(?:${ALL_MODS})[ \\t])(${HEADER_PHRASE})(?=\\s|$)`,
    "g",
  )
  text = text.replace(beforeRx, "$1\n$2")

  // 3. Insert a newline AFTER a header phrase with trailing content on the same
  //    line, so the header is alone on its line for exact-line scoping.
  const afterRx = new RegExp(`(^|\\n)([ \\t]*${HEADER_PHRASE})[ \\t]+(?=\\S)`, "g")
  text = text.replace(afterRx, "$1$2\n")

  return text
}

// ============================================================================
// isolateResumeBody — strip leading intake + trailing cover letter / Q&A
// ============================================================================

const PRIMARY_HEADER_CAPS =
  /(?:^|\n)[ \t]*(?:PROFESSIONAL SUMMARY|SUMMARY|PROFESSIONAL EXPERIENCE|RELEVANT EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EDUCATION|CORE COMPETENCIES|TECHNICAL SKILLS|SKILLS)\b/
const PRIMARY_HEADER_LINE =
  /(?:^|\n)[ \t]*(?:professional summary|summary|professional experience|relevant experience|work experience|experience|education|core competencies|employment(?: history)?|skills)[ \t]*(?=\r?\n|$)/i

function firstHeaderIndex(text: string): number {
  const a = text.search(PRIMARY_HEADER_CAPS)
  const b = text.search(PRIMARY_HEADER_LINE)
  const cands = [a, b].filter((i) => i > 0)
  return cands.length ? Math.min(...cands) : -1
}

const INTAKE_SIGNAL =
  /First Name|Last Name|Current Status|Job Type Preference|What types of roles|Secondary or adjacent|Timeline for starting|Location preferences|How open are you|How do you prefer feedback|What do you believe|Specific companies|Are there any roles|\n\d+\.\s|Name[:\t]|University[:\t]|Resume[ \t]|Paste[ \t]|Text:/i

const TRAILING_INTAKE: RegExp[] = [
  /\n[ \t]*Cover Letter\b/i,
  /\n[ \t]*Dear\b[^\n]{0,40}(Hiring|Manager|Sir|Madam|Committee)/i,
  /\n[ \t]*Other Concerns\s*:/i,
  /\n[ \t]*Strengths\s*:/i,
  /\n[ \t]*Weaknesses\s*:/i,
  /\n[ \t]*How open are you\b/i,
  /\n[ \t]*Timeline for starting\b/i,
  /\n[ \t]*Location preferences\b/i,
  /\n[ \t]*Secondary or adjacent\b/i,
  /\n[ \t]*Specific companies\b/i,
  /\n[ \t]*Are there any roles\b/i,
  /\n[ \t]*How do you prefer feedback\b/i,
  /\n[ \t]*What do you believe are your strongest\b/i,
  /\n[ \t]*What about your job search\b/i,
  /\n[ \t]*What types of roles\b/i,
  /\n[ \t]*Job Type Preference\b/i,
  /\n[ \t]*\d+\.\s+(What|How|Are|Do|Where|Why|Which)\b/,
]

export function isolateResumeBody(rawText: string): string {
  if (!rawText) return ""
  let text = rawText.replace(/\r\n/g, "\n")

  // 1. Strip leading intake by anchoring on the first résumé header — but ONLY
  //    when the preamble looks like intake. Clean résumés are left untouched.
  const hIdx = firstHeaderIndex(text)
  if (hIdx > 0) {
    const preamble = text.slice(0, hIdx)
    if (INTAKE_SIGNAL.test(preamble)) {
      text = text.slice(hIdx).replace(/^\n/, "")
    }
  }

  // 2. Strip trailing cover letter / intake Q&A (earliest marker wins).
  let cutIdx = -1
  for (const rx of TRAILING_INTAKE) {
    const i = text.search(rx)
    if (i !== -1 && (cutIdx === -1 || i < cutIdx)) cutIdx = i
  }
  if (cutIdx !== -1) text = text.slice(0, cutIdx)

  return text.trim()
}

// ============================================================================
// extractProfessionalExperienceText — scope to professional-experience sections
// ============================================================================

const PRO_HEADERS = new RegExp(
  `^\\s*(?:` +
    `(?:(?:${PRO_MODS})\\s+)?(?:experience|employment(?: history)?|work history|career history|internships?|career)` +
    `|employment(?: history)?|professional development` +
    `)\\s*[:&]?\\s*$`,
  "i",
)

const NON_PRO_HEADERS = new RegExp(
  `^\\s*(?:(?:core|technical|selected|academic|relevant|additional|key|professional|earlier|early)\\s+)?` +
    `(?:` +
    `education(?:\\s*(?:&|and)\\s*(?:certifications?|other professional credentials))?` +
    `|core competencies|competencies` +
    `|skills?(?:\\s*(?:&|and|,|/)\\s*(?:tools|interests|certifications?|credentials|systems|platforms|languages))*` +
    `|tools?(?:\\s*(?:&|and|,|/)\\s*(?:platforms|systems))*` +
    `|projects?` +
    `|leadership(?:\\s*(?:&|and|,|/)\\s*(?:campus\\s+)?(?:involvement|activities|communications?|awards|interests|responsibility|volunteerism|engagement|arts administration))*` +
    `|involvement(?:\\s*(?:&|and)\\s*(?:leadership|volunteerism))*` +
    `|activities|extracurricular(?:\\s*activities)?|volunteer(?:\\s*experience|\\s*work|ism)?|community(?:\\s*service|\\s*involvement)?` +
    `|affiliations?|certifications?(?:\\s*(?:&|and)\\s*(?:skills|affiliations))?` +
    `|interests|career highlights|highlights|selected impact highlights` +
    `|summary|professional summary|objective|profile|references|publications|coursework|training` +
    `|honors(?:\\s*(?:&|and)\\s*awards)?|awards(?:\\s*(?:&|and)\\s*honors)?` +
    `|languages|expertise|core expertise|credentials|qualifications|additional information` +
    `)\\s*[:&]?\\s*$`,
  "i",
)

// Coursework / academic-projects headers that leak past the exact-line list —
// multi-modifier, glued trailing, or "<topic> Coursework". START-anchored +
// requires a modifier (alt 1) or a separator after "coursework" (alt 2), so
// prose like "Completing coursework covering…" is NOT dropped.
const COURSEWORK_PROJECT_HEADER =
  /^\s*(?:(?:selected|relevant|academic|core|key|additional|independent)\s+){1,3}(?:academic\s+)?(?:projects?|coursework|course\s*work)\b|^\s*[A-Za-z][\w &/-]{0,40}\bcoursework\b\s*(?:[-–—:|]|\d|\bfall\b|\bspring\b|\bsummer\b|\bwinter\b|$)/i

export function extractProfessionalExperienceText(profileText: string): string {
  if (!profileText) return ""

  const lines = profileText.split(/\r?\n/)
  let inProfessional = true // default true so content BEFORE any header is kept
  let sawAnyHeader = false
  const kept: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      kept.push(raw)
      continue
    }
    if (PRO_HEADERS.test(line)) {
      sawAnyHeader = true
      inProfessional = true
      kept.push(raw)
      continue
    }
    if (NON_PRO_HEADERS.test(line) || COURSEWORK_PROJECT_HEADER.test(line)) {
      sawAnyHeader = true
      inProfessional = false
      continue
    }
    if (inProfessional) kept.push(raw)
  }

  if (!sawAnyHeader) return profileText
  const joined = kept.join("\n").trim()
  return joined.length > 20 ? joined : profileText
}

// ============================================================================
// segmentBlocks — split the professional slice into role-blocks
// ============================================================================

const BULLET_CHARS = /[●•▪◦‣]/
const BULLET_SPLIT = /[ \t]*[●•▪◦‣][ \t]*/g
const LAST_BULLET = /[●•▪◦‣][^●•▪◦‣]*$/

const DATE_RANGE = new RegExp(
  "(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s*'?\\d{2,4}|\\b(?:19|20)\\d{2}|\\d{1,2}\\/\\d{2,4})" +
    "\\s*[\\u2013\\u2014\\-]\\s*" +
    "(?:present|current|(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?\\s*'?\\d{2,4}|(?:19|20)\\d{2}|\\d{1,2}\\/\\d{2,4})",
  "gi",
)
const DATE_RANGE_ONE = new RegExp(DATE_RANGE.source, "i")

const SECTION_HEADER =
  /^\s*(?:(?:professional|relevant|work|additional|creative|clinical|sales|legal|policy|editorial|research|internship|early career|earlier career|earlier|early|career|consulting|design|marketing|finance|investment|operations|product|nursing|teaching|biomedical engineering|arts administration|communications|academic|technical|core|selected|key)\s+)?(?:experience|employment(?: history)?|work history|career history|internships?|professional development)\s*[:&]?\s*$/i

const ROLE_SEP = /[—–|]|\s-\s/

function stripNonExperienceHead(pro: string): string {
  const lines = pro.split(/\r?\n/)
  const isContact = (l: string) =>
    /@|linkedin|github|\bhttps?:|\(\d{3}\)|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i.test(l)
  const isName = (l: string) =>
    /^[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3}$/.test(l.trim())
  const isSummaryProse = (l: string) =>
    /\b(results-driven|results driven|motivated|aspiring|seeking|passionate|detail-oriented|dedicated|open to relocation|recent graduate|hardworking|driven \w+ (student|professional|graduate))\b/i.test(
      l,
    )
  let i = 0
  let firstContent = true
  while (i < lines.length && i < 8) {
    const l = lines[i].trim()
    if (!l) {
      i++
      continue
    }
    // Strip-conditions come FIRST: a contact line may use • as a separator,
    // which would otherwise trip the bullet break before we strip it.
    if (isContact(l) || isSummaryProse(l) || (firstContent && isName(l))) {
      firstContent = false
      i++
      continue
    }
    if (DATE_RANGE_ONE.test(l) || BULLET_CHARS.test(l) || SECTION_HEADER.test(l)) break
    break // unrecognized line (likely a real title) — stop, don't over-strip
  }
  return i > 0 ? lines.slice(i).join("\n") : pro
}

function lineBasedSegment(text: string): Block[] {
  const frags: { bullet: boolean; text: string }[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const segs = rawLine.split(BULLET_SPLIT)
    const head = segs[0].trim()
    if (head) frags.push({ bullet: false, text: head })
    for (let j = 1; j < segs.length; j++) {
      const b = segs[j].trim()
      if (b) frags.push({ bullet: true, text: b })
    }
  }
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const f of frags) {
    if (f.bullet) {
      if (!cur) {
        cur = { title_line: "(untitled)", bullets: [] }
        blocks.push(cur)
      }
      cur.bullets.push(f.text)
      continue
    }
    if (SECTION_HEADER.test(f.text)) continue
    const looksLikeTitle =
      DATE_RANGE_ONE.test(f.text) || (ROLE_SEP.test(f.text) && f.text.length < 160)
    if (looksLikeTitle || !cur || cur.bullets.length > 0) {
      cur = { title_line: f.text, bullets: [] }
      blocks.push(cur)
    } else {
      cur.title_line += " " + f.text
    }
  }
  return blocks.filter(
    (b) => (b.title_line && b.title_line !== "(untitled)") || b.bullets.length > 0,
  )
}

function splitBullets(s: string): string[] {
  const parts = s
    .split(BULLET_SPLIT)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  if (parts.length <= 1) {
    const t = s.replace(/\s+/g, " ").trim()
    return t ? [t.slice(0, 280)] : [] // unmarked prose role → 1 weight unit
  }
  return parts.map((p) => p.slice(0, 280))
}

function dateRangeSegment(text: string): Block[] {
  const matches = [...text.matchAll(DATE_RANGE)]
  if (matches.length === 0) return []
  const blocks: Block[] = matches.map(() => ({ title_line: "", bullets: [] }))
  for (let k = 0; k < matches.length; k++) {
    const dStart = matches[k].index ?? 0
    const regionStart =
      k === 0 ? 0 : (matches[k - 1].index ?? 0) + matches[k - 1][0].length
    const region = text.slice(regionStart, dStart) // [bullets of role k-1] + [title of role k]
    let beforeTitle: string
    let title: string
    const lb = region.search(LAST_BULLET)
    if (lb >= 0) {
      beforeTitle = region.slice(0, lb)
      title = region.slice(lb).replace(BULLET_SPLIT, "")
    } else if (k > 0 && region.length > 130) {
      const cut = Math.max(0, region.length - 95) // trailing ~95 chars = title_k; rest = role k-1 prose
      beforeTitle = region.slice(0, cut)
      title = region.slice(cut)
    } else {
      beforeTitle = ""
      title = region
    }
    blocks[k].title_line = (title.replace(/\s+/g, " ").trim() + " " + matches[k][0])
      .trim()
      .slice(0, 200)
    if (k > 0 && beforeTitle.trim()) blocks[k - 1].bullets.push(...splitBullets(beforeTitle))
  }
  const last = matches[matches.length - 1]
  const tail = text.slice((last.index ?? 0) + last[0].length)
  if (tail.trim()) blocks[blocks.length - 1].bullets.push(...splitBullets(tail))
  return blocks
}

// A "real title" carries a role/company signal. Fragments (bullet text mis-split
// into their own block) lack it — they merge into the preceding titled block.
const ROLE_WORD =
  /\b(intern(ship)?|manager|analyst|coordinator|assistant|director|lead|engineer|consultant|representative|specialist|president|founder|clerk|extern|coach|teacher|associate|officer|agent|ambassador|fellow|volunteer|steward|technician|designer|developer|administrator|controller|advisor|partner|owner|chair|secretary|captain|counselor|strategist|writer|photographer|server|busser|lifeguard|cashier|tutor|scientist|researcher|nurse|paralegal|accountant|recruiter|broker|trader|planner|supervisor|operator|host|barista|bartender|caddy|aide)\b/i
function isRealTitle(titleLine: string): boolean {
  const s = titleLine.replace(DATE_RANGE, "").trim()
  if (!s) return false
  if (ROLE_WORD.test(s)) return true
  // separator FOLLOWED BY a capital (so prose "testing—while" does not count)
  if (/[|—–·]\s*[A-Z]/.test(s) || /\s-\s[A-Z]/.test(s)) return true
  if (/^[A-Z][A-Za-z.'&]+(?:\s+[A-Z][A-Za-z.'&]+){1,}/.test(s)) return true // Title-Case company
  return false
}
function mergeFragments(blocks: Block[]): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    if (isRealTitle(b.title_line) || out.length === 0) {
      out.push(b) // keep real titles AND the leading block (a real, weakly-titled role)
    } else {
      const prev = out[out.length - 1]
      const frag = b.title_line.replace(DATE_RANGE, "").trim()
      if (frag) prev.bullets.push(frag.slice(0, 280))
      prev.bullets.push(...b.bullets)
    }
  }
  // drop only fully-empty blocks; never drop a substantive leading role.
  return out.filter((b) => (b.title_line && b.title_line.trim()) || b.bullets.length > 0)
}

export function segmentBlocks(professionalText: string): Block[] {
  if (!professionalText) return []
  const pro = stripNonExperienceHead(professionalText)
  const lined = lineBasedSegment(pro)
  const dateRanges = (pro.match(DATE_RANGE) || []).length
  const blocks =
    dateRanges >= 2 && lined.length < dateRanges ? dateRangeSegment(pro) : lined
  return mergeFragments(blocks)
}
