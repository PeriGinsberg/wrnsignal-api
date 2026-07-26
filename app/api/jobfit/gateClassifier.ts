// FILE: app/api/jobfit/gateClassifier.ts
//
// Regex requirement classifier — defect #1, step 2 (JD side).
//
// Turns a job posting into GateCandidate[] (the ONLY interface to the
// deterministic core in gateLedger.ts). Implements DESIGN-gate-ledger.md §2:
//   §2a section headers, §2b E1–E5, §2c C1–C2, §3a credential allowlist+exclusion.
// It classifies the JD ONLY (kind / required / spec / trigger_span). It never
// touches the resume and never decides MET/UNMET — that is the core's job.
//
// This classifier is deliberately corpus-fitted (see §6: the LLM classifier is
// the designed-in successor for unseen phrasings). Fitted to 8 synthetic + 6
// real postings.

import type { GateCandidate, GateSpec, LicenseTerm } from "./gateLedger"

// ── slug / id helpers ────────────────────────────────────────────────────────
function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\+/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

// ── section header detection (§2a) ───────────────────────────────────────────
const RE_REQUIRED = /^\**\s*(requirements?(\s*\((?:non-negotiable|must-have)\))?(\s*[—-]\s*must show hands-on.*)?|what we'?re looking for|required qualifications(,?\s*capabilities,?\s*and skills)?|skills you(?:'ll| will) need|who you are|what you'?ll bring|qualifications)\s*:?\s*\**$/i
const RE_PREFERRED = /^\**\s*(nice[-\s]to[-\s]have|preferred qualifications?|desired qualifications?|preferred(\s*\(nice-to-have\))?)\s*:?\s*\**$/i
// headers that CLOSE a required/preferred section (soft, non-gating)
const RE_OTHER = /^\**\s*(responsibilities|what you'?ll do|what you will do|about(\s+(us|the\s+(company|role)))?|job\s+(description|overview|responsibilities)|benefits|what we\s+(can\s+)?offer|compensation|skills|locations?|what'?s next|stack|position summary|some additional benefits)\s*:?\s*\**$/i

// A required-section header that itself declares "hands-on … all four" (case 05):
const RE_HANDS_ON_SECTION = /must show hands-on|hands-on.*all\s+(four|three|two|\d+)/i

// ── §3a exclusion (work-auth / EEO boilerplate) — applied BEFORE marker (C2) ──
const RE_EXCLUDED = /authorized to work|eligible to work|no sponsorship|immigration sponsorship|equal[-\s]opportunity|background check|work authorization/i

// ── §2c inline markers ───────────────────────────────────────────────────────
const RE_STRONG_MARKER = /\b(required|must\s+(?:have|show|possess|be able to|hold|be)|non-negotiable|mandatory|requires)\b/i
const RE_ENROLLMENT = /currently pursuing|pursuing\s+(?:a|an)\b|working toward|enrolled in|expected graduation|candidate for|rising\s+(?:junior|senior)/i

// ── known tool vocab (specialized vs ubiquitous) ─────────────────────────────
const SPECIALIZED = ["dbt", "snowflake", "airflow", "spark", "salesforce", "hubspot", "angular", "pytorch", "tensorflow", "kafka", "tableau", "alteryx", "looker"]
const UBIQUITOUS = new Set(["excel", "powerpoint", "word", "outlook", "google docs", "microsoft word", "microsoft excel"])

