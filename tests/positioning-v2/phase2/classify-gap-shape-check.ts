// tests/positioning-v2/phase2/classify-gap-shape-check.ts
//
// Unit checks for the G1 hybrid gap-shape classifier orchestrator. Plain
// tsx, no DB / live LLM. Covers each of the six decision passes
// (heuristic-only outcomes) plus the LLM fallback paths, the cost-cap
// short-circuit, and defensive inputs.
//
// Run: npx tsx tests/positioning-v2/phase2/classify-gap-shape-check.ts
// Exits 1 on any failure.

import {
  classifyGapShape,
  type ClassifyGapShapeAiImpl,
} from "@/lib/positioning/v2/phase2/itemPopulatorParts/classifyGapShape"
import type { GapCandidate } from "@/lib/positioning/v2/phase2/itemPopulatorParts/types"
import type { GapShape } from "@/lib/positioning/v2/phase2/types"

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

/**
 * Build a GapCandidate with the fields the classifier reads. Default
 * values are neutral so caller-supplied overrides drive the test.
 */
function gap(overrides: Partial<GapCandidate> = {}): GapCandidate {
  return {
    gap_description: overrides.gap_description ?? "",
    jd_context: overrides.jd_context ?? "",
    keyword: overrides.keyword ?? "test_key",
    kind: overrides.kind ?? "function",
    gap_shape: overrides.gap_shape ?? "unknown",
  }
}

/**
 * Mock LLM impl that returns a fixed shape and a small token usage so
 * cents-for-usage rounds to a non-zero amount (Math.ceil ensures any
 * fractional cent rounds up to 1).
 */
function aiReturns(
  shape: GapShape,
  usage = { input_tokens: 200, output_tokens: 10 },
): { impl: ClassifyGapShapeAiImpl; calls: { count: number } } {
  const calls = { count: 0 }
  const impl: ClassifyGapShapeAiImpl = async () => {
    calls.count++
    return { shape, usage }
  }
  return { impl, calls }
}

/**
 * Mock LLM impl that throws to exercise the orchestrator's
 * graceful-degradation path. Caller passes the simulated error message.
 */
function aiThrows(message: string): {
  impl: ClassifyGapShapeAiImpl
  calls: { count: number }
} {
  const calls = { count: 0 }
  const impl: ClassifyGapShapeAiImpl = async () => {
    calls.count++
    throw new Error(message)
  }
  return { impl, calls }
}

async function main(): Promise<void> {

// ============================================================================
// PASS 1 — HIGH confidence text patterns (no LLM)
// ============================================================================

console.log("=== PASS 1 — text-pattern HIGH confidence (no LLM) ===")

{
  const { impl, calls } = aiReturns("experience")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "PMP certified" }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("1a: 'PMP certified' → certification", r.shape === "certification", r.shape)
  check("1a: no LLM call (high confidence)", calls.count === 0 && !r.llmCalled)
  check("1a: aiCostCents === 0", r.aiCostCents === 0)
}

{
  const r = await classifyGapShape({
    candidate: gap({
      gap_description: "AWS Certified Solutions Architect",
    }),
    aiAllowed: true,
  })
  check("1b: 'AWS Certified ...' → certification", r.shape === "certification", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "Series 7 license required" }),
    aiAllowed: true,
  })
  check("1c: 'Series 7' → certification", r.shape === "certification", r.shape)
}

{
  // Generic "certified" regex hit even when no specific credential
  // appears in the curated list.
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "Must be certified in some industry framework" }),
    aiAllowed: true,
  })
  check("1d: generic /certified/ regex → certification", r.shape === "certification", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "Spanish fluency required" }),
    aiAllowed: true,
  })
  check("1e: 'Spanish fluency' → language", r.shape === "language", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "Bilingual Mandarin preferred" }),
    aiAllowed: true,
  })
  check("1f: 'bilingual Mandarin' → language", r.shape === "language", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "Salesforce administration experience" }),
    aiAllowed: true,
  })
  check("1g: 'Salesforce' → tool", r.shape === "tool", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "Power BI dashboards" }),
    aiAllowed: true,
  })
  check("1h: 'Power BI' → tool", r.shape === "tool", r.shape)
}

// ============================================================================
// PASS 2 — kind-signal MEDIUM-HIGH confidence (no LLM)
// ============================================================================

console.log("\n=== PASS 2 — kind-signal MEDIUM-HIGH confidence (no LLM) ===")

{
  const { impl, calls } = aiReturns("experience")
  // No text-pattern hit; kind === "tool" drives PASS 2.
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "proprietary internal platform", kind: "tool" }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("2a: kind='tool' → tool", r.shape === "tool", r.shape)
  check("2a: no LLM call", calls.count === 0)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "cross-functional partnership", kind: "stakeholder" }),
    aiAllowed: true,
  })
  check("2b: kind='stakeholder' → experience", r.shape === "experience", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "regulated industry context", kind: "environment" }),
    aiAllowed: true,
  })
  check("2c: kind='environment' → experience", r.shape === "experience", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "quarterly board reporting", kind: "deliverable" }),
    aiAllowed: true,
  })
  check("2d: kind='deliverable' → experience", r.shape === "experience", r.shape)
}

