// tests/positioning-v2/phase2/grounding-validator-check.ts
//
// Unit tests for lib/positioning/v2/phase2/groundingValidator.ts (Stage 2c
// Commit 4). Tests both:
//   - validateDraftGrounding: three-rule heuristic (numeric strict,
//     capitalized proper noun strict, content word lenient with competence
//     list + stem matching)
//   - isAcceptableAiResult: empty-drafts + per-draft grounding combined
//     into a single signal for /draft route's retry loop
//
// Pure-function tests — no DB, no async, no fixtures beyond inline strings.
//
// Run:
//   npx tsx tests/positioning-v2/phase2/grounding-validator-check.ts

import {
  validateDraftGrounding,
  isAcceptableAiResult,
} from "@/lib/positioning/v2/phase2/groundingValidator"

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

// Convenience: returns true if validator passed
function pass(draft: string, allowedSources: string[]): boolean {
  return validateDraftGrounding({ draft, allowedSources }).ok
}

// Convenience: returns ungrounded entities (or [] on pass)
function fail(draft: string, allowedSources: string[]): string[] {
  const r = validateDraftGrounding({ draft, allowedSources })
  return r.ok ? [] : r.ungrounded_entities
}

// ============================================================================

console.log("=== Group 1: Tokenization edge cases ===")

// 1: empty string fails with marker
{
  const r = validateDraftGrounding({ draft: "", allowedSources: ["anything"] })
  check(
    "1: empty draft → ok=false with (empty draft) marker",
    !r.ok && r.ungrounded_entities.includes("(empty draft)"),
    JSON.stringify(r),
  )
}

// 2: whitespace-only draft treated as empty
{
  const r = validateDraftGrounding({
    draft: "   \n\t  ",
    allowedSources: ["anything"],
  })
  check(
    "2: whitespace-only draft → ok=false (empty draft)",
    !r.ok && r.ungrounded_entities.includes("(empty draft)"),
    JSON.stringify(r),
  )
}

// 3: single short word filtered (length < 3)
{
  // "to" is < 3 chars; "be" is < 3 chars. Both skipped, no content tokens.
  check(
    "3: draft with only short words/stopwords passes (no content to check)",
    pass("to be", ["unrelated source text"]),
  )
}

// 4: punctuation stripped from token edges
{
  // "Managed!" should tokenize to "Managed" (competence word, passes Rule 3)
  check(
    "4: trailing punctuation stripped before check",
    pass("Managed projects!", ["worked on initiatives"]),
  )
}

// ============================================================================
console.log("\n=== Group 2: Rule 1 (numeric strict) ===")

// 5: invented percentage rejected
{
  const ungrounded = fail("Increased revenue by 47%", ["I worked on sales"])
  check(
    "5: 47% not in source → ungrounded",
    ungrounded.includes("47%"),
    JSON.stringify(ungrounded),
  )
}

// 6: invented dollar amount rejected
{
  const ungrounded = fail("Managed $50K budget", ["led the team"])
  check(
    "6: $50K not in source → ungrounded",
    ungrounded.some((u) => u.toLowerCase().includes("50")),
    JSON.stringify(ungrounded),
  )
}

// 7: numeric in source accepted (verbatim match)
{
  // Draft "23%" should be grounded if source contains "23%"
  check(
    "7: 23% in source → grounded",
    pass("achieved 23% over baseline", ["grew metrics 23% over baseline"]),
  )
}

// 8: integer not in source rejected
{
  const ungrounded = fail("Led team of 12 engineers", ["managed a team"])
  check(
    "8: 12 not in source → ungrounded",
    ungrounded.includes("12"),
    JSON.stringify(ungrounded),
  )
}

// ============================================================================
console.log("\n=== Group 3: Rule 2 (capitalized proper nouns) ===")

// 9: invented tool name rejected (mid-sentence capitalized)
{
  const ungrounded = fail("Used HubSpot to manage leads", [
    "managed the sales pipeline",
  ])
  check(
    "9: HubSpot not in source → ungrounded",
    ungrounded.includes("HubSpot"),
    JSON.stringify(ungrounded),
  )
}

// 10: invented company name rejected
{
  const ungrounded = fail("worked at Goldman Sachs", ["worked at a bank"])
  check(
    "10: Goldman not in source → ungrounded",
    ungrounded.includes("Goldman"),
    JSON.stringify(ungrounded),
  )
}

// 11: company name in source accepted (case-insensitive)
{
  check(
    "11: Salesforce in source → grounded",
    pass("Salesforce expertise demonstrated", ["worked with salesforce admin"]),
  )
}

// 12: sentence-start capitalized falls through to Rule 3 (known limitation)
{
  // "Managed" at sentence start is in COMPETENCE_WORDS so Rule 3 passes it.
  // Documents that sentence-start handling correctly bypasses Rule 2 for
  // common verbs.
  check(
    "12: sentence-start 'Managed' bypasses Rule 2 (competence) → grounded",
    pass("Managed key initiatives", ["led various initiatives"]),
  )
}

// ============================================================================
console.log("\n=== Group 4: Rule 3 (content words) ===")

