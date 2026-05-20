// tests/positioning-v2/phase2/decision-resolver-check.ts
//
// Unit test for lib/positioning/v2/phase2/decisionResolver.ts. Pure
// function — no DB, no async, no fixtures.
//
// Run:
//   npx tsx tests/positioning-v2/phase2/decision-resolver-check.ts
//
// Exits 1 on any failure.

import {
  resolveFinalText,
  type DecideRequestFields,
} from "@/lib/positioning/v2/phase2/decisionResolver"
import type {
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
} from "@/lib/positioning/v2/phase2/types"

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

// ============================================================================
// Item builders (minimal valid shapes for each variant)
// ============================================================================

function makeHeadline(overrides: Partial<PhaseTwoHeadlineItem> = {}): PhaseTwoHeadlineItem {
  return {
    id: "headline-1",
    type: "headline",
    label: "Reframe headline",
    original: "Old headline",
    synthesize_mode: false,
    draft_options: ["Option A", "Option B", "Option C"],
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

function makeBullet(overrides: Partial<PhaseTwoBulletItem> = {}): PhaseTwoBulletItem {
  return {
    id: "bullet-1",
    type: "bullet",
    label: "Reframe bullet",
    original_bullet: "Old bullet",
    jd_context: "JD context",
    question_asked: "What tools did you use?",
    user_response: "Excel, Tableau",
    draft: "Reframed bullet draft",
    final_text: null,
    accepted: false,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: null,
    ...overrides,
  }
}

function makeGap(overrides: Partial<PhaseTwoGapItem> = {}): PhaseTwoGapItem {
  return {
    id: "gap-1",
    type: "gap",
    label: "Address Excel gap",
    gap_description: "JD asks for Excel",
    jd_context: "JD context",
    question_asked: "What tools did you use?",
    user_response: null,
    draft: null,
    final_text: null,
    accepted: false,
    declined: false,
    gap_shape: "unknown",
    skipped: false,
    manual_entry: false,
    compositional_outcome: null,
    target_bullet_text: null,
    suggested_bullets_for_reword: [],
    decided_at: null,
    ...overrides,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function expectOk(
  name: string,
  result: ReturnType<typeof resolveFinalText>,
  expected: { final_text: string | null; manual_entry: boolean },
): void {
  if (!result.ok) {
    check(name, false, `expected ok=true, got error=${result.error}`)
    return
  }
  check(
    `${name} — final_text`,
    result.final_text === expected.final_text,
    `expected ${JSON.stringify(expected.final_text)}, got ${JSON.stringify(result.final_text)}`,
  )
  check(
    `${name} — manual_entry`,
    result.manual_entry === expected.manual_entry,
    `expected ${expected.manual_entry}, got ${result.manual_entry}`,
  )
}

function expectError(
  name: string,
  result: ReturnType<typeof resolveFinalText>,
  expectedError: string,
): void {
  if (result.ok) {
    check(name, false, `expected error, got ok with final_text=${result.final_text}`)
    return
  }
  check(
    name,
    result.error === expectedError,
    `expected error=${expectedError}, got ${result.error}`,
  )
}

// ============================================================================
// Tests
// ============================================================================

console.log("=== Pattern A — headline accept ===")

// 1. selected_draft_index in-range, no edited_text → use draft_options[index]
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: 1 }
  expectOk("1: headline + selected_draft_index=1 → draft_options[1]", resolveFinalText(item, req, ""), {
    final_text: "Option B",
    manual_entry: false,
  })
}

// 2. selected_draft_index + edited_text → edited_text wins
{
  const item = makeHeadline()
  const req: DecideRequestFields = {
    decision: "accept",
    selected_draft_index: 1,
    edited_text: "User-edited variant",
  }
  expectOk(
    "2: headline + selected_draft_index + edited_text → edited_text wins",
    resolveFinalText(item, req, ""),
    { final_text: "User-edited variant", manual_entry: false },
  )
}

// 3. selected_draft_index out of range (negative) → 400
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: -1 }
  expectError(
    "3: headline + selected_draft_index=-1 → 400 out_of_range",
    resolveFinalText(item, req, ""),
    "selected_draft_index_out_of_range",
  )
}

