// tests/ai/anthropic-client-check.ts
//
// Unit tests for:
//   - lib/ai/anthropicClient.ts (invokeClaude, InvokeClaudeError)
//   - lib/ai/costPolicy.ts (centsForUsage)
//
// invokeClaude tests use a mock fetch (passed via fetchImpl input field)
// — no real Anthropic API calls.
//
// centsForUsage tests are pure-function checks against the verified Haiku
// 4.5 pricing constants.
//
// Run:
//   npx tsx tests/positioning-v2/phase2/anthropic-client-check.ts

import {
  invokeClaude,
  InvokeClaudeError,
  MODEL,
  ANTHROPIC_VERSION,
} from "@/lib/ai/anthropicClient"
import {
  centsForUsage,
  HAIKU_INPUT_CENTS_PER_MTOK,
  HAIKU_OUTPUT_CENTS_PER_MTOK,
} from "@/lib/ai/costPolicy"

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
// Mock fetch helpers
// ============================================================================

function mockOkResponse(body: object): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch
}

function mockErrorResponse(status: number, body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/plain" },
    })) as unknown as typeof fetch
}

/**
 * Build a mock fetch that also captures the request for assertion.
 * Returns { fetchImpl, captured } — captured.body is populated after the
 * mock is called.
 */
function spyFetch(responseBody: object): {
  fetchImpl: typeof fetch
  captured: { url?: string; init?: RequestInit; bodyJson?: any }
} {
  const captured: { url?: string; init?: RequestInit; bodyJson?: any } = {}
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    captured.url = url
    captured.init = init
    if (init?.body && typeof init.body === "string") {
      try {
        captured.bodyJson = JSON.parse(init.body)
      } catch {
        // ignore
      }
    }
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, captured }
}

// ============================================================================
// invokeClaude tests
// ============================================================================

