// tests/positioning-v2/workflow-preview-check.ts
//
// Unit checks for lib/positioning/v2/workflowPreview.ts. Pure function,
// no DB / LLM / I/O.
//
// Run:
//   npx tsx tests/positioning-v2/workflow-preview-check.ts
//
// Exits 1 on any failure.

import { generateWorkflowPreview } from "@/lib/positioning/v2/workflowPreview"
import type {
  Case,
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

function makeInputs(jobfit: unknown): CaseInputs {
  return {
    jobfit: jobfit as JobfitResultJson,
    targeting: null,
    careerStage: "mid_career",
  }
}

function arrayEq<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ============================================================================
// Happy path (per case)
// ============================================================================

console.log("=== Happy path ===")

// Test 1: Case A clean (no risks)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [
        { keyword: "a", lead: "", connection: "", action: "" },
        { keyword: "b", lead: "", connection: "", action: "" },
        { keyword: "c", lead: "", connection: "", action: "" },
      ],
    }),
    "A" as Case,
  )
  check("1: Case A gap_count = 0", wp.gap_count === 0, `got ${wp.gap_count}`)
  check(
    "1: Case A gap_themes = []",
    arrayEq(wp.gap_themes, []),
    JSON.stringify(wp.gap_themes),
  )
  check(
    "1: Case A content_review_required = false",
    wp.content_review_required === false,
    String(wp.content_review_required),
  )
  check(
    "1: Case A estimated_minutes = 0",
    wp.estimated_minutes === 0,
    String(wp.estimated_minutes),
  )
  check(
    "1: audit_findings_count = null (v2 stub)",
    wp.audit_findings_count === null,
    String(wp.audit_findings_count),
  )
}

// Test 2: Case B with 2 risks
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_structured: [
        { keyword: "gap_alpha", gap: "", reframe: "", severity: "medium" },
        { keyword: "gap_beta", gap: "", reframe: "", severity: "low" },
      ],
    }),
    "B" as Case,
  )
  check("2: Case B gap_count = 2", wp.gap_count === 2, `got ${wp.gap_count}`)
  check(
    "2: Case B gap_themes = [gap_alpha, gap_beta]",
    arrayEq(wp.gap_themes, ["gap_alpha", "gap_beta"]),
    JSON.stringify(wp.gap_themes),
  )
  check(
    "2: Case B content_review_required = true",
    wp.content_review_required === true,
  )
  check(
    "2: Case B estimated_minutes in 15-20 range",
    wp.estimated_minutes >= 15 && wp.estimated_minutes <= 20,
    String(wp.estimated_minutes),
  )
  check(
    "2: audit_findings_count = null",
    wp.audit_findings_count === null,
  )
}

// Test 3: Case C with 5 risks (mixed severity)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "k1_low", gap: "", reframe: "", severity: "low" },
        { keyword: "k2_high", gap: "", reframe: "", severity: "high" },
        { keyword: "k3_medium", gap: "", reframe: "", severity: "medium" },
        { keyword: "k4_high", gap: "", reframe: "", severity: "high" },
        { keyword: "k5_medium", gap: "", reframe: "", severity: "medium" },
      ],
    }),
    "C" as Case,
  )
  check("3: Case C gap_count = 5", wp.gap_count === 5, `got ${wp.gap_count}`)
  check(
    "3: Case C gap_themes = top 3 by severity [k2_high, k4_high, k3_medium]",
    arrayEq(wp.gap_themes, ["k2_high", "k4_high", "k3_medium"]),
    JSON.stringify(wp.gap_themes),
  )
  check(
    "3: Case C content_review_required = true",
    wp.content_review_required === true,
  )
  check(
    "3: Case C estimated_minutes in 30-45 range",
    wp.estimated_minutes >= 30 && wp.estimated_minutes <= 45,
    String(wp.estimated_minutes),
  )
}

// ============================================================================
// Sorting tests
// ============================================================================

console.log("\n=== Sorting ===")

// Test 4: 5 risks with mixed severity → top 3 by severity
// (covered partially by Test 3; this is a focused sort check)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "m1", gap: "", reframe: "", severity: "medium" },
        { keyword: "m2", gap: "", reframe: "", severity: "medium" },
        { keyword: "h1", gap: "", reframe: "", severity: "high" },
        { keyword: "h2", gap: "", reframe: "", severity: "high" },
        { keyword: "l1", gap: "", reframe: "", severity: "low" },
      ],
    }),
    "C" as Case,
  )
  check(
    "4: top-3 with 2 high + 2 medium + 1 low → [h1, h2, m1]",
    arrayEq(wp.gap_themes, ["h1", "h2", "m1"]),
    JSON.stringify(wp.gap_themes),
  )
}

