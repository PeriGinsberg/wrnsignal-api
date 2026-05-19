// tests/positioning-v2/phase2/item-populator-check.ts
//
// Integration checks for the populateItems orchestrator. Plain tsx,
// no DB / LLM / I/O. Combines the six pure helpers wired into a single
// case-gated transformation per FRD §6.2.
//
// Run: npx tsx tests/positioning-v2/phase2/item-populator-check.ts
// Exits 1 on any failure.

import { populateItems } from "@/lib/positioning/v2/phase2/itemPopulator"
import type {
  Case,
  JobfitResultJson,
  PositioningRunV2Row,
} from "@/lib/positioning/v2/types"
import type {
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
} from "@/lib/positioning/v2/phase2/types"
import {
  CATHERINE_JOBFIT_WITH_UNITS,
  CATHERINE_RESUME_ANCHORED_LINE,
  CATHERINE_RESUME_SLICE,
  REQ_CORE_FINANCIAL_ANALYSIS,
} from "./fixtures"

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

/** Minimal PositioningRunV2Row fixture builder. Only the fields populateItems
 *  reads (case_assigned, id) are meaningful; the rest fill type slots. */
function makePositioningRun(caseAssigned: Case, id = "run-test-1"): PositioningRunV2Row {
  return {
    id,
    profile_id: "profile-1",
    persona_id: "persona-1",
    jobfit_run_id: "jobfit-1",
    signal_application_id: null,
    job_title: "Test Title",
    job_company: "Test Co",
    job_url: null,
    job_description: "Test JD",
    case_assigned: caseAssigned,
    case_reasoning: "fixture",
    current_phase: 1,
    phase_data: {},
    status: "in_progress",
    fingerprint_hash: "hash",
    fingerprint_code: "code",
    result_json: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    completed_at: null,
  }
}

// ============================================================================
// Test 1 — Happy path Case B against the Catherine fixture
// ============================================================================

console.log("=== Happy path (Catherine fixture, Case B) ===")

