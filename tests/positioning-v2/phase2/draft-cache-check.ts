// tests/positioning-v2/phase2/draft-cache-check.ts
//
// Unit test for lib/positioning/v2/phase2/draftCache.ts. Pure functions
// — no DB, no async, no fixtures.
//
// Run:
//   npx tsx tests/positioning-v2/phase2/draft-cache-check.ts
//
// Exits 1 on any failure.

import {
  shouldUseCachedDrafts,
  getCachedDrafts,
} from "@/lib/positioning/v2/phase2/draftCache"
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
// Item builders
// ============================================================================

function makeHeadline(overrides: Partial<PhaseTwoHeadlineItem> = {}): PhaseTwoHeadlineItem {
  return {
    id: "headline-1",
    type: "headline",
    label: "Reframe headline",
    original: "Old headline",
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

function makeBullet(overrides: Partial<PhaseTwoBulletItem> = {}): PhaseTwoBulletItem {
  return {
    id: "bullet-1",
    type: "bullet",
    label: "Reframe bullet",
    original_bullet: "Old bullet",
    jd_context: "JD context",
    question_asked: null,
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

function makeGap(overrides: Partial<PhaseTwoGapItem> = {}): PhaseTwoGapItem {
  return {
    id: "gap-1",
    type: "gap",
    label: "Address Excel gap",
    gap_description: "JD asks for Excel",
    jd_context: "JD context",
    question_asked: null,
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

// ============================================================================
// Tests
// ============================================================================

console.log("=== shouldUseCachedDrafts — headline ===")

// 1. headline + no draft_options + regenerate=undefined → false
{
  const item = makeHeadline({ draft_options: [] })
  check(
    "1: headline + empty draft_options + regenerate=undefined → false",
    shouldUseCachedDrafts(item, undefined) === false,
  )
}

// 2. headline + draft_options populated + regenerate=undefined → true
{
  const item = makeHeadline({ draft_options: ["a", "b"] })
  check(
    "2: headline + populated draft_options + regenerate=undefined → true",
    shouldUseCachedDrafts(item, undefined) === true,
  )
}

// 3. headline + draft_options populated + regenerate=false → true
{
  const item = makeHeadline({ draft_options: ["a"] })
  check(
    "3: headline + populated draft_options + regenerate=false → true",
    shouldUseCachedDrafts(item, false) === true,
  )
}

// 4. headline + draft_options populated + regenerate=true → false (bypass)
{
  const item = makeHeadline({ draft_options: ["a"] })
  check(
    "4: headline + populated draft_options + regenerate=true → false (bypass)",
    shouldUseCachedDrafts(item, true) === false,
  )
}

console.log("\n=== shouldUseCachedDrafts — bullet ===")

// 5. bullet + draft=null + regenerate=undefined → false
{
  const item = makeBullet({ draft: null })
  check(
    "5: bullet + null draft + regenerate=undefined → false",
    shouldUseCachedDrafts(item, undefined) === false,
  )
}

// 6. bullet + draft set + regenerate=undefined → true
{
  const item = makeBullet({ draft: "Cached bullet draft" })
  check(
    "6: bullet + draft set + regenerate=undefined → true",
    shouldUseCachedDrafts(item, undefined) === true,
  )
}

// 7. bullet + draft set + regenerate=true → false (bypass)
{
  const item = makeBullet({ draft: "Cached bullet draft" })
  check(
    "7: bullet + draft set + regenerate=true → false (bypass)",
    shouldUseCachedDrafts(item, true) === false,
  )
}

console.log("\n=== shouldUseCachedDrafts — gap ===")

// 8. gap + draft=null + regenerate=undefined → false
{
  const item = makeGap({ draft: null })
  check(
    "8: gap + null draft + regenerate=undefined → false",
    shouldUseCachedDrafts(item, undefined) === false,
  )
}

// 9. gap + draft set + regenerate=undefined → true
{
  const item = makeGap({ draft: "Cached gap draft" })
  check(
    "9: gap + draft set + regenerate=undefined → true",
    shouldUseCachedDrafts(item, undefined) === true,
  )
}

// 10. gap + draft set + regenerate=true → false (bypass)
{
  const item = makeGap({ draft: "Cached gap draft" })
  check(
    "10: gap + draft set + regenerate=true → false (bypass)",
    shouldUseCachedDrafts(item, true) === false,
  )
}

console.log("\n=== getCachedDrafts ===")

// 11. getCachedDrafts(headline) → returns draft_options
{
  const item = makeHeadline({ draft_options: ["a", "b", "c"] })
  const result = getCachedDrafts(item)
  check(
    "11: getCachedDrafts(headline) returns draft_options array",
    JSON.stringify(result) === JSON.stringify(["a", "b", "c"]),
    `got ${JSON.stringify(result)}`,
  )
}

// 12. getCachedDrafts(bullet) → returns [draft] when set
{
  const item = makeBullet({ draft: "Bullet draft" })
  const result = getCachedDrafts(item)
  check(
    "12: getCachedDrafts(bullet) returns [draft]",
    JSON.stringify(result) === JSON.stringify(["Bullet draft"]),
    `got ${JSON.stringify(result)}`,
  )
}

// 13. getCachedDrafts(gap) → returns [draft] when set
{
  const item = makeGap({ draft: "Gap draft" })
  const result = getCachedDrafts(item)
  check(
    "13: getCachedDrafts(gap) returns [draft]",
    JSON.stringify(result) === JSON.stringify(["Gap draft"]),
    `got ${JSON.stringify(result)}`,
  )
}

// 14. getCachedDrafts(bullet) with no draft → empty array (caller's responsibility)
{
  const item = makeBullet({ draft: null })
  const result = getCachedDrafts(item)
  check(
    "14: getCachedDrafts(bullet) with null draft → []",
    Array.isArray(result) && result.length === 0,
    `got ${JSON.stringify(result)}`,
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
