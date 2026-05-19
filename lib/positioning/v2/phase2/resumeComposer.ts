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
// Main entry point
// ============================================================================

/**
 * Recompose the revised resume from the original resume text and the
 * user's accepted decisions.
 *
 * FRD §6.10 algorithm (B1 scope: headline + bullet only; B2 ships gap):
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
 *   5. Gap items: SKIPPED in B1 (B2 will implement). Accepted gaps pass
 *      through with no effect on output.
 *   6. Return the final working text.
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

  // ── Pass 3: gaps (B2) ────────────────────────────────────────────────
  // Gap items are intentionally NOT processed in B1. The four
  // compositional outcomes (reword_existing_bullet, add_new_bullet,
  // note_for_cover_letter, acknowledge_genuine_gap) each need their
  // own composer path. B2 implements them. For B1, accepted gap items
  // pass through with no effect on output. Tests pin this behavior so
  // a future regression that accidentally writes gap content here
  // would surface.
  void isReadyHeadline
  void isReadyBullet

  return working
}
