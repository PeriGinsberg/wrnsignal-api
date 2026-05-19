// tests/positioning-v2/phase2/item-populator-check.ts
//
// Integration checks for the populateItems orchestrator. Plain tsx,
// no DB / LLM / I/O. Combines the six pure helpers wired into a single
// case-gated transformation per FRD §6.2.
//
// Run: npx tsx tests/positioning-v2/phase2/item-populator-check.ts
// Exits 1 on any failure.

import {
  populateItems,
  type SuggestBulletsForGapImpl,
} from "@/lib/positioning/v2/phase2/itemPopulator"
import type {
  Case,
  CaseSpecificData,
  JobfitResultJson,
  PositioningRunV2Row,
} from "@/lib/positioning/v2/types"
import type {
  PhaseTwoBulletItem,
  PhaseTwoGapItem,
  PhaseTwoHeadlineItem,
  PhaseTwoItem,
} from "@/lib/positioning/v2/phase2/types"
import {
  CATHERINE_JOBFIT_WITH_UNITS,
  CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH,
  CATHERINE_RESUME_HEADLINE_BLOCK,
  CATHERINE_RESUME_NO_HEADLINE,
  CATHERINE_RESUME_SLICE,
  CATHERINE_RESUME_TEXT,
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

/**
 * No-op AI mock for tests that don't care about gap suggestions. Returns
 * empty suggestions + zero usage for every call so the existing test
 * assertions (which predate A3's AI integration) continue to hold.
 * Tests that DO care about suggestions pass a custom mock to
 * populateItems directly.
 */
const noopSuggestBullets: SuggestBulletsForGapImpl = async () => ({
  suggestions: [],
  usage: { input_tokens: 0, output_tokens: 0 },
})

/**
 * Test helper that awaits populateItems with the noop AI mock and returns
 * just `items` (the existing tests don't care about cost). Replaces
 * the synchronous `populateItems(...)` call sites that pre-date A3.
 */
async function populate(
  run: PositioningRunV2Row,
  jobfit: JobfitResultJson,
  caseSpecific: CaseSpecificData | null,
  resumeText: string,
): Promise<PhaseTwoItem[]> {
  const { items } = await populateItems(
    run,
    jobfit,
    caseSpecific,
    resumeText,
    noopSuggestBullets,
  )
  return items
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
// async main() — populateItems is async as of A3 (it awaits per-gap
// AI bullet-suggestion calls). Tests are wrapped accordingly. Matches
// ai-client-check.ts convention.
// ============================================================================

async function main(): Promise<void> {

// ============================================================================
// Test 1 — Happy path Case B against the Catherine v3 fixture (real resume)
// ============================================================================

console.log("=== Happy path (Catherine v3 real resume, Case B, replace headline) ===")

{
  const run = makePositioningRun("B")
  const items = await populate(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_TEXT,
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
    "1: exactly one headline item (real headline detected → replace path)",
    headlines.length === 1,
    `headlines=${headlines.length}`,
  )
  check(
    "1: at least one bullet item (real resume anchors reframe-flavored whys)",
    bullets.length >= 1,
    `bullets=${bullets.length}`,
  )
  // Note: REQ_CORE_FINANCIAL_ANALYSIS.label contains the token "work",
  // which appears in the v3 resume's L036 "Produced polished creative
  // work...". The label-token-overlap rule in extractGapCandidates
  // therefore considers this requirement REPRESENTED in the v3 resume,
  // so the gap doesn't emit here. Gap shape coverage is handled in
  // extract-gap-candidates-check.ts against fixtures that don't share
  // this tokenization quirk. See Test 8c below for an inline gap fixture
  // explicitly designed to fire against the v3 resume.
  void gaps

  // Headline shape — REPLACE path (real headline detected in resume)
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
    "1: headline.synthesize_mode === false (real headline detected)",
    h?.synthesize_mode === false,
    String(h?.synthesize_mode),
  )
  check(
    "1: headline.original is Catherine's real 3-sentence headline block",
    h?.original === CATHERINE_RESUME_HEADLINE_BLOCK,
    h?.original?.slice(0, 60),
  )
  check(
    "1: headline.original is verbatim in resumeText (locate-and-replace invariant)",
    typeof h?.original === "string" &&
      CATHERINE_RESUME_TEXT.includes(h.original),
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

  // Bullet shape (first one) — verbatim invariant must hold against the
  // real resume text. v3 resume has no bullet glyphs, so anchored lines
  // are bare (no "○ " prefix).
  //
  // Note on which line anchors first: WHY_REFRAME_FLAVORED.lead reads
  // "...performed industry, audience, and SWOT analyses for a boutique
  // retail brand and presented findings through a professional client
  // deck and written report." Against the v3 resume, that lead overlaps
  // L029 (SWOT line) at 5 content tokens and L031 ("Presented findings…")
  // at 7. anchorBullet picks the higher-overlap match, so the first
  // bullet's original_bullet is L031, NOT the SWOT line. The SWOT line
  // remains a *plausible* anchor (overlap ≥ 3) but loses the tiebreak.
  // This is correct behavior and the test reflects it.
  const b = bullets[0] as PhaseTwoBulletItem
  check("1: first bullet.id === 'bullet-1'", b?.id === "bullet-1")
  check("1: first bullet.type === 'bullet'", b?.type === "bullet")
  check(
    "1: first bullet.label starts with 'Reframe bullet: '",
    typeof b?.label === "string" && b.label.startsWith("Reframe bullet: "),
    b?.label,
  )
  check(
    "1: first bullet.original_bullet is verbatim in CATHERINE_RESUME_TEXT",
    typeof b?.original_bullet === "string" &&
      CATHERINE_RESUME_TEXT.includes(b.original_bullet),
    b?.original_bullet?.slice(0, 80),
  )
  check(
    "1: first bullet.original_bullet === L031 (highest-overlap anchor for WHY_REFRAME_FLAVORED)",
    b?.original_bullet ===
      "Presented findings through a professional client deck and written report",
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

  // (Gap shape coverage removed from this test — see note above re:
  // REQ_CORE_FINANCIAL_ANALYSIS.label tokenization quirk. Gap shape is
  // exhaustively asserted in extract-gap-candidates-check.ts. Test 8c
  // below uses an inline synthetic requirement to verify gap emission
  // against the v3 resume.)
}

// ============================================================================
// Test 2 — Verbatim invariant (permanent architectural test)
// ============================================================================

console.log("\n=== Verbatim invariant (permanent) ===")

{
  const run = makePositioningRun("B")
  const items = await populate(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_TEXT,
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
    if (CATHERINE_RESUME_TEXT.indexOf(b.original_bullet) < 0) {
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

  // Headline verbatim invariant — replace-kind items must satisfy the
  // same substring guarantee for resumeComposer's locate-and-replace.
  const headlines = items.filter(
    (i): i is PhaseTwoHeadlineItem => i.type === "headline",
  )
  for (const h of headlines) {
    if (!h.synthesize_mode) {
      check(
        `2: headline ${h.id} (synthesize_mode=false) original is verbatim in resumeText`,
        CATHERINE_RESUME_TEXT.includes(h.original),
        h.original.slice(0, 60),
      )
    }
  }
}

// ============================================================================
// Test 3 — Case A returns []
// ============================================================================

console.log("\n=== Case gate — Case A ===")

{
  const run = makePositioningRun("A")
  const items = await populate(
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
  const items = await populate(
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
  const items = await populate(run, jobfit, null, resume)
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
  const items = await populate(run, jobfit, null, resume)
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
  const items = await populate(
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
  // jobfit with no reframe-flavored whys, no unrepresented requirements,
  // jobTitle present, AND RISK_FAMILY_MISMATCH in risk_codes → headline
  // emits via the synthesize path. (Pre-A1 the headline always emitted
  // when jobTitle was present; A1 narrowed emission to require either a
  // detectable headline or a synthesize-trigger.)
  const jobfit = {
    job_signals: { jobTitle: "Test Role" },
    risk_codes: [{ code: "RISK_FAMILY_MISMATCH", severity: "medium" }],
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta gamma",
        connection: "ctx",
        action: "Mention in your cover letter", // not reframe-flavored
      },
    ],
  } as unknown as JobfitResultJson
  const run = makePositioningRun("B")
  const items = await populate(run, jobfit, null, "alpha beta gamma")
  check(
    "7a: only-jobTitle + family mismatch (no bullets, no gaps) → [headlineItem]",
    items.length === 1 && items[0].type === "headline",
    `length=${items.length}, types=[${items.map((i) => i.type).join(",")}]`,
  )
  if (items[0]?.type === "headline") {
    check(
      "7a: synthesized headline carries synthesize_mode=true",
      items[0].synthesize_mode === true,
      String(items[0].synthesize_mode),
    )
    check(
      "7a: synthesized headline.original starts with 'Headline targeting: '",
      items[0].original.startsWith("Headline targeting: "),
      items[0].original,
    )
  }
}

{
  // Same setup but NO RISK_FAMILY_MISMATCH → headline detection finds
  // nothing in the bare resume AND no synthesize-trigger fires → no
  // headline item emitted. This is the A1 null-emission rule in action.
  const jobfit: JobfitResultJson = {
    job_signals: { jobTitle: "Test Role" },
    why_structured: [
      {
        keyword: "K",
        lead: "alpha beta gamma",
        connection: "ctx",
        action: "Mention in your cover letter",
      },
    ],
    // no risk_codes
  }
  const run = makePositioningRun("B")
  const items = await populate(run, jobfit, null, "alpha beta gamma")
  check(
    "7b: only-jobTitle + NO family mismatch + no anchorable content → []",
    items.length === 0,
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
  const items = await populate(run, jobfit, null, "alpha beta gamma")
  check(
    "8: no jobTitle, no anchorable whys, no core requirements → []",
    items.length === 0,
    `length=${items.length}`,
  )
}

// ============================================================================
// Test 8b — Synthesize-path headline against the no-headline Catherine
//          fixture (Catherine v3 minus L003). RISK_FAMILY_MISMATCH still
//          fires from CATHERINE_JOBFIT_WITH_UNITS so the headline emits
//          with synthesize_mode=true.
// ============================================================================

console.log("\n=== Synthesize-path headline (no headline in resume + family mismatch) ===")

{
  const run = makePositioningRun("B")
  const items = await populate(
    run,
    CATHERINE_JOBFIT_WITH_UNITS,
    null,
    CATHERINE_RESUME_NO_HEADLINE,
  )
  const headlines = items.filter(
    (i): i is PhaseTwoHeadlineItem => i.type === "headline",
  )
  check(
    "8b: exactly one headline item",
    headlines.length === 1,
    `headlines=${headlines.length}`,
  )
  const h = headlines[0]
  check(
    "8b: headline.synthesize_mode === true",
    h?.synthesize_mode === true,
    String(h?.synthesize_mode),
  )
  check(
    "8b: headline.original is the 'Headline targeting: …' placeholder",
    h?.original.startsWith("Headline targeting: "),
    h?.original,
  )
  // Bullets + gaps should still emit normally against the no-headline
  // resume (it has the SWOT line and the rest of the resume body).
  check(
    "8b: at least one bullet still anchors (NO_HEADLINE retains body content)",
    items.some((i) => i.type === "bullet"),
  )
}

// ============================================================================
// Test 8c — Null emission: no headline in resume AND no family mismatch.
//           Headline item should NOT be present in the output. Bullets/
//           gaps from the surrounding fixture content are unaffected.
// ============================================================================

console.log("\n=== Null emission (no headline + no family mismatch → no headline item) ===")

{
  // Inline synthetic requirement whose label tokens (kubernetes,
  // orchestration, deployment) are genuinely absent from Catherine's
  // resume. Picked deliberately to dodge the "work" / "analyses"
  // tokenization coincidences that REQ_CORE_FINANCIAL_ANALYSIS shares
  // with the v3 resume's CREATIVE EXPERIENCE section.
  const trulyUnrepresentedReq = {
    id: "synthetic-req-1",
    key: "kubernetes_orchestration",
    kind: "function",
    label: "kubernetes orchestration and container deployment",
    snippet: "Required: hands-on Kubernetes cluster orchestration experience",
    strength: 8,
    functionTag: "platform_eng",
    requiredness: "core",
  }
  const jobfitNoMismatchWithUnits: JobfitResultJson = {
    ...CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH,
    job_signals: {
      ...(CATHERINE_JOBFIT_WITHOUT_FAMILY_MISMATCH.job_signals ?? {}),
      requirement_units: [trulyUnrepresentedReq],
    } as unknown as JobfitResultJson["job_signals"],
  }
  const run = makePositioningRun("B")
  const items = await populate(
    run,
    jobfitNoMismatchWithUnits,
    null,
    CATHERINE_RESUME_NO_HEADLINE,
  )
  const headlines = items.filter((i) => i.type === "headline")
  check(
    "8c: NO headline item in output (no detection + no synthesize-trigger)",
    headlines.length === 0,
    `headlines=${headlines.length}`,
  )
  // Output may still contain bullets/gaps — that's the point: the
  // null-emission rule is headline-specific, not whole-run-suppression.
  const gapItem = items.find(
    (i): i is PhaseTwoGapItem => i.type === "gap",
  )
  check(
    "8c: gaps still emit (synthetic Kubernetes requirement is unrepresented)",
    items.some((i) => i.type === "gap"),
  )
  // A2 multi-outcome composition fields — emitted gap items must have the
  // three new fields populated with their initial defaults. /decide (C1)
  // and aiClient (A3) set them later in the lifecycle.
  check(
    "8c: gap.compositional_outcome === null (undecided)",
    gapItem?.compositional_outcome === null,
    String(gapItem?.compositional_outcome),
  )
  check(
    "8c: gap.target_bullet_text === null (no reword target until C1)",
    gapItem?.target_bullet_text === null,
    String(gapItem?.target_bullet_text),
  )
  check(
    "8c: gap.suggested_bullets_for_reword === [] (A3 populates)",
    Array.isArray(gapItem?.suggested_bullets_for_reword) &&
      gapItem.suggested_bullets_for_reword.length === 0,
    JSON.stringify(gapItem?.suggested_bullets_for_reword),
  )
}

// ============================================================================
// Test 8d — A2 default-shape: every emitted gap item carries the three
//           new fields with their safe defaults. Uses Test 5b's synthetic
//           substrate (5 unrepresented core requirements → 3 gaps capped)
//           so we can check every emitted gap rather than a single item.
// ============================================================================

console.log("\n=== A2 gap-item default fields (every emitted gap) ===")

{
  const fiveCoreUnits = Array.from({ length: 5 }, (_, i) => ({
    id: `req-${i + 1}`,
    key: `kubernetes_core_${i + 1}`,
    kind: "function",
    label: `kubernetes orchestration topic ${i + 1}`,
    snippet: `JD snippet for synthetic core requirement ${i + 1}`,
    strength: 8,
    functionTag: "platform_eng",
    requiredness: "core",
  }))
  const jobfit = {
    job_signals: { jobTitle: "Test Role", requirement_units: fiveCoreUnits },
  } as unknown as JobfitResultJson
  const resume = "completely unrelated short resume"
  const run = makePositioningRun("B")
  const items = await populate(run, jobfit, null, resume)
  const gaps = items.filter(
    (i): i is PhaseTwoGapItem => i.type === "gap",
  )
  check(
    "8d: emits 3 gap items (cap)",
    gaps.length === 3,
    `gaps=${gaps.length}`,
  )
  let allDefaultsCorrect = true
  for (const g of gaps) {
    if (g.compositional_outcome !== null) {
      allDefaultsCorrect = false
      console.log(`       FAIL: gap ${g.id} compositional_outcome=${g.compositional_outcome}`)
    }
    if (g.target_bullet_text !== null) {
      allDefaultsCorrect = false
      console.log(`       FAIL: gap ${g.id} target_bullet_text=${JSON.stringify(g.target_bullet_text)}`)
    }
    if (
      !Array.isArray(g.suggested_bullets_for_reword) ||
      g.suggested_bullets_for_reword.length !== 0
    ) {
      allDefaultsCorrect = false
      console.log(`       FAIL: gap ${g.id} suggested_bullets_for_reword=${JSON.stringify(g.suggested_bullets_for_reword)}`)
    }
  }
  check(
    "8d: every gap item has compositional_outcome=null, target_bullet_text=null, suggested_bullets_for_reword=[]",
    allDefaultsCorrect,
  )
}

// ============================================================================
// Test 8e — Backward compat: a legacy phase2_runs row stored before A2
//           lacks the three new fields entirely. Reading such a row from
//           JSONB returns `undefined` for those fields, NOT null. Consumers
//           (resumeComposer in B1/B2, frontend in D-series) must default
//           `?? null` / `?? []` per the PhaseTwoGapItem JSDoc. This test
//           pins that contract — both the typed cast and the runtime read
//           behavior.
// ============================================================================

console.log("\n=== A2 backward-compat: legacy gap row read shape ===")

{
  // Synthetic legacy row matching the hand-seeded phase2_run 9d5ebb75
  // demo fixture's gap item (which predates A2). Cast through unknown
  // because the TS type now requires the three new fields — this test
  // is exactly about reading data that doesn't have them.
  const legacyGapItem = {
    id: "gap-test-1",
    type: "gap",
    label: "Address marketing analytics gap",
    gap_description:
      "JD asks for experience with marketing analytics tools and campaign performance measurement; resume does not mention metrics or analytics tools",
    jd_context:
      "Required: experience tracking campaign performance using Google Analytics, social media metrics, or similar tools",
    question_asked:
      "Have you ever measured the performance of any content you created?",
    user_response: null,
    draft: null,
    final_text: "i was responsible for managing likes and engagement",
    accepted: true,
    declined: false,
    skipped: false,
    manual_entry: true,
    decided_at: "2026-05-17T20:20:20.989Z",
    // NO compositional_outcome, NO target_bullet_text,
    // NO suggested_bullets_for_reword — legacy DB row shape.
  } as unknown as PhaseTwoGapItem

  // Runtime reads: the missing fields return undefined, not null.
  // Downstream consumers must defensively default.
  check(
    "8e: legacy row reads compositional_outcome as undefined",
    (legacyGapItem as { compositional_outcome?: unknown }).compositional_outcome === undefined,
  )
  check(
    "8e: legacy row reads target_bullet_text as undefined",
    (legacyGapItem as { target_bullet_text?: unknown }).target_bullet_text === undefined,
  )
  check(
    "8e: legacy row reads suggested_bullets_for_reword as undefined",
    (legacyGapItem as { suggested_bullets_for_reword?: unknown }).suggested_bullets_for_reword === undefined,
  )
  // Defensive default pattern that B1/B2/D consumers will use:
  const outcome = legacyGapItem.compositional_outcome ?? null
  const target = legacyGapItem.target_bullet_text ?? null
  const suggestions = legacyGapItem.suggested_bullets_for_reword ?? []
  check(
    "8e: defensive `?? null` defaults legacy compositional_outcome to null",
    outcome === null,
  )
  check(
    "8e: defensive `?? null` defaults legacy target_bullet_text to null",
    target === null,
  )
  check(
    "8e: defensive `?? []` defaults legacy suggested_bullets_for_reword to []",
    Array.isArray(suggestions) && suggestions.length === 0,
  )
  // Other fields on the legacy row still read normally — the new fields
  // are additive, not destructive.
  check(
    "8e: legacy row still reads existing fields normally (e.g., final_text)",
    legacyGapItem.final_text ===
      "i was responsible for managing likes and engagement",
  )
}

// ============================================================================
// Test 9 — Defensive: null jobfit, empty resume, wrong-type case
// ============================================================================

console.log("\n=== Defensive ===")

{
  const run = makePositioningRun("B")
  const items = await populate(
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
  const items = await populate(run, CATHERINE_JOBFIT_WITH_UNITS, null, "")
  const headlines = items.filter((i): i is PhaseTwoHeadlineItem => i.type === "headline")
  const bullets = items.filter((i) => i.type === "bullet")
  const gaps = items.filter((i) => i.type === "gap")
  check(
    "10: empty resumeText → headline emits (family mismatch fires synthesize)",
    headlines.length === 1,
    `headlines=${headlines.length}`,
  )
  check(
    "10: empty resumeText → headline.synthesize_mode === true",
    headlines[0]?.synthesize_mode === true,
    String(headlines[0]?.synthesize_mode),
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
  const items = await populate(
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
// Test 12 — A3: AI suggestions populate gap items end-to-end. Uses Test
//           8c's Kubernetes-fixture substrate (the gap that actually
//           fires against the v3 resume) plus a mock suggestBulletsForGap
//           that returns 3 verbatim resume bullets. Asserts the
//           orchestrator threaded suggestions into the gap item.
// ============================================================================

console.log("\n=== A3: AI bullet suggestions populate gap items ===")

{
  // 3 verbatim substrings of CATHERINE_RESUME_TEXT (lines L020, L029,
  // L031 from the real resume). Used by the mock to simulate Claude
  // returning relevant verbatim picks.
  const verbatimSuggestions = [
    "Lead photographer for editorial shoots, managing creative direction and execution to engage audiences",
    "Performed industry, audience, and SWOT analyses to assess positioning and identify growth opportunities",
    "Presented findings through a professional client deck and written report",
  ]
  // Sanity: confirm the fixture strings really are verbatim in the
  // resume (the test would still pass if any string accidentally
  // matched something else but would erode the architectural intent).
  for (const s of verbatimSuggestions) {
    if (!CATHERINE_RESUME_TEXT.includes(s)) {
      throw new Error(
        `Test 12 fixture corruption: ${JSON.stringify(s)} is not a verbatim substring of CATHERINE_RESUME_TEXT`,
      )
    }
  }
  let callCount = 0
  const mock: SuggestBulletsForGapImpl = async () => {
    callCount++
    return {
      suggestions: verbatimSuggestions,
      usage: { input_tokens: 800, output_tokens: 60 },
    }
  }
  const trulyUnrepresentedReq = {
    id: "synthetic-req-12",
    key: "kubernetes_orchestration",
    kind: "function",
    label: "kubernetes orchestration and container deployment",
    snippet: "Required: hands-on Kubernetes cluster orchestration experience",
    strength: 8,
    functionTag: "platform_eng",
    requiredness: "core",
  }
  const jobfit: JobfitResultJson = {
    ...CATHERINE_JOBFIT_WITH_UNITS,
    job_signals: {
      ...(CATHERINE_JOBFIT_WITH_UNITS.job_signals ?? {}),
      requirement_units: [trulyUnrepresentedReq],
    } as unknown as JobfitResultJson["job_signals"],
  }
  const run = makePositioningRun("B")
  const result = await populateItems(
    run,
    jobfit,
    null,
    CATHERINE_RESUME_TEXT,
    mock,
  )
  const gaps = result.items.filter(
    (i): i is PhaseTwoGapItem => i.type === "gap",
  )
  check(
    "12: exactly 1 gap emitted",
    gaps.length === 1,
    `gaps=${gaps.length}`,
  )
  check(
    "12: gap.suggested_bullets_for_reword has 3 entries",
    gaps[0]?.suggested_bullets_for_reword.length === 3,
    `length=${gaps[0]?.suggested_bullets_for_reword.length}`,
  )
  let allVerbatim = true
  for (const s of gaps[0]?.suggested_bullets_for_reword ?? []) {
    if (!CATHERINE_RESUME_TEXT.includes(s)) {
      allVerbatim = false
      console.log(`       FAIL: suggestion not verbatim: ${JSON.stringify(s).slice(0, 80)}`)
    }
  }
  check(
    "12: every suggestion is a verbatim substring of resumeText",
    allVerbatim,
  )
  check(
    "12: suggestions preserve mock-returned order",
    JSON.stringify(gaps[0]?.suggested_bullets_for_reword) ===
      JSON.stringify(verbatimSuggestions),
  )
  check(
    "12: aiCostCents > 0 (cost tracked)",
    result.aiCostCents > 0,
    `aiCostCents=${result.aiCostCents}`,
  )
  // Suggestions returned on first attempt — should NOT retry. We expect
  // exactly 1 call. (Retry semantics tested separately in suggest-
  // bullets-for-gap-check.ts and below in Test 14.)
  check(
    "12: mock called exactly 1x (no retry on non-empty result)",
    callCount === 1,
    `callCount=${callCount}`,
  )
}

// ============================================================================
// Test 13 — A3: cost-cap mid-populate exhaustion. 3 gaps; mock charges
//           heavy cost so the cap fires after gap 2. Gap 3 emits with
//           empty suggestions but the run still completes.
// ============================================================================

console.log("\n=== A3: cost-cap mid-populate exhaustion ===")

{
  // Fixture: 3 unrepresented requirements → 3 gaps.
  const threeUnrepresentedReqs = Array.from({ length: 3 }, (_, i) => ({
    id: `synthetic-req-cap-${i + 1}`,
    key: `kubernetes_topic_${i + 1}`,
    kind: "function",
    label: `kubernetes orchestration topic ${i + 1}`,
    snippet: `JD snippet for synthetic core requirement ${i + 1}`,
    strength: 8,
    functionTag: "platform_eng",
    requiredness: "core",
  }))
  const jobfit: JobfitResultJson = {
    ...CATHERINE_JOBFIT_WITH_UNITS,
    job_signals: {
      ...(CATHERINE_JOBFIT_WITH_UNITS.job_signals ?? {}),
      requirement_units: threeUnrepresentedReqs,
    } as unknown as JobfitResultJson["job_signals"],
  }
  // Mock charges ~30 cents per call. After gap 1 + retry (~60 cents)
  // we exceed the $0.50 cap. (Real Haiku calls cost ~1 cent — this
  // mock cost is intentionally heavy to exercise the cap reliably
  // without needing a 50+ call workflow.) Each call returns empty
  // suggestions to force the retry path; second attempt also empty
  // because we want to verify the cap fires BEFORE the third gap's
  // first attempt, not after.
  let callCount = 0
  const heavyMock: SuggestBulletsForGapImpl = async () => {
    callCount++
    // 60_000 output tokens × $5/MTok = 30 cents (ceil)
    return {
      suggestions: [],
      usage: { input_tokens: 0, output_tokens: 60_000 },
    }
  }
  const run = makePositioningRun("B")
  const result = await populateItems(
    run,
    jobfit,
    null,
    CATHERINE_RESUME_TEXT,
    heavyMock,
  )
  const gaps = result.items.filter(
    (i): i is PhaseTwoGapItem => i.type === "gap",
  )
  check(
    "13: 3 gap items still emit (cost cap doesn't drop items)",
    gaps.length === 3,
    `gaps=${gaps.length}`,
  )
  check(
    "13: every gap emits with empty suggestions (cap fired OR mock returned [])",
    gaps.every((g) => g.suggested_bullets_for_reword.length === 0),
  )
  check(
    "13: aiCostCents reflects calls that completed before cap fired",
    result.aiCostCents > 0,
    `aiCostCents=${result.aiCostCents}`,
  )
  // Call sequence: gap 1 first attempt (cost=30) + retry (cost=60) →
  // now ≥ MAX_COST_CENTS=50 → gap 2 first attempt SKIPPED. callCount=2.
  // The cap-hit log fires on the gap-2 iteration entry.
  check(
    "13: mock invoked at most 2x (cap short-circuits remaining gaps)",
    callCount <= 2,
    `callCount=${callCount}`,
  )
  check(
    "13: /start does NOT throw — populator succeeds with empty suggestions on capped gaps",
    Array.isArray(result.items),
  )
}

// ============================================================================
// Test 14 — A3: retry-once on empty first-attempt suggestions. Mock returns
//           empty on first call and 3 verbatim on second (isRetry=true).
//           Asserts the populator retried and got real suggestions.
// ============================================================================

console.log("\n=== A3: retry-once on empty first-attempt suggestions ===")

{
  const trulyUnrepresentedReq = {
    id: "synthetic-req-retry",
    key: "kubernetes_retry",
    kind: "function",
    label: "kubernetes orchestration",
    snippet: "JD snippet",
    strength: 8,
    functionTag: "platform_eng",
    requiredness: "core",
  }
  const jobfit: JobfitResultJson = {
    ...CATHERINE_JOBFIT_WITH_UNITS,
    job_signals: {
      ...(CATHERINE_JOBFIT_WITH_UNITS.job_signals ?? {}),
      requirement_units: [trulyUnrepresentedReq],
    } as unknown as JobfitResultJson["job_signals"],
  }
  const verbatimOnRetry = [
    "Lead photographer for editorial shoots, managing creative direction and execution to engage audiences",
  ]
  let callCount = 0
  const retryMock: SuggestBulletsForGapImpl = async (input) => {
    callCount++
    return {
      suggestions: input.isRetry ? verbatimOnRetry : [],
      usage: { input_tokens: 400, output_tokens: 50 },
    }
  }
  const run = makePositioningRun("B")
  const result = await populateItems(
    run,
    jobfit,
    null,
    CATHERINE_RESUME_TEXT,
    retryMock,
  )
  const gap = result.items.find(
    (i): i is PhaseTwoGapItem => i.type === "gap",
  )
  check(
    "14: gap emitted",
    gap !== undefined,
  )
  check(
    "14: mock invoked exactly 2x (first attempt + retry)",
    callCount === 2,
    `callCount=${callCount}`,
  )
  check(
    "14: suggestions populated from retry attempt",
    gap?.suggested_bullets_for_reword.length === 1 &&
      gap.suggested_bullets_for_reword[0] === verbatimOnRetry[0],
  )
}

// ============================================================================
// Test 15 — A3: error swallowing. If suggestBulletsForGap throws (network
//           error, Anthropic 5xx), populator logs and emits gap with
//           empty suggestions. /start does NOT fail.
// ============================================================================

console.log("\n=== A3: error swallowing on AI call failure ===")

{
  const trulyUnrepresentedReq = {
    id: "synthetic-req-throw",
    key: "kubernetes_throw",
    kind: "function",
    label: "kubernetes orchestration",
    snippet: "JD snippet",
    strength: 8,
    functionTag: "platform_eng",
    requiredness: "core",
  }
  const jobfit: JobfitResultJson = {
    ...CATHERINE_JOBFIT_WITH_UNITS,
    job_signals: {
      ...(CATHERINE_JOBFIT_WITH_UNITS.job_signals ?? {}),
      requirement_units: [trulyUnrepresentedReq],
    } as unknown as JobfitResultJson["job_signals"],
  }
  const throwingMock: SuggestBulletsForGapImpl = async () => {
    throw new Error("simulated Anthropic 500")
  }
  const run = makePositioningRun("B")
  // Should NOT throw — populator catches and falls through.
  const result = await populateItems(
    run,
    jobfit,
    null,
    CATHERINE_RESUME_TEXT,
    throwingMock,
  )
  const gap = result.items.find(
    (i): i is PhaseTwoGapItem => i.type === "gap",
  )
  check(
    "15: gap still emits despite AI call failure",
    gap !== undefined,
  )
  check(
    "15: gap.suggested_bullets_for_reword === [] on AI failure",
    gap?.suggested_bullets_for_reword.length === 0,
  )
  check(
    "15: aiCostCents === 0 (no successful calls billed)",
    result.aiCostCents === 0,
    `aiCostCents=${result.aiCostCents}`,
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

} // end async function main

main().catch((e) => {
  console.error("Unhandled error in main():", e)
  process.exit(1)
})