{
  const run = makePositioningRun("B")
  const items = populateItems(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_SLICE,
  )

  check(
    "1: returns a non-empty array",
    Array.isArray(items) && items.length > 0,
    `length=${items.length}`,
  )

  const headlines = items.filter((i) => i.type === "headline")
  const bullets = items.filter((i) => i.type === "bullet")
  const gaps = items.filter((i) => i.type === "gap")

  check(
    "1: exactly one headline item (jobTitle present in fixture)",
    headlines.length === 1,
    `headlines=${headlines.length}`,
  )
  check(
    "1: at least one bullet item (Catherine fixture anchors reframe-flavored whys)",
    bullets.length >= 1,
    `bullets=${bullets.length}`,
  )
  check(
    "1: at least one gap item (Catherine fixture has core financial_analysis unrepresented)",
    gaps.length >= 1,
    `gaps=${gaps.length}`,
  )

  // Headline shape
  const h = headlines[0] as PhaseTwoHeadlineItem
  check("1: headline.id === 'headline-1'", h?.id === "headline-1")
  check("1: headline.type === 'headline'", h?.type === "headline")
  check(
    "1: headline.label starts with 'Reframe headline for '",
    typeof h?.label === "string" &&
      h.label.startsWith("Reframe headline for "),
    h?.label,
  )
  check(
    "1: headline.original starts with 'Headline targeting: '",
    typeof h?.original === "string" &&
      h.original.startsWith("Headline targeting: "),
    h?.original,
  )
  check(
    "1: headline.draft_options === [] (seed state)",
    Array.isArray(h?.draft_options) && h.draft_options.length === 0,
  )
  check(
    "1: headline seed flags (all false) + decided_at null",
    h?.accepted === false &&
      h.declined === false &&
      h.skipped === false &&
      h.manual_entry === false &&
      h.decided_at === null,
  )
  check(
    "1: headline.selected_draft_index / user_override_text / final_text all null",
    h?.selected_draft_index === null &&
      h.user_override_text === null &&
      h.final_text === null,
  )

  // Bullet shape (first one)
  const b = bullets[0] as PhaseTwoBulletItem
  check("1: first bullet.id === 'bullet-1'", b?.id === "bullet-1")
  check("1: first bullet.type === 'bullet'", b?.type === "bullet")
  check(
    "1: first bullet.label starts with 'Reframe bullet: '",
    typeof b?.label === "string" && b.label.startsWith("Reframe bullet: "),
    b?.label,
  )
  check(
    "1: first bullet.original_bullet is the verbatim SWOT line",
    b?.original_bullet === CATHERINE_RESUME_ANCHORED_LINE,
    b?.original_bullet?.slice(0, 80),
  )
  check(
    "1: first bullet.question_asked contains 'You wrote:' template",
    typeof b?.question_asked === "string" &&
      b.question_asked.startsWith("You wrote:"),
  )
  check(
    "1: first bullet.question_asked contains the 2-4 sentences instruction",
    typeof b?.question_asked === "string" && /2-4 sentences/i.test(b.question_asked),
  )
  check(
    "1: bullet seed flags (all false), draft/user_response/final_text null",
    b?.accepted === false &&
      b.declined === false &&
      b.skipped === false &&
      b.manual_entry === false &&
      b.decided_at === null &&
      b.draft === null &&
      b.user_response === null &&
      b.final_text === null,
  )

  // Gap shape (first one)
  const g = gaps[0] as PhaseTwoGapItem
  check("1: first gap.id === 'gap-1'", g?.id === "gap-1")
  check("1: first gap.type === 'gap'", g?.type === "gap")
  check(
    "1: first gap.label === 'Address financial_analysis'",
    g?.label === "Address financial_analysis",
    g?.label,
  )
  check(
    "1: first gap.gap_description === requirement.label",
    g?.gap_description === REQ_CORE_FINANCIAL_ANALYSIS.label,
  )
  check(
    "1: first gap.question_asked starts with 'The job asks for: '",
    typeof g?.question_asked === "string" &&
      g.question_asked.startsWith("The job asks for: "),
  )
  check(
    "1: first gap.question_asked contains the LOAD-BEARING exit clause",
    typeof g?.question_asked === "string" &&
      /if you genuinely don't have this experience, that's fine/i.test(
        g.question_asked,
      ),
  )
  check(
    "1: gap seed flags (all false), draft/user_response/final_text null",
    g?.accepted === false &&
      g.declined === false &&
      g.skipped === false &&
      g.manual_entry === false &&
      g.decided_at === null &&
      g.draft === null &&
      g.user_response === null &&
      g.final_text === null,
  )
}

// ============================================================================
// Test 2 — Verbatim invariant (permanent architectural test)
// ============================================================================

console.log("\n=== Verbatim invariant (permanent) ===")

{
  const run = makePositioningRun("B")
  const items = populateItems(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_SLICE,
  )
  const bullets = items.filter(
    (i): i is PhaseTwoBulletItem => i.type === "bullet",
  )
  check(
    "2: every bullet has at least one anchored item to validate",
    bullets.length > 0,
  )
  let allVerbatim = true
  for (const b of bullets) {
    if (CATHERINE_RESUME_SLICE.indexOf(b.original_bullet) < 0) {
      allVerbatim = false
      console.log(
        `       FAIL: bullet ${b.id} original_bullet not found verbatim: "${b.original_bullet.slice(0, 80)}"`,
      )
    }
  }
  check(
    "2: every emitted bullet.original_bullet appears char-for-char in resumeText",
    allVerbatim,
  )
}

// ============================================================================
// Test 3 — Case A returns []
// ============================================================================

console.log("\n=== Case gate — Case A ===")

