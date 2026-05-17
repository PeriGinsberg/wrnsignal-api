// lib/positioning/v2/phase2/groundingValidator.ts
//
// Server-side validation that an AI-generated draft contains only facts
// traceable to the allowed source set. Enforces the interview-integrity
// principle (FRD §4.2) — every claim in the revised resume must be
// defensible by the user in an interview, which means it must originate
// from the original resume or text the user typed.
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.8 — grounding validation contract (the algorithm)
//   §4.2 — interview integrity (the why)
//   §6.7 — AI integration retry policy (uses this validator)
//   §6.9.1 — manual-entry mode (the downstream UX when validation fails
//            after retry)
//   §11 — grounding validator telemetry (operational pattern)
//
// Conservative-validator principle: the validator errs toward rejecting
// borderline drafts rather than letting ungrounded claims through. False
// rejects degrade UX (more manual-entry-mode invocations) but never
// produce interview-integrity violations. False accepts are the failure
// mode that matters — those leak ungrounded claims into the revised
// resume. Tuning post-launch will follow the §11 telemetry pattern
// (review first 100 rejections, loosen if false-reject rate > 20%).
//
// ============================================================================
// v0.1 algorithm (Stage 2c Commit 4)
// ============================================================================
//
// DEVIATION FROM FRD §6.8: the spec calls for "tokenize draft into noun
// phrases, named entities, numeric claims, tool/skill mentions" — which
// assumes an NLP entity extractor we don't have and don't want to add for
// v0.1. We implement a simpler three-rule heuristic that preserves the
// conservative-validator intent. Per FRD §6.8 closing paragraph: "Initial
// implementation uses simple substring + entity overlap heuristics; can be
// tightened with a small classifier model if false-reject rate is too high
// (see §11 grounding validator telemetry)." — this is that initial
// implementation.
//
// For each content-bearing token in the draft (after stopword filtering):
//
//   Rule 1 (Numeric strict) — any token containing a digit MUST appear
//     verbatim (case-insensitive substring) in the allowed-source text.
//     Catches invented percentages, dollar amounts, counts.
//
//   Rule 2 (Capitalized proper noun strict) — any non-sentence-start
//     capitalized 3+ letter token MUST appear (case-insensitive) in the
//     allowed-source text, UNLESS the lowercased form is in COMPETENCE_WORDS
//     (handles "Managed" / "Led" at non-sentence positions). Catches
//     invented employer names, tool/product names, certifications.
//     Sentence-start bypass: tokens at sentence-start fall through to
//     Rule 3. Known limitation: this opens a stem-match leak for proper
//     nouns at sentence-start (see ungrounded-stem-leak test). Acceptable
//     for v0.1; tighten if §11 telemetry shows false-accepts.
//
//   Rule 3 (Content words lenient) — all other 3+ char content tokens
//     pass if they are:
//       a) in COMPETENCE_WORDS (general workplace verbs everyone can
//          plausibly claim — the FRD's "general competence language"
//          made concrete), OR
//       b) in the allowed-source word set, OR
//       c) share a 5-char stem with any allowed-source word (handles
//          paraphrase: "managed" stems to "manag" matches "manager").
//     Otherwise → ungrounded.
//
// All other tokens (stopwords, words < 3 chars) are skipped without check.
//
// Per-pattern allowed-source composition (unchanged from /draft route):
//   - Pattern A (headline): [resumeText]
//   - Pattern B (bullet):   [original_bullet, user_input]
//   - Pattern C (gap):      [gap_description, user_input]
//
// COMPETENCE_WORDS makes concrete the FRD's "general competence language"
// extension to allowed sources. "Case_specific recommendation framing"
// (FRD §6.8 step 2 for Pattern A) is undefined in spec and not implemented
// in v0.1. Flag if telemetry surfaces false-rejects on headline patterns.
//
// Synchronous + pure — no I/O, no model calls. Validator runs in-process
// as part of the /draft endpoint's retry loop.

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a grounding validation pass. Discriminated on `ok`:
 *   - ok=true: draft passed validation; the validated draft is echoed
 *     back (callers can use this shape consistently regardless of pass/fail)
 *   - ok=false: draft failed validation; ungrounded_entities lists the
 *     specific tokens that couldn't be traced to allowed sources.
 */
export type GroundingValidationResult =
  | { ok: true; draft: string }
  | { ok: false; ungrounded_entities: string[] }

/**
 * Input shape for validateDraftGrounding.
 */
