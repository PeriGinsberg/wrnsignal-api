// tests/positioning-v2/phase2/item-populator-templates-check.ts
//
// Unit checks for templates.ts pure string builders + a lightweight
// compilation check for itemPopulatorParts/types.ts shape exports.
//
// Run: npx tsx tests/positioning-v2/phase2/item-populator-templates-check.ts
// Exits 1 on any failure.

import {
  bulletLabel,
  bulletQuestionTemplate,
  gapLabel,
  gapQuestionTemplate,
  headlineLabel,
} from "@/lib/positioning/v2/phase2/itemPopulatorParts/templates"
import type {
  BulletCandidate,
  GapCandidate,
  HeadlineCandidate,
} from "@/lib/positioning/v2/phase2/itemPopulatorParts/types"

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
// bulletQuestionTemplate
// ============================================================================

console.log("=== bulletQuestionTemplate ===")

{
  const q = bulletQuestionTemplate(
    "Lead photographer for editorial shoots",
    "JD asks for stakeholder management experience",
  )
  check(
    "1: includes the original bullet in quotes",
    q.includes('You wrote: "Lead photographer for editorial shoots"'),
  )
  check(
    "1: includes the JD context",
    q.includes("The job is asking for: JD asks for stakeholder management experience"),
  )
  check(
    "1: includes the 2-4 sentences instruction",
    /2-4 sentences/i.test(q),
  )
  check(
    "1: asks about outcome, who was involved, tools/methods",
    /outcome/i.test(q) && /involved/i.test(q) && /tools or methods/i.test(q),
  )
}

// ============================================================================
// gapQuestionTemplate
// ============================================================================

console.log("\n=== gapQuestionTemplate ===")

{
  const q = gapQuestionTemplate(
    "marketing analytics tools and campaign performance",
    "Required: experience tracking campaign performance using Google Analytics",
  )
  check(
    "2: uses jdContext as the 'The job asks for' anchor",
    q.startsWith(
      "The job asks for: Required: experience tracking campaign performance using Google Analytics",
    ),
  )
  check(
    "2: includes \"doesn't directly mention this\"",
    q.includes("doesn't directly mention this"),
  )
  check(
    "2: includes the LOAD-BEARING 'if you genuinely don't have this experience, that's fine' exit",
    /if you genuinely don't have this experience, that's fine/i.test(q),
  )
  check(
    "2: lists coursework / projects / internships / volunteer transferable sources",
    /coursework/i.test(q) &&
      /projects/i.test(q) &&
      /internships/i.test(q) &&
      /volunteer/i.test(q),
  )
  check(
    "2: asks for 2-4 sentences",
    /2-4 sentences/i.test(q),
  )
}

{
  // gapDescription is in the signature but not interpolated into the body —
  // the template uses jdContext as anchor. Verify by passing a distinctive
  // gapDescription and asserting it does NOT appear in the output.
  const q = gapQuestionTemplate(
    "DISTINCTIVE_GAP_DESCRIPTION_MARKER_XYZ",
    "The actual JD line goes here",
  )
  check(
    "3: gapDescription is not interpolated into template body",
    !q.includes("DISTINCTIVE_GAP_DESCRIPTION_MARKER_XYZ"),
  )
}

// ============================================================================
// Labels — with content
// ============================================================================

console.log("\n=== Labels (with content) ===")

{
  check(
    "4: headlineLabel with jobTitle → 'Reframe headline for X'",
    headlineLabel("Marketing Coordinator") === "Reframe headline for Marketing Coordinator",
  )
}

{
  check(
    "5: bulletLabel with keyword → 'Reframe bullet: X'",
    bulletLabel("ANALYSIS AND REPORTING") === "Reframe bullet: ANALYSIS AND REPORTING",
  )
}

{
  check(
    "6: gapLabel with keyword → 'Address X'",
    gapLabel("financial_analysis") === "Address financial_analysis",
  )
}

// ============================================================================
// Labels — empty-string fallback
// ============================================================================

console.log("\n=== Labels (empty-string fallback) ===")

{
  check(
    "7: headlineLabel with empty jobTitle → 'Reframe headline' (no trailing 'for')",
    headlineLabel("") === "Reframe headline",
    headlineLabel(""),
  )
}

{
  check(
    "8: bulletLabel with empty keyword → 'Reframe bullet' (no trailing colon)",
    bulletLabel("") === "Reframe bullet",
    bulletLabel(""),
  )
}

{
  check(
    "9: gapLabel with empty keyword → 'Address gap'",
    gapLabel("") === "Address gap",
    gapLabel(""),
  )
}

// ============================================================================
// Candidate type shape compilation check
// ============================================================================

console.log("\n=== Candidate type shape compilation ===")

{
  // Construct one of each candidate type to verify the types are
  // structurally compatible with the expected shapes. Failures here
  // would surface at tsc time; this runtime check is belt-and-suspenders.
  const h: HeadlineCandidate = {
    kind: "synthesize",
    jobTitle: "X",
    jobFamily: null,
    topWhyKeywords: [],
  }
  const b: BulletCandidate = {
    original_bullet: "x",
    jd_context: "y",
    keyword: "z",
    action_match: "retitle",
  }
  const g: GapCandidate = {
    gap_description: "x",
    jd_context: "y",
    keyword: "z",
  }
  check(
    "10: HeadlineCandidate / BulletCandidate / GapCandidate shapes constructed",
    h.jobTitle === "X" && b.keyword === "z" && g.keyword === "z",
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