{
  const run = makePositioningRun("A")
  const items = populateItems(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "3: Case A run with otherwise-anchorable inputs → []",
    Array.isArray(items) && items.length === 0,
    `length=${items.length}`,
  )
}

// ============================================================================
// Test 4 — Case C returns []
// ============================================================================

console.log("\n=== Case gate — Case C ===")

{
  const run = makePositioningRun("C")
  const items = populateItems(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "4: Case C run with otherwise-anchorable inputs → []",
    Array.isArray(items) && items.length === 0,
    `length=${items.length}`,
  )
}

// ============================================================================
// Test 5 — Caps enforcement (bullets ≤ 3, gaps ≤ 3)
// ============================================================================

console.log("\n=== Caps enforcement ===")

{
  // 5 reframe-flavored whys, all anchoring on the same resume line. Helper
  // will surface 5 candidates; orchestrator must cap at 3.
  const fiveWhys = Array.from({ length: 5 }, (_, i) => ({
    keyword: `KW_${i + 1}`,
    lead: "alpha beta gamma delta echo",
    connection: "jd asks for thing",
    action: `Please retitle this bullet ${i + 1}.`,
  }))
  const jobfit = {
    job_signals: { jobTitle: "Test Role" },
    why_structured: fiveWhys,
  } as JobfitResultJson
  const resume = "alpha beta gamma delta echo content here"
  const run = makePositioningRun("B")
  const items = populateItems(run, jobfit, null, resume)
  const bullets = items.filter((i) => i.type === "bullet")
  check(
    "5: 5 anchorable reframe-flavored whys → exactly 3 bullet items (cap)",
    bullets.length === 3,
    `bullets=${bullets.length}`,
  )
  // Position IDs are correctly 1..3
  check(
    "5: bullet IDs are bullet-1, bullet-2, bullet-3",
    bullets[0]?.id === "bullet-1" &&
      bullets[1]?.id === "bullet-2" &&
      bullets[2]?.id === "bullet-3",
    bullets.map((b) => b.id).join(","),
  )
}

{
  // 5 core requirements, all absent from the resume. Helper will surface 5
  // candidates; orchestrator must cap at 3.
  const fiveCoreUnits = Array.from({ length: 5 }, (_, i) => ({
    id: `req-${i + 1}`,
    key: `core_key_${i + 1}`,
    kind: "function",
    label: `core requirement label ${i + 1}`,
    snippet: `JD snippet for requirement ${i + 1}`,
    strength: 8,
    functionTag: "test",
    requiredness: "core",
  }))
  const jobfit = {
    job_signals: { jobTitle: "Test Role", requirement_units: fiveCoreUnits },
  } as unknown as JobfitResultJson
  const resume = "completely unrelated short resume"
  const run = makePositioningRun("B")
  const items = populateItems(run, jobfit, null, resume)
  const gaps = items.filter((i) => i.type === "gap")
  check(
    "5b: 5 unrepresented core requirements → exactly 3 gap items (cap)",
    gaps.length === 3,
    `gaps=${gaps.length}`,
  )
  check(
    "5b: gap IDs are gap-1, gap-2, gap-3",
    gaps[0]?.id === "gap-1" &&
      gaps[1]?.id === "gap-2" &&
      gaps[2]?.id === "gap-3",
    gaps.map((g) => g.id).join(","),
  )
}

// ============================================================================
// Test 6 — Canonical ordering
// ============================================================================

console.log("\n=== Canonical ordering ===")

