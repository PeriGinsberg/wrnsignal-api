// lib/positioning/v2/phase2/resumeComposer.ts
//
// Deterministic recomposition of the revised resume text from the original
// persona resume_text + the user's accepted decisions on phase2_runs.state
// .items. Called by POST /api/positioning/v2/phase2/[id]/decide after
// every accept to recompute revised_resume_text (FRD §6.5.4 + §6.10).
//
// FRD: docs/Features/positioning-phase2-frd.md
//   §6.10 — revised resume composition (the canonical algorithm)
//   §6.5.4 — /decide endpoint that triggers recomposition
//
// Types: ./types.ts (PhaseTwoItem discriminated union)
//
// Determinism contract: same (originalResumeText, items) always produces
// the same output. The composer reads only from its inputs — no I/O, no
// time-of-day dependence, no random ordering. This lets the UI request
// a preview after edit without persisting intermediate state, and lets
// the server treat phase2_runs.state.items as the single source of truth
// (revised_resume_text is always recomputable).
//
// Coverage scope (Phase 2 v1 build B1):
//   - Headline items (Pattern A): replace mode + synthesize mode
//   - Bullet items (Pattern B): replace via locate-and-replace
//   - Gap items (Pattern C): SKIPPED in B1. Gap multi-outcome composition
//     ships in B2. Accepted gap items pass through the composer with
//     zero effect on output.
//
// Source of truth for accepted content: item.final_text.
//   - final_text is null at populator emit and set at /decide accept
//     time (FRD §6.5.4 — the /decide handler resolves selected_draft_index,
//     user_override_text, edited_text, or draft into the single
//     final_text value).
//   - Accepted item with final_text=null is a state-corruption signal
//     (decide handler bug); composer logs and skips rather than throwing.
//
// First-occurrence-only replacement (load-bearing):
//   - String.prototype.replace(needle, replacement) semantics. If the
//     same original_bullet appears twice in the resume (rare but
//     possible — repeated job descriptions across roles), only the
//     first occurrence is replaced.
//   - Consistent with anchorBullet which takes the first matching line
//     when overlap is tied. Same architectural choice top to bottom.

import type {
  PhaseTwoHeadlineItem,
  PhaseTwoBulletItem,
  PhaseTwoItem,
} from "./types"

// ============================================================================
// Type narrowing helpers
// ============================================================================

/**
 * True only for an accepted headline with non-null final_text. Decline,
 * skip, and undecided items short-circuit composer work; null final_text
 * indicates state corruption (decide handler should have written one).
 */
function isReadyHeadline(
  item: PhaseTwoItem,
): item is PhaseTwoHeadlineItem & { final_text: string } {
  return (
    item.type === "headline" &&
    item.accepted === true &&
    typeof item.final_text === "string"
  )
}

/**
 * True only for an accepted bullet with non-null final_text. Same shape
 * as isReadyHeadline.
 */
function isReadyBullet(
  item: PhaseTwoItem,
): item is PhaseTwoBulletItem & { final_text: string } {
  return (
    item.type === "bullet" &&
    item.accepted === true &&
    typeof item.final_text === "string"
  )
}

// ============================================================================
// Synthesize-mode insertion: locate the first blank line after the contact
// block
// ============================================================================

