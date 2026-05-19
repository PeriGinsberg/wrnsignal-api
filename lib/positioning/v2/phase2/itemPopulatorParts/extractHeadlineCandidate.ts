// lib/positioning/v2/phase2/itemPopulatorParts/extractHeadlineCandidate.ts
//
// Derive a HeadlineCandidate from jobfit + resumeText. Three-outcome
// emission rule (Phase 2 v1 build A1):
//
//   1. Resume has a detectable headline block → kind: "replace" with the
//      verbatim captured string as `original`. resumeComposer locate-
//      and-replace uses this as the anchor.
//
//   2. Resume has no detectable headline AND the jobfit carries a
//      RISK_FAMILY_MISMATCH signal in risk_codes → kind: "synthesize".
//      The orchestrator synthesizes an informational "Headline
//      targeting: ${jobTitle}" placeholder and flags the item
//      synthesize_mode=true; resumeComposer inserts final_text at the
//      first blank line after the contact block.
//
//   3. Resume has no detectable headline AND no synthesize-trigger →
//      null. No headline item is emitted at all (no filler).
//
// Stage 2b's synthesized-always behavior is replaced. Real headlines
// are now detected and used as the locate-and-replace anchor; missing
// headlines without a story-mismatch signal are no longer surfaced.
//
// Pure function — no I/O. Defensive style matches caseSpecific.ts:
// param accepts null/undefined; every nested-object access guarded by
// `typeof x === "object"`; every string field guarded by
// `typeof x === "string"` + trim + non-empty check.

import type {
  JobfitResultJson,
  WhyStructuredItem,
} from "@/lib/positioning/v2/types"
import type { HeadlineCandidate } from "./types"

// ============================================================================
// Section-header detection
// ============================================================================

/**
 * Known section keywords that mark a "this section follows" boundary. A line
 * matching any of these (case-INSENSITIVE on the trimmed line) terminates
 * headline capture. The SUMMARY/PROFILE/OBJECTIVE family is handled
 * specially — see isSummaryStyleHeader.
 */
const SECTION_KEYWORDS = new Set([
  "SUMMARY",
  "PROFILE",
  "OBJECTIVE",
  "PROFESSIONAL SUMMARY",
  "EDUCATION",
  "EXPERIENCE",
  "WORK EXPERIENCE",
  "EMPLOYMENT",
  "CREATIVE EXPERIENCE",
  "PROFESSIONAL EXPERIENCE",
  "CORE COMPETENCIES",
  "SKILLS",
  "LEADERSHIP",
  "LEADERSHIP & INVOLVEMENT",
  "INVOLVEMENT",
  "ADDITIONAL EXPERIENCE",
])

/**
 * SUMMARY-style headers: when one of these is the first content line we
 * hit, the headline lives UNDER the header (consumers expect the prose
 * after it). Other section keywords terminate capture without consuming.
 */
const SUMMARY_STYLE_HEADERS = new Set([
  "SUMMARY",
  "PROFILE",
  "OBJECTIVE",
  "PROFESSIONAL SUMMARY",
])

/**
 * Returns true if `line` is a section header. Two paths qualify:
 *   (a) the entire trimmed line is uppercase (no lowercase letters), OR
 *   (b) the trimmed line matches a known section keyword exactly
 *       (case-insensitive).
 *
 * Empty and blank-only lines are NOT section headers (callers check those
 * separately as boundary markers).
 */
function isSectionHeader(line: string): boolean {
  const t = line.trim()
  if (t.length === 0) return false
  // All-uppercase check: at least one letter, and no lowercase letters.
  if (/[A-Z]/.test(t) && !/[a-z]/.test(t)) return true
  // Known-keyword check
  if (SECTION_KEYWORDS.has(t.toUpperCase())) return true
  return false
}

function isSummaryStyleHeader(line: string): boolean {
  return SUMMARY_STYLE_HEADERS.has(line.trim().toUpperCase())
}

