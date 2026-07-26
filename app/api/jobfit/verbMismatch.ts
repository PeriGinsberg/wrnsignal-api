// FILE: app/api/jobfit/verbMismatch.ts
//
// Ownership-requirement extraction (posting side) + object-scoped mismatch —
// defect #2, step 2. See DESIGN-verb-classifier.md §2 (Steps A–D).
//
// Fires RISK_OWNERSHIP_VERB_MISMATCH iff the posting demands ownership of X and
// the résumé's FUNCTION-level evidence FOR X is contribution-only (no ownership
// verb on X). Object↔X matching is the semantic-fitted part (§6, prod-gap).

import type { VerbBullet } from "./verbEvidence"
import { extractRequirementsSection } from "./gateClassifier"

export type OwnershipRequirement = { text: string; object: string; conceptTokens: string[] }

// Step B domain expansion for known X objects. Unseen X → its own tokens only
// (token overlap), which fails safe (under-fire on synonym-heavy résumés).
const CONCEPT_EXPANSION: Array<{ match: RegExp; tokens: string[] }> = [
  {
    match: /measurement|analytics function|data function/i,
    tokens: ["measurement", "data warehouse", "warehouse", "data stack", "dbt", "bi layer",
      "attribution", "forecasting", "marketing mix model", "cac", "ltv", "pipeline velocity", "measurement system"],
  },
  {
    match: /roadmap|product line|strategy|product area/i,
    tokens: ["roadmap", "product line", "product direction", "strategy", "vision"],
  },
  {
    match: /model lifecycle|ml lifecycle|full model/i,
    tokens: ["model", "lifecycle", "training", "deployment", "monitoring"],
  },
]

// Defect 2 — stopwords dropped from conceptTokens so objectOverlaps can't match
// on junk. A greedy capture like "…function and drive the build-out…" otherwise
// leaves tokens "and"/"the"/"our" that match ANY bullet, making the fire
// punctuation-fragile. See project_jobfit_ownership_reporting_scope_falsefire.
const OBJECT_STOPWORDS = new Set([
  "and", "the", "our", "your", "its", "their", "out", "for", "with", "across", "over",
  "into", "onto", "from", "that", "this", "these", "those", "per", "via",
  "drive", "build", "lead", "driving", "building", "leading", "own", "owning",
])
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !OBJECT_STOPWORDS.has(w))
}

function conceptTokensFor(object: string): string[] {
  const base = tokenize(object)
  const extra = CONCEPT_EXPANSION.filter((e) => e.match.test(object)).flatMap((e) => e.tokens)
  return Array.from(new Set([...base, ...extra]))
}

// Step A. Parse ownership demands from the REQUIREMENTS section only — "you'll
// own X" in the duties ("What you'll do") is a forward-looking job duty, not a
// backward-looking demand ON the candidate, so pulling it is a category error
// that over-fires. Pull ALL ownership demands in the section (a posting may
// legitimately require ownership of two things). Headerless posting → fall back
// to the WHOLE posting (over-fire safe; never a silent zero-requirement miss).
export function extractOwnershipRequirements(jobText: string): OwnershipRequirement[] {
  const scoped = extractRequirementsSection(jobText) ?? jobText
  const out: OwnershipRequirement[] = []
  const seen = new Set<string>()
  const add = (object: string, text: string) => {
    const obj = object.trim().toLowerCase().replace(/\s+/g, " ")
    if (!obj || seen.has(obj)) return
    seen.add(obj)
    out.push({ text: text.trim(), object: obj, conceptTokens: conceptTokensFor(obj) })
  }
  // Defect 2 — stop the capture at CLAUSE boundaries (" and ") so a run-on
  // ("…function and drive the build-out…") is cut to its noun phrase, and strip
  // leading determiners/possessives (the/a/an/our/my/your) so the object is the
  // noun phrase, not a stopword-led run-on.
  const patterns = [
    /(?:demonstrated\s+)?ownership of (?:a |an |the |our |my |your )?([a-z][a-z /-]*?)(?=,|\.|;|\(| and | not | end to end|$)/gi,
    /\bown(?:s|ed|ing)? (?:the |a |an |our |my |your )?([a-z][a-z /-]*?)(?=,|\.|;| and | end to end| for | from |$)/gi,
    /driving ([a-z][a-z /-]*?) you personally defined/gi,
  ]
  for (const re of patterns) {
    for (const m of scoped.matchAll(re)) if (m[1]) add(m[1], m[0])
  }
  return out
}

function objectOverlaps(bullet: VerbBullet, conceptTokens: string[]): boolean {
  const hay = (bullet.objectPhrase + " " + bullet.text).toLowerCase()
  // `s?` so a singular concept token matches its plural (model↔models) — else an
  // honest candidate who OWNS "churn-prediction models" is missed and false-fires.
  return conceptTokens.some((t) =>
    t.includes(" ") ? hay.includes(t) : new RegExp(`\\b${t}s?\\b`).test(hay)
  )
}

export type VerbMismatchResult = {
  fires: boolean
  firedOn: string | null // the requirement object that fired
  perRequirement: Array<{
    object: string
    relevant: number
    hasContribution: boolean
    hasOwnership: boolean
    fires: boolean
  }>
}

// Steps C–D. For each ownership requirement, keep FUNCTION-scope bullets whose
// object matches X; fire iff ≥1 is contribution and NONE is ownership.
export function detectOwnershipVerbMismatch(jobText: string, bullets: VerbBullet[]): VerbMismatchResult {
  const reqs = extractOwnershipRequirements(jobText)
  const perRequirement: VerbMismatchResult["perRequirement"] = []
  let firedOn: string | null = null

  for (const req of reqs) {
    const relevant = bullets.filter((b) => b.scope === "function" && objectOverlaps(b, req.conceptTokens))
    const hasContribution = relevant.some((b) => b.verbClass === "contribution")
    const hasOwnership = relevant.some((b) => b.verbClass === "ownership")
    const fires = relevant.length > 0 && hasContribution && !hasOwnership // Guard 3: one ownership clears
    if (fires && !firedOn) firedOn = req.object
    perRequirement.push({ object: req.object, relevant: relevant.length, hasContribution, hasOwnership, fires })
  }

  return { fires: firedOn !== null, firedOn, perRequirement }
}