// 4. selected_draft_index out of range (too large) → 400
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: 99 }
  expectError(
    "4: headline + selected_draft_index=99 → 400 out_of_range",
    resolveFinalText(item, req, ""),
    "selected_draft_index_out_of_range",
  )
}

// 5. selected_draft_index points at empty string → 400 invalid_selected_draft
{
  const item = makeHeadline({ draft_options: ["valid", "", "also valid"] })
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: 1 }
  expectError(
    "5: headline + selected_draft_index points at empty string → 400 invalid_selected_draft",
    resolveFinalText(item, req, ""),
    "invalid_selected_draft",
  )
}

// 6. selected_draft_index null, edited_text set → use edited_text
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept", edited_text: "Typed from scratch" }
  expectOk(
    "6: headline + edited_text only → use edited_text",
    resolveFinalText(item, req, ""),
    { final_text: "Typed from scratch", manual_entry: false },
  )
}

// 7. selected_draft_index null, edited_text null → 400 missing_selection
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept" }
  expectError(
    "7: headline + neither selection nor edit → 400 missing_selection",
    resolveFinalText(item, req, ""),
    "missing_selection",
  )
}

console.log("\n=== Pattern B — bullet accept ===")

// 8. item.draft set, no edited_text → use item.draft
{
  const item = makeBullet({ draft: "Bullet draft" })
  const req: DecideRequestFields = { decision: "accept" }
  expectOk("8: bullet + draft only → use item.draft", resolveFinalText(item, req, ""), {
    final_text: "Bullet draft",
    manual_entry: false,
  })
}

// 9. item.draft set, edited_text set → edited_text wins
{
  const item = makeBullet({ draft: "Bullet draft" })
  const req: DecideRequestFields = { decision: "accept", edited_text: "User edit" }
  expectOk("9: bullet + draft + edited_text → edited_text wins", resolveFinalText(item, req, ""), {
    final_text: "User edit",
    manual_entry: false,
  })
}

// 10. item.draft null, edited_text set → use edited_text (manual-entry path)
{
  const item = makeBullet({ draft: null })
  const req: DecideRequestFields = { decision: "accept", edited_text: "User edit" }
  expectOk(
    "10: bullet + null draft + edited_text → use edited_text",
    resolveFinalText(item, req, ""),
    { final_text: "User edit", manual_entry: false },
  )
}

// 11. item.draft null, no edited_text → 400 missing_draft_or_edit
{
  const item = makeBullet({ draft: null })
  const req: DecideRequestFields = { decision: "accept" }
  expectError(
    "11: bullet + null draft + no edit → 400 missing_draft_or_edit",
    resolveFinalText(item, req, ""),
    "missing_draft_or_edit",
  )
}

console.log("\n=== Pattern C — gap accept (mirrors B) ===")

// 12. selected_draft_index on non-headline → 400 selected_draft_index_only_for_headlines
{
  const item = makeGap({ draft: "Gap draft" })
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: 0 }
  expectError(
    "12: gap + selected_draft_index → 400 selected_draft_index_only_for_headlines",
    resolveFinalText(item, req, ""),
    "selected_draft_index_only_for_headlines",
  )
}

console.log("\n=== manual_entry cross-cutting ===")

// 13. manual_entry=true, no edited_text → 400
{
  const item = makeBullet()
  const req: DecideRequestFields = { decision: "accept", manual_entry: true }
  expectError(
    "13: manual_entry=true + no edited_text → 400 edited_text_required_for_manual_entry",
    resolveFinalText(item, req, ""),
    "edited_text_required_for_manual_entry",
  )
}

// 14. manual_entry=true, edited_text set (headline) → ok with manual_entry=true
{
  const item = makeHeadline()
  const req: DecideRequestFields = {
    decision: "accept",
    edited_text: "Manual headline",
    manual_entry: true,
  }
  expectOk(
    "14: headline + manual_entry=true + edited_text → ok, manual_entry=true",
    resolveFinalText(item, req, ""),
    { final_text: "Manual headline", manual_entry: true },
  )
}

