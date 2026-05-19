// tests/positioning-v2/phase2/extract-bullet-candidates-check.ts
//
// Unit checks for extractBulletCandidates.
//
// Run: npx tsx tests/positioning-v2/phase2/extract-bullet-candidates-check.ts
// Exits 1 on any failure.
//
// Note: the "anchor-failed" telemetry log fires during the anchor-drop
// tests (by design). Don't be alarmed when stdout has those lines —
// the tests assert on return value, not on log output.

import { extractBulletCandidates } from "@/lib/positioning/v2/phase2/itemPopulatorParts/extractBulletCandidates"
import type { JobfitResultJson } from "@/lib/positioning/v2/types"
import {
  CATHERINE_JOBFIT,
  CATHERINE_RESUME_ANCHORED_LINE,
  CATHERINE_RESUME_SLICE,
  WHY_FRAME_AS_FLAVORED,
  WHY_NOT_REFRAME_FLAVORED,
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
// Happy path against Catherine fixture
// ============================================================================

console.log("=== Happy path (Catherine fixture) ===")

{
  const candidates = extractBulletCandidates(CATHERINE_JOBFIT, CATHERINE_RESUME_SLICE)
  // WHY_REFRAME_FLAVORED → reframe (retitle) + anchors on SWOT line → candidate
  // WHY_NOT_REFRAME_FLAVORED → "Mention in your optional letter" → SKIP
  // WHY_FRAME_AS_FLAVORED → reframe (frame this) + anchors on PESO line → candidate
  check(
    "1: produces 2 candidates (both reframe-flavored whys anchor in this slice)",
    candidates.length === 2,
    `got ${candidates.length}: [${candidates.map((c) => c.keyword).join(", ")}]`,
  )
  check(
    "1: includes WHY_REFRAME_FLAVORED keyword",
    candidates.some((c) => c.keyword === WHY_REFRAME_FLAVORED.keyword),
  )
  check(
    "1: includes WHY_FRAME_AS_FLAVORED keyword",
    candidates.some((c) => c.keyword === WHY_FRAME_AS_FLAVORED.keyword),
  )
  check(
    "1: EXCLUDES WHY_NOT_REFRAME_FLAVORED keyword (cover letter direction filtered)",
    !candidates.some((c) => c.keyword === WHY_NOT_REFRAME_FLAVORED.keyword),
  )
}

{
  const candidates = extractBulletCandidates(CATHERINE_JOBFIT, CATHERINE_RESUME_SLICE)
  const c = candidates.find((x) => x.keyword === WHY_REFRAME_FLAVORED.keyword)
  check(
    "2: WHY_REFRAME_FLAVORED candidate.original_bullet = SWOT line verbatim",
    c?.original_bullet === CATHERINE_RESUME_ANCHORED_LINE,
    c?.original_bullet?.slice(0, 80),
  )
  check(
    "2: candidate.jd_context = why.connection",
    c?.jd_context === WHY_REFRAME_FLAVORED.connection,
  )
  check(
    "2: candidate.action_match = 'retitle'",
    c?.action_match === "retitle",
    c?.action_match,
  )
}

{
  const candidates = extractBulletCandidates(CATHERINE_JOBFIT, CATHERINE_RESUME_SLICE)
  const c = candidates.find((x) => x.keyword === WHY_FRAME_AS_FLAVORED.keyword)
  check(
    "3: WHY_FRAME_AS_FLAVORED candidate.action_match = 'frame this'",
    c?.action_match === "frame this",
    c?.action_match,
  )
}

// ============================================================================
// Reframe filter — phrase coverage
// ============================================================================

console.log("\n=== Reframe filter ===")

{
  // Cover-letter direction is rejected entirely.
  const jobfit: JobfitResultJson = {
    why_structured: [WHY_NOT_REFRAME_FLAVORED],
  }
  const candidates = extractBulletCandidates(jobfit, CATHERINE_RESUME_SLICE)
  check(
    "4: non-reframe action → skipped entirely",
    candidates.length === 0,
  )
}

const REFRAME_PHRASES = [
  "retitle",
  "reframe",
  "rewrite",
  "frame this",
  "frame your",
  "rephrase",
  "restructure",
]

for (const phrase of REFRAME_PHRASES) {
  const jobfit = {
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta gamma delta epsilon",
        connection: "jd asks for thing",
        action: `Please ${phrase} this thing.`,
      },
    ],
  } as JobfitResultJson
  const resume = "alpha beta gamma delta epsilon"
  const candidates = extractBulletCandidates(jobfit, resume)
  check(
    `5: action phrase "${phrase}" → reframe filter passes`,
    candidates.length === 1 && candidates[0].action_match === phrase,
    `got ${candidates.length}, action_match=${candidates[0]?.action_match ?? "(none)"}`,
  )
}