{
  const run = makePositioningRun("B")
  const items = populateItems(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_SLICE,
  )
  // Build a "kind" sequence and verify it's headline → bullets → gaps.
  const kinds = items.map((i) => i.type)
  const firstBulletIdx = kinds.indexOf("bullet")
  const firstGapIdx = kinds.indexOf("gap")
  const lastHeadlineIdx = kinds.lastIndexOf("headline")
  const lastBulletIdx = kinds.lastIndexOf("bullet")

  check(
    "6: headline (if present) precedes all bullets",
    lastHeadlineIdx < firstBulletIdx,
    `lastHeadline=${lastHeadlineIdx} firstBullet=${firstBulletIdx}`,
  )
  check(
    "6: last bullet precedes first gap",
    lastBulletIdx < firstGapIdx,
    `lastBullet=${lastBulletIdx} firstGap=${firstGapIdx}`,
  )
  check(
    "6: no headline appears after a bullet or gap",
    lastHeadlineIdx === kinds.indexOf("headline"),
  )
}

// ============================================================================
// Test 7 — Zero-items edge cases
// ============================================================================

console.log("\n=== Zero-items edge cases ===")

{
  // jobfit with no reframe-flavored whys AND no unrepresented requirements,
  // but jobTitle present → returns [headlineItem] only.
  const jobfit: JobfitResultJson = {
    job_signals: { jobTitle: "Test Role" },
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta gamma",
        connection: "ctx",
        action: "Mention in your cover letter", // not reframe-flavored
      },
    ],
  }
  const run = makePositioningRun("B")
  const items = populateItems(run, jobfit, null, "alpha beta gamma")
  check(
    "7: only-jobTitle (no anchorable whys, no core requirements) → [headlineItem]",
    items.length === 1 && items[0].type === "headline",
    `length=${items.length}, types=[${items.map((i) => i.type).join(",")}]`,
  )
}

{
  // Same but jobTitle missing → returns [].
  const jobfit: JobfitResultJson = {
    job_signals: { jobFamily: "HR" }, // no jobTitle
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta gamma",
        connection: "ctx",
        action: "Mention in your cover letter",
      },
    ],
  }
  const run = makePositioningRun("B")
  const items = populateItems(run, jobfit, null, "alpha beta gamma")
  check(
    "8: no jobTitle, no anchorable whys, no core requirements → []",
    items.length === 0,
    `length=${items.length}`,
  )
}

// ============================================================================
// Test 9 — Defensive: null jobfit, empty resume, wrong-type case
// ============================================================================

console.log("\n=== Defensive ===")

{
  const run = makePositioningRun("B")
  const items = populateItems(
    run,
    null as unknown as JobfitResultJson,
    null,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "9: null jobfit (Case B) → [] (all extractors short-circuit)",
    items.length === 0,
    `length=${items.length}`,
  )
}

{
  // Empty resumeText: headline can still emit (jobTitle present), but
  // extractBulletCandidates returns [] (empty resume guard) and
  // extractGapCandidates emits everything (no content to check against).
  // The fixture has 1 core requirement, so total = 1 headline + 1 gap = 2.
  const run = makePositioningRun("B")
  const items = populateItems(run, CATHERINE_JOBFIT_WITH_UNITS, null, "")
  const headlines = items.filter((i) => i.type === "headline")
  const bullets = items.filter((i) => i.type === "bullet")
  const gaps = items.filter((i) => i.type === "gap")
  check(
    "10: empty resumeText → headline emits (jobTitle present)",
    headlines.length === 1,
    `headlines=${headlines.length}`,
  )
  check(
    "10: empty resumeText → bullets = [] (anchorBullet bails on empty resume)",
    bullets.length === 0,
    `bullets=${bullets.length}`,
  )
  check(
    "10: empty resumeText → gaps emitted (no resume content to represent)",
    gaps.length >= 1,
    `gaps=${gaps.length}`,
  )
}

{
  // Wrong-type case_assigned (cast through unknown to bypass the literal
  // union). The case gate's strict !== "B" comparison should reject it.
  const run = {
    ...makePositioningRun("B"),
    case_assigned: "Z" as unknown as Case,
  }
  const items = populateItems(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_SLICE,
  )
  check(
    "11: wrong-type case_assigned ('Z') → []",
    items.length === 0,
    `length=${items.length}`,
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