// 15. manual_entry=true, edited_text set (bullet) → ok with manual_entry=true
{
  const item = makeBullet({ draft: null })
  const req: DecideRequestFields = {
    decision: "accept",
    edited_text: "Manual bullet",
    manual_entry: true,
  }
  expectOk(
    "15: bullet + manual_entry=true + edited_text → ok, manual_entry=true",
    resolveFinalText(item, req, ""),
    { final_text: "Manual bullet", manual_entry: true },
  )
}

console.log("\n=== Decline / Skip ===")

// 16. decline → final_text=null, manual_entry=false
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "decline" }
  expectOk(
    "16: decline → null final_text, manual_entry=false",
    resolveFinalText(item, req, ""),
    { final_text: null, manual_entry: false },
  )
}

// 17. skip → final_text=null, manual_entry=false
{
  const item = makeBullet()
  const req: DecideRequestFields = { decision: "skip" }
  expectOk(
    "17: skip → null final_text, manual_entry=false",
    resolveFinalText(item, req, ""),
    { final_text: null, manual_entry: false },
  )
}

// 18. decline with edited_text + manual_entry → ignored, still null
{
  const item = makeHeadline()
  const req: DecideRequestFields = {
    decision: "decline",
    edited_text: "should be ignored",
    manual_entry: true,
  }
  expectOk(
    "18: decline ignores edited_text + manual_entry → null final_text",
    resolveFinalText(item, req, ""),
    { final_text: null, manual_entry: false },
  )
}

// ============================================================================
// C1 — multi-outcome decide for gap items
// ============================================================================

console.log("\n=== C1: gap accept — four compositional outcomes (happy paths) ===")

/**
 * Verbatim-bearing resumeText used by C1 tests. Contains the
 * `EXISTING_BULLET` string so reword-outcome validation succeeds; any
 * non-substring target_bullet_text fails the verbatim invariant.
 */
const C1_RESUME =
  "CATHERINE LEES\nSummit, NJ | example@example.com\n\nEDUCATION\nB.S. Communication\n\nEXPERIENCE\nLead photographer for editorial shoots, managing creative direction and execution to engage audiences\nDesigned magazine spreads for digital and print publication\n"
const EXISTING_BULLET =
  "Lead photographer for editorial shoots, managing creative direction and execution to engage audiences"

/** Sanity-check the fixture before any test relies on it. */
if (!C1_RESUME.includes(EXISTING_BULLET)) {
  throw new Error("C1 fixture corruption: EXISTING_BULLET not in C1_RESUME")
}

/** Extended helper — asserts the C1 fields on the ok branch. */
function expectGapOk(
  name: string,
  result: ReturnType<typeof resolveFinalText>,
  expected: {
    final_text: string | null
    manual_entry: boolean
    compositional_outcome:
      | "reword_existing_bullet"
      | "add_new_bullet"
      | "note_for_cover_letter"
      | "acknowledge_genuine_gap"
      | null
    target_bullet_text: string | null
  },
): void {
  if (!result.ok) {
    check(name, false, `expected ok=true, got error=${result.error}`)
    return
  }
  check(
    `${name} — final_text`,
    result.final_text === expected.final_text,
    `expected ${JSON.stringify(expected.final_text)}, got ${JSON.stringify(result.final_text)}`,
  )
  check(
    `${name} — manual_entry`,
    result.manual_entry === expected.manual_entry,
    `expected ${expected.manual_entry}, got ${result.manual_entry}`,
  )
  check(
    `${name} — compositional_outcome`,
    result.compositional_outcome === expected.compositional_outcome,
    `expected ${JSON.stringify(expected.compositional_outcome)}, got ${JSON.stringify(result.compositional_outcome)}`,
  )
  check(
    `${name} — target_bullet_text`,
    result.target_bullet_text === expected.target_bullet_text,
    `expected ${JSON.stringify(expected.target_bullet_text)}, got ${JSON.stringify(result.target_bullet_text)}`,
  )
}

