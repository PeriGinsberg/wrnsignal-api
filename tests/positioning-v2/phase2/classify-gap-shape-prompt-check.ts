// tests/positioning-v2/phase2/classify-gap-shape-prompt-check.ts
//
// Light prompt-sanity checks for buildClassifyGapShapePrompt. Asserts the
// prompt structure load-bearing for Claude's classification:
//   - all 7 shape names appear
//   - JSON output contract is explicit
//   - example phrases for each shape are present
//   - escape hatch (return {"shape":"unknown"}) is present
//
// Run: npx tsx tests/positioning-v2/phase2/classify-gap-shape-prompt-check.ts
// Exits 1 on any failure.

import {
  buildClassifyGapShapePrompt,
  MAX_TOKENS_CLASSIFY_GAP_SHAPE,
} from "@/lib/positioning/v2/phase2/prompts/classifyGapShapePrompt"

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

const prompt = buildClassifyGapShapePrompt({
  gapDescription: "test gap description for the prompt sanity check",
  jdContext: "test jd context for the prompt sanity check",
})

// ============================================================================
// All 7 shape names appear
// ============================================================================

console.log("=== All seven shapes named ===")

const shapes = [
  "experience",
  "skill",
  "certification",
  "tool",
  "language",
  "coursework",
  "unknown",
] as const

for (const s of shapes) {
  check(`prompt mentions shape '${s}'`, prompt.includes(s))
}

// ============================================================================
// JSON output contract
// ============================================================================

console.log("\n=== JSON output contract ===")

check(
  "prompt instructs strict JSON output",
  /strict json/i.test(prompt),
)
check(
  "prompt shows the {\"shape\": ...} response shape",
  prompt.includes('{"shape":'),
)
check(
  "prompt explicitly forbids markdown fences",
  /no markdown/i.test(prompt) || /no fences/i.test(prompt),
)

// ============================================================================
// Inputs flow through verbatim
// ============================================================================

console.log("\n=== Inputs interpolate ===")

check(
  "gap_description value appears verbatim",
  prompt.includes("test gap description for the prompt sanity check"),
)
check(
  "jd_context value appears verbatim",
  prompt.includes("test jd context for the prompt sanity check"),
)

// ============================================================================
// Escape hatch
// ============================================================================

console.log("\n=== Escape hatch present ===")

check(
  "prompt shows unknown-fallback shape '{\"shape\": \"unknown\"}'",
  prompt.includes('{"shape": "unknown"}'),
)
check(
  "prompt frames 'cannot confidently' as the unknown-trigger",
  /cannot confidently/i.test(prompt),
)

// ============================================================================
// Token budget sanity
// ============================================================================

console.log("\n=== Token budget ===")

check(
  "MAX_TOKENS_CLASSIFY_GAP_SHAPE is a small positive number",
  MAX_TOKENS_CLASSIFY_GAP_SHAPE > 0 && MAX_TOKENS_CLASSIFY_GAP_SHAPE <= 200,
  String(MAX_TOKENS_CLASSIFY_GAP_SHAPE),
)

// ============================================================================
console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")
