// tests/resume/extract-graduation-date-check.ts
//
// Unit tests for lib/resume/extractGraduationDate.
//
// All tests inject a mock invokeClaude so no real API calls are made. The
// mock just returns whatever stub text the test wants Claude to have said;
// the assertions verify that extractGraduationDate parses correctly,
// validates defensively, and short-circuits on empty input.
//
// Fixtures cover the matrix from the build plan:
//   - "May 2026"             (year+month, no expected/completed cue)
//   - "Expected May 2027"    (future, expected)
//   - "May 2024"             (past, bare cue)
//   - "Class of 2025"        (year-only, model returns type=unknown)
//   - "Class of 2027"        (year-only, future — same shape)
//   - "Bachelor of Arts, 2023" (completed, past degree)
//   - no education section   (→ null)
//   - year mention but not graduation (→ null)
//   - multiple degrees       (model picks the most recent)
// + defensive validation cases:
//   - malformed JSON         (→ null)
//   - explicit found=false   (→ null)
//   - empty resume text      (→ null, no API call)
//   - year out of range      (→ null)
//   - month out of range     (→ coerced to null, result kept)
//   - missing year field     (→ null)
//   - missing found field    (→ null, treated as not-found)
//
// Run: npx tsx tests/resume/extract-graduation-date-check.ts

import {
  extractGraduationDate,
  type ParsedGradDate,
} from "../../lib/resume/extractGraduationDate"
import type {
  InvokeClaudeInput,
  InvokeClaudeResult,
} from "../../lib/positioning/v2/phase2/anthropicClient"