// 19. Gap accept + reword_existing_bullet + verbatim target → ok, both fields persisted
{
  const item = makeGap({ draft: "Reworded bullet draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "reword_existing_bullet",
    target_bullet_text: EXISTING_BULLET,
  }
  expectGapOk(
    "19: gap + reword + verbatim target → ok with both fields",
    resolveFinalText(item, req, C1_RESUME),
    {
      final_text: "Reworded bullet draft",
      manual_entry: false,
      compositional_outcome: "reword_existing_bullet",
      target_bullet_text: EXISTING_BULLET,
    },
  )
}

// 20. Gap accept + add_new_bullet → ok, target_bullet_text null even if absent
{
  const item = makeGap({ draft: "New bullet draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "add_new_bullet",
  }
  expectGapOk(
    "20: gap + add_new_bullet → ok, target_bullet_text=null",
    resolveFinalText(item, req, C1_RESUME),
    {
      final_text: "New bullet draft",
      manual_entry: false,
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
    },
  )
}

// 21. Gap accept + note_for_cover_letter → ok, target null
{
  const item = makeGap({ draft: "Cover letter note draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "note_for_cover_letter",
  }
  expectGapOk(
    "21: gap + note_for_cover_letter → ok, target_bullet_text=null",
    resolveFinalText(item, req, C1_RESUME),
    {
      final_text: "Cover letter note draft",
      manual_entry: false,
      compositional_outcome: "note_for_cover_letter",
      target_bullet_text: null,
    },
  )
}

// 22. Gap accept + acknowledge_genuine_gap → ok, target null
{
  const item = makeGap({ draft: "Gap acknowledged draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "acknowledge_genuine_gap",
  }
  expectGapOk(
    "22: gap + acknowledge_genuine_gap → ok, target_bullet_text=null",
    resolveFinalText(item, req, C1_RESUME),
    {
      final_text: "Gap acknowledged draft",
      manual_entry: false,
      compositional_outcome: "acknowledge_genuine_gap",
      target_bullet_text: null,
    },
  )
}

console.log("\n=== C1: gap accept — validation failures ===")

// 23. Gap accept WITHOUT compositional_outcome → 400 compositional_outcome_required
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = { decision: "accept" }
  expectError(
    "23: gap accept missing compositional_outcome → compositional_outcome_required",
    resolveFinalText(item, req, C1_RESUME),
    "compositional_outcome_required",
  )
}

// 24. Gap accept + reword WITHOUT target_bullet_text → 400 target_bullet_text_required
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "reword_existing_bullet",
  }
  expectError(
    "24: gap reword missing target_bullet_text → target_bullet_text_required",
    resolveFinalText(item, req, C1_RESUME),
    "target_bullet_text_required",
  )
}

// 25. Gap accept + reword + NON-verbatim target → 400 target_bullet_not_verbatim
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "reword_existing_bullet",
    target_bullet_text: "This bullet does not appear anywhere in the resume",
  }
  expectError(
    "25: gap reword non-verbatim target → target_bullet_not_verbatim",
    resolveFinalText(item, req, C1_RESUME),
    "target_bullet_not_verbatim",
  )
}

// 26. Gap accept + reword + target with extra trailing space → 400 (verbatim is strict)
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "reword_existing_bullet",
    target_bullet_text: EXISTING_BULLET + " ", // trailing space breaks substring match
  }
  expectError(
    "26: gap reword target with trailing space → target_bullet_not_verbatim (strict)",
    resolveFinalText(item, req, C1_RESUME),
    "target_bullet_not_verbatim",
  )
}

// 27. Gap accept + reword + target verbatim BUT empty resumeText → 400
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "reword_existing_bullet",
    target_bullet_text: EXISTING_BULLET,
  }
  expectError(
    "27: empty resumeText → target_bullet_not_verbatim (no resume → no valid bullet)",
    resolveFinalText(item, req, ""),
    "target_bullet_not_verbatim",
  )
}

console.log("\n=== C1: target_bullet_text ignored when outcome is not reword ===")

// 28. Gap accept + add_new_bullet + target_bullet_text present → warning logged, target persisted as null
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "add_new_bullet",
    target_bullet_text: EXISTING_BULLET, // present but should be ignored
  }
  expectGapOk(
    "28: gap + add_new_bullet + stray target_bullet_text → target_bullet_text persisted as null",
    resolveFinalText(item, req, C1_RESUME),
    {
      final_text: "Some draft",
      manual_entry: false,
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
    },
  )
}