/** Email pattern reused from extractHeadlineCandidate's contact-line detection. */
const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
/** Loose US/international phone pattern. */
const PHONE_RX = /(?:\+?\d[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/

/**
 * Returns true if `line` looks like part of the contact block — same
 * heuristic the populator uses to skip the contact block when detecting
 * a headline. Three signals qualify:
 *   - contains a pipe `|` (the most common contact-line separator)
 *   - matches an email pattern
 *   - matches a phone pattern
 *
 * Empty lines do NOT qualify; callers handle them separately.
 */
function isContactLine(line: string): boolean {
  const t = line.trim()
  if (t.length === 0) return false
  if (t.includes("|")) return true
  if (EMAIL_RX.test(t)) return true
  if (PHONE_RX.test(t)) return true
  return false
}

/**
 * Locate the index of the first blank line after the contact block in a
 * line array. Algorithm:
 *
 *   1. Skip line 0 (the name).
 *   2. Skip consecutive lines that look like contact lines (pipes /
 *      email / phone).
 *   3. The next blank line is the insertion point.
 *   4. If no blank line is found within the first ~10 lines after the
 *      contact block, return -1 → caller falls back to a different
 *      insertion strategy.
 *
 * Returns the line index of the blank line found, or -1 if none.
 */
function findBlankLineAfterContact(lines: string[]): number {
  if (lines.length === 0) return -1
  // Step 1: skip name (line 0).
  let i = 1
  // Step 2: skip contact lines.
  while (i < lines.length && lines[i].trim() !== "" && isContactLine(lines[i])) {
    i++
  }
  // Step 3: the next line we hit — if blank, that's the insertion point.
  // Allow up to 10 lines of scanning to handle weird resume formats with
  // non-blank content immediately after contact (rare, but possible).
  const scanLimit = Math.min(lines.length, i + 10)
  for (let j = i; j < scanLimit; j++) {
    if (lines[j].trim() === "") return j
  }
  return -1
}

/**
 * Insert the synthesized headline text into the working resume text. The
 * algorithm finds the first blank line after the contact block and
 * splices the headline in with blank-line padding above and below so it
 * visually separates from surrounding content.
 *
 * Fallback: if no blank line is found within the scan window, insert
 * immediately after the contact block on its own line, preceded and
 * followed by a blank line.
 */
function insertSynthesizedHeadline(
  workingText: string,
  headlineText: string,
): string {
  const lines = workingText.split("\n")
  const insertIdx = findBlankLineAfterContact(lines)

  if (insertIdx >= 0) {
    // Replace the single blank line with: blank + headline + blank. This
    // preserves the structural blank-line gap the resume already has at
    // that position while inserting the headline content.
    const before = lines.slice(0, insertIdx)
    const after = lines.slice(insertIdx + 1)
    return [...before, "", headlineText, "", ...after].join("\n")
  }

  // Fallback: no blank line in the scan window. Find the end of the
  // contact block and insert there.
  let endOfContact = 1
  while (
    endOfContact < lines.length &&
    lines[endOfContact].trim() !== "" &&
    isContactLine(lines[endOfContact])
  ) {
    endOfContact++
  }
  const before = lines.slice(0, endOfContact)
  const after = lines.slice(endOfContact)
  return [...before, "", headlineText, "", ...after].join("\n")
}

// ============================================================================
// Single-occurrence locate-and-replace
// ============================================================================

/**
 * Locate `needle` in `haystack` and replace the FIRST occurrence with
 * `replacement`. Returns the result and a found-flag. If needle is not
 * a substring, returns the haystack unchanged and found=false.
 *
 * Uses indexOf + slice rather than String.prototype.replace to avoid
 * regex-metacharacter pitfalls (the verbatim invariant means needles
 * are arbitrary substrings, not patterns — they may contain `.`, `*`,
 * `(`, `)`, etc. that would be interpreted as regex).
 */
function replaceFirstOccurrence(
  haystack: string,
  needle: string,
  replacement: string,
): { text: string; found: boolean } {
  const idx = haystack.indexOf(needle)
  if (idx < 0) return { text: haystack, found: false }
  return {
    text: haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length),
    found: true,
  }
}

// ============================================================================
// Gap "add_new_bullet" insertion: detect bullet-bearing lines, anchor + glyph
// ============================================================================

/**
 * Bullet-glyph characters Phase 2 recognizes as "this line is a bullet."
 * Per the design lock: ●, ○, •, -, *. Other Unicode bullet variants
 * (◦ U+25E6, ‣ U+2023, ⁃ U+2043, ∙ U+2219) are NOT recognized — if a real
 * persona surfaces them, extend the list.
 *
 * Note: bare "-" or "*" lines used purely as visual separators (e.g.,
 * "---" or "* * *") would qualify under this rule. None of our known
 * persona resumes use that pattern; if one does in the future, the
 * separator line will be misclassified as a bullet anchor (the resulting
 * insertion would land below the separator — visible but ugly). Pre-
 * emptive complexity to handle that case isn't justified yet.
 */
const BULLET_GLYPHS = new Set(["●", "○", "•", "-", "*"])

/**
 * Match the leading-whitespace + glyph + post-glyph-whitespace of a bullet
 * line. Capture group 1 is the whitespace prefix (often empty for
 * left-aligned bullets); the glyph itself is matched in a character
 * class so we know one of the recognized glyphs led the line. Designed
 * to support both `● Coordinated…` and `   - Built…` shapes.
 *
 * Note: the trailing `\s*` consumes the post-glyph whitespace so the new
 * bullet matches the original's spacing convention.
 */
const BULLET_LINE_RX = /^(\s*)([●○•\-*])(\s*)/

/**
 * Returns the bullet-glyph + indentation prefix of a line if it's a
 * bullet-bearing line, or null otherwise. Used to detect the anchor for
 * add_new_bullet insertion.
 *
 * "Bullet-bearing" means: the first non-whitespace character is one of
 * BULLET_GLYPHS. Empty lines and lines whose first non-whitespace is a
 * letter, digit, or other punctuation do NOT qualify.
 *
 * The returned prefix preserves the indentation + glyph + trailing
 * whitespace exactly so a new bullet built from it matches the original's
 * formatting. Example: input `"  ○ Performed industry…"` → returns
 * `"  ○ "`.
 */
function bulletPrefixOf(line: string): string | null {
  const m = BULLET_LINE_RX.exec(line)
  if (!m) return null
  // m[0] is the full match (indent + glyph + post-whitespace).
  // m[2] is the glyph; verify it's recognized (the regex character class
  // already enforces this but the Set check makes the intent explicit
  // and protects against future regex edits).
  if (!BULLET_GLYPHS.has(m[2])) return null
  return m[0]
}

/**
 * Locate the last bullet-bearing line in a line array by scanning from
 * the end backwards. Returns the line index of the last bullet, or -1
 * if no line in the array is bullet-bearing (pure-prose resume case;
 * caller falls back to append-at-end).
 *
 * Reverse scan matches the spec's "first line whose first non-whitespace
 * character is a bullet glyph" rule interpreted from the end — we want
 * the FINAL bullet position so a freshly added bullet lands after all
 * existing ones.
 */
function findLastBulletLineIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (bulletPrefixOf(lines[i]) !== null) return i
  }
  return -1
}

