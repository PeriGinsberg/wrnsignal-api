// tests/positioning-v2/phase2/ai-client-check.ts
//
// Unit tests for lib/positioning/v2/phase2/aiClient.ts (Stage 2c Commit 3).
//
// Tests inject a mock invokeClaude via the `invokeClaudeImpl` input field
// (parallel to Commit 2's fetchImpl DI pattern). No real Anthropic calls.
//
// Coverage:
//   - parseClaudeResponse (shared helper): 8 tests covering all defensive
//     paths + truncation. Exercised indirectly via generateHeadlineOptions
//     since the helper is module-private.
//   - generateHeadlineOptions: 4 tests
//   - generateBulletReframe: 4 tests
//   - generateGapResponse: 4 tests
//
// Run:
//   npx tsx tests/positioning-v2/phase2/ai-client-check.ts

import {
  generateHeadlineOptions,
  generateBulletReframe,
  generateGapResponse,
} from "@/lib/positioning/v2/phase2/aiClient"
import type {
  InvokeClaudeInput,
  InvokeClaudeResult,
} from "@/lib/positioning/v2/phase2/anthropicClient"
import { SYSTEM_PROMPT } from "@/lib/positioning/v2/phase2/prompts/systemPrompt"
import { MAX_TOKENS_HEADLINE } from "@/lib/positioning/v2/phase2/prompts/headlinePrompt"
import { MAX_TOKENS_BULLET } from "@/lib/positioning/v2/phase2/prompts/bulletPrompt"
import { MAX_TOKENS_GAP } from "@/lib/positioning/v2/phase2/prompts/gapPrompt"
import type {
  PhaseTwoHeadlineItem,
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
} from "@/lib/positioning/v2/phase2/types"

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
// Mock invokeClaude factory
// ============================================================================

/**
 * Build a mock invokeClaude that returns a fixed response and captures the
 * input args for assertion.
 */
function mockInvoke(
  responseText: string,
  usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 100,
    output_tokens: 50,
  },
): {
  fn: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult>
  captured: { input?: InvokeClaudeInput }
} {
  const captured: { input?: InvokeClaudeInput } = {}
  const fn = async (input: InvokeClaudeInput): Promise<InvokeClaudeResult> => {
    captured.input = input
    return { text: responseText, usage, latencyMs: 42 }
  }
  return { fn, captured }
}

// ============================================================================
// Fixture items
// ============================================================================

const headlineItem: PhaseTwoHeadlineItem = {
  id: "h1",
  type: "headline",
  label: "Headline",
  original: "Marketing student with internship experience",
  synthesize_mode: false,
  draft_options: [],
  selected_draft_index: null,
  user_override_text: null,
  final_text: null,
  accepted: false,
  declined: false,
  skipped: false,
  manual_entry: false,
  decided_at: null,
}

const bulletItem: PhaseTwoBulletItem = {
  id: "b1",
  type: "bullet",
  label: "Bullet 1",
  original_bullet: "Helped with social media posts",
  jd_context: "JD asks for content strategy ownership",
  question_asked: "What specific outcomes did you drive?",
  user_response: null,
  draft: null,
  final_text: null,
  accepted: false,
  declined: false,
  skipped: false,
  manual_entry: false,
  decided_at: null,
}

const gapItem: PhaseTwoGapItem = {
  id: "g1",
  type: "gap",
  label: "Gap 1",
  gap_description: "JD requires Excel; resume doesn't mention it",
  jd_context: "Proficiency with Excel and data analysis required",
  question_asked: "Have you used Excel in any role or coursework?",
  user_response: null,
  draft: null,
  final_text: null,
  accepted: false,
  declined: false,
  skipped: false,
  manual_entry: false,
  decided_at: null,
}

// ============================================================================
// parseClaudeResponse — exercised via generateHeadlineOptions
// ============================================================================

