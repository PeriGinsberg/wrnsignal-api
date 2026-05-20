// tests/positioning-v2/phase2/resume-composer-check.ts
//
// Unit tests for lib/positioning/v2/phase2/resumeComposer.ts (Phase 2 v1
// build B1). Pure function — no DB, no LLM, no fixtures beyond strings
// and PhaseTwoItem shapes built inline.
//
// Coverage (16 named tests):
//   1.  Headline replace happy path (Catherine v3 fixture)
//   2.  Headline synthesize happy path (synthetic resume w/o headline)
//   3.  Headline original not found → log + skip
//   4.  Headline null final_text on accepted → log + skip
//   5.  Bullet replace happy path
//   6.  Bullet original_bullet not found → log + skip
//   7.  Bullet null final_text on accepted → log + skip
//   8.  Multiple bullets — sequential replacement, both apply
//   9.  Headline + bullet combined
//   10. Gap items ignored in B1 (B2 implements)
//   11. Declined / skipped / undecided items ignored
//   12. Determinism — same inputs twice → identical output
//   13. First-occurrence-only replacement
//   14. Synthesize insertion lands at first blank line after contact
//   15. Defensive: empty resume + accepted items → returns "" or near-""
//   16. Defensive: empty items array → originalResumeText unchanged
//
// Run: npx tsx tests/positioning-v2/phase2/resume-composer-check.ts

import { composeRevisedResume } from "@/lib/positioning/v2/phase2/resumeComposer"
import type {
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
  PhaseTwoItem,
} from "@/lib/positioning/v2/phase2/types"
import {
  CATHERINE_RESUME_HEADLINE_BLOCK,
  CATHERINE_RESUME_NO_HEADLINE,
  CATHERINE_RESUME_SLICE,
  CATHERINE_RESUME_TEXT,
} from "./fixtures"

const failures: string[] = []

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    const line = name + (detail ? ` — ${detail}` : "")
    failures.push(line)
    console.log(`  ✗ ${line}`)
  }
}

// ────────────────────────────────────────────────────────────────────────
// Item fixture builders
// ────────────────────────────────────────────────────────────────────────

function makeHeadline(
  overrides: Partial<PhaseTwoHeadlineItem> = {},
): PhaseTwoHeadlineItem {
  return {
    id: "headline-1",
    type: "headline",
    label: "Reframe headline",
    original: "PLACEHOLDER ORIGINAL",
    synthesize_mode: false,
    draft_options: [],
    selected_draft_index: null,
    user_override_text: null,
    final_text: null,
    accepted: false,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: null,
    ...overrides,
  }
}

function makeBullet(
  overrides: Partial<PhaseTwoBulletItem> = {},
): PhaseTwoBulletItem {
  return {
    id: "bullet-1",
    type: "bullet",
    label: "Reframe bullet",
    original_bullet: "PLACEHOLDER BULLET",
    jd_context: "JD context",
    question_asked: "Question?",
    user_response: null,
    draft: null,
    final_text: null,
    accepted: false,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: null,
    ...overrides,
  }
}

