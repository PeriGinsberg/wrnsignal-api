// tests/positioning-v2/case-determination-check.ts
//
// Unit checks for lib/positioning/v2/caseDetermination.ts. Pure function,
// no DB / LLM / I/O.
//
// Run:
//   npx tsx tests/positioning-v2/case-determination-check.ts
//
// Exits 1 on any failure.

import { determineCase } from "@/lib/positioning/v2/caseDetermination"
import type {
  CaseInputs,
  JobfitResultJson,
} from "@/lib/positioning/v2/types"

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

// Helper: build a CaseInputs with defaults. jobfit is `unknown` to allow
// passing malformed data for defensive-path tests.
function makeInputs(jobfit: unknown): CaseInputs {
  return {
    jobfit: jobfit as JobfitResultJson,
    targeting: null,
    careerStage: "mid_career",
  }
}

// ============================================================================
// Happy path (one per case)
// ============================================================================

console.log("=== Happy path ===")

// Test 1: Pass → Case C
{
  const r = determineCase(makeInputs({ decision: "Pass" }))
  check("1: Pass → Case C", r.case === "C", `got ${r.case}`)
  check("1: reasoning mentions 'Pass'", /pass/i.test(r.reasoning), r.reasoning)
}

// Test 2: Review + 1 high-severity risk → Case C
{
  const r = determineCase(
    makeInputs({
      decision: "Review",
      risk_structured: [
        {
          keyword: "missing_skill_x",
          gap: "candidate lacks X",
          reframe: "address X",
          severity: "high",
        },
      ],
    }),
  )
  check("2: Review + high-severity → Case C", r.case === "C", `got ${r.case}`)
  check(
    "2: reasoning mentions 'high-severity'",
    /high.?severity/i.test(r.reasoning),
    r.reasoning,
  )
  check(
    "2: reasoning includes the risk keyword",
    /missing_skill_x/.test(r.reasoning),
    r.reasoning,
  )
}

// Test 3: Review + only medium/low risks → Case B
{
  const r = determineCase(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "x", gap: "", reframe: "", severity: "medium" },
        { keyword: "y", gap: "", reframe: "", severity: "low" },
      ],
    }),
  )
  check("3: Review + medium/low → Case B", r.case === "B", `got ${r.case}`)
  check(
    "3: reasoning mentions 'Review'",
    /review/i.test(r.reasoning),
    r.reasoning,
  )
}

// Test 4: Apply + 0 risks + 3 whys → Case A
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [
        { keyword: "a", lead: "", connection: "", action: "" },
        { keyword: "b", lead: "", connection: "", action: "" },
        { keyword: "c", lead: "", connection: "", action: "" },
      ],
    }),
  )
  check("4: Apply + 0 risks + 3 whys → Case A", r.case === "A", `got ${r.case}`)
  check(
    "4: reasoning mentions 'Apply'",
    /apply/i.test(r.reasoning),
    r.reasoning,
  )
  check(
    "4: reasoning includes '3' positive findings",
    /3 positive/i.test(r.reasoning),
    r.reasoning,
  )
}

// Test 5: Apply + 0 risks + 2 whys (below threshold) → Case B
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [
        { keyword: "a", lead: "", connection: "", action: "" },
        { keyword: "b", lead: "", connection: "", action: "" },
      ],
    }),
  )
  check(
    "5: Apply + 0 risks + 2 whys (below threshold) → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
}

// Test 6: Apply + 1 high-severity risk → Case B
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_structured: [
        { keyword: "deal_breaker", gap: "", reframe: "", severity: "high" },
      ],
      why_structured: [{ keyword: "a", lead: "", connection: "", action: "" }],
    }),
  )
  check(
    "6: Apply + high-severity risk → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
  check(
    "6: reasoning mentions 'high-severity'",
    /high.?severity/i.test(r.reasoning),
    r.reasoning,
  )
}

