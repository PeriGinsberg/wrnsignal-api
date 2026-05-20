// lib/positioning/v2/phase2/clientHelpers.ts
//
// Client-side helpers for the Phase 2 prototype UI. Introduced in v1
// build D2 for the bullet picker sub-step. Pure functions only — no
// React, no async, no I/O. Safe to import from server code too if a
// future commit needs the same parsing (today only the item-detail
// page consumes them).
//
// What lives here:
//   - extractAllResumeBullets(resumeText): walks a resume and returns
//     every "selectable bullet" line annotated with its containing
//     section. Used by BulletPickerView's "Show all bullets" expansion.
//
// What does NOT live here (deliberate scope):
//   - Anchor/overlap scoring (anchorBullet.ts owns that)
//   - Reframe-flavored why detection (extractBulletCandidates.ts)
//   - Composer's locate-and-replace (resumeComposer.ts)
//
// Cross-reference to composer constants:
//   The bullet-glyph set + line-detection regex here MUST stay in
//   lockstep with resumeComposer.ts's BULLET_GLYPHS + BULLET_LINE_RX.
//   If a real persona surfaces a new bullet variant (◦, ‣, etc.),
//   extend BOTH files. The composer is the source of truth at write
//   time (it produces the resume_text that the user later picks
//   bullets from); D2 mirrors it at read time.

/**
 * One verbatim resume line that the user can pick as a reword target.
 * `text` is the verbatim line (preserves leading whitespace, glyph,
 * trailing whitespace — resumeComposer's locate-and-replace depends on
 * this character-for-character match). `section` is the title-cased
 * name of the section the bullet lives under (empty string if no
 * section header was seen above this line, e.g. for content above
 * the first section).
 */
export type ResumeBulletWithSection = {
  /** Verbatim line from the resume — passed to /decide as target_bullet_text. */
  text: string
  /** Title-cased section name, or "" if no section header seen above. */
  section: string
}

/**
 * Returns true if a line looks like a SECTION HEADER (e.g.
 * "EDUCATION", "CORE COMPETENCIES", "LEADERSHIP & INVOLVEMENT").
 *
 * Rules (matches the heuristic resumeComposer.ts uses for section-stop
 * detection in findPipeDelimitedSectionLine):
 *   - 2+ characters when trimmed
 *   - no pipes (those are pipe-delimited list lines)
 *   - no colons (those are key-prefix list lines like "Tools : ...")
 *   - contains at least one letter
 *   - every alphabetic character is uppercase
 *
 * Liberal — accepts "&" and digits as long as alphabetic chars are
 * all uppercase. Conservative — rejects mixed case so "Selected
 * Coursework" (sub-section header on some resumes) is NOT classified
 * as a top-level section header here.
 */
function looksLikeSectionHeader(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 2) return false
  if (trimmed.includes("|")) return false
  if (trimmed.includes(":")) return false
  if (!/[A-Z]/.test(trimmed)) return false
  for (const ch of trimmed) {
    if (/[a-z]/.test(ch)) return false
  }
  return true
}

/**
 * Title-case an uppercase section name. "CREATIVE EXPERIENCE" → "Creative
 * Experience"; "LEADERSHIP & INVOLVEMENT" → "Leadership & Involvement".
 * Stop-words ("and", "or", "of", etc.) stay lowercase unless they're
 * the first word.
 */
function titleCaseSection(uppercaseSection: string): string {
  const stopWords = new Set([
    "and",
    "or",
    "the",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "a",
    "an",
  ])
  const words = uppercaseSection.toLowerCase().split(/(\s+|&)/)
  return words
    .map((word, idx) => {
      if (word === "&" || /^\s+$/.test(word)) return word
      if (idx > 0 && stopWords.has(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join("")
}

/**
 * Heuristic for "is this line a meaningful narrative bullet the user
 * could pick to reword?" Returns true when:
 *   - non-blank when trimmed
 *   - not a section header (caught by looksLikeSectionHeader upstream)
 *   - not a pipe-delimited list line (skills / tools / coursework — those
 *     are addressed by their own compositional outcomes, not by reword)
 *   - not a contact-info line (email or phone visible)
 *   - long enough to be a real bullet (>= 20 chars)
 *
 * The 20-char floor filters out dates ("Sep 2024 – Present"), short
 * labels ("GPA: 3.63"), and credential names that are too short to
 * meaningfully reword. Tuned conservatively — a borderline 19-char
 * narrative line will be filtered, but the picker still has the AI-
 * suggested top 3 (which can include shorter lines because A3's LLM
 * judgment is the gate, not this heuristic).
 */
function isSelectableBulletLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return false
  if (looksLikeSectionHeader(line)) return false
  if ((trimmed.match(/\|/g) ?? []).length >= 2) return false
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(trimmed)) return false
  if (/(?:\+?\d[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(trimmed)) return false
  if (trimmed.length < 20) return false
  return true
}

/**
 * Walk `resumeText` and emit every selectable bullet line annotated
 * with the section it lives under. Used by the D2 bullet picker's
 * "Show all bullets" expansion.
 *
 * Verbatim invariant: every returned `text` value is a character-for-
 * character substring of `resumeText` (no trim, no normalize). The
 * caller passes this exact string to /decide as `target_bullet_text`;
 * the backend's resumeComposer locate-and-replace depends on the
 * verbatim match. Display UIs can `.trim()` for cleaner rendering,
 * but the `text` field stays untouched.
 *
 * Empty input or no qualifying lines → []. The caller's empty-state
 * UI handles the no-bullets case ("This resume has no bullets to
 * update — pick a different outcome.").
 */
export function extractAllResumeBullets(
  resumeText: string | null | undefined,
): ResumeBulletWithSection[] {
  if (!resumeText || typeof resumeText !== "string") return []
  const lines = resumeText.split("\n")
  const out: ResumeBulletWithSection[] = []
  let currentSection = ""
  for (const line of lines) {
    if (looksLikeSectionHeader(line)) {
      currentSection = titleCaseSection(line.trim())
      continue
    }
    if (isSelectableBulletLine(line)) {
      out.push({ text: line, section: currentSection })
    }
  }
  return out
}