// Test 5: Equal severity ties preserve original order (stable sort)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "first_medium", gap: "", reframe: "", severity: "medium" },
        { keyword: "second_medium", gap: "", reframe: "", severity: "medium" },
        { keyword: "third_medium", gap: "", reframe: "", severity: "medium" },
      ],
    }),
    "B" as Case,
  )
  check(
    "5: equal severity preserves original order",
    arrayEq(wp.gap_themes, ["first_medium", "second_medium", "third_medium"]),
    JSON.stringify(wp.gap_themes),
  )
}

// ============================================================================
// Edge cases
// ============================================================================

console.log("\n=== Edge cases ===")

// Test 6: Malformed risk_structured → gap_count=0, gap_themes=[]
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_structured: "not an array" as unknown,
    }),
    "B" as Case,
  )
  check("6: malformed → gap_count = 0", wp.gap_count === 0, `got ${wp.gap_count}`)
  check(
    "6: malformed → gap_themes = []",
    arrayEq(wp.gap_themes, []),
    JSON.stringify(wp.gap_themes),
  )
}

// Test 7: V4 fallback (risk_codes only) → gap_themes from codes
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_codes: ["v4_code_a", "v4_code_b", "v4_code_c", "v4_code_d"],
    }),
    "B" as Case,
  )
  check(
    "7: V4 fallback gap_count = 4",
    wp.gap_count === 4,
    `got ${wp.gap_count}`,
  )
  check(
    "7: V4 fallback gap_themes = top 3 (medium severity, stable order)",
    arrayEq(wp.gap_themes, ["v4_code_a", "v4_code_b", "v4_code_c"]),
    JSON.stringify(wp.gap_themes),
  )
}

// Test 8a: Fewer than 3 risks → return however many exist (1)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_structured: [
        { keyword: "only_one", gap: "", reframe: "", severity: "high" },
      ],
    }),
    "B" as Case,
  )
  check("8a: 1 risk → gap_count = 1", wp.gap_count === 1)
  check(
    "8a: 1 risk → gap_themes = [only_one] (no padding)",
    arrayEq(wp.gap_themes, ["only_one"]),
    JSON.stringify(wp.gap_themes),
  )
}

// Test 8b: Fewer than 3 risks → return however many exist (0)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
    }),
    "A" as Case,
  )
  check("8b: 0 risks → gap_count = 0", wp.gap_count === 0)
  check(
    "8b: 0 risks → gap_themes = []",
    arrayEq(wp.gap_themes, []),
  )
}

// Test 9: Case A but somehow has risks (shouldn't happen, but defensive)
//   → still produce reasonable preview (counts reflect reality)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_structured: [
        { keyword: "weird_a", gap: "", reframe: "", severity: "medium" },
        { keyword: "weird_b", gap: "", reframe: "", severity: "low" },
      ],
    }),
    "A" as Case, // inconsistent with risk count, but defensive
  )
  check(
    "9: Case A with risks → gap_count reflects reality (2)",
    wp.gap_count === 2,
    `got ${wp.gap_count}`,
  )
  check(
    "9: Case A with risks → gap_themes still populated",
    arrayEq(wp.gap_themes, ["weird_a", "weird_b"]),
    JSON.stringify(wp.gap_themes),
  )
  check(
    "9: Case A → content_review_required = false (driven by case, not risks)",
    wp.content_review_required === false,
  )
  check(
    "9: Case A → estimated_minutes = 0 (driven by case)",
    wp.estimated_minutes === 0,
  )
}

// Test 10: Missing jobfit entirely → defensive shape with zero counts
{
  const wp = generateWorkflowPreview(
    {
      jobfit: undefined as unknown as JobfitResultJson,
      targeting: null,
      careerStage: "mid_career",
    },
    "B" as Case,
  )
  check("10: missing jobfit → gap_count = 0", wp.gap_count === 0)
  check(
    "10: missing jobfit → gap_themes = []",
    arrayEq(wp.gap_themes, []),
  )
  check(
    "10: case-driven fields still set (content_review_required = true for B)",
    wp.content_review_required === true,
  )
  check(
    "10: estimated_minutes still set from case (B in range)",
    wp.estimated_minutes >= 15 && wp.estimated_minutes <= 20,
  )
}

// Test 11: Risks with empty-string keywords → filtered out of gap_themes
//   (avoids returning empty strings to UI; not in user's required list but
//    defensive against malformed data that has the right shape)
{
  const wp = generateWorkflowPreview(
    makeInputs({
      decision: "Apply",
      risk_structured: [
        { keyword: "", gap: "", reframe: "", severity: "high" },
        { keyword: "real_keyword", gap: "", reframe: "", severity: "medium" },
      ],
    }),
    "B" as Case,
  )
  check(
    "11: gap_count still = 2 (count includes the empty-keyword risk)",
    wp.gap_count === 2,
  )
  check(
    "11: gap_themes filters empty keyword → [real_keyword]",
    arrayEq(wp.gap_themes, ["real_keyword"]),
    JSON.stringify(wp.gap_themes),
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
