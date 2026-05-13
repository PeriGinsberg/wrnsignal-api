// scripts/migrate-candidate-targeting/run-synthetic-test.ts
//
// Run Claude Haiku against SYNTHETIC_SAMPLES and compare each result to its
// expected output. Single inference per case, temperature=0 for determinism.
// No DB reads. No DB writes. No real-data execution. Validation-only.
//
// Run:
//   npx tsx scripts/migrate-candidate-targeting/run-synthetic-test.ts
//
// Output:
//   - Per-case table to stdout
//   - Saved transcript at scripts/migrate-candidate-targeting/results/synthetic-<ISO>.txt

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import Anthropic from "@anthropic-ai/sdk"
import { isValidLaneId, isValidSubLaneId } from "@/lib/laneTaxonomy"
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseInferenceOutput,
  type InferenceOutput,
} from "./inference-prompt"
import {
  SYNTHETIC_SAMPLES,
  type SyntheticCase,
} from "./synthetic-samples"

// ============================================================================
// Env
// ============================================================================

function loadEnvFromDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, "utf8")
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const i = trimmed.indexOf("=")
    if (i < 0) continue
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
  }
  return out
}

// Load .env.local (where ANTHROPIC_API_KEY lives) and .env.development.local
// (where dev Supabase creds live). Later sources override earlier ones, but
// for this script we only need ANTHROPIC_API_KEY from either.
const env = {
  ...loadEnvFromDotEnv(".env.local"),
  ...loadEnvFromDotEnv(".env.development.local"),
}
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY in .env.local, .env.development.local, or process env",
  )
  process.exit(1)
}

const MODEL = "claude-haiku-4-5-20251001"

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ============================================================================
// Comparison logic
// ============================================================================

export type FieldStatus = "pass" | "fail" | "pass-within-lane"

export type CaseComparison = {
  caseId: number
  label: string
  outcome:
    | "PASS" // all fields pass
    | "FAIL" // at least one field fail
    | "LLM_ERROR" // Anthropic API call threw
    | "PARSE_ERROR" // parseInferenceOutput rejected the response
  lane: {
    expected: string
    /** Acceptable-lanes list when the case used multi-lane mode. Undefined or
     *  single-element means single-lane strict match against expected. */
    acceptable?: string[]
    actual: string
    status: FieldStatus
    /** True when actual lane is not in LANES (taxonomy constraint violated). */
    hallucination: boolean
  }
  sublane: {
    expected: string | null
    actual: string | null
    mode: "specific" | "any-within-lane" | "other-must-be-null"
    status: FieldStatus
    hallucination: boolean
  }
  confidence: {
    expected: InferenceOutput["confidence"]
    actual: InferenceOutput["confidence"]
    status: FieldStatus
  }
  description: {
    expectedShape: "null" | "nonempty"
    actual: string | null
    status: FieldStatus
  }
  reasoning: string | null
  rawResponse: string
  error?: string
}

/**
 * Compare a parsed LLM output against the expected output. All comparisons
 * are pure functions — no I/O. Returns a per-field status report.
 *
 * Lane: exact match required.
 *
 * Sub-lane:
 *   - When expected.lane='other': actual.sublane MUST be null (mode='other-must-be-null')
 *   - When sublaneMode='specific' (default): actual.sublane === expected.sublane
 *   - When sublaneMode='any-within-lane': isValidSubLaneId(expected.lane, actual.sublane)
 *     — i.e., actual.sublane is a real sub-lane belonging to the expected lane.
 *     Mode-specific pass is labeled 'pass-within-lane' so the report shows the
 *     LLM didn't match our illustrative guess but did pick a defensible alt.
 *
 * Sub-lane hallucination: actual.sublane is set but doesn't belong to actual.lane.
 *   This is flagged independently — even if lane matched expected, a hallucinated
 *   sublane is a real defect.
 *
 * Confidence: exact match (high|medium|low).
 *
 * Description:
 *   - When expected.lane='other': actual.primary_other_description must be a non-empty string.
 *   - Else: actual.primary_other_description must be null.
 *   Content of the description is NOT compared — LLM phrasing varies.
 */