// ── experience detectors (§2b + E4) ──────────────────────────────────────────
function detectExperience(line: string): GateCandidate | null {
  // E4 reject: company-age "For N years"
  if (/\bfor\s+\d+\+?\s*years\b/i.test(line)) return null

  // compound "N+ years … with at least M in <domain>" → single domain gate
  let m = line.match(/(\d+)\+?\s*years?\b[^.\n]*?\bwith\s+at\s+least\s+(\d+)\s*(?:years?\s*)?in\s+([A-Za-z][A-Za-z0-9 /&.+-]*?)(?=[.,;]|$)/i)
  if (m) {
    const domain = slug(m[3])
    const years = Number(m[2])
    return gate(`${domain}_${years}yr`, false, m[0], { kind: "experience", years, scope: { domain } })
  }
  // manager-of-managers
  m = line.match(/(\d+)\+?\s*years?\s+(?:managing\s+managers|manager\s+of\s+managers|managers\s*\(not just ICs?\))/i)
  if (m) return gate(`manager_of_managers_${m[1]}yr`, false, m[0], { kind: "experience", years: Number(m[1]), scope: "manager_of_managers" })

  // recency + version: "N+ years of recent, hands-on <skill> (vNN+)"
  m = line.match(/(\d+)\+?\s*years?\s+of\s+recent,?\s*hands-?on\s+([A-Za-z][A-Za-z0-9.]*)\s*\(v?(\d+)\+?\)/i)
  if (m) {
    const skill = slug(m[2])
    const withinLastNRoles = /last\s+two\s+roles/i.test(line) ? 2 : undefined
    return gate(`recent_${skill}_v${m[3]}_${m[1]}yr`, false, m[0], {
      kind: "experience", years: Number(m[1]), scope: { domain: skill },
      recency: { versionMin: Number(m[3]), withinLastNRoles },
    })
  }
  // specific practice: "N+ years building ML models in production"
  m = line.match(/(\d+)\+?\s*years?\s+building\s+ml\s+models?\s+in\s+production/i)
  if (m) return gate(`ml_in_prod_${m[1]}yr`, false, m[0], { kind: "experience", years: Number(m[1]), scope: { domain: "ml_in_prod" } })

  // generic "N+ years in/of <field>" → total years-of-experience gate
  m = line.match(/(\d+)\+?\s*years?\s+(?:in|of|building|managing)\s+([A-Za-z][A-Za-z0-9 /&.+-]*?)(?=[.,;]|$)/i)
  if (m) return gate(`yoe_${m[1]}`, false, m[0], { kind: "experience", years: Number(m[1]), scope: "total" })

  return null
}

// hands-on practice presence (A/B testing) → tool-style presence gate
function detectPractice(line: string): GateCandidate | null {
  if (/hands-?on\s+(?:experimentation\s*\/?\s*)?(?:a\/b testing|ab testing|experimentation)/i.test(line)) {
    return gate("experimentation_ab_testing", false, line.trim(), { kind: "tool", anyOf: ["ab_testing"] })
  }
  return null
}

// ── credential detectors (§2b E1/E2/E5 + §3a allowlist) ──────────────────────
function detectClearance(line: string): GateCandidate | null {
  const m = line.match(/active\s+([A-Za-z/ ]+?)\s+(?:security\s+)?clearance/i)
  if (!m) return null
  const id = slug(m[1])
  return gate(`${id}_clearance`, false, m[0], { kind: "credential", credentialType: "clearance", id })
}

function detectDegree(line: string): GateCandidate | null {
  if (!/bachelor'?s(?:\s+degree)?|master'?s(?:\s+degree)?/i.test(line)) return null
  if (RE_ENROLLMENT.test(line)) return null // E1: enrollment ≠ degree-held
  const softMarker = /encouraged to apply|preferred|a plus|ideally/i.test(line)
  const genericEscape = /or\s+equivalent\s+(?:work\s+)?experience\b/i.test(line)
  const specificWaiver = /waiver on file|dod-accepted|accepted\s+(?:experience\s+)?waiver/i.test(line)
  // E2: soft-marked or generic-escape degree lines do NOT gate.
  if (softMarker || genericEscape) return null
  return gate("degree_or_waiver", false, line.trim(), { kind: "credential", credentialType: "degree", waiverPath: specificWaiver ? "specific" : "none" })
}

