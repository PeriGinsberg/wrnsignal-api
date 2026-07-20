// lib/positioning/v2/phase2/itemPopulatorParts/classifyGapShape.ts
//
// Hybrid heuristic + LLM-fallback classifier for the seven-value GapShape
// taxonomy (Phase 2 v1 build G1). Called per gap candidate at populator
// time. Heuristic-first: most gaps never make an LLM call. Only PASS 4/5
// (tentative skill / coursework) and PASS 6 (genuinely unclassified) hit
// the LLM, and only when the run's cost cap hasn't been exhausted.
//
// Decision passes (run in order; first match wins unless noted):
//
//   PASS 1 — text-pattern HIGH confidence (no LLM):
//     - certification keywords/regex in gap_description or jd_context
//       → "certification"
//     - language proficiency pattern in gap_description
//       → "language"
//     - curated tool/platform names in gap_description
//       → "tool"
//
//   PASS 2 — kind-signal MEDIUM-HIGH confidence (no LLM):
//     - kind === "tool"
//       → "tool"
//     - kind ∈ {"deliverable", "stakeholder", "environment"}
//       → "experience"
//
//   PASS 3 — verb+scope MEDIUM confidence (no LLM):
//     - experience-shaped verb + duration OR scale marker in gap_description
//       → "experience"
//
//   PASS 4 — short skill noun-phrase LOW confidence (LLM verifies):
//     - < 8 words, no action verb, no duration → tentative "skill"
//
//   PASS 5 — coursework pattern LOW confidence (LLM verifies):
//     - "familiarity with", "exposure to", "fundamentals of" → tentative
//       "coursework"
//
//   PASS 6 — UNCLASSIFIED (LLM required):
//     - kind ∈ {"function", "execution", "domain"} AND no text pattern, OR
//     - no signal whatsoever
//     - LLM call. If LLM returns "unknown" or fails, fall back to
//       "experience" (B2's existing composer handles it as the safe
//       default).
//
// Cost-cap behavior: mirrors A3 (suggestBulletsForGap) in itemPopulator.ts.
// The caller passes `aiAllowed: false` when the per-run cap is exhausted;
// the orchestrator then returns the heuristic best guess (or "experience"
// for PASS 6) without an LLM call. aiCostCents is always returned (0 when
// no LLM call was made).
//
// FRD: docs/Features/positioning-phase2-frd.md §5.4 (multi-outcome gap
//      composition consumer of gap_shape) + §6.12 (AI cost cap).

import type { GapCandidate } from "./types"
import type { GapShape } from "../types"
import {
  classifyGapShape as defaultClassifyGapShape,
  type ClassifyGapShapeInput,
  type ClassifyGapShapeResult,
} from "../aiClient"
import { centsForUsage } from "@/lib/ai/costPolicy"

/**
 * Dependency-injection override for the LLM call. Match the aiClient
 * signature so the orchestrator can call it identically regardless of
 * source. Production callers omit it; the real aiClient implementation
 * is used.
 */
export type ClassifyGapShapeAiImpl = (
  input: ClassifyGapShapeInput,
) => Promise<ClassifyGapShapeResult>

export type ClassifyGapShapeOrchestratorInput = {
  /** The gap candidate to classify. */
  candidate: GapCandidate
  /**
   * Whether an LLM call is permitted. Caller (itemPopulator) sets to
   * false when the per-run cost cap is exhausted. When false, PASS 4/5
   * skip verification (use the tentative heuristic shape) and PASS 6
   * falls back to "experience" without a call.
   */
  aiAllowed: boolean
  /** Test-only: inject a mock LLM call. */
  aiImpl?: ClassifyGapShapeAiImpl
}

export type ClassifyGapShapeOrchestratorResult = {
  /** Final shape. */
  shape: GapShape
  /** Integer cents spent on the LLM call (0 when no call was made). */
  aiCostCents: number
  /** True iff an LLM call was made (regardless of outcome). For telemetry. */
  llmCalled: boolean
}

// ============================================================================
// Heuristic dictionaries
// ============================================================================
//
// TODO(v0.2): The keyword/regex/name lists below (CERTIFICATION_KEYWORDS,
// CERTIFICATION_REGEXES, LANGUAGE_NAMES, LANGUAGE_PROFICIENCY_CUES,
// TOOL_KEYWORDS, EXPERIENCE_VERBS, DURATION_REGEXES, SCALE_REGEXES,
// COURSEWORK_REGEXES) are inline-curated for v1. They will need ongoing
// maintenance as JD vocabulary drifts — when the lists outgrow inline
// reasonable-review size (rough thresholds: certifications past ~60
// entries; tools past ~80; languages stable), extract to a dedicated
// constants module (e.g. ./gapShapeDictionaries.ts) or load from a
// config table (e.g. signal_gap_shape_dictionaries) so coaches/PM can
// edit without code changes. Today's inline form is intentional: it
// keeps every classifier decision pass auditable in one file during
// the v1 build sequence.