/**
 * Append a new bullet to `workingText` for the add_new_bullet gap
 * outcome. Algorithm:
 *
 *   1. Split workingText into lines.
 *   2. Reverse-scan for the last bullet-bearing line.
 *   3. If found: clone that line's prefix (indent + glyph + post-glyph
 *      whitespace) and insert a new line with `<prefix><finalText>`
 *      immediately after the anchor.
 *   4. If not found (pure-prose resume): append the finalText at the
 *      end of workingText with a blank line separator. No glyph
 *      inserted — the assumption is that a resume without bullets won't
 *      suddenly start using them.
 *
 * Returns the modified text. Pure function. No side effects.
 */
function appendNewBullet(workingText: string, finalText: string): string {
  const lines = workingText.split("\n")
  const lastBulletIdx = findLastBulletLineIndex(lines)

  if (lastBulletIdx >= 0) {
    const prefix = bulletPrefixOf(lines[lastBulletIdx]) ?? ""
    const newLine = `${prefix}${finalText}`
    const before = lines.slice(0, lastBulletIdx + 1)
    const after = lines.slice(lastBulletIdx + 1)
    return [...before, newLine, ...after].join("\n")
  }

  // Fallback: no bullets anywhere. Append at end with blank-line
  // separator and no glyph. Preserve the resume's existing trailing
  // newline (Catherine v3 ends with "\n"; the slice doesn't) by
  // checking and adjusting separator structure.
  if (workingText.endsWith("\n")) {
    return `${workingText}\n${finalText}\n`
  }
  return `${workingText}\n\n${finalText}`
}

// ============================================================================
// Pipe-delimited / key-prefixed list detection (B3)
// ============================================================================
//
// B3 adds composition into four non-bullet sections (skills, tools,
// languages, coursework). The detectors below target two resume
// structural patterns observed across the persona fixtures we've seen:
//
//   Pattern A — section header on its own line, followed by a blank line
//               (sometimes), then a pipe-delimited content line:
//
//     CORE COMPETENCIES
//
//     Brand Messaging | Creative Strategy | Visual Communication | …
//
//   Pattern B — key-prefixed inline line (single line carrying both the
//               keyword and the pipe-delimited content):
//
//     Certificates & Tools : Muck Rack Certification | Adobe Creative … | Microsoft Office
//     Relevant Coursework: Strategic Message Design | Writing for Strategic Communication | …
//
// Pattern B's colon spacing varies across resumes ("Tools :" with a space
// before the colon vs "Coursework:" without). The detector accepts both.
//
// Both patterns require at least PIPE_LIST_MIN_PIPES pipes on the content
// line — a "section" with one item isn't disambiguatable from prose and
// we don't try to compose into it. Non-pipe formats (bulleted skills,
// comma-separated, paragraph-prose) are silently skipped — v0.2 will
// handle them when we have more persona fixtures to validate against.