// ============================================================================
// Contact-block detection
// ============================================================================

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
// US-style "908.477.5138", "(908) 477-5138", "908-477-5138", or international.
// Loose on purpose — contact lines are heterogeneous.
const PHONE_RX = /(?:\+?\d[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/

/**
 * Returns true if `line` looks like part of the contact block. Three
 * paths qualify:
 *   (a) contains a pipe `|` (the most common contact-line separator), OR
 *   (b) matches an email pattern, OR
 *   (c) matches a phone pattern.
 *
 * Empty lines do NOT qualify; callers skip them separately.
 */
function isContactLine(line: string): boolean {
  const t = line.trim()
  if (t.length === 0) return false
  if (t.includes("|")) return true
  if (EMAIL_RX.test(t)) return true
  if (PHONE_RX.test(t)) return true
  return false
}

// ============================================================================
// Defensive extraction from jobfit
// ============================================================================

function extractJobTitle(jobfit: JobfitResultJson | null | undefined): string | null {
  if (!jobfit || typeof jobfit !== "object") return null
  const js = (jobfit as { job_signals?: unknown }).job_signals
  if (!js || typeof js !== "object") return null
  const title = (js as { jobTitle?: unknown }).jobTitle
  if (typeof title !== "string") return null
  const trimmed = title.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractJobFamily(jobfit: JobfitResultJson | null | undefined): string | null {
  if (!jobfit || typeof jobfit !== "object") return null
  const js = (jobfit as { job_signals?: unknown }).job_signals
  if (!js || typeof js !== "object") return null
  const family = (js as { jobFamily?: unknown }).jobFamily
  if (typeof family !== "string") return null
  const trimmed = family.trim()
  return trimmed.length > 0 ? trimmed : null
}

function extractTopWhyKeywords(jobfit: JobfitResultJson | null | undefined): string[] {
  if (!jobfit || typeof jobfit !== "object") return []
  if (!Array.isArray(jobfit.why_structured)) return []
  const out: string[] = []
  for (const raw of jobfit.why_structured) {
    if (!raw || typeof raw !== "object") continue
    const item = raw as Partial<WhyStructuredItem>
    if (typeof item.keyword !== "string") continue
    const trimmed = item.keyword.trim()
    if (trimmed.length === 0) continue
    out.push(trimmed)
    if (out.length >= 3) break
  }
  return out
}

/**
 * True if jobfit.risk_codes contains a RISK_FAMILY_MISMATCH entry. Handles
 * both shapes admitted by the post-foundation-fix
 * JobfitResultJson.risk_codes type (`Array<string | RiskCodeV5>`):
 *   - V4 entries: bare string === "RISK_FAMILY_MISMATCH"
 *   - V5 entries: object with .code === "RISK_FAMILY_MISMATCH"
 *
 * Defensive on shape — gracefully returns false on null/undefined/wrong-
 * type inputs and on malformed entries within an otherwise-valid array.
 */
function hasFamilyMismatch(jobfit: JobfitResultJson | null | undefined): boolean {
  if (!jobfit || typeof jobfit !== "object") return false
  const rc = (jobfit as { risk_codes?: unknown }).risk_codes
  if (!Array.isArray(rc)) return false
  for (const entry of rc) {
    if (typeof entry === "string") {
      if (entry === "RISK_FAMILY_MISMATCH") return true
    } else if (entry && typeof entry === "object") {
      const obj = entry as { code?: unknown }
      if (typeof obj.code === "string" && obj.code === "RISK_FAMILY_MISMATCH") {
        return true
      }
    }
  }
  return false
}

// ============================================================================
// Headline detection
// ============================================================================

/**
 * Detect the headline block in resumeText per FRD-aligned rules:
 *
 *   1. Split on \n (preserving original lines).
 *   2. Skip line 0 (the name).
 *   3. Skip the contact block: consecutive non-empty lines that match
 *      `isContactLine` (pipes / email / phone).
 *   4. Skip blank lines immediately following the contact block.
 *   5. Inspect the first remaining non-empty line:
 *      - If it IS a section header AND is SUMMARY/PROFILE/OBJECTIVE/
 *        PROFESSIONAL SUMMARY: capture content lines after it, stopping
 *        at the next section header or end-of-text.
 *      - If it IS a section header but NOT SUMMARY-style (e.g.,
 *        EDUCATION, EXPERIENCE): there is no headline. Returns null
 *        (caller decides synthesize vs no-emission).
 *      - If it is NOT a section header: it's the headline block.
 *        Capture all consecutive non-empty lines until a section header
 *        or a blank-line boundary.
 *   6. If captured non-empty content exists, return that content joined
 *      with \n (preserves the verbatim invariant — the joined string is
 *      a substring of the original resumeText).
 *
 * Returns null when no headline can be detected (empty resume, no
 * content after contact block, first content line is a non-SUMMARY
 * section header, etc.).
 */
function detectHeadlineBlock(resumeText: string): string | null {
  if (typeof resumeText !== "string" || resumeText.length === 0) return null

  const lines = resumeText.split("\n")
  if (lines.length === 0) return null

  // Step 2: skip line 0 (name). Indexing starts at 1.
  let i = 1

  // Step 3: skip contact block (consecutive non-empty contact-flavored lines).
  while (i < lines.length && lines[i].trim() !== "" && isContactLine(lines[i])) {
    i++
  }

  // Step 4: skip blank lines after the contact block.
  while (i < lines.length && lines[i].trim() === "") {
    i++
  }

  if (i >= lines.length) return null

  // Step 5: inspect the first remaining non-empty line.
  if (isSectionHeader(lines[i])) {
    if (!isSummaryStyleHeader(lines[i])) {
      // EDUCATION/EXPERIENCE/etc. — no headline lives here.
      return null
    }
    // SUMMARY-style header — capture content after it.
    i++
    // Skip blank lines between the SUMMARY header and its content.
    while (i < lines.length && lines[i].trim() === "") {
      i++
    }
  }

  // Step 6: capture consecutive non-empty content lines until a section
  // header or a blank line boundary.
  const captured: string[] = []
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === "") break          // blank line ends capture
    if (isSectionHeader(line)) break        // section header ends capture
    captured.push(line)
    i++
  }

  if (captured.length === 0) return null
  return captured.join("\n")
}

// ============================================================================
// Main entrypoint
// ============================================================================

/**
 * Build a HeadlineCandidate from jobfit + resumeText. Three-outcome:
 *
 *   - { kind: "replace", original, ... } — resume has a detectable
 *     headline block. `original` is verbatim from resumeText (substring
 *     invariant holds — resumeComposer locate-and-replace dependency).
 *
 *   - { kind: "synthesize", ... } — no headline detected, but jobfit
 *     carries RISK_FAMILY_MISMATCH. Orchestrator generates an
 *     informational `original` and sets synthesize_mode=true.
 *
 *   - null — no headline AND no synthesize-trigger, OR jobTitle missing.
 *     No headline item is emitted.
 *
 * Defensive cases:
 *   - jobfit null/undefined/wrong-type → null
 *   - jobTitle missing/wrong-type/blank-only → null
 *   - resumeText null/undefined: detection short-circuits; if jobTitle
 *     present AND family mismatch present → synthesize, else null.
 *   - resumeText empty string: same as null resumeText for detection.
 *   - jobFamily missing → candidate carries jobFamily=null.
 *   - why_structured missing/malformed → candidate carries
 *     topWhyKeywords=[].
 */
export function extractHeadlineCandidate(
  jobfit: JobfitResultJson | null | undefined,
  resumeText: string | null | undefined,
): HeadlineCandidate | null {
  const jobTitle = extractJobTitle(jobfit)
  if (jobTitle === null) return null

  const jobFamily = extractJobFamily(jobfit)
  const topWhyKeywords = extractTopWhyKeywords(jobfit)

  // Detection only runs when resumeText is a non-empty string. Null /
  // undefined / wrong-type / empty resumes skip detection entirely.
  const resumeForDetection =
    typeof resumeText === "string" && resumeText.length > 0 ? resumeText : ""
  const detected = resumeForDetection ? detectHeadlineBlock(resumeForDetection) : null

  if (detected !== null) {
    return {
      kind: "replace",
      original: detected,
      jobTitle,
      jobFamily,
      topWhyKeywords,
    }
  }

  if (hasFamilyMismatch(jobfit)) {
    return {
      kind: "synthesize",
      jobTitle,
      jobFamily,
      topWhyKeywords,
    }
  }

  return null
}
