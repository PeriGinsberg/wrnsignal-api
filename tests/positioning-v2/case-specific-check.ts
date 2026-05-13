// tests/positioning-v2/case-specific-check.ts
//
// Unit checks for lib/positioning/v2/caseSpecific.ts. Pure function,
// no DB / LLM / I/O.
//
// Run:
//   npx tsx tests/positioning-v2/case-specific-check.ts
//
// Exits 1 on any failure.

import { generateCaseSpecific } from "@/lib/positioning/v2/caseSpecific"
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

// ============================================================================
// Happy path
// ============================================================================

console.log("=== Happy path ===")

// Test 1: Case A with 3+ whys → summary contains all 3 keywords, small_refinements = []
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [
        { keyword: "python_expertise", lead: "", connection: "", action: "" },
        { keyword: "team_leadership", lead: "", connection: "", action: "" },
        { keyword: "data_pipelines", lead: "", connection: "", action: "" },
      ],
    }),
    "A" as Case,
  )
  check("1: Case A returns non-null object", r !== null)
  check(
    "1: well_positioned_summary mentions kw1",
    !!r?.well_positioned_summary?.includes("python_expertise"),
    r?.well_positioned_summary,
  )
  check(
    "1: well_positioned_summary mentions kw2",
    !!r?.well_positioned_summary?.includes("team_leadership"),
  )
  check(
    "1: well_positioned_summary mentions kw3",
    !!r?.well_positioned_summary?.includes("data_pipelines"),
  )
  check(
    "1: well_positioned_summary uses 'aligns strongly'",
    !!r?.well_positioned_summary?.includes("aligns strongly"),
    r?.well_positioned_summary,
  )
  check(
    "1: small_refinements is empty array (not undefined)",
    Array.isArray(r?.small_refinements) && r!.small_refinements!.length === 0,
    JSON.stringify(r?.small_refinements),
  )
  check(
    "1: Case A does NOT include inferred_lane_mismatch",
    r?.inferred_lane_mismatch === undefined,
  )
  check(
    "1: Case A does NOT include high_severity_gap_summary",
    r?.high_severity_gap_summary === undefined,
  )
}

// Test 2: Case B → returns null
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Apply",
      risk_structured: [
        { keyword: "x", gap: "", reframe: "", severity: "medium" },
      ],
    }),
    "B" as Case,
  )
  check("2: Case B returns exactly null", r === null, String(r))
}

// Test 3: Case C with 1 high-severity risk → summary + lane_mismatch
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Review",
      risk_structured: [
        {
          keyword: "no_supervisory_experience",
          gap: "candidate has not managed direct reports",
          reframe: "",
          severity: "high",
        },
      ],
      job_signals: {
        jobTitle: "Senior Engineering Manager",
      },
    }),
    "C" as Case,
  )
  check("3: Case C returns non-null object", r !== null)
  check(
    "3: high_severity_gap_summary mentions the keyword",
    !!r?.high_severity_gap_summary?.includes("no_supervisory_experience"),
    r?.high_severity_gap_summary,
  )
  check(
    "3: high_severity_gap_summary includes the gap text",
    !!r?.high_severity_gap_summary?.includes("managed direct reports"),
    r?.high_severity_gap_summary,
  )
  check(
    "3: high_severity_gap_summary ends with period",
    !!r?.high_severity_gap_summary?.endsWith("."),
    r?.high_severity_gap_summary,
  )
  check(
    "3: inferred_lane_mismatch.job_asking_for uses jobTitle",
    r?.inferred_lane_mismatch?.job_asking_for === "Senior Engineering Manager",
    r?.inferred_lane_mismatch?.job_asking_for,
  )
  check(
    "3: inferred_lane_mismatch.resume_reads_as is null (v2 stub)",
    r?.inferred_lane_mismatch?.resume_reads_as === null,
  )
  check(
    "3: Case C does NOT include well_positioned_summary",
    r?.well_positioned_summary === undefined,
  )
}

// Test 4: Case C with 2+ high-severity risks → mentions multiple keywords
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Pass",
      risk_structured: [
        { keyword: "missing_credential_x", gap: "", reframe: "", severity: "high" },
        { keyword: "missing_skill_y", gap: "", reframe: "", severity: "high" },
        { keyword: "missing_skill_z", gap: "", reframe: "", severity: "high" },
      ],
      job_signals: { jobTitle: "Senior Counsel" },
    }),
    "C" as Case,
  )
  check(
    "4: 3 high-sev → mentions first two keywords + 'and others'",
    !!r?.high_severity_gap_summary?.includes("missing_credential_x") &&
      !!r?.high_severity_gap_summary?.includes("missing_skill_y") &&
      !!r?.high_severity_gap_summary?.includes("and others"),
    r?.high_severity_gap_summary,
  )
}