{
  // Case-insensitive matching on the action string
  const jobfit = {
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta gamma",
        connection: "jd",
        action: "FRAME THIS section right now",
      },
    ],
  } as JobfitResultJson
  const candidates = extractBulletCandidates(jobfit, "alpha beta gamma")
  check(
    "6: case-insensitive reframe-phrase matching",
    candidates.length === 1 && candidates[0].action_match === "frame this",
  )
}

// ============================================================================
// Anchor drop
// ============================================================================

console.log("\n=== Anchor drop ===")

{
  // Reframe action ✓ but lead has zero meaningful overlap with resume
  const jobfit = {
    why_structured: [
      {
        keyword: "K",
        lead: "completely unrelated text that won't anchor",
        connection: "jd asks for thing",
        action: "Please retitle this bullet.",
      },
    ],
  } as JobfitResultJson
  const resume = "different content entirely\nnothing in common here at all"
  const candidates = extractBulletCandidates(jobfit, resume)
  check(
    "7: reframe action ✓ but lead doesn't anchor → drop",
    candidates.length === 0,
  )
}

{
  // 2-overlap (below threshold) — drops on anchor failure
  const jobfit = {
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta unrelated",
        connection: "jd",
        action: "rewrite this section",
      },
    ],
  } as JobfitResultJson
  const resume = "alpha beta extra extra extra"
  const candidates = extractBulletCandidates(jobfit, resume)
  check(
    "8: 2-overlap lead (below threshold) → drop",
    candidates.length === 0,
  )
}

// ============================================================================
// Defensive
// ============================================================================

console.log("\n=== Defensive ===")

{
  check(
    "9: null jobfit → []",
    extractBulletCandidates(null, CATHERINE_RESUME_SLICE).length === 0,
  )
}

{
  check(
    "10: undefined jobfit → []",
    extractBulletCandidates(undefined, CATHERINE_RESUME_SLICE).length === 0,
  )
}

{
  check(
    "11: null resumeText → []",
    extractBulletCandidates(CATHERINE_JOBFIT, null).length === 0,
  )
}

{
  check(
    "12: undefined resumeText → []",
    extractBulletCandidates(CATHERINE_JOBFIT, undefined).length === 0,
  )
}

{
  check(
    "13: empty resumeText → []",
    extractBulletCandidates(CATHERINE_JOBFIT, "").length === 0,
  )
}

{
  check(
    "14: whitespace-only resumeText → []",
    extractBulletCandidates(CATHERINE_JOBFIT, "   \n   ").length === 0,
  )
}

{
  const jobfit = { why_structured: "not an array" } as unknown as JobfitResultJson
  check(
    "15: wrong-type why_structured (string) → []",
    extractBulletCandidates(jobfit, CATHERINE_RESUME_SLICE).length === 0,
  )
}

{
  // Entry with missing fields — silently skipped without crashing the loop
  const jobfit = {
    why_structured: [
      {
        keyword: "GOOD",
        lead: "alpha beta gamma",
        connection: "ctx",
        action: "retitle this",
      },
      { keyword: "BAD" }, // missing lead/connection/action
      null, // null entry
      "string-entry" as unknown, // wrong type entry
      {
        keyword: "ALSO_GOOD",
        lead: "alpha beta gamma",
        connection: "ctx2",
        action: "reframe this",
      },
    ],
  } as unknown as JobfitResultJson
  const candidates = extractBulletCandidates(jobfit, "alpha beta gamma")
  check(
    "16: malformed entries skipped without crashing; valid entries still emit",
    candidates.length === 2 &&
      candidates[0].keyword === "GOOD" &&
      candidates[1].keyword === "ALSO_GOOD",
    `got: [${candidates.map((c) => c.keyword).join(", ")}]`,
  )
}

{
  // Entry with wrong-type action (number) → silently skipped
  const jobfit = {
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta gamma",
        connection: "ctx",
        action: 42,
      },
    ],
  } as unknown as JobfitResultJson
  check(
    "17: wrong-type action field → entry skipped",
    extractBulletCandidates(jobfit, "alpha beta gamma").length === 0,
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
