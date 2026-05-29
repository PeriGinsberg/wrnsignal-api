// tests/profile/compute-status-check.ts
//
// Boundary matrix for lib/profile/computeStatus.
//
// All tests inject `today` so assertions are deterministic and unaffected
// by the real clock. Uses a fixed reference today of 2026-05-29
// (matching the date the wrong-status fix is being built against) for
// most cases, plus a few cases that pin behavior at other reference
// dates to confirm the boundary logic isn't an artifact of one specific
// today.
//
// Coverage:
//   Year+month branch:
//     - future year, future month         → student
//     - past year, past month             → graduated
//     - same year, future month           → student
//     - same year, past month             → graduated
//     - same year, SAME month             → graduated (boundary fold)
//   Year-only branch (same year tiebreaker via `type`):
//     - past year (any type)              → graduated
//     - future year (any type)            → student
//     - same year, type "expected"        → student
//     - same year, type "completed"       → graduated
//     - same year, type "unknown"         → graduated  [EDIT 1]
//   careerStage fallback (no grad date):
//     - "student"                          → student
//     - "early_career"                     → graduated
//     - "mid_career"                       → graduated
//     - "executive"                        → graduated
//     - null                               → unknown
//   Precedence:
//     - grad date present + careerStage present → grad date wins
//   Default today:
//     - omitting today uses real Date (smoke test only — no value assert)
//
// Run: npx tsx tests/profile/compute-status-check.ts

import {
  computeStatus,
  type CandidateStatus,
} from "../../lib/profile/computeStatus"
import type { ParsedGradDate } from "../../lib/resume/extractGraduationDate"
import type { CareerStage } from "../../lib/laneTaxonomy"