// E5 compound + substitute license
function detectLicense(line: string): GateCandidate | null {
  if (!/\b(FINRA|SIE|Series\s*\d+|CPA|bar|\bRN\b|\bPE\b|CDL)\b/i.test(line)) return null
  // capture substitute clause: "(63 and 65 accepted in lieu of 66)"
  const subs: Record<string, string[][]> = {}
  const subM = line.match(/\(([^)]*\bin lieu of\b[^)]*)\)/i)
  if (subM) {
    const inner = subM[1]
    const lieu = inner.match(/in lieu of\s+(\d+)/i)
    const subNums = (inner.match(/\d+/g) || []).filter((n) => !lieu || n !== lieu[1])
    if (lieu && subNums.length) subs[`series_${lieu[1]}`] = [subNums.map((n) => `series_${n}`)]
  }
  const terms: LicenseTerm[] = []
  if (/\bSIE\b/i.test(line)) terms.push({ id: "sie" })
  // Series numbers OUTSIDE the substitute parenthetical
  const outside = line.replace(/\([^)]*\bin lieu of\b[^)]*\)/i, "")
  for (const sm of outside.matchAll(/series\s*(\d+)/gi)) {
    const id = `series_${sm[1]}`
    terms.push(subs[id] ? { id, substitutes: subs[id] } : { id })
  }
  if (/\bCPA\b/i.test(line)) terms.push({ id: "cpa" })
  if (!terms.length) return null
  const gid = terms.map((t) => t.id).join("_").replace(/series_/g, "series")
  return gate(`${/finra/i.test(line) ? "finra_" : ""}${gid}`, false, line.trim(), { kind: "credential", credentialType: "license", requires: terms })
}

// ── tool detectors (§2b E3a/E3b) ─────────────────────────────────────────────
function excludedTool(line: string): boolean {
  if (/proficiency\s+(?:in|with)|knowledge of|familiarity with/i.test(line)) return true
  // E3b: examples / parenthetical after a generic noun
  if (/\((?:e\.g\.|ex\.|such as|etc)/i.test(line)) return true
  return false
}
function detectTool(line: string, handsOnSection: boolean): GateCandidate[] {
  if (excludedTool(line)) return []
  const out: GateCandidate[] = []
  // OR gate with a work artifact: "Experience with Salesforce or HubSpot pipeline data"
  const orM = line.match(/experience with\s+([A-Za-z]+)\s+or\s+([A-Za-z]+)\s+(pipeline|crm)/i)
  if (orM) {
    const a = slug(orM[1]), b = slug(orM[2])
    const gid = (a === "salesforce" || b === "salesforce") && (a === "hubspot" || b === "hubspot") ? "crm_pipeline" : `${a}_or_${b}`
    out.push(gate(gid, false, orM[0], { kind: "tool", anyOf: [a, b] }))
    return out
  }
  // inline hands-on tool: "hands-on experience building models in dbt"
  const hoM = line.match(new RegExp(`hands-?on[^.\\n]*\\b(${SPECIALIZED.join("|")})\\b`, "i"))
  if (hoM) {
    const t = slug(hoM[1])
    if (!UBIQUITOUS.has(t)) out.push(gate(`${t}_handson`, false, hoM[0], { kind: "tool", anyOf: [t] }))
    return out
  }
  // bolded/leading specialized tool under a "hands-on all four" section (case 05)
  if (handsOnSection) {
    const bM = line.match(/^[-*\s]*\**\s*([A-Za-z][A-Za-z0-9.]+)/)
    if (bM) {
      const t = slug(bM[1])
      if (SPECIALIZED.includes(t) && !UBIQUITOUS.has(t)) out.push(gate(`${t}_handson`, false, bM[0], { kind: "tool", anyOf: [t] }))
    }
  }
  return out
}

function gate(gate_id: string, required: boolean, trigger_span: string, spec: GateSpec): GateCandidate {
  return { gate_id, required, trigger_span: trigger_span.trim(), spec }
}

// Join wrapped continuation lines back into their bullet BEFORE parsing, so a
// requirement whose clause wraps across physical lines is read whole. Real
// postings wrap constantly; per-physical-line parsing misreads them (e.g. a
// degree line's "…waiver on file" clause landing on the next line -> classifier
// sees no waiver path -> a candidate who HELD the waiver is wrongly UNMET). Only
// OPEN bullets absorb continuations; non-bullet prose stays per-line (fallback
// prose is sentence-per-line and must not be globbed together). A blank line or
// the next bullet/header closes the open bullet.
function coalesceBullets(rawLines: string[]): string[] {
  const out: string[] = []
  let openBullet = false
  for (const raw of rawLines) {
    const t = raw.trim()
    if (!t) { openBullet = false; continue }
    const isBullet = /^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t)
    const isHeader = RE_REQUIRED.test(t) || RE_PREFERRED.test(t) || RE_OTHER.test(t)
    if (isBullet) { out.push(t); openBullet = true }
    else if (isHeader) { out.push(t); openBullet = false }
    else if (openBullet) { out[out.length - 1] += " " + t }
    else { out.push(t) }
  }
  return out
}

