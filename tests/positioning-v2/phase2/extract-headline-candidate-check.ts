// tests/positioning-v2/phase2/extract-headline-candidate-check.ts
//
// Unit checks for extractHeadlineCandidate.
//
// Run: npx tsx tests/positioning-v2/phase2/extract-headline-candidate-check.ts
// Exits 1 on any failure.

import { extractHeadlineCandidate } from "@/lib/positioning/v2/phase2/itemPopulatorParts/extractHeadlineCandidate"
import type { JobfitResultJson } from "@/lib/positioning/v2/types"
import { CATHERINE_JOBFIT, WHY_REFRAME_FLAVORED } from "./fixtures"

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
// Happy path
// ============================================================================

console.log("=== Happy path (Catherine fixture) ===")

{
  const c = extractHeadlineCandidate(CATHERINE_JOBFIT)
  check("1: real fixture → non-null candidate", c !== null)
  check(
    "1: jobTitle pulled from job_signals.jobTitle",
    c?.jobTitle ===
      "Versant Internship Program - Corporate Finance, Analytics & Human Resources",
    c?.jobTitle?.slice(0, 60),
  )
  check(
    "1: jobFamily pulled from job_signals.jobFamily",
    c?.jobFamily === "HR",
    c?.jobFamily ?? "null",
  )
  check(
    "1: topWhyKeywords length === 3 (all three real whys)",
    Array.isArray(c?.topWhyKeywords) && c.topWhyKeywords.length === 3,
    JSON.stringify(c?.topWhyKeywords),
  )
  check(
    "1: topWhyKeywords[0] = first why entry's keyword (array order preserved)",
    c?.topWhyKeywords[0] === WHY_REFRAME_FLAVORED.keyword,
    c?.topWhyKeywords[0],
  )
}

// ============================================================================
// Missing fields
// ============================================================================

console.log("\n=== Missing fields ===")

{
  const jobfit: JobfitResultJson = { job_signals: { jobFamily: "HR" } }
  check(
    "2: missing jobTitle → null",
    extractHeadlineCandidate(jobfit) === null,
  )
}

{
  const jobfit: JobfitResultJson = {}
  check(
    "3: missing job_signals → null",
    extractHeadlineCandidate(jobfit) === null,
  )
}

{
  const jobfit: JobfitResultJson = {
    job_signals: { jobTitle: "Marketing Coordinator" },
  }
  const c = extractHeadlineCandidate(jobfit)
  check(
    "4: missing jobFamily → candidate with jobFamily=null",
    c !== null && c.jobTitle === "Marketing Coordinator" && c.jobFamily === null,
  )
}

{
  const jobfit: JobfitResultJson = {
    job_signals: { jobTitle: "X", jobFamily: "Y" },
  }
  const c = extractHeadlineCandidate(jobfit)
  check(
    "5: missing why_structured → candidate with topWhyKeywords=[]",
    c !== null && c.topWhyKeywords.length === 0,
  )
}

{
  const jobfit: JobfitResultJson = { job_signals: { jobTitle: "   " } }
  check(
    "6: blank-only jobTitle → null",
    extractHeadlineCandidate(jobfit) === null,
  )
}

{
  const jobfit: JobfitResultJson = { job_signals: { jobTitle: "Real Title", jobFamily: "   " } }
  const c = extractHeadlineCandidate(jobfit)
  check(
    "7: blank-only jobFamily → jobFamily=null",
    c !== null && c.jobFamily === null,
    c?.jobFamily ?? "null",
  )
}

// ============================================================================
// Wrong-type input
// ============================================================================

console.log("\n=== Wrong-type input ===")

{
  check("8: null jobfit → null", extractHeadlineCandidate(null) === null)
}

{
  check(
    "9: undefined jobfit → null",
    extractHeadlineCandidate(undefined) === null,
  )
}

{
  check(
    "10: wrong-type jobfit (string) → null",
    extractHeadlineCandidate(
      "not an object" as unknown as JobfitResultJson,
    ) === null,
  )
}

{
  const jobfit = {
    job_signals: { jobTitle: "X" },
    why_structured: "not an array",
  } as unknown as JobfitResultJson
  const c = extractHeadlineCandidate(jobfit)
  check(
    "11: wrong-type why_structured (string) → topWhyKeywords=[]",
    c !== null && c.topWhyKeywords.length === 0,
  )
}

{
  const jobfit = {
    job_signals: { jobTitle: "X" },
    why_structured: [
      { keyword: 42, lead: "", connection: "", action: "" },
      { keyword: "GOOD", lead: "", connection: "", action: "" },
    ],
  } as unknown as JobfitResultJson
  const c = extractHeadlineCandidate(jobfit)
  check(
    "12: entries with wrong-type keyword skipped",
    c !== null && JSON.stringify(c.topWhyKeywords) === JSON.stringify(["GOOD"]),
    JSON.stringify(c?.topWhyKeywords),
  )
}

{
  const jobfit = {
    job_signals: { jobTitle: 99 },
  } as unknown as JobfitResultJson
  check(
    "13: wrong-type jobTitle (number) → null",
    extractHeadlineCandidate(jobfit) === null,
  )
}

// ============================================================================
// Top-3 cap
// ============================================================================

console.log("\n=== Top-3 cap ===")

{
  const jobfit = {
    job_signals: { jobTitle: "X" },
    why_structured: [
      { keyword: "A", lead: "", connection: "", action: "" },
      { keyword: "B", lead: "", connection: "", action: "" },
      { keyword: "C", lead: "", connection: "", action: "" },
      { keyword: "D", lead: "", connection: "", action: "" },
      { keyword: "E", lead: "", connection: "", action: "" },
    ],
  } as unknown as JobfitResultJson
  const c = extractHeadlineCandidate(jobfit)
  check(
    "14: more than 3 whys → slices [0,3) in array order",
    c !== null &&
      JSON.stringify(c.topWhyKeywords) === JSON.stringify(["A", "B", "C"]),
    JSON.stringify(c?.topWhyKeywords),
  )
}

{
  // Empty-keyword entries do not count toward the top-3 quota.
  const jobfit = {
    job_signals: { jobTitle: "X" },
    why_structured: [
      { keyword: "", lead: "", connection: "", action: "" },
      { keyword: "A", lead: "", connection: "", action: "" },
      { keyword: "", lead: "", connection: "", action: "" },
      { keyword: "B", lead: "", connection: "", action: "" },
      { keyword: "C", lead: "", connection: "", action: "" },
      { keyword: "D", lead: "", connection: "", action: "" },
    ],
  } as unknown as JobfitResultJson
  const c = extractHeadlineCandidate(jobfit)
  check(
    "15: empty-keyword entries skipped; top-3 = next 3 non-empty",
    c !== null &&
      JSON.stringify(c.topWhyKeywords) === JSON.stringify(["A", "B", "C"]),
    JSON.stringify(c?.topWhyKeywords),
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