/**
 * Certification keywords. Matched case-insensitively against
 * gap_description OR jd_context. Mix of specific named credentials
 * (PMP, CFA) and generic patterns (regex below also fires on
 * "<word> certified" / "certified <word>").
 */
const CERTIFICATION_KEYWORDS: readonly string[] = [
  "pmp",
  "cfa",
  "cpa",
  "series 7",
  "series 63",
  "series 65",
  "series 66",
  "itil",
  "six sigma",
  "lean six sigma",
  "scrum master",
  "csm",
  "pmi-acp",
  "shrm-cp",
  "phr",
  "sphr",
  "aws certified",
  "azure certified",
  "google cloud certified",
  "gcp certified",
  "salesforce certified",
  "comptia",
  "cissp",
  "ceh",
  "ccna",
  "ccnp",
  "mcse",
  "rhce",
  "ocp",
  "fpc",
  "cma",
  "cgma",
  "cipm",
  "ce credential",
]

/**
 * Generic certification regexes. Catch credentials not in the curated
 * list. Order matters only weakly — any match wins.
 */
const CERTIFICATION_REGEXES: readonly RegExp[] = [
  /\bcertified\b/i,
  /\bcertification\b/i,
  /\blicense(?:d|s|)\b/i,
  /\bcredentialed\b/i,
  /\baccredit(?:ed|ation)\b/i,
]

/**
 * Language proficiency patterns. Specific to spoken/written languages.
 * Most are paired with a fluency / proficiency / bilingual cue to avoid
 * matching e.g. "Python" (programming language).
 */
const LANGUAGE_NAMES: readonly string[] = [
  "spanish",
  "french",
  "german",
  "italian",
  "portuguese",
  "mandarin",
  "cantonese",
  "chinese",
  "japanese",
  "korean",
  "arabic",
  "hindi",
  "russian",
  "vietnamese",
  "tagalog",
  "polish",
  "dutch",
  "swedish",
  "turkish",
  "hebrew",
]

const LANGUAGE_PROFICIENCY_CUES: readonly RegExp[] = [
  /\bfluen(?:t|cy)\b/i,
  /\bbilingual\b/i,
  /\bmultilingual\b/i,
  /\bproficien(?:t|cy)\s+(?:in\s+)?(?:[a-z]+\s+)?(?:language|spanish|french|german|mandarin|cantonese|japanese|korean|portuguese|arabic|hindi|russian)\b/i,
  /\bnative speaker\b/i,
  /\b(?:business|conversational|professional)\s+(?:level\s+)?(?:fluency|proficiency|spanish|french|german|mandarin)\b/i,
]

/**
 * Curated tool/platform names. Matched case-insensitively as
 * word-boundary-flexible substrings against gap_description. Tools the
 * heuristic catches directly skip the LLM; everything else falls to
 * PASS 2 (kind === "tool") or to the LLM.
 */
const TOOL_KEYWORDS: readonly string[] = [
  "salesforce",
  "hubspot",
  "marketo",
  "pardot",
  "tableau",
  "power bi",
  "powerbi",
  "looker",
  "qlik",
  "sap",
  "workday",
  "netsuite",
  "oracle erp",
  "peoplesoft",
  "adobe creative",
  "photoshop",
  "illustrator",
  "indesign",
  "premiere",
  "after effects",
  "figma",
  "sketch",
  "framer",
  "miro",
  "notion",
  "jira",
  "confluence",
  "asana",
  "monday.com",
  "trello",
  "autocad",
  "solidworks",
  "matlab",
  "stata",
  "spss",
  "sas",
  "alteryx",
  "snowflake",
  "databricks",
  "azure devops",
  "kubernetes",
  "docker",
  "terraform",
  "ansible",
  "jenkins",
  "github actions",
  "gitlab ci",
  "splunk",
  "datadog",
  "new relic",
  "zendesk",
  "intercom",
  "freshdesk",
  "shopify",
  "magento",
  "woocommerce",
]