async function main(): Promise<void> {
  console.log("=== parseClaudeResponse (via generateHeadlineOptions) ===")

  // 1: happy path
  {
    const { fn } = mockInvoke(
      '{"drafts":["headline a","headline b","headline c"]}',
    )
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "1: happy path returns 3 drafts",
      result.drafts.length === 3 &&
        result.drafts[0] === "headline a" &&
        result.drafts[2] === "headline c",
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 2: malformed JSON → empty drafts
  {
    const { fn } = mockInvoke("this is not json")
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "2: malformed JSON → drafts: []",
      result.drafts.length === 0,
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 3: insufficient_source_evidence reason → empty drafts
  {
    const { fn } = mockInvoke(
      '{"drafts":[],"reason":"insufficient_source_evidence"}',
    )
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "3: insufficient_source_evidence → drafts: []",
      result.drafts.length === 0,
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 4: missing drafts key → empty
  {
    const { fn } = mockInvoke('{"other":"value"}')
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "4: missing drafts key → drafts: []",
      result.drafts.length === 0,
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 5: drafts not array → empty
  {
    const { fn } = mockInvoke('{"drafts":"not an array"}')
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "5: drafts not array → drafts: []",
      result.drafts.length === 0,
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 6: drafts array with non-strings filtered; remainder used
  {
    const { fn } = mockInvoke(
      '{"drafts":["valid",null,42,{"k":"v"},"also valid"]}',
    )
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "6: non-string drafts filtered; valid strings retained",
      result.drafts.length === 2 &&
        result.drafts[0] === "valid" &&
        result.drafts[1] === "also valid",
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 7: empty drafts array without reason → empty (defensive)
  {
    const { fn } = mockInvoke('{"drafts":[]}')
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "7: empty drafts array (no reason) → drafts: []",
      result.drafts.length === 0,
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 8: drafts truncated to maxDrafts (headline = 3)
  {
    const { fn } = mockInvoke('{"drafts":["1","2","3","4","5"]}')
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "8: 5 drafts truncated to 3 (headline maxDrafts=3)",
      result.drafts.length === 3 &&
        result.drafts[0] === "1" &&
        result.drafts[2] === "3",
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // ============================================================================
  console.log("\n=== generateHeadlineOptions ===")

  // 9: usage returned from invokeClaude
  {
    const { fn } = mockInvoke('{"drafts":["x"]}', {
      input_tokens: 777,
      output_tokens: 88,
    })
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "9: returns usage from invokeClaude",
      result.usage.input_tokens === 777 && result.usage.output_tokens === 88,
      `got ${JSON.stringify(result.usage)}`,
    )
  }

  // 10: invokeClaude called with SYSTEM_PROMPT + MAX_TOKENS_HEADLINE + temp 0.7
  {
    const { fn, captured } = mockInvoke('{"drafts":["x"]}')
    await generateHeadlineOptions({
      resumeText: "RESUME",
      jobDescription: "JD",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "10: invokeClaude called with SYSTEM_PROMPT",
      captured.input?.systemPrompt === SYSTEM_PROMPT,
    )
    check(
      "10: invokeClaude called with MAX_TOKENS_HEADLINE",
      captured.input?.maxTokens === MAX_TOKENS_HEADLINE,
    )
    check(
      "10: invokeClaude called with temperature 0.7 (first attempt)",
      captured.input?.temperature === 0.7,
    )
    check(
      "10: user prompt includes resumeText",
      captured.input?.userPrompt?.includes("RESUME") ?? false,
    )
    check(
      "10: user prompt includes original headline",
      captured.input?.userPrompt?.includes(headlineItem.original) ?? false,
    )
  }

  // 11: isRetry=true → temperature 1.0
  {
    const { fn, captured } = mockInvoke('{"drafts":["x"]}')
    await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      isRetry: true,
      invokeClaudeImpl: fn,
    })
    check(
      "11: isRetry=true → temperature 1.0",
      captured.input?.temperature === 1.0,
      `got ${captured.input?.temperature}`,
    )
  }

  // 12: questionAsked NOT set (undefined) for headline
  {
    const { fn } = mockInvoke('{"drafts":["x"]}')
    const result = await generateHeadlineOptions({
      resumeText: "R",
      jobDescription: "J",
      item: headlineItem,
      invokeClaudeImpl: fn,
    })
    check(
      "12: questionAsked is undefined for headline",
      result.questionAsked === undefined,
      `got ${result.questionAsked}`,
    )
  }

  // ============================================================================
  console.log("\n=== generateBulletReframe ===")

  // 13: happy path returns 1 draft
  {
    const { fn } = mockInvoke('{"drafts":["reframed bullet"]}', {
      input_tokens: 200,
      output_tokens: 30,
    })
    const result = await generateBulletReframe({
      resumeText: "R",
      jobDescription: "J",
      item: bulletItem,
      userResponse: "I led the project",
      invokeClaudeImpl: fn,
    })
    check(
      "13: happy path returns 1 bullet draft",
      result.drafts.length === 1 && result.drafts[0] === "reframed bullet",
      `got ${JSON.stringify(result.drafts)}`,
    )
    check(
      "13: returns usage from invokeClaude",
      result.usage.input_tokens === 200 && result.usage.output_tokens === 30,
    )
  }

  // 14: invokeClaude called with MAX_TOKENS_BULLET + temp 0.7
  {
    const { fn, captured } = mockInvoke('{"drafts":["x"]}')
    await generateBulletReframe({
      resumeText: "R",
      jobDescription: "J",
      item: bulletItem,
      userResponse: "USER_RESP_MARKER",
      invokeClaudeImpl: fn,
    })
    check(
      "14: invokeClaude called with MAX_TOKENS_BULLET",
      captured.input?.maxTokens === MAX_TOKENS_BULLET,
    )
    check(
      "14: invokeClaude called with temperature 0.7 (first attempt)",
      captured.input?.temperature === 0.7,
    )
    check(
      "14: user prompt includes original_bullet",
      captured.input?.userPrompt?.includes(bulletItem.original_bullet) ?? false,
    )
    check(
      "14: user prompt includes userResponse",
      captured.input?.userPrompt?.includes("USER_RESP_MARKER") ?? false,
    )
  }

  // 15: bullet truncated to 1 (maxDrafts=1)
  {
    const { fn } = mockInvoke('{"drafts":["a","b","c"]}')
    const result = await generateBulletReframe({
      resumeText: "R",
      jobDescription: "J",
      item: bulletItem,
      userResponse: "x",
      invokeClaudeImpl: fn,
    })
    check(
      "15: 3 drafts truncated to 1 (bullet maxDrafts=1)",
      result.drafts.length === 1 && result.drafts[0] === "a",
      `got ${JSON.stringify(result.drafts)}`,
    )
  }

  // 16: isRetry=true → temperature 1.0
  {
    const { fn, captured } = mockInvoke('{"drafts":["x"]}')
    await generateBulletReframe({
      resumeText: "R",
      jobDescription: "J",
      item: bulletItem,
      userResponse: "x",
      isRetry: true,
      invokeClaudeImpl: fn,
    })
    check(
      "16: bullet isRetry=true → temperature 1.0",
      captured.input?.temperature === 1.0,
      `got ${captured.input?.temperature}`,
    )
  }

  // ============================================================================
  console.log("\n=== generateGapResponse ===")

  // 17: happy path returns 1 draft
  {
    const { fn } = mockInvoke('{"drafts":["new bullet for gap"]}', {
      input_tokens: 150,
      output_tokens: 25,
    })
    const result = await generateGapResponse({
      resumeText: "R",
      jobDescription: "J",
      item: gapItem,
      userResponse: "Used Excel pivot tables in coursework",
      invokeClaudeImpl: fn,
    })
    check(
      "17: happy path returns 1 gap draft",
      result.drafts.length === 1 &&
        result.drafts[0] === "new bullet for gap",
      `got ${JSON.stringify(result.drafts)}`,
    )
    check(
      "17: returns usage from invokeClaude",
      result.usage.input_tokens === 150 && result.usage.output_tokens === 25,
    )
  }

  // 18: invokeClaude called with MAX_TOKENS_GAP + temp 0.7
  {
    const { fn, captured } = mockInvoke('{"drafts":["x"]}')
    await generateGapResponse({
      resumeText: "R",
      jobDescription: "J",
      item: gapItem,
      userResponse: "GAP_USER_RESP_MARKER",
      invokeClaudeImpl: fn,
    })
    check(
      "18: invokeClaude called with MAX_TOKENS_GAP",
      captured.input?.maxTokens === MAX_TOKENS_GAP,
    )
    check(
      "18: invokeClaude called with temperature 0.7 (first attempt)",
      captured.input?.temperature === 0.7,
    )
    check(
      "18: user prompt includes gap_description",
      captured.input?.userPrompt?.includes(gapItem.gap_description) ?? false,
    )
    check(
      "18: user prompt includes userResponse",
      captured.input?.userPrompt?.includes("GAP_USER_RESP_MARKER") ?? false,
    )
  }

  // 19: gap insufficient_source_evidence returns drafts: [] + usage still reported
  {
    const { fn } = mockInvoke(
      '{"drafts":[],"reason":"insufficient_source_evidence"}',
      { input_tokens: 99, output_tokens: 5 },
    )
    const result = await generateGapResponse({
      resumeText: "R",
      jobDescription: "J",
      item: gapItem,
      userResponse: "x",
      invokeClaudeImpl: fn,
    })
    check(
      "19: gap insufficient_source_evidence → drafts: []",
      result.drafts.length === 0,
    )
    check(
      "19: usage still reported on insufficient evidence",
      result.usage.input_tokens === 99 && result.usage.output_tokens === 5,
      `got ${JSON.stringify(result.usage)}`,
    )
  }

  // 20: gap isRetry=true → temperature 1.0
  {
    const { fn, captured } = mockInvoke('{"drafts":["x"]}')
    await generateGapResponse({
      resumeText: "R",
      jobDescription: "J",
      item: gapItem,
      userResponse: "x",
      isRetry: true,
      invokeClaudeImpl: fn,
    })
    check(
      "20: gap isRetry=true → temperature 1.0",
      captured.input?.temperature === 1.0,
      `got ${captured.input?.temperature}`,
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
}

main().catch((e) => {
  console.error("Unhandled error in test runner:", e)
  process.exit(1)
})
