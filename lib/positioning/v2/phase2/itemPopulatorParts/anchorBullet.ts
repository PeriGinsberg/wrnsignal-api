// lib/positioning/v2/phase2/itemPopulatorParts/anchorBullet.ts
//
// Token-overlap anchoring of a why_structured.lead string against a resume
// body. Returns the verbatim resume line with the highest content-word
// overlap, or null if overlap is below threshold.
//
// Verbatim invariant (load-bearing): the returned string MUST appear
// character-for-character in the input resume_text. resumeComposer's
// locate-and-replace logic (FRD §6.10) depends on this guarantee. The
// algorithm splits resume_text on "\n" and returns one of the resulting
// substrings as-is — leading bullet chars (•, ●, ○, -, *), internal
// whitespace, and original casing are all preserved. Only the trailing
// "\n" at the line boundary is dropped (because it's the split delimiter).
//
// tokenize and STOPWORDS are exported because extractGapCandidates reuses
// them for its "represented in resume" check — keeping the stopword list
// single-source.

/** Minimum unique-content-word overlap to count as an anchor match. */
const ANCHOR_MIN_OVERLAP = 3

/**
 * Stopword list. Lowercase. Used to filter out grammatical/structural
 * words that would inflate overlap counts without signaling meaningful
 * content match. Hand-curated — common English function words.
 *
 * Exported for parity with tokenize so callers can audit / extend.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // articles
  "a", "an", "the",
  // common auxiliaries / copulas
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing", "done",
  "will", "would", "should", "could", "may", "might", "must", "can", "cannot",
  // conjunctions
  "and", "or", "but", "nor", "so", "yet",
  // prepositions
  "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "as", "into", "onto", "upon", "about", "against", "between", "through",
  "during", "before", "after", "above", "below", "over", "under",
  // pronouns
  "i", "you", "your", "yours", "he", "him", "his", "she", "her", "hers",
  "it", "its", "we", "us", "our", "ours", "they", "them", "their", "theirs",
  "this", "that", "these", "those",
  // negation / quantifiers
  "not", "no", "yes",
  "all", "any", "some", "each", "every",
  "than", "then", "if", "else", "such",
  // common low-content verbs
  "got", "get", "gets",
])

/**
 * Tokenize a string into lowercase content words. Drops stopwords,
 * punctuation, tokens shorter than 2 chars, and pure-numeric tokens.
 * Pure-numeric tokens like "30" inflate overlap without semantic value.
 *
 * Exported so extractGapCandidates can apply identical tokenization for
 * the "represented in resume" overlap check.
 *
 * Defensive: null / undefined / wrong-type input → [].
 *
 * Algorithm:
 *   1. lowercase
 *   2. split on /[^a-z0-9]+/ — drops punctuation, whitespace, bullet chars
 *   3. filter: length ≥ 2, not in STOPWORDS, contains ≥1 letter
 */
export function tokenize(input: string | null | undefined): string[] {
  if (!input || typeof input !== "string") return []
  const lower = input.toLowerCase()
  const raw = lower.split(/[^a-z0-9]+/)
  const out: string[] = []
  for (const t of raw) {
    if (!t) continue
    if (t.length < 2) continue
    if (STOPWORDS.has(t)) continue
    if (!/[a-z]/.test(t)) continue
    out.push(t)
  }
  return out
}

/**
 * Anchor a why_structured.lead against a resume body. Returns the
 * verbatim resume line with the highest unique-content-word overlap
 * (≥ ANCHOR_MIN_OVERLAP), or null if no line meets threshold.
 *
 * Overlap counting is set-intersection: dedup tokens on both sides so a
 * line that repeats a word doesn't game the score.
 *
 * Tie-breaking: returns the FIRST line in reading order that achieves
 * the max overlap. Stable and predictable.
 *
 * Verbatim invariant: the returned string is a slice of resume_text
 * bounded by "\n". Leading bullet chars, internal whitespace, original
 * casing all preserved as-stored. Callers can rely on
 * `resumeText.indexOf(result) !== -1` after this returns.
 *
 * Defensive:
 *   - null/empty/wrong-type lead → null
 *   - null/empty/wrong-type resumeText → null
 *   - lead with zero content tokens (all stopwords) → null
 *   - no line meets threshold → null
 */
export function anchorLeadToResume(
  lead: string | null | undefined,
  resumeText: string | null | undefined,
): string | null {
  if (!lead || typeof lead !== "string") return null
  if (!resumeText || typeof resumeText !== "string") return null

  const leadTokens = new Set(tokenize(lead))
  if (leadTokens.size === 0) return null

  const lines = resumeText.split("\n")
  let bestLine: string | null = null
  let bestOverlap = 0

  for (const line of lines) {
    if (!line) continue
    const lineTokens = new Set(tokenize(line))
    if (lineTokens.size === 0) continue
    let overlap = 0
    for (const t of lineTokens) {
      if (leadTokens.has(t)) overlap++
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      bestLine = line
    }
  }

  if (bestOverlap < ANCHOR_MIN_OVERLAP) return null
  return bestLine
}