// Test 4b: Case C with exactly 2 high-severity → "X and Y" (no "and others")
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "gap_a", gap: "", reframe: "", severity: "high" },
        { keyword: "gap_b", gap: "", reframe: "", severity: "high" },
      ],
      job_signals: { jobTitle: "PM" },
    }),
    "C" as Case,
  )
  check(
    "4b: 2 high-sev → '... gap_a and gap_b.' (no 'and others')",
    r?.high_severity_gap_summary === "Significant gaps include: gap_a and gap_b.",
    r?.high_severity_gap_summary,
  )
}

// ============================================================================
// Edge cases
// ============================================================================

console.log("\n=== Edge cases ===")

// Test 5: Case A with empty why_structured → generic summary, no keywords
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [],
    }),
    "A" as Case,
  )
  check("5: Case A empty whys returns non-null", r !== null)
  check(
    "5: generic summary (no keyword list)",
    r?.well_positioned_summary === "Your resume already aligns strongly with this role.",
    r?.well_positioned_summary,
  )
  check(
    "5: small_refinements still empty array",
    Array.isArray(r?.small_refinements) && r!.small_refinements!.length === 0,
  )
}

// Test 6: Case C with empty risk_structured → no high_severity_gap_summary, lane_mismatch present
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Pass",
      risk_structured: [],
      job_signals: { jobTitle: "Director" },
    }),
    "C" as Case,
  )
  check(
    "6: Case C with no risks → high_severity_gap_summary is undefined",
    r?.high_severity_gap_summary === undefined,
    String(r?.high_severity_gap_summary),
  )
  check(
    "6: inferred_lane_mismatch still produced",
    r?.inferred_lane_mismatch?.job_asking_for === "Director",
  )
}

// Test 7: Case C with missing jobTitle → job_asking_for falls back to "this role"
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Pass",
      risk_structured: [
        { keyword: "x", gap: "", reframe: "", severity: "high" },
      ],
      // no job_signals
    }),
    "C" as Case,
  )
  check(
    "7: missing jobTitle → 'this role'",
    r?.inferred_lane_mismatch?.job_asking_for === "this role",
    r?.inferred_lane_mismatch?.job_asking_for,
  )
}

// Test 7b: Empty jobTitle string → also falls back
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Pass",
      risk_structured: [],
      job_signals: { jobTitle: "   " }, // whitespace-only
    }),
    "C" as Case,
  )
  check(
    "7b: whitespace-only jobTitle → 'this role'",
    r?.inferred_lane_mismatch?.job_asking_for === "this role",
    r?.inferred_lane_mismatch?.job_asking_for,
  )
}

// Test 8a: Malformed jobfit for Case A → minimal valid Case A object
{
  const r = generateCaseSpecific(
    {
      jobfit: undefined as unknown as JobfitResultJson,
      targeting: null,
      careerStage: "mid_career",
    },
    "A" as Case,
  )
  check("8a: Case A with missing jobfit returns non-null", r !== null)
  check(
    "8a: generic summary on missing data",
    r?.well_positioned_summary === "Your resume already aligns strongly with this role.",
  )
  check(
    "8a: small_refinements is empty array",
    Array.isArray(r?.small_refinements) && r!.small_refinements!.length === 0,
  )
}

// Test 8b: Malformed jobfit for Case B → still null
{
  const r = generateCaseSpecific(
    {
      jobfit: null as unknown as JobfitResultJson,
      targeting: null,
      careerStage: "mid_career",
    },
    "B" as Case,
  )
  check("8b: Case B with null jobfit → null", r === null, String(r))
}

// Test 8c: Malformed jobfit for Case C → lane_mismatch with "this role", no gap summary
{
  const r = generateCaseSpecific(
    {
      jobfit: undefined as unknown as JobfitResultJson,
      targeting: null,
      careerStage: "mid_career",
    },
    "C" as Case,
  )
  check("8c: Case C with missing jobfit returns non-null", r !== null)
  check(
    "8c: job_asking_for = 'this role'",
    r?.inferred_lane_mismatch?.job_asking_for === "this role",
  )
  check(
    "8c: high_severity_gap_summary omitted",
    r?.high_severity_gap_summary === undefined,
  )
}

