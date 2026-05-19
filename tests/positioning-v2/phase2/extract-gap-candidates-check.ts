// tests/positioning-v2/phase2/extract-gap-candidates-check.ts
//
// Unit checks for extractGapCandidates.
//
// Run: npx tsx tests/positioning-v2/phase2/extract-gap-candidates-check.ts
// Exits 1 on any failure.

import { extractGapCandidates } from "@/lib/positioning/v2/phase2/itemPopulatorParts/extractGapCandidates"
import type { JobfitResultJson } from "@/lib/positioning/v2/types"
import {
  CATHERINE_JOBFIT_WITH_UNITS,
  CATHERINE_RESUME_SLICE,
  REQ_CORE_FINANCIAL_ANALYSIS,
  REQ_SUPPORTING_OPERATIONS_EXECUTION,
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
  // The Catherine slice contains "audience" and "analyses" (plural) but
  // NOT "financial", "analysis" (singular), "investment", or "work" — and
  // the substring "financial_analysis" doesn't appear. So the financial
  // requirement is NOT represented and should emit a candidate. The other
  // two requirement_units are supporting — should be skipped.
  const candidates = extractGapCandidates(
    CATHERINE_JOBFIT_WITH_UNITS,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "1: emits 1 candidate (financial_analysis; supporting units skipped)",
    candidates.length === 1,
    `got ${candidates.length}: [${candidates.map((c) => c.keyword).join(", ")}]`,
  )
  const c = candidates[0]
  check(
    "1: candidate.keyword = financial_analysis",
    c?.keyword === REQ_CORE_FINANCIAL_ANALYSIS.key,
    c?.keyword,
  )
  check(
    "1: candidate.gap_description = requirement.label",
    c?.gap_description === REQ_CORE_FINANCIAL_ANALYSIS.label,
  )
  check(
    "1: candidate.jd_context = requirement.snippet",
    c?.jd_context === REQ_CORE_FINANCIAL_ANALYSIS.snippet,
  )
}

// ============================================================================
// Requiredness filter
// ============================================================================

console.log("\n=== Requiredness filter ===")

{
  const jobfit = {
    job_signals: { requirement_units: [REQ_SUPPORTING_OPERATIONS_EXECUTION] },
  } as unknown as JobfitResultJson
  const candidates = extractGapCandidates(jobfit, "completely unrelated resume")
  check(
    "2: supporting requirement → skipped",
    candidates.length === 0,
  )
}

{
  // Mixed: 1 core, 2 supporting. Only core (not in resume) should emit.
  const candidates = extractGapCandidates(
    CATHERINE_JOBFIT_WITH_UNITS,
    "completely unrelated marketing strategy",
  )
  check(
    "3: mixed requiredness → only core emits",
    candidates.length === 1 && candidates[0].keyword === "financial_analysis",
    `got: [${candidates.map((c) => c.keyword).join(", ")}]`,
  )
}

{
  // requiredness can be any string; only "core" passes.
  const jobfit = {
    job_signals: {
      requirement_units: [
        { ...REQ_CORE_FINANCIAL_ANALYSIS, requiredness: "preferred" },
      ],
    },
  } as unknown as JobfitResultJson
  check(
    "4: requiredness='preferred' (not 'core') → skipped",
    extractGapCandidates(jobfit, "unrelated").length === 0,
  )
}

// ============================================================================
// Represented-in-resume — Path (a): key substring
// ============================================================================

console.log("\n=== Represented (Path a: key substring) ===")

{
  // Path (a): raw "financial_analysis" substring in resume
  const jobfit = {
    job_signals: { requirement_units: [REQ_CORE_FINANCIAL_ANALYSIS] },
  } as unknown as JobfitResultJson
  const resume = "I have done financial_analysis work before"
  check(
    "5: requirement.key substring in resume → represented → skip",
    extractGapCandidates(jobfit, resume).length === 0,
  )
}

{
  // Case-insensitive key substring match
  const jobfit = {
    job_signals: { requirement_units: [REQ_CORE_FINANCIAL_ANALYSIS] },
  } as unknown as JobfitResultJson
  const resume = "FINANCIAL_ANALYSIS team lead"
  check(
    "6: key substring match is case-insensitive",
    extractGapCandidates(jobfit, resume).length === 0,
  )
}

// ============================================================================
// Represented-in-resume — Path (b): label token overlap
// ============================================================================

console.log("\n=== Represented (Path b: label token overlap) ===")

{
  // Label = "financial analysis and investment work" → tokens: financial,
  // analysis, investment, work. Resume contains "investment" alone — that's
  // ≥1 token overlap → represented.
  const jobfit = {
    job_signals: { requirement_units: [REQ_CORE_FINANCIAL_ANALYSIS] },
  } as unknown as JobfitResultJson
  const resume = "I performed investment banking summer internship at firm X"
  check(
    "7: ≥1 label token (investment) in resume → represented → skip",
    extractGapCandidates(jobfit, resume).length === 0,
  )
}