let failures = 0

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${label}`)
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

/** Build a ParsedGradDate with sensible defaults for test brevity. */
function gd(
  year: number,
  month: number | null,
  type: ParsedGradDate["type"] = "unknown",
  confidence: ParsedGradDate["confidence"] = "high",
  raw = `${month ?? "?"}/${year}`,
): ParsedGradDate {
  return { raw, year, month, type, confidence }
}

/** Build a today at year + 1-indexed month + day. */
function on(year: number, month: number, day: number): Date {
  // new Date(year, monthIndex, day) — monthIndex is 0-based
  return new Date(year, month - 1, day)
}

function check(
  label: string,
  input: {
    gradDate: ParsedGradDate | null
    careerStage: CareerStage | null
    today: Date
  },
  expected: CandidateStatus,
) {
  const actual = computeStatus(input)
  if (actual === expected) {
    console.log(`  ✅ ${label} → ${expected}`)
  } else {
    console.log(`  ❌ ${label} → expected ${expected}, got ${actual}`)
    failures++
  }
}

// ──────────────────────────────────────────────────────────────────────
// Reference today for the main matrix: 2026-05-29.
// ──────────────────────────────────────────────────────────────────────
const TODAY = on(2026, 5, 29)

// ──────────────────────────────────────────────────────────────────────
// Year+month branch
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== year+month branch ===")

check(
  "future year + any month (May 2027, today May 2026)",
  { gradDate: gd(2027, 5), careerStage: null, today: TODAY },
  "student",
)

check(
  "past year + any month (May 2024, today May 2026)",
  { gradDate: gd(2024, 5), careerStage: null, today: TODAY },
  "graduated",
)

check(
  "same year, future month (June 2026 vs May 2026)",
  { gradDate: gd(2026, 6), careerStage: null, today: TODAY },
  "student",
)

check(
  "same year, past month (April 2026 vs May 2026)",
  { gradDate: gd(2026, 4), careerStage: null, today: TODAY },
  "graduated",
)

// THE BOUNDARY FOLD: same year + same month → graduated.
check(
  "same year, SAME month (May 2026 vs today May 2026) — boundary fold",
  { gradDate: gd(2026, 5), careerStage: null, today: TODAY },
  "graduated",
)

// Also test the same-month boundary on a different today so the result
// isn't an artifact of May.
check(
  "same year, same month at different today (June 2027 vs today June 2027)",
  { gradDate: gd(2027, 6), careerStage: null, today: on(2027, 6, 15) },
  "graduated",
)

// Type doesn't matter when month is present and resolves the same-year case.
check(
  'same year + future month + type="completed" — month wins over type',
  {
    gradDate: gd(2026, 9, "completed"),
    careerStage: null,
    today: TODAY,
  },
  "student",
)

check(
  'same year + past month + type="expected" — month wins over type',
  {
    gradDate: gd(2026, 3, "expected"),
    careerStage: null,
    today: TODAY,
  },
  "graduated",
)

// ──────────────────────────────────────────────────────────────────────
// Year-only branch — type matters only for same year
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== year-only branch ===")

check(
  'year-only past (2025, any type) — "expected"',
  { gradDate: gd(2025, null, "expected"), careerStage: null, today: TODAY },
  "graduated",
)
check(
  'year-only past (2025, any type) — "completed"',
  { gradDate: gd(2025, null, "completed"), careerStage: null, today: TODAY },
  "graduated",
)
check(
  'year-only past (2025, any type) — "unknown"',
  { gradDate: gd(2025, null, "unknown"), careerStage: null, today: TODAY },
  "graduated",
)

check(
  'year-only future (2027, any type) — "expected"',
  { gradDate: gd(2027, null, "expected"), careerStage: null, today: TODAY },
  "student",
)
check(
  'year-only future (2027, any type) — "completed"',
  { gradDate: gd(2027, null, "completed"), careerStage: null, today: TODAY },
  "student",
)
check(
  'year-only future (2027, any type) — "unknown"',
  { gradDate: gd(2027, null, "unknown"), careerStage: null, today: TODAY },
  "student",
)

// Same-year + year-only: type is the tiebreaker.
check(
  'year-only SAME year + type "expected" — student',
  { gradDate: gd(2026, null, "expected"), careerStage: null, today: TODAY },
  "student",
)
check(
  'year-only SAME year + type "completed" — graduated',
  { gradDate: gd(2026, null, "completed"), careerStage: null, today: TODAY },
  "graduated",
)

// EDIT 1: explicit pin — year-only + same year + type "unknown" → graduated
console.log('\n=== EDIT 1 pins: year-only same-year "unknown" → graduated ===')

check(
  '[EDIT 1] year-only SAME year + type "unknown" → graduated',
  { gradDate: gd(2026, null, "unknown"), careerStage: null, today: TODAY },
  "graduated",
)

// Confirm EDIT 1 holds at a different reference today (not an artifact of 2026).
check(
  '[EDIT 1] year-only SAME year + type "unknown" → graduated (today 2030)',
  { gradDate: gd(2030, null, "unknown"), careerStage: null, today: on(2030, 7, 1) },
  "graduated",
)

// Confirm EDIT 1 differs from the "expected" tiebreaker — same data
// shape, different `type`, different verdict.
check(
  '[EDIT 1 contrast] year-only SAME year + type "expected" → student (not graduated)',
  { gradDate: gd(2026, null, "expected"), careerStage: null, today: TODAY },
  "student",
)

// ──────────────────────────────────────────────────────────────────────
// careerStage fallback (no grad date)
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== careerStage fallback (gradDate null) ===")

check(
  'gradDate null + careerStage "student" → student',
  { gradDate: null, careerStage: "student", today: TODAY },
  "student",
)
check(
  'gradDate null + careerStage "early_career" → graduated',
  { gradDate: null, careerStage: "early_career", today: TODAY },
  "graduated",
)
check(
  'gradDate null + careerStage "mid_career" → graduated',
  { gradDate: null, careerStage: "mid_career", today: TODAY },
  "graduated",
)
check(
  'gradDate null + careerStage "executive" → graduated',
  { gradDate: null, careerStage: "executive", today: TODAY },
  "graduated",
)
check(
  "gradDate null + careerStage null → unknown",
  { gradDate: null, careerStage: null, today: TODAY },
  "unknown",
)

// ──────────────────────────────────────────────────────────────────────
// Precedence — gradDate always wins over careerStage when both present
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== precedence — gradDate wins over careerStage ===")

check(
  'gradDate past + careerStage "student" → graduated (date wins)',
  { gradDate: gd(2024, 5), careerStage: "student", today: TODAY },
  "graduated",
)
check(
  'gradDate future + careerStage "executive" → student (date wins)',
  { gradDate: gd(2028, 5), careerStage: "executive", today: TODAY },
  "student",
)
check(
  '[EDIT 1] gradDate same-year unknown + careerStage "student" → graduated (date wins)',
  {
    gradDate: gd(2026, null, "unknown"),
    careerStage: "student",
    today: TODAY,
  },
  "graduated",
)

// ──────────────────────────────────────────────────────────────────────
// Default today — smoke check that the optional `today` parameter falls
// back to real Date. Asserts only that the call doesn't throw and returns
// a valid CandidateStatus (the actual verdict depends on the wall clock,
// which we intentionally don't pin in this test).
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== default today (real clock) ===")

const defaultResult = computeStatus({
  // gradDate in 2200 so the verdict is deterministic regardless of when
  // the test runs — "student" until the year 2200.
  gradDate: gd(2199, null, "expected"),
  careerStage: null,
})
const validValues: CandidateStatus[] = ["student", "graduated", "unknown"]
assert(
  validValues.includes(defaultResult),
  "default today returns a valid CandidateStatus",
  `got "${defaultResult}"`,
)
assert(
  defaultResult === "student",
  "gradDate year 2199 → student (regardless of real wall clock)",
  `got "${defaultResult}"`,
)

// ──────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────
console.log(
  `\n=== ${
    failures === 0 ? "✅ all checks passed" : `❌ ${failures} failure(s)`
  } ===`,
)
process.exit(failures === 0 ? 0 : 1)