// Test 9: Case C with all medium/low risks → no high_severity_gap_summary
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "m1", gap: "", reframe: "", severity: "medium" },
        { keyword: "l1", gap: "", reframe: "", severity: "low" },
      ],
      job_signals: { jobTitle: "Analyst" },
    }),
    "C" as Case,
  )
  check(
    "9: no high-sev → high_severity_gap_summary undefined",
    r?.high_severity_gap_summary === undefined,
  )
  check(
    "9: lane_mismatch still present",
    r?.inferred_lane_mismatch?.job_asking_for === "Analyst",
  )
}

// ============================================================================
// Pattern / additional defensive tests
// ============================================================================

console.log("\n=== Pattern checks ===")

// Test 10: Case B returns exactly null (not empty object)
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "x", gap: "", reframe: "", severity: "low" },
      ],
      why_structured: [
        { keyword: "y", lead: "", connection: "", action: "" },
      ],
    }),
    "B" as Case,
  )
  check("10: Case B === null (not {})", r === null && r !== ({} as unknown))
}

// Test 11: Case A with 4+ whys → only top 3 used in summary
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [
        { keyword: "kw_one", lead: "", connection: "", action: "" },
        { keyword: "kw_two", lead: "", connection: "", action: "" },
        { keyword: "kw_three", lead: "", connection: "", action: "" },
        { keyword: "kw_four", lead: "", connection: "", action: "" },
      ],
    }),
    "A" as Case,
  )
  check(
    "11: 4+ whys → summary mentions kw_one, kw_two, kw_three",
    !!r?.well_positioned_summary?.includes("kw_one") &&
      !!r?.well_positioned_summary?.includes("kw_two") &&
      !!r?.well_positioned_summary?.includes("kw_three"),
  )
  check(
    "11: 4+ whys → summary does NOT mention kw_four",
    !r?.well_positioned_summary?.includes("kw_four"),
    r?.well_positioned_summary,
  )
}

// Test 12: Case C with 1 high-sev but empty gap → fallback template
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Review",
      risk_structured: [
        { keyword: "credential_gap", gap: "", reframe: "", severity: "high" },
      ],
      job_signals: { jobTitle: "Specialist" },
    }),
    "C" as Case,
  )
  check(
    "12: empty gap → 'The most significant gap: credential_gap.'",
    r?.high_severity_gap_summary === "The most significant gap: credential_gap.",
    r?.high_severity_gap_summary,
  )
}

// Test 13: Case C with 1 high-sev, gap already ends with period → no double period
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Review",
      risk_structured: [
        {
          keyword: "skill_x",
          gap: "candidate lacks Python experience.",
          reframe: "",
          severity: "high",
        },
      ],
      job_signals: { jobTitle: "Engineer" },
    }),
    "C" as Case,
  )
  check(
    "13: gap with trailing period → single period in summary",
    r?.high_severity_gap_summary === "The most significant gap is in skill_x: candidate lacks Python experience.",
    r?.high_severity_gap_summary,
  )
}

// Test 14: Case A with some empty-keyword whys → skips them, uses next valid
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Apply",
      risk_structured: [],
      why_structured: [
        { keyword: "", lead: "", connection: "", action: "" },
        { keyword: "valid_one", lead: "", connection: "", action: "" },
        { keyword: "", lead: "", connection: "", action: "" },
        { keyword: "valid_two", lead: "", connection: "", action: "" },
        { keyword: "valid_three", lead: "", connection: "", action: "" },
      ],
    }),
    "A" as Case,
  )
  check(
    "14: empty-keyword whys filtered → top 3 are valid_one, valid_two, valid_three",
    !!r?.well_positioned_summary?.includes("valid_one") &&
      !!r?.well_positioned_summary?.includes("valid_two") &&
      !!r?.well_positioned_summary?.includes("valid_three"),
    r?.well_positioned_summary,
  )
}

// Test 15: Case C with high-sev risks that have empty keywords → filtered, fall back if all blank
{
  const r = generateCaseSpecific(
    makeInputs({
      decision: "Pass",
      risk_structured: [
        { keyword: "", gap: "something", reframe: "", severity: "high" },
        { keyword: "   ", gap: "", reframe: "", severity: "high" },
      ],
      job_signals: { jobTitle: "VP" },
    }),
    "C" as Case,
  )
  check(
    "15: all high-sev keywords blank → high_severity_gap_summary omitted",
    r?.high_severity_gap_summary === undefined,
    String(r?.high_severity_gap_summary),
  )
  check(
    "15: lane_mismatch still produced",
    r?.inferred_lane_mismatch?.job_asking_for === "VP",
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