/**
 * Experience-shaped action verbs. Past-tense + a few common gerunds.
 * Paired with a scope marker (duration or scale) in PASS 3 to qualify
 * as experience. Action-verbs ALONE are too noisy (every skill noun
 * phrase contains gerunds).
 */
const EXPERIENCE_VERBS: readonly string[] = [
  "managed",
  "led",
  "drove",
  "executed",
  "delivered",
  "oversaw",
  "built",
  "owned",
  "directed",
  "supervised",
  "coordinated",
  "spearheaded",
]

/**
 * Duration patterns: "N years", "N+ years", "N-N years", etc.
 */
const DURATION_REGEXES: readonly RegExp[] = [
  /\b\d+\+?\s*(?:years?|yrs?)\b/i,
  /\b\d+\s*-\s*\d+\s*(?:years?|yrs?)\b/i,
  /\b(?:multiple|several|many)\s+years?\b/i,
]

/**
 * Scale markers: team size, budget size, deal size, throughput.
 */
const SCALE_REGEXES: readonly RegExp[] = [
  /\b\d+\+?\s*(?:people|peers|reports|engineers|analysts|interns)\b/i,
  /\bteam\s+of\s+\d+/i,
  /\$\s*\d+[.,]?\d*\s*[mkbMKB]\b/i,
  /\$\s*\d+\s*(?:million|billion|thousand)\b/i,
  /\b\d+\+?\s*(?:million|billion)\s+(?:dollars|in revenue|in budget)\b/i,
]

/**
 * Coursework patterns. Lead phrases used in JDs for academic familiarity
 * rather than work experience.
 */
const COURSEWORK_REGEXES: readonly RegExp[] = [
  /\bfamiliarity with\b/i,
  /\bexposure to\b/i,
  /\bfundamentals of\b/i,
  /\bbasic understanding of\b/i,
  /\bworking knowledge of\b/i,
  /\bcoursework in\b/i,
  /\bintroduction to\b/i,
]

// ============================================================================
// Pure heuristic — returns { shape, confidence } without any LLM call
// ============================================================================

type HeuristicConfidence = "high" | "medium" | "low" | "unclassified"

type HeuristicResult = {
  /** Best-guess shape from heuristics alone. "experience" when truly unclassified. */
  shape: GapShape
  /** How sure the heuristic is. Drives whether an LLM call is needed. */
  confidence: HeuristicConfidence
}

/**
 * Run the deterministic passes only. Exposed (not exported) for the
 * orchestrator to consume; tests cover orchestrator behavior, not
 * heuristic internals directly. Pure function — no I/O.
 */
function runHeuristic(candidate: GapCandidate): HeuristicResult {
  const desc = (candidate.gap_description ?? "").toLowerCase()
  const ctx = (candidate.jd_context ?? "").toLowerCase()
  const kind = candidate.kind ?? ""

  // ── PASS 1: HIGH-confidence text patterns ──────────────────────────────
  // Certification: keywords OR generic regex in either field.
  for (const kw of CERTIFICATION_KEYWORDS) {
    if (desc.includes(kw) || ctx.includes(kw)) {
      return { shape: "certification", confidence: "high" }
    }
  }
  for (const re of CERTIFICATION_REGEXES) {
    if (re.test(desc) || re.test(ctx)) {
      return { shape: "certification", confidence: "high" }
    }
  }

  // Language: requires a proficiency cue (fluent / bilingual / etc.) OR
  // a known language name in the gap_description. Name alone with a cue
  // anywhere also counts.
  let hasLangName = false
  for (const lang of LANGUAGE_NAMES) {
    if (desc.includes(lang)) {
      hasLangName = true
      break
    }
  }
  let hasLangCue = false
  for (const re of LANGUAGE_PROFICIENCY_CUES) {
    if (re.test(desc)) {
      hasLangCue = true
      break
    }
  }
  if (hasLangName && hasLangCue) {
    return { shape: "language", confidence: "high" }
  }

  // Tool: curated list in gap_description.
  for (const tool of TOOL_KEYWORDS) {
    if (desc.includes(tool)) {
      return { shape: "tool", confidence: "high" }
    }
  }

  // ── PASS 2: MEDIUM-HIGH kind signals ───────────────────────────────────
  if (kind === "tool") {
    return { shape: "tool", confidence: "high" }
  }
  if (kind === "deliverable" || kind === "stakeholder" || kind === "environment") {
    return { shape: "experience", confidence: "high" }
  }

  // ── PASS 3: MEDIUM verb + scope ────────────────────────────────────────
  let hasVerb = false
  for (const v of EXPERIENCE_VERBS) {
    // Word-boundary check: avoid matching "built" inside "rebuilt", etc.
    const re = new RegExp(`\\b${v}\\b`, "i")
    if (re.test(desc)) {
      hasVerb = true
      break
    }
  }
  let hasDuration = false
  for (const re of DURATION_REGEXES) {
    if (re.test(desc)) {
      hasDuration = true
      break
    }
  }
  let hasScale = false
  for (const re of SCALE_REGEXES) {
    if (re.test(desc)) {
      hasScale = true
      break
    }
  }
  if (hasVerb && (hasDuration || hasScale)) {
    return { shape: "experience", confidence: "medium" }
  }
  // Duration alone (no verb) also implies experience-shaped.
  if (hasDuration) {
    return { shape: "experience", confidence: "medium" }
  }

  // ── PASS 5: LOW coursework patterns (before PASS 4 — academic cues
  // are more specific than the generic short-noun-phrase fallback).
  for (const re of COURSEWORK_REGEXES) {
    if (re.test(desc) || re.test(ctx)) {
      return { shape: "coursework", confidence: "low" }
    }
  }

  // ── PASS 4: LOW short skill noun phrase ────────────────────────────────
  // Tokenize roughly: split on non-word chars, drop empties.
  const words = desc.split(/[^a-z0-9]+/i).filter((w) => w.length > 0)
  if (words.length > 0 && words.length < 8 && !hasVerb && !hasDuration && !hasScale) {
    return { shape: "skill", confidence: "low" }
  }

  // ── PASS 6: UNCLASSIFIED — caller sends to LLM ─────────────────────────
  // "experience" is the safe default for the LLM-unavailable path
  // (B2's existing composer handles experience-shaped content).
  return { shape: "experience", confidence: "unclassified" }
}

