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
 *   5. Then process gap items (B2). Split into two sub-passes:
 *      5a. compositional_outcome === "reword_existing_bullet": locate
 *          item.target_bullet_text verbatim, replace with
 *          item.final_text. Log + skip on null target or missing
 *          anchor.
 *      5b. compositional_outcome === "add_new_bullet": append
 *          item.final_text as a new bullet after the resume's last
 *          bullet-bearing line, preserving the glyph + indentation
 *          convention. Multiple add_new_bullet items in one run
 *          CLUSTER — each append moves the "last bullet" anchor
 *          forward so subsequent appends land immediately below.
 *      "note_for_cover_letter" and "acknowledge_genuine_gap" outcomes
 *      are no-ops at the composer level — D2 surfaces them on the
 *      completion screen.
 *   6. Return the final working text.
 *
 * Sub-pass ordering rationale (3a before 3b):
 *   A freshly added bullet from 3b must never collide with a reword
 *   target from 3a. Doing 3a first means reword targets are matched
 *   against the original bullet set; doing 3b second means new
 *   appends can't be accidentally consumed as reword anchors.
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

  // ── Pass 3c: gap no-op outcomes (cover letter / acknowledge) ─────────
  // Resume text is unchanged for these outcomes. D2 surfaces them on
  // the completion screen. Logged for telemetry visibility — useful
  // for debugging whether the composer is seeing the expected mix of
  // outcomes from /decide.
  for (const item of items) {
    if (item.type !== "gap") continue
    if (!item.accepted) continue
    const outcome = item.compositional_outcome ?? null

    if (outcome === "note_for_cover_letter" || outcome === "acknowledge_genuine_gap") {
      console.log(
        `[resumeComposer] gap outcome=${outcome} is a no-op at composer level (D2 surfaces on completion screen). id=${item.id}`,
      )
      continue
    }

    // Legacy gap items (no compositional_outcome) and any unknown value
    // (shouldn't be possible per C1's literal type, but defensive)
    // land here. Log + skip — don't synthesize a default outcome.
    if (outcome === null) {
      console.warn(
        `[resumeComposer] accepted gap has no compositional_outcome, skipping. id=${item.id} (legacy row predating C1, OR a decide handler bug)`,
      )
      continue
    }
    if (outcome !== "reword_existing_bullet" && outcome !== "add_new_bullet") {
      console.warn(
        `[resumeComposer] accepted gap has unknown compositional_outcome=${outcome}, skipping. id=${item.id}`,
      )
    }
  }

  // Retained for forward-compat: the type-narrowing helpers stay
  // exported-equivalent so a future commit can use them without re-
  // declaring. void-ing them satisfies the "unused" linter.
  void isReadyHeadline
  void isReadyBullet

  return working
}
