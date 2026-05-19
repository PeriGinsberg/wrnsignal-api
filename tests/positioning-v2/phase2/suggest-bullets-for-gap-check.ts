// tests/positioning-v2/phase2/suggest-bullets-for-gap-check.ts
//
// Unit tests for aiClient.suggestBulletsForGap (Phase 2 v1 build A3).
// Mocks invokeClaude via the invokeClaudeImpl DI hook — no real Anthropic
// calls. Same pattern as ai-client-check.ts.
//
// Coverage:
//   - Happy path: 3 verbatim bullets returned, parsed, kept
//   - Verbatim filter: paraphrased entries dropped
//   - All non-verbatim: graceful degradation to suggestions=[]
//   - Empty array response (model: "no good matches")
//   - Malformed JSON
//   - Missing `drafts` field
//   - Non-string elements filtered
//   - Cap at 3 even if Claude returns more
//   - Defensive: empty resumeText, null/undefined edge cases (via type bypass)
//
// Run: npx tsx tests/positioning-v2/phase2/suggest-bullets-for-gap-check.ts

import { suggestBulletsForGap } from "@/lib/positioning/v2/phase2/aiClient"
import type {
  InvokeClaudeInput,
  InvokeClaudeResult,
} from "@/lib/positioning/v2/phase2/anthropicClient"
import { CATHERINE_RESUME_TEXT } from "./fixtures"

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

// ────────────────────────────────────────────────────────────────────────
// Mock invokeClaude factory (matches ai-client-check.ts convention)
// ────────────────────────────────────────────────────────────────────────

function mockInvoke(
  responseText: string,
  usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 800,
    output_tokens: 60,
  },
): {
  fn: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
  captured: { input?: InvokeClaudeInput; callCount: number }
} {
  const captured: { input?: InvokeClaudeInput; callCount: number } = {
    callCount: 0,
  }
  const fn = async (input: InvokeClaudeInput): Promise<InvokeClaudeResult> => {
    captured.input = input
    captured.callCount++
    return { text: responseText, usage, latencyMs: 31 }
  }
  return { fn, captured }
}

// Three real verbatim substrings of CATHERINE_RESUME_TEXT (L020, L029, L031).
const VERBATIM_1 =
  "Lead photographer for editorial shoots, managing creative direction and execution to engage audiences"
const VERBATIM_2 =
  "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities"
const VERBATIM_3 =
  "Presented findings through a professional client deck and written report"

// ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Sanity guard the verbatim fixtures
  if (
    !CATHERINE_RESUME_TEXT.includes(VERBATIM_1) ||
    !CATHERINE_RESUME_TEXT.includes(VERBATIM_2) ||
    !CATHERINE_RESUME_TEXT.includes(VERBATIM_3)
  ) {
    throw new Error(
      "Fixture corruption: VERBATIM_* strings are not verbatim substrings of CATHERINE_RESUME_TEXT",
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("=== Happy path: 3 verbatim bullets ===")
  {
    const responseText = JSON.stringify({
      drafts: [VERBATIM_1, VERBATIM_2, VERBATIM_3],
    })
    const { fn, captured } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "JD wants Excel proficiency",
      jdContext: "Excel and data analysis required",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check(
      "1: returns 3 suggestions",
      result.suggestions.length === 3,
      `length=${result.suggestions.length}`,
    )
    check(
      "1: suggestions preserve mock-returned order",
      result.suggestions[0] === VERBATIM_1 &&
        result.suggestions[1] === VERBATIM_2 &&
        result.suggestions[2] === VERBATIM_3,
    )
    check(
      "1: every suggestion is verbatim in resumeText",
      result.suggestions.every((s) => CATHERINE_RESUME_TEXT.includes(s)),
    )
    check(
      "1: usage propagated from mock",
      result.usage.input_tokens === 800 && result.usage.output_tokens === 60,
    )
    check(
      "1: temperature is the SUGGEST_BULLETS first-attempt value (0.3)",
      captured.input?.temperature === 0.3,
      `temperature=${captured.input?.temperature}`,
    )
    check(
      "1: maxTokens is MAX_TOKENS_SUGGEST_BULLETS (500)",
      captured.input?.maxTokens === 500,
      `maxTokens=${captured.input?.maxTokens}`,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Verbatim filter: paraphrased entries dropped ===")
  {
    // 2 verbatim + 1 paraphrased ("modified Performed industry...")
    const responseText = JSON.stringify({
      drafts: [
        VERBATIM_1,
        "Slightly modified industry, audience, and SWOT analyses paraphrased here", // not verbatim
        VERBATIM_3,
      ],
    })
    const { fn } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check(
      "2: paraphrased entry filtered → suggestions.length === 2",
      result.suggestions.length === 2,
      `length=${result.suggestions.length}`,
    )
    check(
      "2: surviving entries are VERBATIM_1 and VERBATIM_3 (paraphrase dropped)",
      result.suggestions[0] === VERBATIM_1 &&
        result.suggestions[1] === VERBATIM_3,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== All non-verbatim: suggestions=[] (graceful degradation) ===")
  {
    const responseText = JSON.stringify({
      drafts: [
        "Made-up bullet 1 that isn't in the resume at all",
        "Another invented bullet that isn't there",
        "Third invented paraphrase",
      ],
    })
    const { fn } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check(
      "3: every entry filtered → suggestions === []",
      result.suggestions.length === 0,
    )
    check(
      "3: usage still reported (the call happened, cost is real)",
      result.usage.input_tokens > 0 || result.usage.output_tokens > 0,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Empty array response (model: no good matches) ===")
  {
    const responseText = JSON.stringify({
      drafts: [],
      reason: "insufficient_source_evidence",
    })
    const { fn } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check("4: empty drafts → suggestions === []", result.suggestions.length === 0)
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Malformed JSON ===")
  {
    const { fn } = mockInvoke("not json at all { invalid")
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check(
      "5: malformed JSON → suggestions === [] (parseClaudeResponse defensive)",
      result.suggestions.length === 0,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Missing `drafts` field ===")
  {
    const responseText = JSON.stringify({ wrong_field: ["x", "y"] })
    const { fn } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check(
      "6: missing drafts field → suggestions === []",
      result.suggestions.length === 0,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Non-string elements in drafts array ===")
  {
    // VERBATIM_1 + non-string element + verbatim VERBATIM_2 → 2 surviving
    const responseText = JSON.stringify({
      drafts: [VERBATIM_1, 42, null, VERBATIM_2],
    })
    const { fn } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check(
      "7: non-string elements filtered by parser → 2 verbatim survive",
      result.suggestions.length === 2 &&
        result.suggestions[0] === VERBATIM_1 &&
        result.suggestions[1] === VERBATIM_2,
      JSON.stringify(result.suggestions),
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Cap at 3 even if Claude returns more ===")
  {
    // 5 verbatim entries — should cap at 3 (parser truncates).
    // Build 5 unique verbatim substrings by including the same lines twice
    // and adding two more from the resume.
    const VERBATIM_4 =
      "Designed magazine spreads for digital and print publication"
    const VERBATIM_5 =
      "Developed an integrated PESO communications strategy aligned with brand voice and audience insights"
    if (
      !CATHERINE_RESUME_TEXT.includes(VERBATIM_4) ||
      !CATHERINE_RESUME_TEXT.includes(VERBATIM_5)
    ) {
      throw new Error("Test 8 fixture corruption: VERBATIM_4/5 not in resume")
    }
    const responseText = JSON.stringify({
      drafts: [VERBATIM_1, VERBATIM_2, VERBATIM_3, VERBATIM_4, VERBATIM_5],
    })
    const { fn } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    check(
      "8: 5 verbatim returned → capped at 3",
      result.suggestions.length === 3,
      `length=${result.suggestions.length}`,
    )
    check(
      "8: cap preserves order — keeps first 3",
      result.suggestions[0] === VERBATIM_1 &&
        result.suggestions[1] === VERBATIM_2 &&
        result.suggestions[2] === VERBATIM_3,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Empty resumeText: every candidate fails verbatim filter ===")
  {
    const responseText = JSON.stringify({
      drafts: [VERBATIM_1, VERBATIM_2],
    })
    const { fn } = mockInvoke(responseText)
    const result = await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: "",
      invokeClaudeImpl: fn,
    })
    check(
      "9: empty resumeText → suggestions === [] (no substring matches)",
      result.suggestions.length === 0,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== isRetry flag bumps temperature ===")
  {
    const { fn, captured } = mockInvoke(JSON.stringify({ drafts: [] }))
    await suggestBulletsForGap({
      gapDescription: "G",
      jdContext: "J",
      resumeText: CATHERINE_RESUME_TEXT,
      isRetry: true,
      invokeClaudeImpl: fn,
    })
    check(
      "10: isRetry=true → temperature 0.7 (vs 0.3 first attempt)",
      captured.input?.temperature === 0.7,
      `temperature=${captured.input?.temperature}`,
    )
  }

  // ────────────────────────────────────────────────────────────────
  console.log("\n=== Prompt content sanity ===")
  {
    const { fn, captured } = mockInvoke(JSON.stringify({ drafts: [] }))
    await suggestBulletsForGap({
      gapDescription: "JD wants strong Excel skills",
      jdContext: "Required: data analysis via Excel pivot tables",
      resumeText: CATHERINE_RESUME_TEXT,
      invokeClaudeImpl: fn,
    })
    const prompt = captured.input?.userPrompt ?? ""
    check(
      "11: prompt includes the gap description",
      prompt.includes("JD wants strong Excel skills"),
    )
    check(
      "11: prompt includes the JD context",
      prompt.includes("Required: data analysis via Excel pivot tables"),
    )
    check(
      "11: prompt includes the resume text (PRIMARY source)",
      prompt.includes("CATHERINE LEES"),
    )
    check(
      "11: prompt includes verbatim instruction",
      /verbatim|character-for-character/i.test(prompt),
    )
    check(
      "11: prompt requests the empty-array escape hatch",
      /insufficient_source_evidence/.test(prompt),
    )
  }

  // ────────────────────────────────────────────────────────────────
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