// ============================================================================
// Orchestrator — heuristic + LLM fallback
// ============================================================================

/**
 * Classify a gap's shape using the hybrid passes above.
 *
 * Behavior:
 *   - High / medium confidence → return immediately, no LLM, aiCostCents=0.
 *   - Low confidence (PASS 4/5) → LLM call ONLY if `aiAllowed` is true.
 *     LLM result overrides the heuristic tentative shape. If LLM returns
 *     "unknown" or fails, fall back to the heuristic's tentative shape.
 *   - Unclassified (PASS 6) → LLM call ONLY if `aiAllowed` is true.
 *     LLM result wins. If LLM returns "unknown" or fails, fall back to
 *     "experience" (the heuristic's PASS 6 default).
 *
 * The orchestrator catches LLM errors and never throws — the populator
 * is not fail-critical on shape classification. Worst case: a gap gets
 * shape="experience" and the existing B2 composer handles it.
 */
export async function classifyGapShape(
  input: ClassifyGapShapeOrchestratorInput,
): Promise<ClassifyGapShapeOrchestratorResult> {
  const heuristic = runHeuristic(input.candidate)

  // High / medium confidence — done. No LLM call.
  if (heuristic.confidence === "high" || heuristic.confidence === "medium") {
    return { shape: heuristic.shape, aiCostCents: 0, llmCalled: false }
  }

  // Cost cap exhausted — return heuristic best guess without LLM.
  if (!input.aiAllowed) {
    return { shape: heuristic.shape, aiCostCents: 0, llmCalled: false }
  }

  // Low / unclassified — make the LLM call.
  const aiImpl = input.aiImpl ?? defaultClassifyGapShape
  try {
    const result = await aiImpl({
      gapDescription: input.candidate.gap_description,
      jdContext: input.candidate.jd_context,
      isRetry: false,
    })
    const cost = centsForUsage(result.usage)
    // LLM said something concrete — accept it.
    if (result.shape !== "unknown") {
      return { shape: result.shape, aiCostCents: cost, llmCalled: true }
    }
    // LLM said "unknown" — fall back to heuristic's tentative shape
    // (for PASS 4/5) or to "experience" (PASS 6 default already set
    // by runHeuristic on unclassified).
    return { shape: heuristic.shape, aiCostCents: cost, llmCalled: true }
  } catch (e) {
    console.warn(
      `[classifyGapShape] LLM call failed for "${input.candidate.gap_description.slice(0, 60)}": ${e instanceof Error ? e.message : String(e)}`,
    )
    return { shape: heuristic.shape, aiCostCents: 0, llmCalled: true }
  }
}