let failures = 0

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${label}`)
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

function mockResult(body: object | string): InvokeClaudeResult {
  return {
    text: typeof body === "string" ? body : JSON.stringify(body),
    usage: { input_tokens: 100, output_tokens: 50 },
    latencyMs: 500,
  }
}

function mockInvoke(
  body: object | string,
): (input: InvokeClaudeInput) => Promise<InvokeClaudeResult> {
  return async () => mockResult(body)
}

async function expectResult(
  label: string,
  modelOutput: string | object,
  expected: ParsedGradDate | null,
) {
  console.log(`\n=== ${label} ===`)
  const { result } = await extractGraduationDate({
    resumeText: "<test resume body>",
    invokeClaudeImpl: mockInvoke(modelOutput),
  })
  if (expected === null) {
    assert(result === null, "result is null", `got ${JSON.stringify(result)}`)
    return
  }
  assert(result !== null, "result is non-null")
  if (!result) return
  assert(result.raw === expected.raw, `raw="${expected.raw}"`, `got "${result.raw}"`)
  assert(result.year === expected.year, `year=${expected.year}`, `got ${result.year}`)
  assert(
    result.month === expected.month,
    `month=${String(expected.month)}`,
    `got ${String(result.month)}`,
  )
  assert(result.type === expected.type, `type="${expected.type}"`, `got "${result.type}"`)
  assert(
    result.confidence === expected.confidence,
    `confidence="${expected.confidence}"`,
    `got "${result.confidence}"`,
  )
}

async function main() {
  // ── Resume-content fixtures ──────────────────────────────────────────

  // 1. "May 2026" — year+month, no expected/completed cue
  await expectResult(
    'fixture: "May 2026" — bare date (type=unknown)',
    {
      found: true,
      raw: "May 2026",
      year: 2026,
      month: 5,
      type: "unknown",
      confidence: "high",
    },
    { raw: "May 2026", year: 2026, month: 5, type: "unknown", confidence: "high" },
  )

  // 2. "Expected May 2027" — future, expected
  await expectResult(
    'fixture: "Expected May 2027" — future, expected',
    {
      found: true,
      raw: "Expected May 2027",
      year: 2027,
      month: 5,
      type: "expected",
      confidence: "high",
    },
    {
      raw: "Expected May 2027",
      year: 2027,
      month: 5,
      type: "expected",
      confidence: "high",
    },
  )

  // 3. "May 2024" — past, bare (model may return type=unknown or completed
  //    depending on the surrounding text; here we test the bare case)
  await expectResult(
    'fixture: "May 2024" — past, type=unknown',
    {
      found: true,
      raw: "May 2024",
      year: 2024,
      month: 5,
      type: "unknown",
      confidence: "high",
    },
    { raw: "May 2024", year: 2024, month: 5, type: "unknown", confidence: "high" },
  )

  // 4. "Class of 2025" — year-only
  await expectResult(
    'fixture: "Class of 2025" — year-only, type=unknown',
    {
      found: true,
      raw: "Class of 2025",
      year: 2025,
      month: null,
      type: "unknown",
      confidence: "high",
    },
    {
      raw: "Class of 2025",
      year: 2025,
      month: null,
      type: "unknown",
      confidence: "high",
    },
  )

  // 5. "Class of 2027" — year-only, future
  await expectResult(
    'fixture: "Class of 2027" — year-only, future, type=unknown',
    {
      found: true,
      raw: "Class of 2027",
      year: 2027,
      month: null,
      type: "unknown",
      confidence: "high",
    },
    {
      raw: "Class of 2027",
      year: 2027,
      month: null,
      type: "unknown",
      confidence: "high",
    },
  )

  // 6. "Bachelor of Arts, 2023" — completed past degree
  await expectResult(
    'fixture: "Bachelor of Arts, 2023" — completed',
    {
      found: true,
      raw: "Bachelor of Arts, 2023",
      year: 2023,
      month: null,
      type: "completed",
      confidence: "high",
    },
    {
      raw: "Bachelor of Arts, 2023",
      year: 2023,
      month: null,
      type: "completed",
      confidence: "high",
    },
  )

  // 7. No education section — model returns found=false
  await expectResult(
    "fixture: no education section — found=false → null",
    {
      found: false,
      raw: "",
      year: 0,
      month: null,
      type: "unknown",
      confidence: "low",
    },
    null,
  )

  // 8. Year mention but not graduation — model correctly returns found=false
  await expectResult(
    "fixture: year mention but not graduation — found=false → null",
    {
      found: false,
      raw: "",
      year: 0,
      month: null,
      type: "unknown",
      confidence: "low",
    },
    null,
  )

  // 9. Multiple degrees — model selects the most recent
  await expectResult(
    "fixture: multiple degrees — model picks most recent (M.S. May 2024 over B.S. May 2020)",
    {
      found: true,
      raw: "May 2024",
      year: 2024,
      month: 5,
      type: "completed",
      confidence: "high",
    },
    { raw: "May 2024", year: 2024, month: 5, type: "completed", confidence: "high" },
  )

  // ── Defensive validation cases ───────────────────────────────────────

  // 10. Malformed JSON
  await expectResult(
    "defensive: malformed JSON → null",
    "this is not json at all",
    null,
  )

  // 11. Explicit found=false with full payload (redundant with #7 but
  //     pins the contract clearly)
  await expectResult(
    "defensive: explicit found=false → null",
    {
      found: false,
      raw: "May 2026",
      year: 2026,
      month: 5,
      type: "unknown",
      confidence: "high",
    },
    null,
  )

  // 12. Empty resume text — short-circuits, no API call
  console.log("\n=== defensive: empty resume text — no API call, null ===")
  let apiCalled = false
  const trackedInvoke: (input: InvokeClaudeInput) => Promise<InvokeClaudeResult> =
    async () => {
      apiCalled = true
      return mockResult({ found: true, year: 2025 })
    }
  const emptyOut = await extractGraduationDate({
    resumeText: "",
    invokeClaudeImpl: trackedInvoke,
  })
  assert(emptyOut.result === null, "result is null on empty resumeText")
  assert(
    !apiCalled,
    "API was NOT called",
    apiCalled ? "API was called despite empty resume" : undefined,
  )
  assert(
    emptyOut.usage.input_tokens === 0 && emptyOut.usage.output_tokens === 0,
    "usage is zero",
    `got ${JSON.stringify(emptyOut.usage)}`,
  )
  assert(emptyOut.latencyMs === 0, "latencyMs is zero", `got ${emptyOut.latencyMs}`)

  // 12b. Whitespace-only resume text — also short-circuits
  console.log(
    "\n=== defensive: whitespace-only resume text — no API call, null ===",
  )
  apiCalled = false
  const wsOut = await extractGraduationDate({
    resumeText: "   \n\n  \t  ",
    invokeClaudeImpl: trackedInvoke,
  })
  assert(wsOut.result === null, "result is null on whitespace resumeText")
  assert(!apiCalled, "API was NOT called on whitespace input")

  // 13. Year out of range (1800)
  await expectResult(
    "defensive: year out of range (1800) → null",
    {
      found: true,
      raw: "1800",
      year: 1800,
      month: null,
      type: "completed",
      confidence: "high",
    },
    null,
  )

  // 13b. Year out of range (2200)
  await expectResult(
    "defensive: year out of range (2200) → null",
    {
      found: true,
      raw: "2200",
      year: 2200,
      month: null,
      type: "expected",
      confidence: "high",
    },
    null,
  )

  // 14. Month out of range (13) — coerced to null, result kept
  await expectResult(
    "defensive: month=13 — coerced to null, result kept",
    {
      found: true,
      raw: "May 2026",
      year: 2026,
      month: 13,
      type: "unknown",
      confidence: "high",
    },
    { raw: "May 2026", year: 2026, month: null, type: "unknown", confidence: "high" },
  )

  // 14b. Month out of range (0) — coerced to null
  await expectResult(
    "defensive: month=0 — coerced to null, result kept",
    {
      found: true,
      raw: "May 2026",
      year: 2026,
      month: 0,
      type: "unknown",
      confidence: "high",
    },
    { raw: "May 2026", year: 2026, month: null, type: "unknown", confidence: "high" },
  )

  // 14c. Month not a number — coerced to null
  await expectResult(
    'defensive: month="May" — coerced to null',
    {
      found: true,
      raw: "May 2026",
      year: 2026,
      month: "May",
      type: "unknown",
      confidence: "high",
    },
    { raw: "May 2026", year: 2026, month: null, type: "unknown", confidence: "high" },
  )

  // 15. Missing year field — null
  await expectResult(
    "defensive: year field absent → null",
    {
      found: true,
      raw: "May 2026",
      month: 5,
      type: "unknown",
      confidence: "high",
    },
    null,
  )

  // 16. Missing found field — treated as not-found → null
  await expectResult(
    "defensive: found field absent → null",
    { raw: "May 2026", year: 2026, month: 5, type: "unknown", confidence: "high" },
    null,
  )

  // 17. type="garbage" — coerced to "unknown", result kept
  await expectResult(
    'defensive: type="garbage" — coerced to "unknown"',
    {
      found: true,
      raw: "May 2026",
      year: 2026,
      month: 5,
      type: "garbage",
      confidence: "high",
    },
    { raw: "May 2026", year: 2026, month: 5, type: "unknown", confidence: "high" },
  )

  // 18. confidence="garbage" — coerced to "low", result kept
  await expectResult(
    'defensive: confidence="garbage" — coerced to "low"',
    {
      found: true,
      raw: "May 2026",
      year: 2026,
      month: 5,
      type: "unknown",
      confidence: "garbage",
    },
    { raw: "May 2026", year: 2026, month: 5, type: "unknown", confidence: "low" },
  )

  // 19. raw missing — coerced to ""
  await expectResult(
    'defensive: raw field absent — coerced to ""',
    {
      found: true,
      year: 2026,
      month: 5,
      type: "unknown",
      confidence: "high",
    },
    { raw: "", year: 2026, month: 5, type: "unknown", confidence: "high" },
  )

  // 20. usage is propagated from invokeClaude on success
  console.log("\n=== contract: usage is propagated from the invokeClaude result ===")
  const usageOut = await extractGraduationDate({
    resumeText: "Education section: Cornell University, May 2025.",
    invokeClaudeImpl: mockInvoke({
      found: true,
      raw: "May 2025",
      year: 2025,
      month: 5,
      type: "completed",
      confidence: "high",
    }),
  })
  assert(
    usageOut.usage.input_tokens === 100 && usageOut.usage.output_tokens === 50,
    "usage input=100 output=50 (matches mock)",
    `got ${JSON.stringify(usageOut.usage)}`,
  )
  assert(
    usageOut.latencyMs === 500,
    "latencyMs = 500 (matches mock)",
    `got ${usageOut.latencyMs}`,
  )

  console.log(
    `\n=== ${
      failures === 0 ? "✅ all checks passed" : `❌ ${failures} failure(s)`
    } ===`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