console.log("\n=== C1: gap decline/skip — C1 fields ignored ===")

// 29. Gap decline with C1 fields present → final_text=null, both C1 fields null
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = {
    decision: "decline",
    compositional_outcome: "reword_existing_bullet",
    target_bullet_text: EXISTING_BULLET,
  }
  expectGapOk(
    "29: gap decline ignores compositional_outcome + target_bullet_text",
    resolveFinalText(item, req, C1_RESUME),
    {
      final_text: null,
      manual_entry: false,
      compositional_outcome: null,
      target_bullet_text: null,
    },
  )
}

// 30. Gap skip with C1 fields present → same
{
  const item = makeGap({ draft: "Some draft" })
  const req: DecideRequestFields = {
    decision: "skip",
    compositional_outcome: "add_new_bullet",
  }
  expectGapOk(
    "30: gap skip ignores compositional_outcome",
    resolveFinalText(item, req, C1_RESUME),
    {
      final_text: null,
      manual_entry: false,
      compositional_outcome: null,
      target_bullet_text: null,
    },
  )
}

console.log("\n=== C1: non-gap items — C1 fields ignored permissively ===")

// 31. Headline accept with C1 fields → ignored, no 400; result still ok
{
  const item = makeHeadline()
  const req: DecideRequestFields = {
    decision: "accept",
    selected_draft_index: 0,
    compositional_outcome: "reword_existing_bullet",
    target_bullet_text: EXISTING_BULLET,
  }
  const result = resolveFinalText(item, req, C1_RESUME)
  check(
    "31: headline accept with C1 fields → still ok (fields permissively ignored)",
    result.ok && result.final_text === "Option A",
    result.ok ? `final_text=${result.final_text}` : `error=${result.error}`,
  )
  if (result.ok) {
    check(
      "31: headline accept → compositional_outcome persisted as null",
      result.compositional_outcome === null,
    )
    check(
      "31: headline accept → target_bullet_text persisted as null",
      result.target_bullet_text === null,
    )
  }
}

// 32. Bullet accept with C1 fields → ignored
{
  const item = makeBullet({ draft: "Bullet draft" })
  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "reword_existing_bullet",
    target_bullet_text: EXISTING_BULLET,
  }
  const result = resolveFinalText(item, req, C1_RESUME)
  check(
    "32: bullet accept with C1 fields → still ok",
    result.ok && result.final_text === "Bullet draft",
  )
  if (result.ok) {
    check(
      "32: bullet accept → compositional_outcome=null in result",
      result.compositional_outcome === null,
    )
    check(
      "32: bullet accept → target_bullet_text=null in result",
      result.target_bullet_text === null,
    )
  }
}

console.log("\n=== C1: backward compat — legacy gap item retroactive population ===")

// 33. Synthetic legacy-shaped gap item (no compositional_outcome on the
//     PRE-state item; resolver writes new value retroactively into the
//     ok-branch result, which the route then persists to state.items[i]).
{
  // Cast through `as unknown as PhaseTwoGapItem` because the strict A2
  // type requires compositional_outcome (set to null on legacy via the
  // populator default — but a hand-seeded row might literally lack the
  // field). This mimics the seeded 9d5ebb75 demo fixture's gap-test-1
  // shape (which predates A2).
  const legacyGap = {
    id: "gap-legacy",
    type: "gap",
    label: "Legacy gap",
    gap_description: "Gap from before A2",
    jd_context: "JD context",
    question_asked: "Q?",
    user_response: null,
    draft: "Draft from before A2",
    final_text: null,
    accepted: false,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: null,
    // NO compositional_outcome / target_bullet_text / suggested_bullets
  } as unknown as PhaseTwoGapItem

  const req: DecideRequestFields = {
    decision: "accept",
    compositional_outcome: "add_new_bullet",
  }
  expectGapOk(
    "33: legacy gap item gets retroactive compositional_outcome on accept",
    resolveFinalText(legacyGap, req, C1_RESUME),
    {
      final_text: "Draft from before A2",
      manual_entry: false,
      compositional_outcome: "add_new_bullet",
      target_bullet_text: null,
    },
  )
}

// ============================================================================
console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")