function makeGap(
  overrides: Partial<PhaseTwoGapItem> = {},
): PhaseTwoGapItem {
  return {
    id: "gap-1",
    type: "gap",
    label: "Address gap",
    gap_description: "Gap description",
    jd_context: "JD context",
    question_asked: "Question?",
    user_response: null,
    draft: null,
    final_text: null,
    accepted: false,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: null,
    gap_shape: "unknown",
    compositional_outcome: null,
    target_bullet_text: null,
    suggested_bullets_for_reword: [],
    ...overrides,
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

console.log("=== 1. Headline replace happy path (Catherine v3) ===")
{
  const newHeadline = "Strategic communicator with proven brand impact."
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: CATHERINE_RESUME_HEADLINE_BLOCK,
      synthesize_mode: false,
      final_text: newHeadline,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "1: revised contains the new headline string",
    result.includes(newHeadline),
  )
  check(
    "1: revised does NOT contain Catherine's original headline block",
    !result.includes(CATHERINE_RESUME_HEADLINE_BLOCK),
  )
  check(
    "1: revised differs from original (compose actually mutated)",
    result !== CATHERINE_RESUME_TEXT,
  )
  check(
    "1: revised length = original length - old.length + new.length",
    result.length ===
      CATHERINE_RESUME_TEXT.length -
        CATHERINE_RESUME_HEADLINE_BLOCK.length +
        newHeadline.length,
    `got ${result.length}`,
  )
}

console.log("\n=== 2. Headline synthesize happy path (resume w/o headline) ===")
{
  const synthHeadline = "Driven analyst with proven results in financial modeling."
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: "Headline targeting: Test Role", // populator's synthesized placeholder
      synthesize_mode: true,
      final_text: synthHeadline,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_NO_HEADLINE, items)
  check(
    "2: revised contains the synthesized headline string",
    result.includes(synthHeadline),
  )
  check(
    "2: revised does NOT contain the populator placeholder string (placeholder is informational, not for composition)",
    !result.includes("Headline targeting: Test Role"),
  )
  check(
    "2: revised differs from original",
    result !== CATHERINE_RESUME_NO_HEADLINE,
  )
  // Confirm the headline appears AFTER the contact block (i.e., not at
  // position 0).
  const idx = result.indexOf(synthHeadline)
  const contactIdx = result.indexOf("CATHERINE LEES")
  const educationIdx = result.indexOf("EDUCATION")
  check(
    "2: synthesized headline appears AFTER the contact block",
    idx > contactIdx + "CATHERINE LEES".length,
    `idx=${idx} contactEnd=${contactIdx + "CATHERINE LEES".length}`,
  )
  check(
    "2: synthesized headline appears BEFORE the EDUCATION section",
    idx < educationIdx,
    `headlineIdx=${idx} educationIdx=${educationIdx}`,
  )
}

console.log("\n=== 3. Headline original not found → log + skip ===")
{
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: "This headline text is not present in the resume at all.",
      synthesize_mode: false,
      final_text: "Reframed headline",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "3: revised text unchanged when headline original is missing",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "3: reframed text NOT injected anywhere",
    !result.includes("Reframed headline"),
  )
}

console.log("\n=== 4. Headline null final_text on accepted → log + skip ===")
{
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: CATHERINE_RESUME_HEADLINE_BLOCK,
      synthesize_mode: false,
      final_text: null, // state corruption signal
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "4: revised text unchanged when accepted headline has null final_text",
    result === CATHERINE_RESUME_TEXT,
  )
}