{
  // Different label token still triggers represented
  const jobfit = {
    job_signals: { requirement_units: [REQ_CORE_FINANCIAL_ANALYSIS] },
  } as unknown as JobfitResultJson
  const resume = "Strategic financial planning role at firm Y"
  check(
    "8: 'financial' token in resume → represented",
    extractGapCandidates(jobfit, resume).length === 0,
  )
}

{
  // Zero overlap on both paths → NOT represented → candidate emits
  const jobfit = {
    job_signals: { requirement_units: [REQ_CORE_FINANCIAL_ANALYSIS] },
  } as unknown as JobfitResultJson
  const resume = "Completely unrelated marketing strategy projects"
  check(
    "9: zero overlap → NOT represented → candidate emits",
    extractGapCandidates(jobfit, resume).length === 1,
  )
}

{
  // Label tokens "financial", "analysis", "investment", "work" — verify
  // "work" presence in resume blocks the emission. Watch out: many
  // resume words contain "work" as a substring (network, workflow) but
  // tokenize splits on non-alphanumeric, so "network" → "network" not "work".
  // "workflow" is the same: a single token "workflow", not "work".
  // To trigger blocking on "work" we need a standalone "work" token.
  const jobfit = {
    job_signals: { requirement_units: [REQ_CORE_FINANCIAL_ANALYSIS] },
  } as unknown as JobfitResultJson
  const resume = "Coursework includes work on consumer products"
  check(
    "10: standalone 'work' token in resume → represented",
    extractGapCandidates(jobfit, resume).length === 0,
  )
}

{
  // "workflow" tokenizes as one token "workflow", which doesn't match "work".
  // So a resume with "workflow" but no standalone "work" / "financial" /
  // "analysis" / "investment" tokens is NOT represented.
  const jobfit = {
    job_signals: { requirement_units: [REQ_CORE_FINANCIAL_ANALYSIS] },
  } as unknown as JobfitResultJson
  const resume = "Optimized workflow for marketing campaigns"
  check(
    "11: 'workflow' does NOT match 'work' (token-level, not substring)",
    extractGapCandidates(jobfit, resume).length === 1,
    `got ${extractGapCandidates(jobfit, resume).length}`,
  )
}

// ============================================================================
// Defensive
// ============================================================================

console.log("\n=== Defensive ===")

{
  check(
    "12: null jobfit → []",
    extractGapCandidates(null, CATHERINE_RESUME_SLICE).length === 0,
  )
}

{
  check(
    "13: undefined jobfit → []",
    extractGapCandidates(undefined, CATHERINE_RESUME_SLICE).length === 0,
  )
}

{
  check(
    "14: empty jobfit → []",
    extractGapCandidates({}, CATHERINE_RESUME_SLICE).length === 0,
  )
}

{
  const jobfit = {
    job_signals: { requirement_units: "not an array" },
  } as unknown as JobfitResultJson
  check(
    "15: wrong-type requirement_units → []",
    extractGapCandidates(jobfit, CATHERINE_RESUME_SLICE).length === 0,
  )
}

{
  check(
    "16: missing job_signals → []",
    extractGapCandidates(
      { decision: "Apply" } as JobfitResultJson,
      CATHERINE_RESUME_SLICE,
    ).length === 0,
  )
}

{
  // null resumeText → safeResume = "" → nothing represented → all core
  // requirements emit.
  const candidates = extractGapCandidates(CATHERINE_JOBFIT_WITH_UNITS, null)
  check(
    "17: null resumeText → core requirements emit (1 in fixture)",
    candidates.length === 1 && candidates[0].keyword === "financial_analysis",
  )
}

{
  // undefined resumeText → same path as null
  const candidates = extractGapCandidates(CATHERINE_JOBFIT_WITH_UNITS, undefined)
  check(
    "18: undefined resumeText → core requirements emit (1 in fixture)",
    candidates.length === 1,
  )
}

{
  // Malformed unit — wrong-type key field → entry skipped silently
  const jobfit = {
    job_signals: {
      requirement_units: [
        { key: 42, label: "x", snippet: "y", requiredness: "core" },
        {
          key: "good_key",
          label: "good label here",
          snippet: "good snippet",
          requiredness: "core",
        },
      ],
    },
  } as unknown as JobfitResultJson
  const candidates = extractGapCandidates(jobfit, "completely unrelated resume")
  check(
    "19: wrong-type key field → entry skipped; valid entry still emits",
    candidates.length === 1 && candidates[0].keyword === "good_key",
  )
}

{
  // Missing required field — entry skipped
  const jobfit = {
    job_signals: {
      requirement_units: [
        { key: "k", label: "l", requiredness: "core" }, // missing snippet
        { key: "k", snippet: "s", requiredness: "core" }, // missing label
        { label: "l", snippet: "s", requiredness: "core" }, // missing key
      ],
    },
  } as unknown as JobfitResultJson
  check(
    "20: entries with missing key/label/snippet → all skipped",
    extractGapCandidates(jobfit, "unrelated resume").length === 0,
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
