// tests/positioning-v2/phase2/prompt-templates-check.ts
//
// Unit tests for the Phase 2 prompt builders + system prompt:
//   - lib/positioning/v2/phase2/prompts/systemPrompt.ts (SYSTEM_PROMPT)
//   - lib/positioning/v2/phase2/prompts/headlinePrompt.ts (buildHeadlinePrompt)
//   - lib/positioning/v2/phase2/prompts/bulletPrompt.ts (buildBulletPrompt)
//   - lib/positioning/v2/phase2/prompts/gapPrompt.ts (buildGapPrompt)
//
// Pure-function tests — no DB, no async, no fixtures.
//
// Run:
//   npx tsx tests/positioning-v2/phase2/prompt-templates-check.ts

import { SYSTEM_PROMPT } from "@/lib/positioning/v2/phase2/prompts/systemPrompt"
import {
  buildHeadlinePrompt,
  MAX_TOKENS_HEADLINE,
} from "@/lib/positioning/v2/phase2/prompts/headlinePrompt"
import {
  buildBulletPrompt,
  MAX_TOKENS_BULLET,
} from "@/lib/positioning/v2/phase2/prompts/bulletPrompt"
import {
  buildGapPrompt,
  MAX_TOKENS_GAP,
} from "@/lib/positioning/v2/phase2/prompts/gapPrompt"

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
// SYSTEM_PROMPT tests
// ============================================================================

console.log("=== SYSTEM_PROMPT ===")

check(
  "system: non-empty string",
  typeof SYSTEM_PROMPT === "string" && SYSTEM_PROMPT.length > 0,
)
check(
  "system: includes SIGNAL role declaration",
  SYSTEM_PROMPT.includes("SIGNAL"),
)
check(
  "system: includes ONLY constraint (no invention)",
  /\bONLY\b/.test(SYSTEM_PROMPT) && /Do NOT introduce/.test(SYSTEM_PROMPT),
)
check(
  "system: includes insufficient_source_evidence escape hatch",
  SYSTEM_PROMPT.includes("insufficient_source_evidence"),
)

// ============================================================================
// Headline (Pattern A) tests
// ============================================================================

console.log("\n=== buildHeadlinePrompt (Pattern A) ===")

{
  const out = buildHeadlinePrompt({
    resumeText: "RESUME_TEXT_MARKER",
    jobDescription: "JD_TEXT_MARKER",
    originalHeadline: "ORIGINAL_HEADLINE_MARKER",
  })

  check(
    "headline: returns non-empty string",
    typeof out === "string" && out.length > 0,
  )
  check(
    "headline: interpolates resumeText",
    out.includes("RESUME_TEXT_MARKER"),
  )
  check(
    "headline: interpolates jobDescription",
    out.includes("JD_TEXT_MARKER"),
  )
  check(
    "headline: interpolates originalHeadline",
    out.includes("ORIGINAL_HEADLINE_MARKER"),
  )
  check(
    "headline: includes SOURCE / TARGET / TASK section markers",
    out.includes("=== SOURCE:") &&
      out.includes("=== TARGET:") &&
      out.includes("=== TASK ==="),
  )
  check(
    "headline: includes JSON output contract",
    out.includes('"drafts"'),
  )
  check(
    "headline: includes no-invention constraint reminder",
    /NOT invent/i.test(out),
  )
  check(
    "headline: includes insufficient_source_evidence escape",
    out.includes("insufficient_source_evidence"),
  )
  check(
    "headline: MAX_TOKENS_HEADLINE is positive integer",
    Number.isInteger(MAX_TOKENS_HEADLINE) && MAX_TOKENS_HEADLINE > 0,
    `got ${MAX_TOKENS_HEADLINE}`,
  )
}

// ============================================================================
// Bullet (Pattern B) tests
// ============================================================================

console.log("\n=== buildBulletPrompt (Pattern B) ===")

{
  const out = buildBulletPrompt({
    resumeText: "RESUME_MARKER",
    jobDescription: "JD_MARKER",
    originalBullet: "ORIGINAL_BULLET_MARKER",
    jdContext: "JD_CONTEXT_MARKER",
    userResponse: "USER_RESPONSE_MARKER",
  })

  check(
    "bullet: returns non-empty string",
    typeof out === "string" && out.length > 0,
  )
  check(
    "bullet: interpolates originalBullet",
    out.includes("ORIGINAL_BULLET_MARKER"),
  )
  check(
    "bullet: interpolates userResponse",
    out.includes("USER_RESPONSE_MARKER"),
  )
  check(
    "bullet: interpolates jdContext",
    out.includes("JD_CONTEXT_MARKER"),
  )
  check(
    "bullet: interpolates resumeText",
    out.includes("RESUME_MARKER"),
  )
  check(
    "bullet: includes SOURCE / TARGET / TASK section markers",
    out.includes("=== SOURCE:") &&
      out.includes("=== TARGET:") &&
      out.includes("=== TASK ==="),
  )
  check(
    "bullet: marks original_bullet + userResponse as PRIMARY sources",
    out.includes("PRIMARY fact source"),
  )
  check(
    "bullet: marks resume as context only",
    /context only/i.test(out),
  )
  check(
    "bullet: includes JSON output contract",
    out.includes('"drafts"'),
  )
  check(
    "bullet: includes no-invention constraint reminder",
    /NOT invent/i.test(out),
  )
  check(
    "bullet: MAX_TOKENS_BULLET is positive integer",
    Number.isInteger(MAX_TOKENS_BULLET) && MAX_TOKENS_BULLET > 0,
    `got ${MAX_TOKENS_BULLET}`,
  )
}

// ============================================================================
// Gap (Pattern C) tests
// ============================================================================

console.log("\n=== buildGapPrompt (Pattern C) ===")

{
  const out = buildGapPrompt({
    resumeText: "RESUME_GAP_MARKER",
    jobDescription: "JD_GAP_MARKER",
    gapDescription: "GAP_DESCRIPTION_MARKER",
    jdContext: "JD_GAP_CONTEXT_MARKER",
    userResponse: "GAP_USER_RESPONSE_MARKER",
  })

  check(
    "gap: returns non-empty string",
    typeof out === "string" && out.length > 0,
  )
  check(
    "gap: interpolates gapDescription",
    out.includes("GAP_DESCRIPTION_MARKER"),
  )
  check(
    "gap: interpolates userResponse",
    out.includes("GAP_USER_RESPONSE_MARKER"),
  )
  check(
    "gap: interpolates jdContext",
    out.includes("JD_GAP_CONTEXT_MARKER"),
  )
  check(
    "gap: interpolates resumeText",
    out.includes("RESUME_GAP_MARKER"),
  )
  check(
    "gap: includes SOURCE / TARGET / TASK section markers",
    out.includes("=== SOURCE:") &&
      out.includes("=== TARGET:") &&
      out.includes("=== TASK ==="),
  )
  check(
    "gap: marks userResponse as PRIMARY fact source",
    out.includes("PRIMARY fact source"),
  )
  check(
    "gap: marks resume as context only",
    /context only/i.test(out),
  )
  check(
    "gap: includes JSON output contract",
    out.includes('"drafts"'),
  )
  check(
    "gap: includes no-invention constraint reminder",
    /NOT invent/i.test(out),
  )
  check(
    "gap: MAX_TOKENS_GAP is positive integer",
    Number.isInteger(MAX_TOKENS_GAP) && MAX_TOKENS_GAP > 0,
    `got ${MAX_TOKENS_GAP}`,
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