// ============================================================================
// PASS 3 — verb + scope MEDIUM confidence (no LLM)
// ============================================================================

console.log("\n=== PASS 3 — verb+scope MEDIUM confidence (no LLM) ===")

{
  const { impl, calls } = aiReturns("skill")
  const r = await classifyGapShape({
    candidate: gap({
      gap_description: "managed cross-functional teams for 5 years",
      kind: "function",
    }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("3a: verb + duration → experience", r.shape === "experience", r.shape)
  check("3a: no LLM call", calls.count === 0)
}

{
  const r = await classifyGapShape({
    candidate: gap({
      gap_description: "led a team of 10 analysts",
      kind: "function",
    }),
    aiAllowed: true,
  })
  check("3b: 'led' + scale (team of 10) → experience", r.shape === "experience", r.shape)
}

{
  const r = await classifyGapShape({
    candidate: gap({
      gap_description: "drove $5M in pipeline growth",
      kind: "function",
    }),
    aiAllowed: true,
  })
  check("3c: 'drove' + $5M → experience", r.shape === "experience", r.shape)
}

{
  // Duration alone (no verb) still implies experience-shaped.
  const r = await classifyGapShape({
    candidate: gap({
      gap_description: "3+ years stakeholder management",
      kind: "function",
    }),
    aiAllowed: true,
  })
  check("3d: duration alone → experience", r.shape === "experience", r.shape)
}

// ============================================================================
// PASS 4/5 — LOW confidence (LLM verifies)
// ============================================================================

console.log("\n=== PASS 4/5 — LOW confidence (LLM verifies) ===")

{
  // Short skill noun phrase → tentative "skill" → LLM verifies.
  const { impl, calls } = aiReturns("skill")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "data analysis", kind: "function" }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("4a: short noun phrase → LLM called", calls.count === 1)
  check("4a: LLM result accepted → skill", r.shape === "skill", r.shape)
  check("4a: aiCostCents > 0", r.aiCostCents > 0, String(r.aiCostCents))
  check("4a: llmCalled === true", r.llmCalled === true)
}

{
  // PASS 5: coursework lead phrase → tentative "coursework" → LLM verifies.
  const { impl, calls } = aiReturns("coursework")
  const r = await classifyGapShape({
    candidate: gap({
      gap_description: "familiarity with econometric methods",
      kind: "function",
    }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("5a: 'familiarity with' → LLM called", calls.count === 1)
  check("5a: LLM result accepted → coursework", r.shape === "coursework", r.shape)
}

{
  // LLM disagrees with heuristic tentative shape → LLM wins.
  const { impl } = aiReturns("tool")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "compliance frameworks", kind: "function" }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check(
    "4b: LLM overrides heuristic tentative shape (skill → tool)",
    r.shape === "tool",
    r.shape,
  )
}

{
  // LLM returns "unknown" on a PASS 4 tentative → fall back to heuristic
  // tentative shape ("skill").
  const { impl, calls } = aiReturns("unknown")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "team dynamics", kind: "function" }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("4c: LLM returned unknown → heuristic tentative used", r.shape === "skill", r.shape)
  check("4c: LLM was still called", calls.count === 1 && r.llmCalled)
  // Cost is still tracked — the API call happened.
  check("4c: aiCostCents > 0 even with unknown result", r.aiCostCents > 0)
}

// ============================================================================
// PASS 6 — UNCLASSIFIED (LLM required, "experience" default on failure)
// ============================================================================

console.log("\n=== PASS 6 — UNCLASSIFIED (LLM required) ===")

{
  // Long description (≥ 8 words), no verb, no duration, no patterns,
  // kind="function" → unclassified → LLM called.
  const { impl, calls } = aiReturns("experience")
  const r = await classifyGapShape({
    candidate: gap({
      gap_description:
        "deep understanding of multi-stakeholder ecosystems within consumer media verticals across emerging markets",
      kind: "function",
    }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("6a: long ambiguous description → LLM called", calls.count === 1)
  check("6a: LLM result accepted → experience", r.shape === "experience", r.shape)
}

{
  // Empty gap_description (no patterns possible) → unclassified.
  const { impl } = aiReturns("skill")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "", kind: "execution" }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("6b: empty description, kind='execution' → LLM consulted", r.shape === "skill", r.shape)
}

{
  // LLM returned "unknown" on a PASS 6 unclassified → fall back to
  // "experience" (the heuristic's PASS 6 default).
  const { impl, calls } = aiReturns("unknown")
  const r = await classifyGapShape({
    candidate: gap({
      gap_description:
        "extensive familiarity navigating large regulated organizations and adjacent partner networks",
      kind: "domain",
    }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check(
    "6c: PASS 6 + LLM unknown → fall back to 'experience' default",
    r.shape === "experience",
    r.shape,
  )
  check("6c: LLM was called", calls.count === 1)
}

{
  // LLM throws → fall back to heuristic's tentative shape (experience
  // for PASS 6).
  const { impl, calls } = aiThrows("simulated Anthropic 500")
  const r = await classifyGapShape({
    candidate: gap({
      gap_description:
        "extensive familiarity navigating large regulated organizations and adjacent partner networks",
      kind: "function",
    }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check("6d: LLM threw → orchestrator does not throw", true)
  check("6d: shape falls back to 'experience' (PASS 6 default)", r.shape === "experience", r.shape)
  check("6d: aiCostCents === 0 (failed call not billed)", r.aiCostCents === 0)
  check("6d: llmCalled === true (attempted)", r.llmCalled === true)
  check("6d: aiThrows mock fired", calls.count === 1)
}

// ============================================================================
// Cost-cap behavior — aiAllowed=false short-circuits LLM
// ============================================================================

console.log("\n=== Cost-cap: aiAllowed=false ===")

{
  // PASS 4 tentative + aiAllowed=false → LLM skipped, heuristic tentative
  // returned as-is.
  const { impl, calls } = aiReturns("tool")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "data analysis", kind: "function" }),
    aiAllowed: false,
    aiImpl: impl,
  })
  check("cap-1: aiAllowed=false → LLM skipped on PASS 4", calls.count === 0)
  check("cap-1: heuristic tentative ('skill') returned as final", r.shape === "skill", r.shape)
  check("cap-1: aiCostCents === 0", r.aiCostCents === 0)
  check("cap-1: llmCalled === false", r.llmCalled === false)
}

{
  // PASS 6 unclassified + aiAllowed=false → "experience" default.
  // Description engineered to dodge every heuristic pass:
  //   - no certification keywords or /certified/ regex
  //   - no language names + cues paired
  //   - no curated tool keywords
  //   - kind='function' (not "tool", "deliverable", "stakeholder", "environment")
  //   - no experience verb + duration / scale combo
  //   - no coursework leading phrases ("familiarity with", "exposure to", etc.)
  //   - ≥ 8 words so PASS 4 short-noun-phrase rule doesn't fire
  const { impl, calls } = aiReturns("tool")
  const r = await classifyGapShape({
    candidate: gap({
      gap_description:
        "comprehensive operational depth across multinational consumer media organizations and adjacent ecosystem partners",
      kind: "function",
    }),
    aiAllowed: false,
    aiImpl: impl,
  })
  check("cap-2: aiAllowed=false on PASS 6 → LLM skipped", calls.count === 0)
  check("cap-2: shape = 'experience' (PASS 6 default)", r.shape === "experience", r.shape)
}

{
  // High-confidence heuristic + aiAllowed=false → still no LLM regardless
  // (heuristic alone is sufficient).
  const { impl, calls } = aiReturns("skill")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "PMP certified" }),
    aiAllowed: false,
    aiImpl: impl,
  })
  check("cap-3: high-confidence still no LLM with aiAllowed=false", calls.count === 0)
  check("cap-3: shape = 'certification'", r.shape === "certification")
}

// ============================================================================
// Defensive — empty / wrong-type inputs
// ============================================================================

console.log("\n=== Defensive ===")

{
  // Empty everything + aiAllowed=false → "experience" PASS 6 default.
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "", jd_context: "", kind: "" }),
    aiAllowed: false,
  })
  check("def-1: empty inputs + aiAllowed=false → 'experience'", r.shape === "experience", r.shape)
}