export type ValidateDraftGroundingInput = {
  /** The AI-generated draft to validate. */
  draft: string
  /**
   * Allowed source texts. Validator confirms every fact-bearing token in
   * `draft` traces back to at least one of these sources (or the
   * COMPETENCE_WORDS set).
   *
   * Per FRD §6.8:
   *   - Patterns B and C: [original_bullet (or gap_description), userResponse]
   *   - Pattern A (headline): [full resumeText]
   */
  allowedSources: string[]
}

/**
 * Result of isAcceptableAiResult — combines empty-drafts check + per-draft
 * grounding into a single signal for the /draft route loop.
 *
 *   - ok=true: drafts are non-empty AND all pass grounding; persist them
 *   - ok=false reason="empty_drafts": Claude refused (insufficient_source_evidence
 *     or any defensive parse failure that collapsed drafts to []). Tokens were
 *     spent. Count as failed attempt; retry or 422.
 *   - ok=false reason="ungrounded": at least one draft contained ungrounded
 *     tokens. ungrounded_entities lists the offending tokens across all
 *     drafts that failed. Count as failed attempt; retry or 422.
 */
export type AcceptableAiResult =
  | { ok: true }
  | {
      ok: false
      reason: "empty_drafts" | "ungrounded"
      ungrounded_entities?: string[]
    }

// ============================================================================
// Constants
// ============================================================================

/**
 * Stopwords skipped without check. Standard English function words plus
 * common pronouns/auxiliaries. Conservative — better to skip a stopword
 * than over-flag.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "to", "for", "with", "of", "in", "on",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "i", "we", "you", "they",
  "have", "has", "had", "do", "does", "did", "can", "could", "would", "should",
  "will", "may", "might", "must", "shall", "into", "through", "over", "under",
  "more", "most", "less", "than", "if", "when", "where", "while",
  "not", "no", "yes", "so", "too", "very", "also", "just", "only", "even",
  "my", "your", "his", "her", "our", "their", "them", "him", "us", "me",
])

/**
 * Workplace verbs/concepts everyone can plausibly claim. Makes concrete the
 * FRD's "general competence language" extension to allowed sources. Passes
 * Rule 3 without needing to appear in allowedSources.
 *
 * Curated to cover common reframing vocabulary without admitting domain-
 * specific terms (industry tools, technical skills, proper nouns) that
 * must be source-grounded.
 */
const COMPETENCE_WORDS = new Set([
  // Action verbs
  "managed", "led", "developed", "created", "built", "designed", "implemented",
  "executed", "delivered", "drove", "owned", "launched", "shipped", "collaborated",
  "coordinated", "supported", "improved", "analyzed", "researched", "presented",
  "communicated", "facilitated", "organized", "planned", "established",
  // Achievement
  "achieved", "contributed", "produced",
  // Outcomes/qualities
  "responsible", "successful", "effective", "efficient", "strategic", "cross-functional",
  // Qualifiers
  "professional", "academic", "student", "intern", "strong", "comprehensive",
  "extensive", "proven", "demonstrated",
  // Connectives/structural
  "experience", "skills", "knowledge", "ability", "expertise", "background",
  "role", "team", "project", "work", "tasks", "responsibilities",
  // Common modifiers
  "various", "multiple", "several", "key", "primary", "core", "additional",
])

/** Minimum stem length for Rule 3 stem matching. */
const STEM_LENGTH = 5

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Tokenize text into per-token records with sentence-start flags.
 * Sentences are split on `.`, `!`, `?` followed by whitespace.
 * Tokens are split on whitespace; leading/trailing punctuation stripped
 * (preserves internal hyphens, `$`, `%`).
 */
function tokenizeDraft(
  draft: string,
): Array<{ token: string; isSentenceStart: boolean }> {
  const sentences = draft.split(/[.!?]+\s+/)
  const result: Array<{ token: string; isSentenceStart: boolean }> = []
  for (const sentence of sentences) {
    const tokens = sentence
      .split(/\s+/)
      .map((t) => t.replace(/^[^\w$%]+|[^\w$%]+$/g, ""))
      .filter((t) => t.length > 0)
    for (let i = 0; i < tokens.length; i++) {
      result.push({ token: tokens[i], isSentenceStart: i === 0 })
    }
  }
  return result
}

/**
 * Build the lowercased word set from allowed sources. Used for Rule 3
 * exact-match check and stem matching.
 */
function extractAllowedWords(allowedSources: string[]): Set<string> {
  const words = new Set<string>()
  for (const src of allowedSources) {
    const tokens = src
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/^[^\w$%]+|[^\w$%]+$/g, ""))
      .filter((t) => t.length >= 3)
    for (const t of tokens) words.add(t)
  }
  return words
}