export function compareCase(
  c: SyntheticCase,
  parsed: InferenceOutput,
  rawResponse: string,
): CaseComparison {
  const expectedLane = c.expected.lane
  const actualLane = parsed.lane

  // acceptableLanes: when present, lane match passes if actual ∈ list. When
  // absent, falls back to single-lane strict match against expected.lane.
  const acceptableLanes = c.expected.acceptableLanes ?? [expectedLane]
  const multiLaneMode = (c.expected.acceptableLanes?.length ?? 0) > 1

  // Lane — separate hallucination check (actual lane not in taxonomy) from
  // wrong-real-lane (actual lane is a valid lane but not the expected one).
  // Both end up as "fail" but the warning surfaces the distinction.
  let laneStatus: FieldStatus = acceptableLanes.includes(actualLane)
    ? "pass"
    : "fail"
  let laneHallucination = false
  if (!isValidLaneId(actualLane)) {
    laneHallucination = true
    laneStatus = "fail"
  }

  // Sub-lane
  // When multi-lane mode is active and the actual lane was accepted, the
  // sub-lane within-lane check uses ACTUAL lane (since the LLM legitimately
  // had multiple lane choices). When in single-lane mode, check against
  // expected lane as before.
  const sublaneCheckLane =
    multiLaneMode && laneStatus === "pass" ? actualLane : expectedLane

  const sublaneMode = c.expected.sublaneMode ?? "specific"
  let sublaneStatus: FieldStatus
  let sublaneModeReported: CaseComparison["sublane"]["mode"]
  let sublaneHallucination = false

  if (expectedLane === "other") {
    sublaneModeReported = "other-must-be-null"
    sublaneStatus = parsed.sublane === null ? "pass" : "fail"
  } else if (sublaneMode === "specific") {
    sublaneModeReported = "specific"
    sublaneStatus = parsed.sublane === c.expected.sublane ? "pass" : "fail"
  } else {
    sublaneModeReported = "any-within-lane"
    if (parsed.sublane && isValidSubLaneId(sublaneCheckLane, parsed.sublane)) {
      sublaneStatus =
        parsed.sublane === c.expected.sublane ? "pass" : "pass-within-lane"
    } else {
      sublaneStatus = "fail"
    }
  }

  // Independent hallucination check: sublane that doesn't belong to the
  // ACTUAL lane (separate failure mode from sublane-mismatch-with-expected).
  // Only applies when actual.sublane is non-null AND actual.lane is not 'other'.
  if (parsed.sublane && actualLane !== "other") {
    if (!isValidSubLaneId(actualLane, parsed.sublane)) {
      sublaneHallucination = true
      // If we hadn't already flagged sublane as fail (e.g., when actual.lane
      // matched expected but the sublane is bogus), force fail.
      if (sublaneStatus === "pass" || sublaneStatus === "pass-within-lane") {
        sublaneStatus = "fail"
      }
    }
  }

  // Confidence
  const confidenceStatus: FieldStatus =
    parsed.confidence === c.expected.confidence ? "pass" : "fail"

  // Description
  let descriptionStatus: FieldStatus
  let expectedShape: "null" | "nonempty"
  if (expectedLane === "other") {
    expectedShape = "nonempty"
    descriptionStatus =
      typeof parsed.primary_other_description === "string" &&
      parsed.primary_other_description.trim().length > 0
        ? "pass"
        : "fail"
  } else {
    expectedShape = "null"
    descriptionStatus = parsed.primary_other_description === null ? "pass" : "fail"
  }

  // Overall outcome
  const anyFail =
    laneStatus === "fail" ||
    sublaneStatus === "fail" ||
    confidenceStatus === "fail" ||
    descriptionStatus === "fail"
  const outcome: CaseComparison["outcome"] = anyFail ? "FAIL" : "PASS"

  return {
    caseId: c.id,
    label: c.label,
    outcome,
    lane: {
      expected: expectedLane,
      acceptable: c.expected.acceptableLanes,
      actual: actualLane,
      status: laneStatus,
      hallucination: laneHallucination,
    },
    sublane: {
      expected: c.expected.sublane,
      actual: parsed.sublane,
      mode: sublaneModeReported,
      status: sublaneStatus,
      hallucination: sublaneHallucination,
    },
    confidence: {
      expected: c.expected.confidence,
      actual: parsed.confidence,
      status: confidenceStatus,
    },
    description: {
      expectedShape,
      actual: parsed.primary_other_description,
      status: descriptionStatus,
    },
    reasoning: parsed.reasoning,
    rawResponse,
  }
}

// ============================================================================
// LLM call
// ============================================================================

