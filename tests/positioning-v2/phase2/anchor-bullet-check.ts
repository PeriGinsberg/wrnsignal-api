// tests/positioning-v2/phase2/anchor-bullet-check.ts
//
// Unit checks for anchorBullet.ts. Pure function, no DB / LLM / I/O.
//
// Run: npx tsx tests/positioning-v2/phase2/anchor-bullet-check.ts
// Exits 1 on any failure.

import {
  STOPWORDS,
  anchorLeadToResume,
  tokenize,
} from "@/lib/positioning/v2/phase2/itemPopulatorParts/anchorBullet"
import {
  CATHERINE_RESUME_ANCHORED_LINE,
  CATHERINE_RESUME_SLICE,
  WHY_REFRAME_FLAVORED,
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

// ============================================================================
// tokenize + STOPWORDS
// ============================================================================

console.log("=== tokenize + STOPWORDS ===")

{
  const tokens = tokenize("The quick brown fox")
  check(
    "1: drops stopwords + lowercases",
    JSON.stringify(tokens) === JSON.stringify(["quick", "brown", "fox"]),
    JSON.stringify(tokens),
  )
}

{
  check("2: null input → []", tokenize(null).length === 0)
}

{
  check("3: undefined input → []", tokenize(undefined).length === 0)
}

{
  check(
    "4: wrong-type input → []",
    tokenize(42 as unknown as string).length === 0,
  )
}

{
  check("5: all-stopword string → []", tokenize("a the an of by").length === 0)
}

{
  const tokens = tokenize("PERFORMED INDUSTRY ANALYSES.")
  check(
    "6: lowercases + drops punctuation",
    JSON.stringify(tokens) === JSON.stringify(["performed", "industry", "analyses"]),
    JSON.stringify(tokens),
  )
}

{
  const tokens = tokenize("data 30 30+ years 2024")
  check(
    "7: drops pure-numeric tokens",
    JSON.stringify(tokens) === JSON.stringify(["data", "years"]),
    JSON.stringify(tokens),
  )
}

{
  check(
    "8: STOPWORDS contains 'the', 'a', 'and', 'of'",
    STOPWORDS.has("the") &&
      STOPWORDS.has("a") &&
      STOPWORDS.has("and") &&
      STOPWORDS.has("of"),
  )
}

{
  // Length-2 tokens pass (need ≥ 2 chars). Single-letter "a" is a stopword
  // anyway. Pure-letter 2-char content words like "io" pass.
  const tokens = tokenize("xx yy zz")
  check(
    "9: length-2 content tokens pass length filter",
    JSON.stringify(tokens) === JSON.stringify(["xx", "yy", "zz"]),
    JSON.stringify(tokens),
  )
}

// ============================================================================
// Happy path against Catherine fixture
// ============================================================================

console.log("\n=== Happy path (Catherine fixture) ===")

{
  const result = anchorLeadToResume(
    WHY_REFRAME_FLAVORED.lead,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "10: anchors Catherine's SWOT lead to the SWOT bullet line",
    result === CATHERINE_RESUME_ANCHORED_LINE,
    `got: ${JSON.stringify(result?.slice(0, 120) ?? null)}`,
  )
}

{
  const result = anchorLeadToResume(
    WHY_REFRAME_FLAVORED.lead,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "11: verbatim invariant — anchored line is a substring of the input resume",
    result !== null && CATHERINE_RESUME_SLICE.indexOf(result) >= 0,
  )
}

{
  const result = anchorLeadToResume(
    WHY_REFRAME_FLAVORED.lead,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "12: verbatim — preserves '○ ' bullet prefix",
    result !== null && result.startsWith("○ "),
  )
}

{
  // Case-insensitive matching — different casing in lead still anchors.
  const result = anchorLeadToResume(
    "performed industry AUDIENCE swot ANALYSES retail BRAND",
    CATHERINE_RESUME_SLICE,
  )
  check(
    "13: case-insensitive matching anchors to SWOT line",
    result === CATHERINE_RESUME_ANCHORED_LINE,
    `got: ${JSON.stringify(result?.slice(0, 80) ?? null)}`,
  )
}

// ============================================================================
// Threshold
// ============================================================================

console.log("\n=== Threshold ===")

{
  // 2 content-word overlap, below threshold of 3
  const resume = "alpha beta unrelated content here\nnothing further"
  const result = anchorLeadToResume("alpha beta charlie delta echo", resume)
  check(
    "14: 2-content-word overlap (below threshold) → null",
    result === null,
    `got: ${JSON.stringify(result)}`,
  )
}

{
  // Exactly 3 content-word overlap, at threshold
  const resume = "alpha beta gamma extra extra extra"
  const result = anchorLeadToResume("alpha beta gamma delta echo", resume)
  check(
    "15: exactly 3-content-word overlap (at threshold) → anchors",
    result === "alpha beta gamma extra extra extra",
    `got: ${JSON.stringify(result)}`,
  )
}

// ============================================================================
// Defensive
// ============================================================================

console.log("\n=== Defensive ===")

{
  check(
    "16: null lead → null",
    anchorLeadToResume(null, CATHERINE_RESUME_SLICE) === null,
  )
}

{
  check(
    "17: undefined lead → null",
    anchorLeadToResume(undefined, CATHERINE_RESUME_SLICE) === null,
  )
}

{
  check(
    "18: null resumeText → null",
    anchorLeadToResume("some lead with many words", null) === null,
  )
}

{
  check(
    "19: undefined resumeText → null",
    anchorLeadToResume("some lead with many words", undefined) === null,
  )
}

{
  check(
    "20: empty lead → null",
    anchorLeadToResume("", CATHERINE_RESUME_SLICE) === null,
  )
}

{
  check(
    "21: empty resumeText → null",
    anchorLeadToResume("some lead with many words", "") === null,
  )
}

{
  check(
    "22: all-stopword lead → null",
    anchorLeadToResume("the a an of by to for", CATHERINE_RESUME_SLICE) === null,
  )
}

{
  check(
    "23: wrong-type lead (number) → null",
    anchorLeadToResume(42 as unknown as string, CATHERINE_RESUME_SLICE) === null,
  )
}

{
  check(
    "24: wrong-type resumeText (object) → null",
    anchorLeadToResume(
      "some lead with many words",
      {} as unknown as string,
    ) === null,
  )
}

// ============================================================================
// Tie-breaking + verbatim invariant edge cases
// ============================================================================

console.log("\n=== Tie-breaking + verbatim edges ===")

{
  // Two lines with identical max overlap — first one in reading order wins.
  const resume = "alpha beta gamma\nalpha beta gamma\nother"
  const result = anchorLeadToResume("alpha beta gamma delta", resume)
  check(
    "25: tie-breaking returns FIRST line in reading order",
    result === "alpha beta gamma",
    `got: ${JSON.stringify(result)}`,
  )
}

{
  // Verifies internal whitespace preserved verbatim — double spaces survive
  const resume = "leading  spaces  matter  here\nnext line"
  const result = anchorLeadToResume(
    "leading spaces matter here",
    resume,
  )
  check(
    "26: preserves internal double-spaces verbatim",
    result === "leading  spaces  matter  here",
    `got: ${JSON.stringify(result)}`,
  )
}

{
  // Set-intersection counting: line with repeated word doesn't double-count.
  // Both leads have overlap = 3 (alpha, beta, gamma) — the line with
  // repetition does NOT win because we dedup tokens.
  const resume = "alpha alpha alpha extra\nalpha beta gamma extra"
  const result = anchorLeadToResume("alpha beta gamma", resume)
  check(
    "27: set-intersection (no double-counting on repeated tokens)",
    result === "alpha beta gamma extra",
    `got: ${JSON.stringify(result)}`,
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