console.log("\n=== 5. Bullet replace happy path ===")
{
  const realBullet =
    "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities"
  const newBullet =
    "Drove brand strategy through industry, audience, and SWOT analytics that informed positioning decisions"
  // Confirm fixture invariant.
  if (!CATHERINE_RESUME_TEXT.includes(realBullet)) {
    throw new Error("Test 5 fixture corruption: realBullet not in CATHERINE_RESUME_TEXT")
  }
  const items: PhaseTwoItem[] = [
    makeBullet({
      original_bullet: realBullet,
      final_text: newBullet,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check("5: revised contains the new bullet", result.includes(newBullet))
  check(
    "5: revised does NOT contain the original bullet",
    !result.includes(realBullet),
  )
  check("5: revised differs from original", result !== CATHERINE_RESUME_TEXT)
}

console.log("\n=== 6. Bullet original_bullet not found → log + skip ===")
{
  const items: PhaseTwoItem[] = [
    makeBullet({
      original_bullet: "This bullet is not in the resume",
      final_text: "Reframed bullet",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "6: revised text unchanged when bullet anchor is missing",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "6: reframed bullet NOT injected anywhere",
    !result.includes("Reframed bullet"),
  )
}

console.log("\n=== 7. Bullet null final_text on accepted → log + skip ===")
{
  const realBullet =
    "Designed magazine spreads for digital and print publication"
  if (!CATHERINE_RESUME_TEXT.includes(realBullet)) {
    throw new Error("Test 7 fixture corruption: realBullet not in resume")
  }
  const items: PhaseTwoItem[] = [
    makeBullet({
      original_bullet: realBullet,
      final_text: null,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "7: revised text unchanged when accepted bullet has null final_text",
    result === CATHERINE_RESUME_TEXT,
  )
}

console.log("\n=== 8. Multiple bullets — sequential replacement ===")
{
  const bulletA =
    "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities"
  const bulletB =
    "Designed magazine spreads for digital and print publication"
  const newA = "Drove strategic analysis across industry, audience, and SWOT dimensions"
  const newB = "Produced print and digital editorial spreads under tight deadlines"
  if (!CATHERINE_RESUME_TEXT.includes(bulletA) || !CATHERINE_RESUME_TEXT.includes(bulletB)) {
    throw new Error("Test 8 fixture corruption")
  }
  const items: PhaseTwoItem[] = [
    makeBullet({
      id: "bullet-1",
      original_bullet: bulletA,
      final_text: newA,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeBullet({
      id: "bullet-2",
      original_bullet: bulletB,
      final_text: newB,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check("8: revised contains both new bullets", result.includes(newA) && result.includes(newB))
  check(
    "8: revised contains neither original bullet",
    !result.includes(bulletA) && !result.includes(bulletB),
  )
}

console.log("\n=== 9. Headline + bullet combined ===")
{
  const realBullet =
    "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities"
  const newHeadline = "Strategic communicator with proven brand impact."
  const newBullet = "Drove SWOT analysis to inform brand positioning."
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: CATHERINE_RESUME_HEADLINE_BLOCK,
      synthesize_mode: false,
      final_text: newHeadline,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeBullet({
      original_bullet: realBullet,
      final_text: newBullet,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check("9: revised contains the new headline", result.includes(newHeadline))
  check("9: revised contains the new bullet", result.includes(newBullet))
  check(
    "9: revised contains NEITHER original",
    !result.includes(CATHERINE_RESUME_HEADLINE_BLOCK) && !result.includes(realBullet),
  )
}

console.log("\n=== 10. Gap with no-op outcome leaves resume unchanged (B2 surface) ===")
{
  // Originally a B1 "all gaps ignored" pin. After B2, gaps with the
  // two no-op outcomes (note_for_cover_letter, acknowledge_genuine_gap)
  // still don't modify the resume — D2 will surface them on the
  // completion screen. Using note_for_cover_letter here exercises that
  // path. The resume-modifying outcomes (reword_existing_bullet,
  // add_new_bullet) are covered in B2's new Tests 17-28 below.
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      final_text: "Notable point worth mentioning in the cover letter",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "note_for_cover_letter",
      target_bullet_text: null,
      suggested_bullets_for_reword: [],
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "10: revised text unchanged when gap outcome is note_for_cover_letter",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "10: gap final_text NOT injected into revised text (no-op outcome)",
    !result.includes("Notable point worth mentioning in the cover letter"),
  )
}

console.log("\n=== 11. Declined / skipped / undecided items ignored ===")
{
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: CATHERINE_RESUME_HEADLINE_BLOCK,
      synthesize_mode: false,
      final_text: "Should not apply — declined",
      accepted: false,
      declined: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeHeadline({
      id: "headline-2",
      original: CATHERINE_RESUME_HEADLINE_BLOCK,
      synthesize_mode: false,
      final_text: "Should not apply — skipped",
      accepted: false,
      skipped: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeHeadline({
      id: "headline-3",
      original: CATHERINE_RESUME_HEADLINE_BLOCK,
      synthesize_mode: false,
      final_text: "Should not apply — undecided",
      accepted: false,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "11: revised text unchanged when no items accepted",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "11: no declined/skipped/undecided final_text leaked into revised text",
    !result.includes("Should not apply"),
  )
}

console.log("\n=== 12. Determinism — same inputs twice → identical output ===")
{
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: CATHERINE_RESUME_HEADLINE_BLOCK,
      synthesize_mode: false,
      final_text: "Deterministic headline",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeBullet({
      original_bullet:
        "Designed magazine spreads for digital and print publication",
      final_text: "Deterministic bullet",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const r1 = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  const r2 = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "12: identical inputs produce byte-identical output across two runs",
    r1 === r2,
    `r1.length=${r1.length} r2.length=${r2.length}`,
  )
}

console.log("\n=== 13. First-occurrence-only replacement ===")
{
  // Synthetic resume with the same bullet text duplicated. First
  // occurrence should be replaced; second should remain.
  const dup = "Delivered consistent results under tight deadlines"
  const synthResume = `JOHN DOE
john@example.com | 555-0100

EXPERIENCE
First Job
${dup}
Mid-section content

Second Job
${dup}
Trailing content`
  const items: PhaseTwoItem[] = [
    makeBullet({
      original_bullet: dup,
      final_text: "REPLACED",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(synthResume, items)
  check(
    "13: result contains exactly one 'REPLACED' occurrence",
    (result.match(/REPLACED/g) || []).length === 1,
    `count=${(result.match(/REPLACED/g) || []).length}`,
  )
  check(
    "13: result still contains exactly one occurrence of the unreplaced dup",
    (result.match(new RegExp(dup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length === 1,
  )
  // The replacement should be the FIRST occurrence — confirm position.
  const replacedIdx = result.indexOf("REPLACED")
  const remainingDupIdx = result.indexOf(dup)
  check(
    "13: replacement landed at the FIRST occurrence (earlier in text than remaining duplicate)",
    replacedIdx < remainingDupIdx,
    `REPLACED at ${replacedIdx}, dup remaining at ${remainingDupIdx}`,
  )
}

console.log("\n=== 14. Synthesize insertion position (synthetic contact patterns) ===")
{
  // Synthetic resume with pipe-delimited contact line + blank + section.
  const synth = `ALICE SMITH
Boston, MA | alice@example.com | 617-555-0100

EDUCATION
University of Somewhere`
  const synthHeadline = "Driven analyst with proven results."
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: "(informational placeholder)",
      synthesize_mode: true,
      final_text: synthHeadline,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume(synth, items)
  check("14: revised contains the synthesized headline", result.includes(synthHeadline))
  // Confirm headline appears AFTER the contact line.
  const contactIdx = result.indexOf("alice@example.com")
  const headlineIdx = result.indexOf(synthHeadline)
  const educationIdx = result.indexOf("EDUCATION")
  check(
    "14: headline lands between contact and EDUCATION section",
    contactIdx < headlineIdx && headlineIdx < educationIdx,
    `contact=${contactIdx} headline=${headlineIdx} education=${educationIdx}`,
  )
  // Confirm structural blank-line padding around the headline.
  const lines = result.split("\n")
  const headlineLineIdx = lines.findIndex((l) => l === synthHeadline)
  check(
    "14: line immediately before headline is blank",
    headlineLineIdx > 0 && lines[headlineLineIdx - 1] === "",
    `prev line: ${JSON.stringify(lines[headlineLineIdx - 1])}`,
  )
  check(
    "14: line immediately after headline is blank",
    headlineLineIdx >= 0 &&
      headlineLineIdx < lines.length - 1 &&
      lines[headlineLineIdx + 1] === "",
    `next line: ${JSON.stringify(lines[headlineLineIdx + 1])}`,
  )
}

console.log("\n=== 15. Defensive: empty resume + accepted items ===")
{
  const items: PhaseTwoItem[] = [
    makeHeadline({
      original: "anything",
      synthesize_mode: false,
      final_text: "new headline",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeBullet({
      original_bullet: "anything",
      final_text: "new bullet",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
  ]
  const result = composeRevisedResume("", items)
  check(
    "15: empty resume + replace-mode items → returns '' (anchors fail, logged + skipped)",
    result === "",
  )
}

console.log("\n=== 16. Defensive: empty items array ===")
{
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, [])
  check(
    "16: empty items → returns originalResumeText unchanged",
    result === CATHERINE_RESUME_TEXT,
  )
}

// ============================================================================
// B2 — gap multi-outcome composition
// ============================================================================

console.log("\n=== 17. Gap reword_existing_bullet happy path (Catherine v3) ===")
{
  const target =
    "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities"
  if (!CATHERINE_RESUME_TEXT.includes(target)) {
    throw new Error("Test 17 fixture corruption: target not in CATHERINE_RESUME_TEXT")
  }
  const reword =
    "Drove data-driven brand analysis through industry, audience, and SWOT research that informed positioning decisions"
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: target,
      final_text: reword,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check("17: revised contains the reword final_text", result.includes(reword))
  check(
    "17: revised does NOT contain the target bullet",
    !result.includes(target),
  )
  check("17: revised differs from original", result !== CATHERINE_RESUME_TEXT)
}

console.log("\n=== 18. Gap add_new_bullet happy path (SLICE with ● glyphs) ===")
{
  // CATHERINE_RESUME_SLICE has explicit ● top-level + ○ nested bullet
  // glyphs. v3 has no glyphs (Test 26 covers that defensive case).
  // Reverse scan finds the last `● ` line — "Coordinated sponsorship,
  // networking, and professional development events" — as the anchor.
  const newBullet = "Led cross-functional collaboration between marketing and operations teams"
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      final_text: newBullet,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_SLICE, items)
  check(
    "18: revised contains the new bullet text",
    result.includes(newBullet),
  )
  check(
    "18: new bullet carries the ● glyph + matching whitespace",
    result.includes(`● ${newBullet}`),
    `looking for "● ${newBullet.slice(0, 40)}…"`,
  )
  // The new bullet should appear AFTER the resume's prior last bullet line.
  const lastOriginalBullet =
    "● Coordinated sponsorship, networking, and professional development events"
  const lastOriginalIdx = result.indexOf(lastOriginalBullet)
  const newBulletIdx = result.indexOf(`● ${newBullet}`)
  check(
    "18: new bullet appears AFTER the original last bullet (anchor preserved)",
    lastOriginalIdx >= 0 && newBulletIdx > lastOriginalIdx,
    `lastOriginal=${lastOriginalIdx} newBullet=${newBulletIdx}`,
  )
  check("18: revised differs from original", result !== CATHERINE_RESUME_SLICE)
}

console.log("\n=== 19. Gap note_for_cover_letter is a no-op ===")
{
  const noteText = "Worth mentioning in the cover letter: deep brand work."
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "note_for_cover_letter",
      target_bullet_text: null,
      final_text: noteText,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "19: revised text unchanged when outcome is note_for_cover_letter",
    result === CATHERINE_RESUME_TEXT,
  )
  check("19: note text NOT injected into resume", !result.includes(noteText))
}

console.log("\n=== 20. Gap acknowledge_genuine_gap is a no-op ===")
{
  const ackText = "I genuinely don't have this experience — TBD how to surface."
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "acknowledge_genuine_gap",
      target_bullet_text: null,
      final_text: ackText,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "20: revised text unchanged when outcome is acknowledge_genuine_gap",
    result === CATHERINE_RESUME_TEXT,
  )
  check("20: ack text NOT injected into resume", !result.includes(ackText))
}

console.log("\n=== 21. Legacy gap (no compositional_outcome field) → log + skip ===")
{
  // Simulate a legacy row written before A2/C1 by casting through unknown.
  // The PhaseTwoGapItem TS type now requires compositional_outcome, but
  // hand-seeded rows like phase2_run 9d5ebb75 predate the field and read
  // as `undefined` at runtime — composer must default `?? null` and skip.
  const legacyGap = {
    id: "gap-legacy-1",
    type: "gap",
    label: "Legacy gap",
    gap_description: "Gap from before A2",
    jd_context: "JD",
    question_asked: "Q",
    user_response: null,
    draft: null,
    final_text: "Legacy gap final_text that must NOT appear in revised text",
    accepted: true,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: "2026-05-17T00:00:00Z",
    // NO compositional_outcome / target_bullet_text / suggested_bullets
  } as unknown as PhaseTwoItem
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, [legacyGap])
  check(
    "21: legacy gap row → revised text unchanged",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "21: legacy gap final_text NOT injected",
    !result.includes("Legacy gap final_text"),
  )
}

console.log("\n=== 22. Gap reword with null target_bullet_text → log + skip ===")
{
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: null, // state corruption — outcome=reword without target
      final_text: "Should not apply because target is null",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "22: reword with null target → revised text unchanged",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "22: reword final_text NOT injected",
    !result.includes("Should not apply because target is null"),
  )
}

console.log("\n=== 23. Gap reword target not in resume (verbatim broken) → log + skip ===")
{
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: "This bullet text does not appear anywhere in the v3 resume.",
      final_text: "Reworded version",
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "23: reword with missing target → revised text unchanged",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "23: reword final_text NOT injected",
    !result.includes("Reworded version"),
  )
}

console.log("\n=== 24. Multiple add_new_bullet items cluster after original last bullet ===")
{
  const newA = "First new bullet from multi-append test"
  const newB = "Second new bullet should land right after the first"
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      final_text: newA,
    }),
    makeGap({
      id: "gap-2",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      final_text: newB,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_SLICE, items)
  const idxA = result.indexOf(`● ${newA}`)
  const idxB = result.indexOf(`● ${newB}`)
  const lastOriginalBullet =
    "● Coordinated sponsorship, networking, and professional development events"
  const lastOriginalIdx = result.indexOf(lastOriginalBullet)
  check("24: both new bullets present with glyph", idxA > 0 && idxB > 0)
  check(
    "24: bullet A appears AFTER the original last bullet",
    idxA > lastOriginalIdx,
    `lastOriginal=${lastOriginalIdx} idxA=${idxA}`,
  )
  check(
    "24: bullet B appears AFTER bullet A (clustering — second append anchors on first)",
    idxB > idxA,
    `idxA=${idxA} idxB=${idxB}`,
  )
  // Confirm they're consecutive (no other lines between them).
  const lines = result.split("\n")
  const lineA = lines.findIndex((l) => l === `● ${newA}`)
  const lineB = lines.findIndex((l) => l === `● ${newB}`)
  check(
    "24: bullets A and B are on consecutive lines (no separator between)",
    lineA >= 0 && lineB === lineA + 1,
    `lineA=${lineA} lineB=${lineB}`,
  )
}

console.log("\n=== 25. Reword-before-append orchestration (3a → 3b) ===")
{
  // Setup: one gap that REWORDS the slice's last ● bullet, then one gap
  // that APPENDS a new ● bullet. Per the architectural ordering (3a →
  // 3b), the reword must apply to the ORIGINAL last bullet (not the
  // newly-appended one). Test pins this.
  const originalLastBullet =
    "● Coordinated sponsorship, networking, and professional development events"
  const rewordTarget = originalLastBullet
  const rewordText = "● Reworded last bullet from gap-1"
  const newAppend = "Newly appended bullet from gap-2"
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: rewordTarget,
      final_text: rewordText,
    }),
    makeGap({
      id: "gap-2",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      final_text: newAppend,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_SLICE, items)
  check(
    "25: reword fired — original last bullet text is GONE",
    !result.includes(originalLastBullet),
  )
  check(
    "25: reword fired — rewordText present",
    result.includes(rewordText),
  )
  check(
    "25: append fired — newAppend present",
    result.includes(`● ${newAppend}`),
  )
  // The newly appended bullet must land AFTER the rewordText (3b anchored
  // on the post-3a text, which now has rewordText as the last ● line).
  const rewordIdx = result.indexOf(rewordText)
  const appendIdx = result.indexOf(`● ${newAppend}`)
  check(
    "25: new bullet from 3b appears AFTER reworded line from 3a (correct ordering)",
    appendIdx > rewordIdx,
    `reword=${rewordIdx} append=${appendIdx}`,
  )
}

console.log("\n=== 26. add_new_bullet with no bullets in resume (defensive fallback) ===")
{
  // CATHERINE_RESUME_TEXT (v3) has NO bullet glyphs anywhere. The
  // appendNewBullet algorithm falls back to "append at end with blank
  // line separator". No glyph inserted (the resume's convention was no
  // glyphs).
  const newContent = "New bullet content with no glyph since resume has none"
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      final_text: newContent,
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "26: new content appended somewhere",
    result.includes(newContent),
  )
  check("26: revised differs from original", result !== CATHERINE_RESUME_TEXT)
  // Confirm the new content is at the END (defensive fallback path).
  const tail = result.slice(-newContent.length - 5)
  check(
    "26: new content appears at/near the end of revised text",
    tail.includes(newContent),
    `tail: ${JSON.stringify(tail.slice(-80))}`,
  )
  // Confirm the new content does NOT have a glyph prefix (resume had none).
  check(
    "26: new content does NOT have ● glyph prefix (resume convention: no glyphs)",
    !result.includes(`● ${newContent}`),
  )
}

console.log("\n=== 27. Mixed item types in one run (headline + bullet + gap-reword + gap-append) ===")
{
  // SLICE has both ● bullets AND no headline (it skips straight from
  // EDUCATION to body). So the headline test uses synthesize mode.
  // For replace-mode headline test we'd need the v3 resume — but v3
  // doesn't have bullet glyphs. To exercise all four item types we use
  // SLICE + synthesize-mode headline.
  const sliceWithFakeHeadlineOriginal = CATHERINE_RESUME_SLICE
  const headlineReplaceFinal = "Synthesized headline injected via composer"
  const bulletTarget =
    "○ Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities for the boutique retail brand"
  if (!sliceWithFakeHeadlineOriginal.includes(bulletTarget)) {
    throw new Error("Test 27 fixture: bulletTarget not in CATHERINE_RESUME_SLICE")
  }
  const bulletReframed = "○ Drove SWOT and audience analysis to inform brand positioning"
  const gapRewordTarget =
    "● Coordinated sponsorship, networking, and professional development events"
  const gapRewordFinal = "● Owned cross-team sponsorship and event ops for BPAD"
  const gapAppendText = "Built campaign-measurement dashboards for the Diligent team"
  const items: PhaseTwoItem[] = [
    makeHeadline({
      id: "headline-1",
      synthesize_mode: true,
      final_text: headlineReplaceFinal,
      original: "Headline targeting: <placeholder>",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeBullet({
      id: "bullet-1",
      original_bullet: bulletTarget,
      final_text: bulletReframed,
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
    }),
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: gapRewordTarget,
      final_text: gapRewordFinal,
    }),
    makeGap({
      id: "gap-2",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      final_text: gapAppendText,
    }),
  ]
  const result = composeRevisedResume(sliceWithFakeHeadlineOriginal, items)
  check("27: headline synthesize injected", result.includes(headlineReplaceFinal))
  check("27: bullet reframe applied", result.includes(bulletReframed) && !result.includes(bulletTarget))
  check("27: gap reword applied", result.includes(gapRewordFinal) && !result.includes(gapRewordTarget))
  check("27: gap append applied", result.includes(`● ${gapAppendText}`))
  // Ordering pin: headline → bullet → gap-reword → gap-append. Each
  // change should appear in the result; verify the gap-append (last
  // change to apply) lands AFTER the gap-reword in document order.
  const gapRewordIdx = result.indexOf(gapRewordFinal)
  const gapAppendIdx = result.indexOf(`● ${gapAppendText}`)
  check(
    "27: gap-append lands after gap-reword in document order",
    gapAppendIdx > gapRewordIdx,
    `reword=${gapRewordIdx} append=${gapAppendIdx}`,
  )
}

console.log("\n=== 28. Determinism for gap items (re-run produces identical output) ===")
{
  const target =
    "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities"
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: target,
      final_text: "Deterministic reword for B2",
    }),
    makeGap({
      id: "gap-2",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      final_text: "Deterministic append for B2",
    }),
  ]
  const r1 = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  const r2 = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "28: identical gap-bearing inputs produce byte-identical output across two runs",
    r1 === r2,
    `r1.length=${r1.length} r2.length=${r2.length}`,
  )
}

// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")