/**
 * Rule 3c — stem matching. Returns true if `word` (5+ chars) shares its
 * first STEM_LENGTH characters with any 5+ char word in allowedWords.
 * Handles paraphrase: "managed" (stem "manag") matches "manager".
 */
function hasStemMatch(word: string, allowedWords: Set<string>): boolean {
  if (word.length < STEM_LENGTH) return false
  const stem = word.slice(0, STEM_LENGTH)
  for (const allowed of allowedWords) {
    if (allowed.length >= STEM_LENGTH && allowed.slice(0, STEM_LENGTH) === stem) {
      return true
    }
  }
  return false
}

// ============================================================================
// Public: validateDraftGrounding
// ============================================================================

/**
 * Validate that a draft contains only facts traceable to the allowed
 * source set per the three-rule algorithm documented in the file header.
 *
 * @param input draft + allowedSources
 * @returns Pass-or-fail result. On pass, draft is echoed for uniform
 *          caller-side handling.
 */
export function validateDraftGrounding(
  input: ValidateDraftGroundingInput,
): GroundingValidationResult {
  const draft = input.draft.trim()
  if (draft === "") {
    return { ok: false, ungrounded_entities: ["(empty draft)"] }
  }

  const allowedText = input.allowedSources.join(" ").toLowerCase()
  const allowedWords = extractAllowedWords(input.allowedSources)
  const tokens = tokenizeDraft(draft)

  const ungrounded: string[] = []

  for (const { token, isSentenceStart } of tokens) {
    const lower = token.toLowerCase()

    // Rule 1: numeric strict — any digit-bearing token must appear verbatim.
    // Applied FIRST so short numeric tokens like "12" or "5%" are caught
    // before the length filter would skip them.
    if (/\d/.test(token)) {
      if (!allowedText.includes(lower)) {
        ungrounded.push(token)
      }
      continue
    }

    // Length and stopword filters apply only to non-numeric tokens
    if (token.length < 3) continue
    if (STOPWORDS.has(lower)) continue

    // Rule 2: capitalized proper noun strict (non-sentence-start),
    // UNLESS the lowercased form is a competence word (e.g., "Managed"
    // mid-sentence is the past-tense verb, not a proper noun).
    if (
      !isSentenceStart &&
      /^[A-Z][a-zA-Z]{2,}/.test(token) &&
      !COMPETENCE_WORDS.has(lower)
    ) {
      if (!allowedText.includes(lower)) {
        ungrounded.push(token)
      }
      continue
    }

    // Rule 3: content word lenient. Tries exact match in competence set,
    // stem match in competence set (handles plural / verb form variants
    // like "projects"/"project", "tasks"/"task"), exact match in allowed
    // sources, then stem match in allowed sources.
    if (COMPETENCE_WORDS.has(lower)) continue
    if (hasStemMatch(lower, COMPETENCE_WORDS)) continue
    if (allowedWords.has(lower)) continue
    if (hasStemMatch(lower, allowedWords)) continue
    ungrounded.push(token)
  }

  if (ungrounded.length > 0) {
    return { ok: false, ungrounded_entities: ungrounded }
  }
  return { ok: true, draft: input.draft }
}

// ============================================================================
// Public: isAcceptableAiResult
// ============================================================================

/**
 * Single-signal validator combining the empty-drafts check with per-draft
 * grounding validation. Used by /draft route's retry loop.
 *
 * Two failure modes are surfaced separately so the route can log them
 * distinctly for §11 telemetry tuning:
 *   - empty_drafts: Claude refused with insufficient_source_evidence (or
 *     any defensive parse failure that collapsed drafts to []). The bug
 *     this helper fixes: previously the route used `drafts.every(...)`
 *     which returns true vacuously for empty arrays, causing empty
 *     drafts to be persisted as `draft: null` instead of triggering retry.
 *   - ungrounded: at least one draft failed grounding validation.
 *     ungrounded_entities aggregates the offending tokens across all
 *     failing drafts.
 */
export function isAcceptableAiResult(
  drafts: string[],
  allowedSources: string[],
): AcceptableAiResult {
  if (drafts.length === 0) {
    return { ok: false, reason: "empty_drafts" }
  }
  const ungroundedAll: string[] = []
  for (const draft of drafts) {
    const v = validateDraftGrounding({ draft, allowedSources })
    if (!v.ok) ungroundedAll.push(...v.ungrounded_entities)
  }
  if (ungroundedAll.length > 0) {
    return {
      ok: false,
      reason: "ungrounded",
      ungrounded_entities: ungroundedAll,
    }
  }
  return { ok: true }
}
