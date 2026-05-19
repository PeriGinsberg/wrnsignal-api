// tests/positioning-v2/phase2/extract-headline-candidate-check.ts
//
// Unit checks for extractHeadlineCandidate (Phase 2 v1 build A1).
//
// Three-outcome emission rule:
//   1. Replace path  — resume has a detectable headline block.
//   2. Synthesize    — no headline + RISK_FAMILY_MISMATCH in risk_codes.
//   3. Null emission — no headline + no synthesize-trigger.
//
// Run: npx tsx tests/positioning-v2/phase2/extract-headline-candidate-check.ts
// Exits 1 on any failure.

import { extractHeadlineCandidate } from "@/lib/positioning/v2/phase2/itemPopulatorParts/extractHeadlineCandidate"
import type { JobfitResultJson } from "@/lib/positioning/v2/types"
import {
  CATHERINE_JOBFIT,
  CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH,
  CATHERINE_RESUME_HEADLINE_BLOCK,
  CATHERINE_RESUME_NO_HEADLINE,
  CATHERINE_RESUME_TEXT,
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
// Test 1 — Replace path against real Catherine (live persona v3)
// ============================================================================

console.log("=== Replace path (Catherine v3, real resume) ===")

{
  const c = extractHeadlineCandidate(CATHERINE_JOBFIT, CATHERINE_RESUME_TEXT)
  check("1: non-null candidate", c !== null)
  check("1: kind === 'replace'", c?.kind === "replace", c?.kind)
  if (c?.kind === "replace") {
    check(
      "1: original starts with 'Strategic Communication junior'",
      c.original.startsWith("Strategic Communication junior"),
      c.original.slice(0, 60),
    )
    check(
      "1: original equals the full 3-sentence headline block",
      c.original === CATHERINE_RESUME_HEADLINE_BLOCK,
      `len=${c.original.length} (expected ${CATHERINE_RESUME_HEADLINE_BLOCK.length})`,
    )
    check(
      "1: verbatim invariant — resumeText.includes(candidate.original)",
      CATHERINE_RESUME_TEXT.includes(c.original),
    )
  }
  check(
    "1: jobTitle pulled from job_signals.jobTitle",
    c?.jobTitle ===
      "Versant Internship Program - Corporate Finance, Analytics & Human Resources",
    c?.jobTitle?.slice(0, 60),
  )
  check(
    "1: jobFamily === 'HR'",
    c?.jobFamily === "HR",
    c?.jobFamily ?? "null",
  )
  check(
    "1: topWhyKeywords[0] === first why's keyword",
    c?.topWhyKeywords[0] === WHY_REFRAME_FLAVORED.keyword,
    c?.topWhyKeywords[0],
  )
  check(
    "1: topWhyKeywords.length === 3",
    Array.isArray(c?.topWhyKeywords) && c.topWhyKeywords.length === 3,
    String(c?.topWhyKeywords.length),
  )
}

// ============================================================================
// Test 2 — Multi-sentence headline captured as a single block
// ============================================================================

console.log("\n=== Multi-sentence headline (same fixture, content shape) ===")

{
  const c = extractHeadlineCandidate(CATHERINE_JOBFIT, CATHERINE_RESUME_TEXT)
  if (c?.kind === "replace") {
    // Three sentences, all in one captured block (single physical line in
    // the source resume, but the assertion verifies all three are present).
    check(
      "2: original contains sentence 1 ('strong skills in visual storytelling')",
      c.original.includes("strong skills in visual storytelling"),
    )
    check(
      "2: original contains sentence 2 ('Experienced in editorial photography')",
      c.original.includes("Experienced in editorial photography"),
    )
    check(
      "2: original contains sentence 3 ('Seeking a creative internship')",
      c.original.includes("Seeking a creative internship"),
    )
    check(
      "2: original ends with 'entertainment marketing.'",
      c.original.endsWith("entertainment marketing."),
    )
  } else {
    check("2: candidate is replace-kind (prereq for content checks)", false, c?.kind)
  }
}

// ============================================================================
// Test 3 — Synthesize path: no headline + family mismatch
// ============================================================================

console.log("\n=== Synthesize path (no headline, RISK_FAMILY_MISMATCH present) ===")

{
  const c = extractHeadlineCandidate(
    CATHERINE_JOBFIT,
    CATHERINE_RESUME_NO_HEADLINE,
  )
  check("3: non-null candidate", c !== null)
  check("3: kind === 'synthesize'", c?.kind === "synthesize", c?.kind)
  check(
    "3: jobTitle pulled from job_signals.jobTitle",
    c?.jobTitle ===
      "Versant Internship Program - Corporate Finance, Analytics & Human Resources",
  )
  // synthesize variant has no `original` field
  check(
    "3: 'original' is not a property on the synthesize variant",
    c?.kind === "synthesize" && !("original" in c),
  )
}

// ============================================================================
// Test 4 — Null emission: no headline + no family mismatch
// ============================================================================

console.log("\n=== Null emission (no headline + no synthesize-trigger) ===")

{
  const c = extractHeadlineCandidate(
    CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH,
    CATHERINE_RESUME_NO_HEADLINE,
  )
  check(
    "4: returns null (no headline AND no RISK_FAMILY_MISMATCH)",
    c === null,
    c === null ? "null" : JSON.stringify(c),
  )
}

// ============================================================================
// Test 5 — Synthetic SUMMARY-labeled resume → replace path
// ============================================================================

console.log("\n=== Synthetic SUMMARY-labeled resume ===")

{
  const resume = [
    "JANE ANALYST",
    "Boston, MA | jane@example.com | 617-555-0100",
    "",
    "SUMMARY",
    "A driven analyst with proven results in financial modeling and stakeholder reporting.",
    "",
    "EDUCATION",
    "Boston University | B.A. Economics",
  ].join("\n")
  const c = extractHeadlineCandidate(CATHERINE_JOBFIT, resume)
  check("5: non-null candidate", c !== null)
  check("5: kind === 'replace'", c?.kind === "replace", c?.kind)
  if (c?.kind === "replace") {
    check(
      "5: original is the line AFTER SUMMARY (not the SUMMARY header)",
      c.original === "A driven analyst with proven results in financial modeling and stakeholder reporting.",
      c.original,
    )
    check(
      "5: original does NOT contain the 'SUMMARY' header line",
      !c.original.includes("SUMMARY"),
    )
    check(
      "5: verbatim invariant — resume.includes(original)",
      resume.includes(c.original),
    )
  }
}

// ============================================================================
// Test 6 — Defensive: null jobfit
// ============================================================================

console.log("\n=== Defensive paths ===")

{
  check(
    "6a: null jobfit → null",
    extractHeadlineCandidate(null, CATHERINE_RESUME_TEXT) === null,
  )
  check(
    "6b: undefined jobfit → null",
    extractHeadlineCandidate(undefined, CATHERINE_RESUME_TEXT) === null,
  )
  check(
    "6c: wrong-type jobfit (string) → null",
    extractHeadlineCandidate(
      "not an object" as unknown as JobfitResultJson,
      CATHERINE_RESUME_TEXT,
    ) === null,
  )
}

// ============================================================================
// Test 7 — Defensive: null/empty resumeText + family mismatch → synthesize
// ============================================================================

{
  const c1 = extractHeadlineCandidate(CATHERINE_JOBFIT, null)
  check(
    "7a: null resumeText + family mismatch → synthesize",
    c1?.kind === "synthesize",
    c1?.kind,
  )

  const c2 = extractHeadlineCandidate(CATHERINE_JOBFIT, undefined)
  check(
    "7b: undefined resumeText + family mismatch → synthesize",
    c2?.kind === "synthesize",
    c2?.kind,
  )

  const c3 = extractHeadlineCandidate(CATHERINE_JOBFIT, "")
  check(
    "7c: empty resumeText + family mismatch → synthesize",
    c3?.kind === "synthesize",
    c3?.kind,
  )
}

// ============================================================================
// Test 8 — Defensive: null/empty resumeText + NO family mismatch → null
// ============================================================================

{
  const c1 = extractHeadlineCandidate(CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH, null)
  check("8a: null resumeText + no mismatch → null", c1 === null)

  const c2 = extractHeadlineCandidate(CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH, "")
  check("8b: empty resumeText + no mismatch → null", c2 === null)
}

// ============================================================================
// Test 9 — Defensive: missing jobTitle → null
// ============================================================================

{
  const jobfit: JobfitResultJson = {
    job_signals: { jobFamily: "HR" }, // no jobTitle
    risk_codes: [{ code: "RISK_FAMILY_MISMATCH", severity: "medium" }],
  }
  check(
    "9a: missing jobTitle → null (even with family mismatch + valid resume)",
    extractHeadlineCandidate(jobfit, CATHERINE_RESUME_TEXT) === null,
  )

  const jobfit2: JobfitResultJson = { risk_codes: [] }
  check(
    "9b: missing job_signals → null",
    extractHeadlineCandidate(jobfit2, CATHERINE_RESUME_TEXT) === null,
  )

  const jobfit3 = {
    job_signals: { jobTitle: 99 },
  } as unknown as JobfitResultJson
  check(
    "9c: wrong-type jobTitle (number) → null",
    extractHeadlineCandidate(jobfit3, CATHERINE_RESUME_TEXT) === null,
  )

  const jobfit4: JobfitResultJson = { job_signals: { jobTitle: "   " } }
  check(
    "9d: blank-only jobTitle → null",
    extractHeadlineCandidate(jobfit4, CATHERINE_RESUME_TEXT) === null,
  )
}

// ============================================================================
// Test 10 — Defensive: wrong-type risk_codes entries
// ============================================================================

{
  // V4 string entries — supported per the duck-typed reader.
  const jobfit: JobfitResultJson = {
    job_signals: { jobTitle: "Test" },
    risk_codes: ["RISK_FAMILY_MISMATCH"],
  }
  const c = extractHeadlineCandidate(jobfit, "")
  check(
    "10a: V4 string risk_codes ['RISK_FAMILY_MISMATCH'] → synthesize",
    c?.kind === "synthesize",
    c?.kind,
  )

  // Mixed shape: V5 object + V4 string + null entries
  const jobfit2 = {
    job_signals: { jobTitle: "Test" },
    risk_codes: [
      null,
      { /* no .code */ severity: "high" },
      { code: 42 },
      { code: "RISK_OTHER" },
      { code: "RISK_FAMILY_MISMATCH", severity: "medium" },
    ],
  } as unknown as JobfitResultJson
  const c2 = extractHeadlineCandidate(jobfit2, "")
  check(
    "10b: malformed entries skipped; V5 object with .code='RISK_FAMILY_MISMATCH' fires synthesize",
    c2?.kind === "synthesize",
    c2?.kind,
  )

  // risk_codes is not an array → no synthesize trigger
  const jobfit3 = {
    job_signals: { jobTitle: "Test" },
    risk_codes: "not an array",
  } as unknown as JobfitResultJson
  const c3 = extractHeadlineCandidate(jobfit3, "")
  check(
    "10c: wrong-type risk_codes (string) → null (no synthesize trigger)",
    c3 === null,
  )

  // risk_codes contains family-mismatch entry only as V5 object with NO severity
  const jobfit4 = {
    job_signals: { jobTitle: "Test" },
    risk_codes: [{ code: "RISK_FAMILY_MISMATCH" }],
  } as unknown as JobfitResultJson
  const c4 = extractHeadlineCandidate(jobfit4, "")
  check(
    "10d: V5 object with .code='RISK_FAMILY_MISMATCH' and no severity → synthesize",
    c4?.kind === "synthesize",
    c4?.kind,
  )
}

// ============================================================================
// Test 11 — Universal verbatim invariant pin across all replace results
// ============================================================================

console.log("\n=== Universal verbatim invariant (replace-kind only) ===")

{
  // Every replace-kind result this suite produces must satisfy
  // resumeText.includes(candidate.original) === true. We re-check the
  // two replace cases here as a guard against future test edits.
  const r1 = extractHeadlineCandidate(CATHERINE_JOBFIT, CATHERINE_RESUME_TEXT)
  if (r1?.kind === "replace") {
    check(
      "11a: Catherine replace — verbatim invariant",
      CATHERINE_RESUME_TEXT.includes(r1.original),
    )
  }
  const summaryResume = [
    "JANE ANALYST",
    "Boston, MA | jane@example.com | 617-555-0100",
    "",
    "SUMMARY",
    "A driven analyst.",
    "",
    "EDUCATION",
  ].join("\n")
  const r2 = extractHeadlineCandidate(CATHERINE_JOBFIT, summaryResume)
  if (r2?.kind === "replace") {
    check(
      "11b: SUMMARY-labeled replace — verbatim invariant",
      summaryResume.includes(r2.original),
    )
  }
}

// ============================================================================
// Test 12 — Top-3 keyword cap (regression from prior tests)
// ============================================================================

console.log("\n=== Top-3 keyword cap ===")

{
  const jobfit = {
    job_signals: { jobTitle: "X" },
    risk_codes: [{ code: "RISK_FAMILY_MISMATCH", severity: "medium" }],
    why_structured: [
      { keyword: "A", lead: "", connection: "", action: "" },
      { keyword: "B", lead: "", connection: "", action: "" },
      { keyword: "C", lead: "", connection: "", action: "" },
      { keyword: "D", lead: "", connection: "", action: "" },
      { keyword: "E", lead: "", connection: "", action: "" },
    ],
  } as unknown as JobfitResultJson
  const c = extractHeadlineCandidate(jobfit, "")
  check(
    "12: more than 3 whys → slices [0,3) in array order",
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