{
  // jd_context-only certification keyword still fires PASS 1 (helpful
  // when gap_description is generic but jd_context spells out the
  // credential).
  const r = await classifyGapShape({
    candidate: gap({
      gap_description: "credentialed practitioner",
      jd_context: "Active PMP certification required",
      kind: "function",
    }),
    aiAllowed: true,
  })
  check(
    "def-2: certification keyword in jd_context only → certification",
    r.shape === "certification",
    r.shape,
  )
}

{
  // language NAME without proficiency cue → does NOT fire PASS 1 alone
  // (avoids matching "Python", a programming language name we don't
  // want classified as a spoken language). Falls through to PASS 4
  // (short noun phrase → LLM).
  const { impl, calls } = aiReturns("skill")
  const r = await classifyGapShape({
    candidate: gap({ gap_description: "Spanish", kind: "function" }),
    aiAllowed: true,
    aiImpl: impl,
  })
  check(
    "def-3: bare 'Spanish' (no cue) does NOT auto-classify as language",
    r.shape !== "language",
    r.shape,
  )
  check("def-3: falls through to LLM (PASS 4 tentative)", calls.count === 1)
}

// ============================================================================
console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")

}

main().catch((e) => {
  console.error("Unhandled error in main():", e)
  process.exit(1)
})