// Return the text UNDER required-section headers only (excludes "What you'll do"
// duties, preferred, and boilerplate), or null when the posting has no
// detectable requirements section. Shared with defect #2's ownership-requirement
// extraction, which scopes to REQUIREMENTS (a candidate demand), not duties.
export function extractRequirementsSection(jobText: string): string | null {
  const lines = coalesceBullets(jobText.split(/\r?\n/))
  const out: string[] = []
  let inReq = false
  for (const line of lines) {
    if (RE_REQUIRED.test(line)) { inReq = true; continue }
    if (RE_PREFERRED.test(line) || RE_OTHER.test(line)) { inReq = false; continue }
    if (inReq) out.push(line)
  }
  return out.length ? out.join("\n") : null
}

// Text UNDER preferred/nice-to-have headers only (or null). Used by defect #3's
// preferred_item_missing (a nice-to-have absence, LOW, non-blocking).
export function extractPreferredSection(jobText: string): string | null {
  const lines = coalesceBullets(jobText.split(/\r?\n/))
  const out: string[] = []
  let inPref = false
  for (const line of lines) {
    if (RE_PREFERRED.test(line)) { inPref = true; continue }
    if (RE_REQUIRED.test(line) || RE_OTHER.test(line)) { inPref = false; continue }
    if (inPref) out.push(line)
  }
  return out.length ? out.join("\n") : null
}

// ── main ─────────────────────────────────────────────────────────────────────
export function classifyRequirements(jobText: string): GateCandidate[] {
  const lines = coalesceBullets(jobText.split(/\r?\n/))
  const hasHeaders = lines.some((l) => RE_REQUIRED.test(l) || RE_PREFERRED.test(l))

  const out: GateCandidate[] = []
  let sawClearance = false
  const pendingCitizenship: GateCandidate[] = []

  let mode: "required" | "preferred" | "other" | null = hasHeaders ? "other" : null
  let handsOnSection = false

  const consider = (line: string, required: boolean) => {
    if (RE_EXCLUDED.test(line)) return // C2: exclusion beats marker

    const cred = detectClearance(line) || detectDegree(line) || detectLicense(line)
    if (cred) { if (cred.spec.kind === "credential" && cred.spec.credentialType === "clearance") sawClearance = true; out.push({ ...cred, required }); return }

    // citizenship gates only if a clearance is co-located (§3a) — defer
    if (/must be (?:a |an )?(?:u\.?s\.?|united states) citizen|(?:u\.?s\.?|united states) citizenship (?:is )?required/i.test(line)) {
      pendingCitizenship.push(gate("us_citizenship", required, line, { kind: "credential", credentialType: "citizenship" }))
      return
    }
    const exp = detectExperience(line) || detectPractice(line)
    if (exp) { out.push({ ...exp, required }); return }

    for (const t of detectTool(line, handsOnSection)) out.push({ ...t, required })
  }

  for (const line of lines) {
    if (RE_REQUIRED.test(line)) { mode = "required"; handsOnSection = RE_HANDS_ON_SECTION.test(line); continue }
    if (RE_PREFERRED.test(line)) { mode = "preferred"; handsOnSection = false; continue }
    if (RE_OTHER.test(line)) { mode = "other"; handsOnSection = false; continue }

    if (hasHeaders) {
      if (mode === "required") consider(line, true)
      // preferred/other lines never gate (Guard 3 handles preferred; other is soft)
    } else {
      // §2c no-header fallback: intrinsic-required OR strong-marker gate-shaped lines.
      const intrinsic = /(\d+)\+?\s*years?\s+(?:in|of|building|managing)/i.test(line) || /clearance|citizen|\bSIE\b|series\s*\d+/i.test(line)
      const required = intrinsic || RE_STRONG_MARKER.test(line)
      if (required) consider(line, true)
    }
  }

  // promote citizenship only when clearance co-located
  if (sawClearance) for (const c of pendingCitizenship) out.push(c)

  // dedupe by gate_id (keep first)
  const seen = new Set<string>()
  return out.filter((c) => (seen.has(c.gate_id) ? false : (seen.add(c.gate_id), true)))
}
