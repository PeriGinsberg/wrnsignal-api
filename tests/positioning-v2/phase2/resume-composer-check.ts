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

console.log("\n=== 10. Gap items ignored in B1 (B2 implements) ===")
{
  const items: PhaseTwoItem[] = [
    makeGap({
      id: "gap-1",
      final_text: "This gap content should NOT appear in revised text in B1",
      accepted: true,
      decided_at: "2026-05-19T00:00:00Z",
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
      suggested_bullets_for_reword: [],
    }),
  ]
  const result = composeRevisedResume(CATHERINE_RESUME_TEXT, items)
  check(
    "10: revised text unchanged when only an accepted gap item is present",
    result === CATHERINE_RESUME_TEXT,
  )
  check(
    "10: gap final_text NOT injected into revised text (B2 will handle)",
    !result.includes("This gap content should NOT appear"),
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

// ────────────────────────────────────────────────────────────────────────
console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")