/** A line needs at least this many ` | ` pipes to count as a pipe-list. */
const PIPE_LIST_MIN_PIPES = 2

/** Section header keywords for Pattern A — skills / competencies section. */
const SKILLS_SECTION_HEADERS: readonly string[] = [
  "CORE COMPETENCIES",
  "COMPETENCIES",
  "SKILLS",
  "KEY SKILLS",
  "TECHNICAL SKILLS",
  "PROFESSIONAL SKILLS",
]

/** Section header keywords for Pattern A — tools / technologies section. */
const TOOLS_SECTION_HEADERS: readonly string[] = [
  "TOOLS",
  "TECHNOLOGIES",
  "SOFTWARE",
  "TECHNICAL TOOLS",
  "TOOLS & TECHNOLOGIES",
]

/** Section header keywords for Pattern A — languages section. */
const LANGUAGES_SECTION_HEADERS: readonly string[] = [
  "LANGUAGES",
  "LANGUAGE PROFICIENCIES",
  "LANGUAGE SKILLS",
]

/** Inline key-prefix keywords for Pattern B — tools variants. Catherine's
 *  "Certificates & Tools : ..." is the canonical case. */
const TOOLS_KEY_PREFIXES: readonly string[] = [
  "Tools",
  "Technologies",
  "Software",
  "Tech Stack",
  "Technical Tools",
  "Tools & Technologies",
  "Certificates & Tools",
  "Tools & Certifications",
]

/** Inline key-prefix keywords for Pattern B — languages variants. */
const LANGUAGES_KEY_PREFIXES: readonly string[] = [
  "Languages",
  "Language Proficiencies",
  "Language Skills",
  "Spoken Languages",
]

/** Inline key-prefix keywords for Pattern B — coursework variants. */
const COURSEWORK_KEY_PREFIXES: readonly string[] = [
  "Relevant Coursework",
  "Coursework",
  "Relevant Courses",
  "Selected Coursework",
]

/**
 * Count of pipe characters in a line. Used to gate whether a candidate
 * line qualifies as a pipe-delimited list (PIPE_LIST_MIN_PIPES floor).
 */
function pipeCount(line: string): number {
  return (line.match(/\|/g) ?? []).length
}

/**
 * Pattern A locator: header-line + content-line. Algorithm:
 *
 *   1. Walk lines top-to-bottom.
 *   2. When a line's trimmed value (case-insensitively) equals any
 *      headerKeyword, scan the next 5 lines for one with >=
 *      PIPE_LIST_MIN_PIPES pipes.
 *   3. Return { lineIndex, line } for the content line; otherwise
 *      keep walking — another section may match later in the resume.
 *   4. If no header-then-content sequence qualifies, returns null.
 *
 * Headers are case-insensitive; content lines preserve their exact
 * casing in the return.
 */
function findPipeDelimitedSectionLine(
  workingText: string,
  headerKeywords: readonly string[],
): { lineIndex: number; line: string } | null {
  const lines = workingText.split("\n")
  const lowerKeywords = headerKeywords.map((k) => k.toLowerCase())
  for (let i = 0; i < lines.length; i++) {
    const headerLine = lines[i].trim()
    if (headerLine.length === 0) continue
    if (!lowerKeywords.includes(headerLine.toLowerCase())) continue
    // Header matched. Scan up to 5 lines after for pipe content.
    const scanLimit = Math.min(lines.length, i + 6)
    for (let j = i + 1; j < scanLimit; j++) {
      if (pipeCount(lines[j]) >= PIPE_LIST_MIN_PIPES) {
        return { lineIndex: j, line: lines[j] }
      }
    }
    // Header found but no qualifying content within 5 lines — keep
    // walking. Another header variant (e.g. resume has both "SKILLS"
    // and "CORE COMPETENCIES" lines, only one pipe-formatted) may match
    // later.
  }
  return null
}