// Test 7: Priority Apply + 1 medium risk → Case B
{
  const r = determineCase(
    makeInputs({
      decision: "Priority Apply",
      risk_structured: [
        { keyword: "minor_x", gap: "", reframe: "", severity: "medium" },
      ],
    }),
  )
  check(
    "7: Priority Apply + 1 medium risk → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
  check(
    "7: reasoning mentions 'Priority Apply'",
    /priority apply/i.test(r.reasoning),
    r.reasoning,
  )
}

// ============================================================================
// Edge cases
// ============================================================================

console.log("\n=== Edge cases ===")

// Test 8: Missing jobfit entirely → Case B with data-quality reasoning
{
  const r = determineCase({
    jobfit: undefined as unknown as JobfitResultJson,
    targeting: null,
    careerStage: "mid_career",
  })
  check("8: Missing jobfit → Case B", r.case === "B", `got ${r.case}`)
  check(
    "8: reasoning mentions data quality / unavailable / malformed",
    /unavailable|malformed|data quality/i.test(r.reasoning),
    r.reasoning,
  )
}

// Test 8b: Null jobfit
{
  const r = determineCase({
    jobfit: null as unknown as JobfitResultJson,
    targeting: null,
    careerStage: "mid_career",
  })
  check("8b: Null jobfit → Case B", r.case === "B", `got ${r.case}`)
  check(
    "8b: reasoning mentions data quality",
    /data quality/i.test(r.reasoning),
    r.reasoning,
  )
}

// Test 9: decision field but no verdict → uses decision
{
  const r = determineCase(makeInputs({ decision: "Pass" }))
  check(
    "9: decision-only Pass → Case C (uses decision)",
    r.case === "C",
    `got ${r.case}`,
  )
}

// Test 10: verdict field but no decision → uses verdict
{
  const r = determineCase(makeInputs({ verdict: "Pass" }))
  check(
    "10: verdict-only Pass → Case C (uses verdict)",
    r.case === "C",
    `got ${r.case}`,
  )
}

// Test 10b: Both decision and verdict set with different values → prefer decision
{
  const r = determineCase(
    makeInputs({
      decision: "Pass",
      verdict: "Apply", // ignored
    }),
  )
  check(
    "10b: both fields set → prefers decision (Pass → Case C)",
    r.case === "C",
    `got ${r.case}`,
  )
}

// Test 11: risk_structured missing, risk_codes present → V4 fallback → Case B
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_codes: ["some_code", "another_code"],
    }),
  )
  check(
    "11: V4 fallback (risk_codes only, Apply) → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
}

// Test 12: risk_structured is not an array → defensive path produces Case B
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_structured: "not an array" as unknown,
    }),
  )
  check(
    "12: risk_structured not an array → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
}

// Test 12b: With non-array risk_structured + ≥3 whys → still Case B (data quality blocks Case A)
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_structured: "not an array" as unknown,
      why_structured: [
        { keyword: "a", lead: "", connection: "", action: "" },
        { keyword: "b", lead: "", connection: "", action: "" },
        { keyword: "c", lead: "", connection: "", action: "" },
      ],
    }),
  )
  check(
    "12b: data quality issue blocks Case A even with ≥3 whys → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
  check(
    "12b: reasoning notes data quality issue",
    /data quality/i.test(r.reasoning),
    r.reasoning,
  )
}

// Test 13: risk_structured items missing severity field → treated as medium
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_structured: [
        // No severity — defensive code defaults to medium
        { keyword: "x", gap: "", reframe: "" } as unknown,
      ],
    }),
  )
  check(
    "13: missing severity → treated as medium → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
}

// Test 14: Empty risk_structured AND empty why_structured → Case B (default)
{
  const r = determineCase(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [],
    }),
  )
  check(
    "14: empty risks + empty whys → Case B",
    r.case === "B",
    `got ${r.case}`,
  )
}

// Test 14b: Same shape but verdict=Pass → still Case C (verdict wins)
{
  const r = determineCase(
    makeInputs({
      decision: "Pass",
      risk_structured: [],
      why_structured: [],
    }),
  )
  check(
    "14b: Pass with empty risks+whys → still Case C",
    r.case === "C",
    `got ${r.case}`,
  )
}

// Test 15: Invalid verdict string → fallback Case B
{
  const r = determineCase(
    makeInputs({
      decision: "Maybe" as unknown,
    }),
  )
  check(
    "15: invalid verdict string → Case B (defensive)",
    r.case === "B",
    `got ${r.case}`,
  )
  check(
    "15: reasoning mentions data quality / invalid / missing",
    /data quality|invalid|missing/i.test(r.reasoning),
    r.reasoning,
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