async function main(): Promise<void> {
  console.log("=== invokeClaude — happy path ===")

  // Ensure API key is set for the test (real value not required since
  // we mock fetch — just needs to be non-empty)
  if (!process.env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = "test-key-for-mocked-fetch"
  }

  {
    const mockBody = {
      content: [
        { type: "text", text: '{"drafts":["headline 1","headline 2"]}' },
      ],
      usage: { input_tokens: 350, output_tokens: 42 },
    }
    const { fetchImpl, captured } = spyFetch(mockBody)

    const result = await invokeClaude({
      systemPrompt: "SYSTEM_TEST",
      userPrompt: "USER_TEST",
      maxTokens: 300,
      temperature: 0.7,
      fetchImpl,
    })

    check(
      "1: returns text from content[0].text",
      result.text === '{"drafts":["headline 1","headline 2"]}',
      `got ${JSON.stringify(result.text)}`,
    )
    check(
      "1: returns usage.input_tokens from response",
      result.usage.input_tokens === 350,
      `got ${result.usage.input_tokens}`,
    )
    check(
      "1: returns usage.output_tokens from response",
      result.usage.output_tokens === 42,
      `got ${result.usage.output_tokens}`,
    )
    check(
      "1: returns latencyMs as non-negative number",
      typeof result.latencyMs === "number" && result.latencyMs >= 0,
      `got ${result.latencyMs}`,
    )
    check(
      "1: posts to Anthropic /v1/messages URL",
      captured.url === "https://api.anthropic.com/v1/messages",
      `got ${captured.url}`,
    )
    check(
      "1: request body includes correct model",
      captured.bodyJson?.model === MODEL,
      `got ${captured.bodyJson?.model}`,
    )
    check(
      "1: request body includes max_tokens",
      captured.bodyJson?.max_tokens === 300,
    )
    check(
      "1: request body includes temperature",
      captured.bodyJson?.temperature === 0.7,
    )
    check(
      "1: request body includes system prompt at top level",
      captured.bodyJson?.system === "SYSTEM_TEST",
    )
    check(
      "1: request body includes user message",
      captured.bodyJson?.messages?.[0]?.role === "user" &&
        captured.bodyJson?.messages?.[0]?.content === "USER_TEST",
    )
    check(
      "1: includes anthropic-version header",
      ((captured.init?.headers ?? {}) as Record<string, string>)[
        "anthropic-version"
      ] === ANTHROPIC_VERSION,
    )
  }

  console.log("\n=== invokeClaude — markdown fence stripping ===")

  {
    const tick = String.fromCharCode(96)
    const fence = tick + tick + tick
    const wrappedJson = `${fence}json\n{"drafts":["test"]}\n${fence}`
    const mockBody = {
      content: [{ type: "text", text: wrappedJson }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }

    const result = await invokeClaude({
      systemPrompt: "x",
      userPrompt: "y",
      maxTokens: 100,
      temperature: 0.7,
      fetchImpl: mockOkResponse(mockBody),
    })

    check(
      "2: strips json-tagged markdown fence",
      result.text === '{"drafts":["test"]}',
      `got ${JSON.stringify(result.text)}`,
    )
  }

  console.log("\n=== invokeClaude — multiple text blocks ===")

  {
    const mockBody = {
      content: [
        { type: "text", text: "part 1 " },
        { type: "text", text: "part 2" },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }

    const result = await invokeClaude({
      systemPrompt: "x",
      userPrompt: "y",
      maxTokens: 100,
      temperature: 0.7,
      fetchImpl: mockOkResponse(mockBody),
    })

    check(
      "3: concatenates multiple text blocks",
      result.text === "part 1 part 2",
      `got ${JSON.stringify(result.text)}`,
    )
  }

  console.log("\n=== invokeClaude — error paths ===")

  {
    try {
      await invokeClaude({
        systemPrompt: "x",
        userPrompt: "y",
        maxTokens: 100,
        temperature: 0.7,
        fetchImpl: mockErrorResponse(429, "rate limit exceeded"),
      })
      check("4: throws InvokeClaudeError on non-200", false, "no throw")
    } catch (e) {
      check(
        "4: throws InvokeClaudeError on non-200",
        e instanceof InvokeClaudeError,
        `got ${(e as Error).constructor.name}`,
      )
      if (e instanceof InvokeClaudeError) {
        check("4: error.status is 429", e.status === 429, `got ${e.status}`)
        check(
          "4: error.body includes response text",
          e.body.includes("rate limit"),
          `got ${e.body}`,
        )
      }
    }
  }

  {
    const savedKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      await invokeClaude({
        systemPrompt: "x",
        userPrompt: "y",
        maxTokens: 100,
        temperature: 0.7,
        fetchImpl: mockOkResponse({ content: [], usage: {} }),
      })
      check("5: throws on missing ANTHROPIC_API_KEY", false, "no throw")
    } catch (e) {
      check(
        "5: throws Error on missing ANTHROPIC_API_KEY",
        e instanceof Error && /ANTHROPIC_API_KEY/.test((e as Error).message),
        `got ${(e as Error).message}`,
      )
    }
    process.env.ANTHROPIC_API_KEY = savedKey
  }

  console.log("\n=== invokeClaude — defensive paths ===")

  {
    const mockBody = {
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    }
    const result = await invokeClaude({
      systemPrompt: "x",
      userPrompt: "y",
      maxTokens: 100,
      temperature: 0.7,
      fetchImpl: mockOkResponse(mockBody),
    })
    check(
      "6: empty content array returns empty text (no throw)",
      result.text === "",
      `got ${JSON.stringify(result.text)}`,
    )
    check(
      "6: usage still extracted from response",
      result.usage.input_tokens === 5,
      `got ${result.usage.input_tokens}`,
    )
  }

  {
    const mockBody = {
      content: [{ type: "text", text: "hello" }],
      // No usage field at all
    }
    const result = await invokeClaude({
      systemPrompt: "x",
      userPrompt: "y",
      maxTokens: 100,
      temperature: 0.7,
      fetchImpl: mockOkResponse(mockBody),
    })
    check(
      "7: missing usage defaults to 0 input + 0 output (no throw)",
      result.usage.input_tokens === 0 && result.usage.output_tokens === 0,
      `got ${JSON.stringify(result.usage)}`,
    )
  }

  // ============================================================================
  // centsForUsage tests
  // ============================================================================

  console.log("\n=== centsForUsage — pricing math ===")

  {
    check(
      "8: zero tokens → 0 cents",
      centsForUsage({ input_tokens: 0, output_tokens: 0 }) === 0,
      `got ${centsForUsage({ input_tokens: 0, output_tokens: 0 })}`,
    )
  }

  {
    // Typical Phase 2 attempt: 500 input + 200 output
    // input cost: 500 * 100 / 1M = 0.05 cents
    // output cost: 200 * 500 / 1M = 0.10 cents
    // total: 0.15 cents → Math.ceil → 1 cent
    const result = centsForUsage({ input_tokens: 500, output_tokens: 200 })
    check(
      "9: typical attempt (500 in + 200 out) → 1 cent (Math.ceil from 0.15)",
      result === 1,
      `got ${result}`,
    )
  }

  {
    // Large input causing >1 cent
    // input cost: 100000 * 100 / 1M = 10 cents
    // output cost: 0
    // total: 10 cents
    const result = centsForUsage({ input_tokens: 100_000, output_tokens: 0 })
    check(
      "10: 100k input tokens → exactly 10 cents (no rounding)",
      result === 10,
      `got ${result}`,
    )
  }

  {
    // Returns integer
    const result = centsForUsage({ input_tokens: 1, output_tokens: 1 })
    check(
      "11: result is always an integer",
      Number.isInteger(result),
      `got ${result} (${typeof result})`,
    )
  }

  {
    // Math.ceil rounds tiny costs up to 1
    const result = centsForUsage({ input_tokens: 1, output_tokens: 1 })
    check(
      "12: tiny fractional cost (Math.ceil from <0.001) → 1 cent",
      result === 1,
      `got ${result}`,
    )
  }

  {
    // Pricing constants are correct integers
    check(
      "13: HAIKU_INPUT_CENTS_PER_MTOK = 100 ($1/MTok)",
      HAIKU_INPUT_CENTS_PER_MTOK === 100,
      `got ${HAIKU_INPUT_CENTS_PER_MTOK}`,
    )
    check(
      "13: HAIKU_OUTPUT_CENTS_PER_MTOK = 500 ($5/MTok)",
      HAIKU_OUTPUT_CENTS_PER_MTOK === 500,
      `got ${HAIKU_OUTPUT_CENTS_PER_MTOK}`,
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