/**
 * Pattern B locator: single-line key-prefix list. Algorithm:
 *
 *   1. Walk lines top-to-bottom.
 *   2. For each keyPrefix, check whether the line (after stripping
 *      leading whitespace) starts with the prefix case-insensitively
 *      followed by optional whitespace + colon + optional whitespace
 *      and then content with >= PIPE_LIST_MIN_PIPES pipes.
 *   3. Return the matched line. Single-line — NO 5-line scan window.
 *
 * Colon spacing is intentionally permissive: matches both `Coursework:`
 * (no space before colon) and `Tools :` (space before colon —
 * Catherine's actual format). Spaces after the colon are also flexible.
 *
 * Case-insensitive on the keyword. The returned `line` is verbatim
 * (caller's later append preserves the original casing + spacing).
 */
function findKeyPrefixedListLine(
  workingText: string,
  keyPrefixes: readonly string[],
): { lineIndex: number; line: string } | null {
  const lines = workingText.split("\n")
  const lowerPrefixes = keyPrefixes.map((p) => p.toLowerCase())
  for (let i = 0; i < lines.length; i++) {
    const lineRaw = lines[i]
    const lineLower = lineRaw.toLowerCase()
    // Strip leading whitespace before prefix comparison so an indented
    // `  Tools : …` still matches. Track the strip offset only for the
    // prefix check; the returned line is verbatim.
    const trimmedStart = lineLower.replace(/^\s+/, "")
    for (const keyLower of lowerPrefixes) {
      if (!trimmedStart.startsWith(keyLower)) continue
      const afterKey = trimmedStart.slice(keyLower.length)
      // Optional whitespace + colon + optional whitespace
      const colonMatch = /^\s*:\s*/.exec(afterKey)
      if (!colonMatch) continue
      const content = afterKey.slice(colonMatch[0].length)
      if (pipeCount(content) < PIPE_LIST_MIN_PIPES) continue
      return { lineIndex: i, line: lineRaw }
    }
  }
  return null
}

/**
 * Thin wrapper over findKeyPrefixedListLine specialized for coursework.
 * Kept as its own helper so future "where does coursework live" tuning
 * is one-callsite without touching the general-purpose detector.
 */
function findCourseworkLine(
  workingText: string,
): { lineIndex: number; line: string } | null {
  return findKeyPrefixedListLine(workingText, COURSEWORK_KEY_PREFIXES)
}

/**
 * Append an item to a pipe-delimited list line with the canonical
 * " | " separator. Trims trailing whitespace from the original line
 * before appending so an irregular trailing tab/space doesn't show up
 * as " <ws> | newItem".
 *
 * Used for both Pattern A content lines and Pattern B key-prefix lines —
 * structurally identical from the appender's perspective (both are
 * pipe-delimited list lines).
 */
