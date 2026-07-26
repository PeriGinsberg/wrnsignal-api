// FILE: app/api/jobfit/verbEvidence.ts
//
// resume -> per-bullet verb evidence — defect #2, step 1 (résumé side).
//
// Reuses defect #1's résumé plumbing (profileEvidence.sectionSplit) and adds a
// per-bullet parse: for each EXPERIENCE bullet, the leading action verb, its
// class (ownership / contribution / neutral), the object phrase, and a generic
// scope (function-level system vs task-level deliverable). It does NOT know the
// posting's required object X — the object↔X match + fire logic is defect #2
// step 2 (verbMismatch). See DESIGN-verb-classifier.md §1/§4.

import { sectionSplit } from "./profileEvidence"

export type VerbClass = "ownership" | "contribution" | "neutral"
export type BulletScope = "function" | "task" | "unknown"

export type VerbBullet = {
  text: string
  leadingVerb: string | null
  verbClass: VerbClass
  objectPhrase: string // bullet text after the leading verb
  objectHeadNoun: string | null // the function/task noun that set scope
  scope: BulletScope
}

// Verb taxonomy (§1), keyed on lowercased surface forms incl. common inflections.
// Classification reads the bullet's LEADING verb only (leading-verb rule, §2).
const OWNERSHIP = new Set([
  "owned", "own", "owns", "owning", "built", "build", "builds", "building",
  "led", "lead", "leads", "leading", "architected", "architect", "drove", "drive",
  "drives", "driving", "hired", "hire", "hires", "hiring", "defined", "define",
  "defines", "defining", "established", "establish", "founded", "found", "created",
  "create", "creates", "launched", "launch", "launches", "spearheaded", "spearhead",
  "headed", "head", "ran", "run", "runs", "set", "sets", "scaled", "scale",
  "initiated", "initiate", "championed", "champion",
])
const CONTRIBUTION = new Set([
  "partnered", "partner", "partners", "partnering", "supported", "support",
  "supports", "supporting", "assisted", "assist", "assists", "contributed",
  "contribute", "contributes", "helped", "help", "helps", "helping",
  "collaborated", "collaborate", "collaborates", "participated", "participate",
  "participates", "worked", "work", "works", "working", "gathered", "gather",
  "aided", "aid", "joined", "join", "engaged", "engage",
])
// Everything else defaults to NEUTRAL (§1). A few common neutral forms are listed
// for readability, but the default is what governs.
const NEUTRAL = new Set([
  "analyzed", "maintained", "reported", "tracked", "monitored", "produced",
  "prepared", "executed", "implemented", "delivered", "conducted", "performed",
  "updated", "managed", "designed", "developed", "migrated",
])

function classifyVerb(verb: string | null): VerbClass {
  if (!verb) return "neutral"
  if (OWNERSHIP.has(verb)) return "ownership"
  if (CONTRIBUTION.has(verb)) return "contribution"
  return "neutral" // NEUTRAL set is illustrative; default is neutral either way
  void NEUTRAL
}

// Scope nouns (§2 Step B). FUNCTION = an ownable system; TASK = a deliverable
// within a function. FUNCTION presence wins (a bullet naming a system is
// function-level even if it also names a report).
const FUNCTION_NOUNS = [
  "function", "system", "stack", "platform", "warehouse", "infrastructure",
  "model", "models", "pipeline", "roadmap", "strategy", "program", "org",
  "organization", "practice", "team", "framework", "architecture", "line",
]
const TASK_NOUNS = [
  "report", "reports", "reporting", "dashboard", "dashboards", "taxonomy",
  "test", "tests", "readout", "readouts", "deck", "analysis", "presentation",
  "spreadsheet", "review",
]

function scopeOf(objectPhrase: string): { scope: BulletScope; head: string | null } {
  const lower = objectPhrase.toLowerCase()
  const fn = FUNCTION_NOUNS.find((n) => new RegExp(`\\b${n}\\b`).test(lower))
  if (fn) return { scope: "function", head: fn }
  const tk = TASK_NOUNS.find((n) => new RegExp(`\\b${n}\\b`).test(lower))
  if (tk) return { scope: "task", head: tk }
  return { scope: "unknown", head: null }
}

// Split the EXPERIENCE section into whole bullets (wrapped continuation lines
// joined; role-header lines skipped). Mirrors gateClassifier's bullet coalescing.
function experienceBullets(experience: string): string[] {
  const out: string[] = []
  let open = false
  for (const raw of experience.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t) { open = false; continue }
    if (/^\*\*/.test(t)) { open = false; continue } // **Role — Company (dates)** header
    if (/^[-*•]\s+/.test(t)) { out.push(t.replace(/^[-*•]\s+/, "")); open = true }
    else if (open) { out[out.length - 1] += " " + t }
  }
  return out
}

export function extractVerbEvidence(resume: string): VerbBullet[] {
  const { experience } = sectionSplit(resume)
  return experienceBullets(experience).map((text) => {
    // strip a leading bold/markdown wrapper, then take the first word as the verb
    const clean = text.replace(/^\*+/, "").trim()
    const m = clean.match(/^([A-Za-z][A-Za-z-]*)/)
    const leadingVerb = m ? m[1].toLowerCase() : null
    const verbClass = classifyVerb(leadingVerb)
    const objectPhrase = m ? clean.slice(m[0].length).trim() : clean
    const { scope, head } = scopeOf(objectPhrase)
    return { text: clean, leadingVerb, verbClass, objectPhrase, objectHeadNoun: head, scope }
  })
}