// 13: tool name not in source rejected (lowercase, no competence match)
{
  const ungrounded = fail("python scripting expertise", [
    "wrote various scripts for data tasks",
  ])
  check(
    "13: 'python' not in source, not competence → ungrounded",
    ungrounded.includes("python"),
    JSON.stringify(ungrounded),
  )
}

// 14: abstract domain word not in source rejected
{
  const ungrounded = fail("performed cryptographic analysis", [
    "did analysis work",
  ])
  check(
    "14: 'cryptographic' not in source, not competence → ungrounded",
    ungrounded.includes("cryptographic"),
    JSON.stringify(ungrounded),
  )
}

// 15: competence word always passes (not in source)
{
  check(
    "15: 'achieved' always passes (competence word) even with empty source",
    pass("achieved demonstrated expertise", [""]),
  )
}

// 16: stem matching — 'managed' matches source 'manager'
{
  // 'managed' is in COMPETENCE_WORDS so passes directly. Use a non-competence
  // verb to test stem matching specifically.
  check(
    "16: stem match 'analyzing' (stem 'analy') matches source 'analyzed'",
    pass("analyzing customer behavior", ["analyzed customer behavior"]),
  )
}

// 17: false-reject acknowledgment (conservative-validator principle)
{
  // Source uses different words for the same concept. Validator rejects.
  // This is acceptable per the conservative-validator principle — the user
  // is routed to manual-entry mode rather than risking an ungrounded claim.
  const ungrounded = fail("negotiated favorable terms", [
    "worked out a good deal",
  ])
  check(
    "17: paraphrase 'negotiated/favorable/terms' rejected (conservative principle)",
    ungrounded.length > 0,
    `Expected at least 1 ungrounded; got ${JSON.stringify(ungrounded)}`,
  )
}

// ============================================================================
console.log("\n=== Group 5: Happy paths ===")

// 18: exact substring of source passes
{
  check(
    "18: draft is exact substring of source → grounded",
    pass("managed the sales pipeline", [
      "I have managed the sales pipeline for two years",
    ]),
  )
}

// 19: full competence-only draft passes
{
  check(
    "19: draft of only competence words + stopwords → grounded with empty source",
    pass("Led the team and delivered key project tasks", [""]),
  )
}

// 20: paraphrase via stem matching passes
{
  // "developing" (stem "devel") matches "developed" (stem "devel") in source
  check(
    "20: 'developing' stem-matches source 'developed' → grounded",
    pass("developing customer connections", [
      "developed strong customer connections",
    ]),
  )
}

// ============================================================================
console.log("\n=== Group 6: Per-pattern integration ===")

// 21: Pattern A headline grounded against full resume
{
  const resume =
    "Marketing student with internship experience at retail company. Skills include Excel and social media analytics."
  check(
    "21: headline draft against full resume → grounded",
    pass("Marketing student with social media analytics expertise", [resume]),
  )
}

// 22: Pattern B bullet grounded against original_bullet + user_response
{
  const originalBullet = "Helped with social media posts"
  const userResponse =
    "I wrote captions and tracked engagement metrics across platforms"
  check(
    "22: bullet draft against original+user → grounded",
    pass("Wrote social media captions and tracked engagement metrics", [
      originalBullet,
      userResponse,
    ]),
  )
}

// 23: Pattern C gap grounded against gap_description + user_response
{
  const gapDescription =
    "JD requires Excel; resume doesn't mention spreadsheet skills"
  const userResponse =
    "Used Excel pivot tables and VLOOKUP for coursework analysis"
  check(
    "23: gap draft against gap+user → grounded",
    pass("Excel pivot tables and VLOOKUP analysis from coursework", [
      gapDescription,
      userResponse,
    ]),
  )
}

// ============================================================================
console.log("\n=== Group 7: isAcceptableAiResult helper ===")

// 24: empty drafts → empty_drafts reason
{
  const r = isAcceptableAiResult([], ["any source"])
  check(
    "24: empty drafts array → ok=false reason=empty_drafts",
    !r.ok && r.reason === "empty_drafts",
    JSON.stringify(r),
  )
}

// 25: all drafts valid → ok=true
{
  const r = isAcceptableAiResult(
    ["managed the team", "led the project"],
    ["managed the team for a year, led the project from start"],
  )
  check(
    "25: all drafts grounded → ok=true",
    r.ok === true,
    JSON.stringify(r),
  )
}

// 26: one ungrounded draft → ok=false reason=ungrounded with entities
{
  const r = isAcceptableAiResult(
    ["Used HubSpot extensively"],
    ["worked with various tools"],
  )
  check(
    "26: ungrounded draft → ok=false reason=ungrounded",
    !r.ok &&
      r.reason === "ungrounded" &&
      (r.ungrounded_entities ?? []).includes("HubSpot"),
    JSON.stringify(r),
  )
}

// 27: mixed grounded + ungrounded → ok=false aggregating only the bad entities
{
  const r = isAcceptableAiResult(
    ["managed the team", "Used Salesforce for outreach"],
    ["managed the team"],
  )
  check(
    "27: mixed result → ok=false reason=ungrounded aggregating bad entities",
    !r.ok &&
      r.reason === "ungrounded" &&
      (r.ungrounded_entities ?? []).includes("Salesforce"),
    JSON.stringify(r),
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
