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
  expectOk("1: headline + selected_draft_index=1 → draft_options[1]", resolveFinalText(item, req), {
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
    resolveFinalText(item, req),
    { final_text: "User-edited variant", manual_entry: false },
  )
}

// 3. selected_draft_index out of range (negative) → 400
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: -1 }
  expectError(
    "3: headline + selected_draft_index=-1 → 400 out_of_range",
    resolveFinalText(item, req),
    "selected_draft_index_out_of_range",
  )
}

// 4. selected_draft_index out of range (too large) → 400
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: 99 }
  expectError(
    "4: headline + selected_draft_index=99 → 400 out_of_range",
    resolveFinalText(item, req),
    "selected_draft_index_out_of_range",
  )
}

// 5. selected_draft_index points at empty string → 400 invalid_selected_draft
{
  const item = makeHeadline({ draft_options: ["valid", "", "also valid"] })
  const req: DecideRequestFields = { decision: "accept", selected_draft_index: 1 }
  expectError(
    "5: headline + selected_draft_index points at empty string → 400 invalid_selected_draft",
    resolveFinalText(item, req),
    "invalid_selected_draft",
  )
}

// 6. selected_draft_index null, edited_text set → use edited_text
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept", edited_text: "Typed from scratch" }
  expectOk(
    "6: headline + edited_text only → use edited_text",
    resolveFinalText(item, req),
    { final_text: "Typed from scratch", manual_entry: false },
  )
}

// 7. selected_draft_index null, edited_text null → 400 missing_selection
{
  const item = makeHeadline()
  const req: DecideRequestFields = { decision: "accept" }
  expectError(
    "7: headline + neither selection nor edit → 400 missing_selection",
    resolveFinalText(item, req),
    "missing_selection",
  )
}

console.log("\n=== Pattern B — bullet accept ===")

// 8. item.draft set, no edited_text → use item.draft
{
  const item = makeBullet({ draft: "Bullet draft" })
  const req: DecideRequestFields = { decision: "accept" }
  expectOk("8: bullet + draft only → use item.draft", resolveFinalText(item, req), {
    final_text: "Bullet draft",
    manual_entry: false,
  })
}

// 9. item.draft set, edited_text set → edited_text wins
{
  const item = makeBullet({ draft: "Bullet draft" })
  const req: DecideRequestFields = { decision: "accept", edited_text: "User edit" }
  expectOk("9: bullet + draft + edited_text → edited_text wins", resolveFinalText(item, req), {
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
    resolveFinalText(item, req),
    { final_text: "User edit", manual_entry: false },
  )
}

// 11. item.draft null, no edited_text → 400 missing_draft_or_edit
{
  const item = makeBullet({ draft: null })
  const req: DecideRequestFields = { decision: "accept" }
  expectError(
    "11: bullet + null draft + no edit → 400 missing_draft_or_edit",
    resolveFinalText(item, req),
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
    resolveFinalText(item, req),
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
    resolveFinalText(item, req),
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
    resolveFinalText(item, req),
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
    resolveFinalText(item, req),
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
    resolveFinalText(item, req),
    { final_text: null, manual_entry: false },
  )
}

// 17. skip → final_text=null, manual_entry=false
{
  const item = makeBullet()
  const req: DecideRequestFields = { decision: "skip" }
  expectOk(
    "17: skip → null final_text, manual_entry=false",
    resolveFinalText(item, req),
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
    resolveFinalText(item, req),
    { final_text: null, manual_entry: false },
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