function appendToPipeList(line: string, newItem: string): string {
  return `${line.trimEnd()} | ${newItem}`
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Recompose the revised resume from the original resume text and the
 * user's accepted decisions.
 *
 * FRD §6.10 algorithm (B2 scope: headlines + bullets + gaps):
 *   1. Start with originalResumeText as the base.
 *   2. Filter items to accepted=true with non-null final_text.
 *   3. Process headlines first:
 *      - synthesize_mode=false: locate item.original verbatim, replace
 *        with item.final_text (first occurrence only).
 *      - synthesize_mode=true: insert item.final_text at the first
 *        blank line after the contact block, with blank-line padding.
 *      - Either case: log + skip if anchor is missing.
 *   4. Then process bullets:
 *      - locate item.original_bullet verbatim, replace with
 *        item.final_text (first occurrence only).
 *      - Log + skip if anchor is missing.
 *   5. Then process gap items. Split into FOUR sub-passes (3a-3d) for
 *      determinism + cross-section safety:
 *
 *      5a. compositional_outcome === "reword_existing_bullet" (B2):
 *          locate item.target_bullet_text verbatim, replace with
 *          item.final_text. Log + skip on null target or missing
 *          anchor.
 *
 *      5b. compositional_outcome === "add_new_bullet" (B2): append
 *          item.final_text as a new bullet after the resume's last
 *          bullet-bearing line, preserving the glyph + indentation
 *          convention. Multiple add_new_bullet items in one run
 *          CLUSTER — each append moves the "last bullet" anchor
 *          forward so subsequent appends land immediately below.
 *
 *      5c. compositional_outcome ∈ { add_to_skills_list,
 *          add_tool_or_software, add_language, add_to_coursework }
 *          (B3): detect the target list line (Pattern A header+content
 *          OR Pattern B inline key-prefix) and append the new item
 *          with " | " separator. Section-not-found is a silent skip
 *          with a log — frontend D1 prevents the user from picking an
 *          outcome whose section the composer can't detect.
 *
 *      5d. compositional_outcome ∈ { note_for_cover_letter,
 *          acknowledge_genuine_gap } (B2): no-op at the composer level.
 *          D2 surfaces these on the completion screen. Logged for
 *          telemetry visibility. Legacy gap rows with no
 *          compositional_outcome (predate C1) also land here and skip.
 *
 *      "add_certification" is intentionally not in 5c — it ships in
 *      B4 with section-creation logic for resumes that lack a
 *      certifications header today.
 *
 *   6. Return the final working text.
 *
 * Sub-pass ordering rationale:
 *   - 3a before 3b: a freshly added bullet from 3b must never collide
 *     with a reword target from 3a. Doing 3a first means reword
 *     targets are matched against the original bullet set; doing 3b
 *     second means new appends can't be accidentally consumed as
 *     reword anchors.
 *   - 3c after 3a/3b: additions to skills/tools/languages/coursework
 *     are in unrelated sections from bullets, so ordering is
 *     architecturally academic — but pinning a deterministic order
 *     keeps composer output byte-stable across runs.
 *   - 3d last: no-op outcomes are pure telemetry and don't depend on
 *     any working-text state.
 *
 * Edge cases (per FRD §6.10 contract):
 *   - Empty items array → returns originalResumeText unchanged.
 *   - All items declined/skipped → returns originalResumeText unchanged.
 *   - Accepted item with final_text=null → log "accepted X has null
 *     final_text" + skip. State corruption signal (decide handler bug).
 *   - Item original/original_bullet not found in resume → log "X not
 *     found in resume_text" + skip. Resume drift / decoupling between
 *     populator emit and current resume_text.
 *   - Empty resumeText → all replace attempts fail, only synthesize
 *     paths produce output (insertion into a near-empty string).
 *
 * @param originalResumeText The base resume text (typically persona.resume_text)
 * @param items All items from phase2_runs.state.items, decided or not
 * @returns The recomposed revised resume text. Always returns a string;
 *          returns originalResumeText unchanged when no items have been
 *          accepted (or when every accepted item's anchor fails).
 */
export function composeRevisedResume(
  originalResumeText: string,
  items: PhaseTwoItem[],
): string {
  let working = originalResumeText

  // ── Pass 1: headlines ────────────────────────────────────────────────
  for (const item of items) {
    if (item.type !== "headline") continue
    if (!item.accepted) continue

    if (item.final_text === null) {
      console.warn(
        `[resumeComposer] accepted headline has null final_text, skipping. id=${item.id}`,
      )
      continue
    }

    if (!item.synthesize_mode) {
      // Replace path — locate the original headline block verbatim.
      const { text, found } = replaceFirstOccurrence(
        working,
        item.original,
        item.final_text,
      )
      if (!found) {
        console.warn(
          `[resumeComposer] headline original not found in resume_text, skipping. id=${item.id}`,
        )
        continue
      }
      working = text
    } else {
      // Synthesize path — insert at the first blank line after contact.
      working = insertSynthesizedHeadline(working, item.final_text)
    }
  }

  // ── Pass 2: bullets ──────────────────────────────────────────────────
  for (const item of items) {
    if (item.type !== "bullet") continue
    if (!item.accepted) continue

    if (item.final_text === null) {
      console.warn(
        `[resumeComposer] accepted bullet has null final_text, skipping. id=${item.id}`,
      )
      continue
    }

    const { text, found } = replaceFirstOccurrence(
      working,
      item.original_bullet,
      item.final_text,
    )
    if (!found) {
      console.warn(
        `[resumeComposer] bullet original_bullet not found in resume_text, skipping. id=${item.id}`,
      )
      continue
    }
    working = text
  }

  // ── Pass 3: gap items — split into two sub-passes ────────────────────
  // 3a (reword) runs BEFORE 3b (append) so a newly-appended bullet
  // from 3b can never accidentally serve as a reword anchor for 3a.
  // See JSDoc above for the full rationale.

  // ── Pass 3a: gap reword_existing_bullet ──────────────────────────────
  for (const item of items) {
    if (item.type !== "gap") continue
    if (!item.accepted) continue

    // Defensive: legacy gap rows (seeded before A2) lack the
    // compositional_outcome field; readGapItem(...) ?? null default is
    // the load-bearing contract documented on PhaseTwoGapItem JSDoc.
    const outcome = item.compositional_outcome ?? null
    if (outcome !== "reword_existing_bullet") continue

    if (item.final_text === null) {
      console.warn(
        `[resumeComposer] accepted gap (reword) has null final_text, skipping. id=${item.id}`,
      )
      continue
    }
    const targetBulletText = item.target_bullet_text ?? null
    if (targetBulletText === null) {
      console.warn(
        `[resumeComposer] accepted gap with reword outcome has null target_bullet_text, skipping. id=${item.id} (state-corruption signal: /decide should have set this)`,
      )
      continue
    }

    const { text, found } = replaceFirstOccurrence(
      working,
      targetBulletText,
      item.final_text,
    )
    if (!found) {
      console.warn(
        `[resumeComposer] gap reword target_bullet_text not found in resume_text, skipping. id=${item.id} (resume drift OR a prior accepted item already overwrote this line)`,
      )
      continue
    }
    working = text
  }

  // ── Pass 3b: gap add_new_bullet ──────────────────────────────────────
  for (const item of items) {
    if (item.type !== "gap") continue
    if (!item.accepted) continue
    const outcome = item.compositional_outcome ?? null
    if (outcome !== "add_new_bullet") continue

    if (item.final_text === null) {
      console.warn(
        `[resumeComposer] accepted gap (add_new_bullet) has null final_text, skipping. id=${item.id}`,
      )
      continue
    }

    // Each append moves the "last bullet" anchor forward — multiple
    // sequential add_new_bullet items cluster after the original last
    // bullet, in items[] order. appendNewBullet re-scans the current
    // working text each call so the clustering is implicit.
    working = appendNewBullet(working, item.final_text)
  }

  // ── Pass 3c: gap additions to skills/tools/languages/coursework ──────
  // For each accepted gap item with one of the four "add to non-bullet
  // section" outcomes, detect the target list line and append the new
  // item with " | " separator. Section-not-found is a silent skip —
  // frontend D1 prevents the user from selecting an outcome whose
  // target section the composer can't detect, so reaching this skip
  // path in production usually indicates a stale-resume race (resume
  // edited mid-flow) or a manual API call bypassing the UI.
  //
  // Detection strategy per outcome:
  //   add_to_skills_list   → Pattern A (SKILLS_SECTION_HEADERS)
  //   add_tool_or_software → Pattern A (TOOLS_SECTION_HEADERS) →
  //                          Pattern B (TOOLS_KEY_PREFIXES) →
  //                          Pattern A (SKILLS_SECTION_HEADERS fallback)
  //   add_language         → Pattern A (LANGUAGES_SECTION_HEADERS) →
  //                          Pattern B (LANGUAGES_KEY_PREFIXES)
  //   add_to_coursework    → Pattern B (COURSEWORK_KEY_PREFIXES)
  //
  // add_certification is intentionally NOT handled here — B4 ships it
  // with section-creation logic for resumes lacking a certifications
  // header.
  for (const item of items) {
    if (item.type !== "gap") continue
    if (!item.accepted) continue
    const outcome = item.compositional_outcome ?? null
    if (
      outcome !== "add_to_skills_list" &&
      outcome !== "add_tool_or_software" &&
      outcome !== "add_language" &&
      outcome !== "add_to_coursework"
    ) {
      continue
    }

    if (item.final_text === null) {
      console.warn(
        `[resumeComposer] accepted gap (outcome=${outcome}) has null final_text, skipping. id=${item.id}`,
      )
      continue
    }

    let target: { lineIndex: number; line: string } | null = null
    let detector = ""

    if (outcome === "add_to_skills_list") {
      target = findPipeDelimitedSectionLine(working, SKILLS_SECTION_HEADERS)
      detector = "skills_section_header"
    } else if (outcome === "add_tool_or_software") {
      // 3-tier fallback. Telemetry log below records which tier matched
      // so B4's certifications-overlap behavior is debuggable (Catherine's
      // "Certificates & Tools :" line will be picked up by the Pattern B
      // tier here AND by B4's certifications detector).
      target = findPipeDelimitedSectionLine(working, TOOLS_SECTION_HEADERS)
      detector = "tools_section_header"
      if (target === null) {
        target = findKeyPrefixedListLine(working, TOOLS_KEY_PREFIXES)
        detector = "tools_key_prefix"
      }
      if (target === null) {
        target = findPipeDelimitedSectionLine(working, SKILLS_SECTION_HEADERS)
        detector = "skills_section_header_fallback"
      }
    } else if (outcome === "add_language") {
      target = findPipeDelimitedSectionLine(working, LANGUAGES_SECTION_HEADERS)
      detector = "languages_section_header"
      if (target === null) {
        target = findKeyPrefixedListLine(working, LANGUAGES_KEY_PREFIXES)
        detector = "languages_key_prefix"
      }
    } else if (outcome === "add_to_coursework") {
      target = findCourseworkLine(working)
      detector = "coursework_key_prefix"
    }

    if (target === null) {
      console.warn(
        `[resumeComposer] outcome=${outcome} target section not detected, skipping. id=${item.id}`,
      )
      continue
    }

    console.log(
      `[resumeComposer] outcome=${outcome} matched detector=${detector} at line ${target.lineIndex}, appending. id=${item.id}`,
    )

    const lines = working.split("\n")
    lines[target.lineIndex] = appendToPipeList(target.line, item.final_text)
    working = lines.join("\n")
  }

  // ── Pass 3d: gap no-op + telemetry pass ──────────────────────────────
  // Logs the disposition of every accepted gap item the prior passes
  // didn't actively modify. Categories:
  //   - note_for_cover_letter / acknowledge_genuine_gap → composer no-op
  //     by design; D2 surfaces these on the completion screen.
  //   - add_certification → B3 doesn't handle (B4 ships it with
  //     section-creation logic). Log as deferred rather than unknown.
  //   - null compositional_outcome → legacy row predating C1 OR a
  //     decide handler bug. Log + skip.
  //   - Outcomes 3a-3c already handled in their own passes; this loop
  //     short-circuits silently for those.
  //   - Genuinely unknown string → log warning (defensive — TS type
  //     should prevent this at compile time, but JSON-payload drift
  //     from older clients is the realistic source).
  const HANDLED_BY_OTHER_PASSES: ReadonlySet<string> = new Set([
    "reword_existing_bullet", // 3a
    "add_new_bullet", // 3b
    "add_to_skills_list", // 3c
    "add_tool_or_software", // 3c
    "add_language", // 3c
    "add_to_coursework", // 3c
  ])
  for (const item of items) {
    if (item.type !== "gap") continue
    if (!item.accepted) continue
    const outcome = item.compositional_outcome ?? null

    if (outcome === null) {
      console.warn(
        `[resumeComposer] accepted gap has no compositional_outcome, skipping. id=${item.id} (legacy row predating C1, OR a decide handler bug)`,
      )
      continue
    }
    if (outcome === "note_for_cover_letter" || outcome === "acknowledge_genuine_gap") {
      console.log(
        `[resumeComposer] gap outcome=${outcome} is a no-op at composer level (D2 surfaces on completion screen). id=${item.id}`,
      )
      continue
    }
    if (outcome === "add_certification") {
      console.log(
        `[resumeComposer] gap outcome=add_certification is not yet handled at composer level (B4 ships it with section-creation logic). id=${item.id}`,
      )
      continue
    }
    if (HANDLED_BY_OTHER_PASSES.has(outcome)) {
      // Handled by 3a/3b/3c. Those passes log their own success / skip
      // details; this loop doesn't re-log.
      continue
    }
    console.warn(
      `[resumeComposer] accepted gap has unknown compositional_outcome=${outcome}, skipping. id=${item.id}`,
    )
  }

  // Retained for forward-compat: the type-narrowing helpers stay
  // exported-equivalent so a future commit can use them without re-
  // declaring. void-ing them satisfies the "unused" linter.
  void isReadyHeadline
  void isReadyBullet

  return working
}