async function inferOne(c: SyntheticCase): Promise<{
  raw: string | null
  parsed: InferenceOutput | null
  error: string | null
}> {
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(c.input) }],
    })
    const block = resp.content.find((b) => b.type === "text")
    const raw = block && block.type === "text" ? block.text : ""
    const parseResult = parseInferenceOutput(raw)
    if (!parseResult.ok) {
      return { raw, parsed: null, error: `parse: ${parseResult.error}` }
    }
    return { raw, parsed: parseResult.output, error: null }
  } catch (e) {
    return {
      raw: null,
      parsed: null,
      error: `llm: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ============================================================================
// Formatting
// ============================================================================

function statusGlyph(s: FieldStatus): string {
  if (s === "pass") return "✓"
  if (s === "pass-within-lane") return "✓ (within-lane)"
  return "✗"
}

function formatCase(c: CaseComparison): string {
  const lines: string[] = []
  lines.push(`── Case ${c.caseId}: ${c.label} ──`)
  if (c.outcome === "LLM_ERROR" || c.outcome === "PARSE_ERROR") {
    lines.push(`  Status: ${c.outcome}`)
    if (c.error) lines.push(`  Error:  ${c.error}`)
    if (c.rawResponse) lines.push(`  Raw:    ${c.rawResponse}`)
    return lines.join("\n")
  }
  // Show acceptable-lanes set when the case had multiple acceptable lanes
  const acceptable = c.lane.acceptable
  const laneExpDisplay = acceptable && acceptable.length > 1
    ? `∈[${acceptable.join(",")}]`
    : c.lane.expected
  lines.push(
    `  Lane:        expected=${laneExpDisplay.padEnd(20)} actual=${c.lane.actual.padEnd(20)} ${statusGlyph(c.lane.status)}`,
  )
  if (c.lane.hallucination) {
    lines.push(
      `               ⚠ LANE HALLUCINATION: actual lane '${c.lane.actual}' is not in the taxonomy (LANES)`,
    )
  }
  const subExp = c.sublane.expected ?? "null"
  const subAct = c.sublane.actual ?? "null"
  lines.push(
    `  Sub-lane:    expected=${subExp.padEnd(20)} actual=${subAct.padEnd(20)} ${statusGlyph(c.sublane.status)} [mode=${c.sublane.mode}]`,
  )
  if (c.sublane.hallucination) {
    lines.push(
      `               ⚠ HALLUCINATION: actual sub-lane is not a valid sub-lane of actual lane '${c.lane.actual}'`,
    )
  }
  lines.push(
    `  Confidence:  expected=${c.confidence.expected.padEnd(20)} actual=${c.confidence.actual.padEnd(20)} ${statusGlyph(c.confidence.status)}`,
  )
  const descShape =
    c.description.expectedShape === "nonempty"
      ? "non-empty string"
      : "null"
  const descAct =
    c.description.actual === null
      ? "null"
      : `"${c.description.actual.slice(0, 60)}${c.description.actual.length > 60 ? "…" : ""}"`
  lines.push(
    `  Description: expected=${descShape.padEnd(20)} actual=${descAct.padEnd(20)} ${statusGlyph(c.description.status)}`,
  )
  if (c.reasoning) lines.push(`  Reasoning:   ${c.reasoning}`)
  lines.push(`  Outcome: ${c.outcome}`)
  return lines.join("\n")
}

function formatSummary(comparisons: CaseComparison[]): string {
  const n = comparisons.length
  const ok = comparisons.filter((c) => c.outcome === "PASS").length
  const fail = comparisons.filter((c) => c.outcome === "FAIL").length
  const llmErr = comparisons.filter((c) => c.outcome === "LLM_ERROR").length
  const parseErr = comparisons.filter((c) => c.outcome === "PARSE_ERROR").length

  const laneOk = comparisons.filter((c) => c.lane?.status === "pass").length
  const subSpecific = comparisons.filter(
    (c) => c.sublane?.mode === "specific" && c.sublane.status === "pass",
  ).length
  const subWithinLane = comparisons.filter(
    (c) => c.sublane?.status === "pass-within-lane",
  ).length
  const subAnyValid = comparisons.filter(
    (c) =>
      c.sublane?.mode === "any-within-lane" && c.sublane.status === "pass",
  ).length
  const subOther = comparisons.filter(
    (c) => c.sublane?.mode === "other-must-be-null" && c.sublane.status === "pass",
  ).length
  const subTotal = subSpecific + subWithinLane + subAnyValid + subOther
  const halluc = comparisons.filter((c) => c.sublane?.hallucination).length
  const laneHalluc = comparisons.filter((c) => c.lane?.hallucination).length
  const confOk = comparisons.filter((c) => c.confidence?.status === "pass").length
  const descOk = comparisons.filter((c) => c.description?.status === "pass").length

  const expectedConf = countConfidence(comparisons, (c) => c.confidence?.expected)
  const actualConf = countConfidence(comparisons, (c) => c.confidence?.actual)

  const lines: string[] = []
  lines.push("")
  lines.push("=== SUMMARY ===")
  lines.push(`Total cases: ${n}`)
  lines.push(`  PASS:        ${ok}`)
  lines.push(`  FAIL:        ${fail}`)
  lines.push(`  LLM_ERROR:   ${llmErr}`)
  lines.push(`  PARSE_ERROR: ${parseErr}`)
  lines.push("")
  lines.push("Per-field match rates:")
  lines.push(`  Lane match:        ${laneOk}/${n}`)
  lines.push(`  Lane hallucinations:     ${laneHalluc}`)
  lines.push(`  Sub-lane match:    ${subTotal}/${n}   (specific=${subSpecific}, within-lane-match=${subWithinLane}, within-lane-other-valid=${subAnyValid}, other-null=${subOther})`)
  lines.push(`  Sub-lane hallucinations: ${halluc}`)
  lines.push(`  Confidence match:  ${confOk}/${n}`)
  lines.push(`  Description shape: ${descOk}/${n}`)
  lines.push("")
  lines.push(`Confidence distribution — expected: high=${expectedConf.high} medium=${expectedConf.medium} low=${expectedConf.low}`)
  lines.push(`Confidence distribution — actual:   high=${actualConf.high} medium=${actualConf.medium} low=${actualConf.low}`)
  return lines.join("\n")
}

function countConfidence(
  comparisons: CaseComparison[],
  pick: (c: CaseComparison) => InferenceOutput["confidence"] | undefined,
): { high: number; medium: number; low: number } {
  const out = { high: 0, medium: 0, low: 0 }
  for (const c of comparisons) {
    const v = pick(c)
    if (v === "high") out.high++
    else if (v === "medium") out.medium++
    else if (v === "low") out.low++
  }
  return out
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const results: CaseComparison[] = []
  const lines: string[] = []

  lines.push(`Model:  ${MODEL}`)
  lines.push(`Cases:  ${SYNTHETIC_SAMPLES.length}`)
  lines.push(`Temp:   0 (deterministic)`)
  lines.push("")

  for (const c of SYNTHETIC_SAMPLES) {
    const { raw, parsed, error } = await inferOne(c)

    if (error?.startsWith("llm:")) {
      const cmp: CaseComparison = {
        caseId: c.id,
        label: c.label,
        outcome: "LLM_ERROR",
        lane: { expected: c.expected.lane, actual: "", status: "fail", hallucination: false },
        sublane: {
          expected: c.expected.sublane,
          actual: null,
          mode: "specific",
          status: "fail",
          hallucination: false,
        },
        confidence: {
          expected: c.expected.confidence,
          actual: "low",
          status: "fail",
        },
        description: {
          expectedShape:
            c.expected.lane === "other" ? "nonempty" : "null",
          actual: null,
          status: "fail",
        },
        reasoning: null,
        rawResponse: "",
        error,
      }
      results.push(cmp)
      console.log(formatCase(cmp))
      lines.push(formatCase(cmp))
      continue
    }

    if (error?.startsWith("parse:") || !parsed) {
      const cmp: CaseComparison = {
        caseId: c.id,
        label: c.label,
        outcome: "PARSE_ERROR",
        lane: { expected: c.expected.lane, actual: "", status: "fail", hallucination: false },
        sublane: {
          expected: c.expected.sublane,
          actual: null,
          mode: "specific",
          status: "fail",
          hallucination: false,
        },
        confidence: {
          expected: c.expected.confidence,
          actual: "low",
          status: "fail",
        },
        description: {
          expectedShape:
            c.expected.lane === "other" ? "nonempty" : "null",
          actual: null,
          status: "fail",
        },
        reasoning: null,
        rawResponse: raw ?? "",
        error: error ?? "no parsed output",
      }
      results.push(cmp)
      console.log(formatCase(cmp))
      lines.push(formatCase(cmp))
      continue
    }

    const cmp = compareCase(c, parsed, raw ?? "")
    results.push(cmp)
    console.log(formatCase(cmp))
    lines.push(formatCase(cmp))
  }

  const summary = formatSummary(results)
  console.log(summary)
  lines.push(summary)

  // Persist transcript
  const resultsDir = join(
    "scripts",
    "migrate-candidate-targeting",
    "results",
  )
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = join(resultsDir, `synthetic-${ts}.txt`)
  writeFileSync(outPath, lines.join("\n"), "utf8")
  console.log(`\nTranscript saved: ${outPath}`)

  // Exit code: non-zero if any failures (so CI / runs flag visibly)
  const fail = results.some(
    (r) =>
      r.outcome === "FAIL" ||
      r.outcome === "LLM_ERROR" ||
      r.outcome === "PARSE_ERROR",
  )
  if (fail) process.exit(1)
}

main().catch((e) => {
  console.error("Fatal:", e)
  process.exit(1)
})
