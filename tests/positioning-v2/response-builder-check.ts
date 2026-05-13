// tests/positioning-v2/response-builder-check.ts
//
// Unit tests for lib/positioning/v2/responseBuilder.ts. Pure-function tests
// — no DB, no I/O, deterministic (uses an injected `now` for time-sensitive
// cases).
//
// Run:
//   npx tsx tests/positioning-v2/response-builder-check.ts

import { buildStartResponse } from "@/lib/positioning/v2/responseBuilder"
import type {
  CaseAssignment,
  CaseSpecificData,
  Phase1Visit,
  PositioningRunV2Row,
  WorkflowPreview,
} from "@/lib/positioning/v2/types"

const failures: string[] = []
function pass(m: string): void {
  console.log(`  ✓ ${m}`)
}
function fail(m: string, d?: string): void {
  failures.push(m)
  console.log(`  ✗ ${m}${d ? ` — ${d}` : ""}`)
}

// Fake row builder — sensible defaults, override per test.
function makeRun(
  overrides: Partial<PositioningRunV2Row> = {},
): PositioningRunV2Row {
  const now = new Date().toISOString()
  return {
    id: "11111111-1111-4111-a111-111111111111",
    profile_id: "p1",
    persona_id: "pn1",
    jobfit_run_id: "jr1",
    signal_application_id: "sa1",
    job_title: "Senior PM",
    job_company: "Acme Inc.",
    job_url: null,
    job_description: "test JD body",
    case_assigned: "B",
    case_reasoning: "default test reasoning",
    current_phase: 1,
    phase_data: { phase_1: { case_assigned_at: now } },
    status: "in_progress",
    fingerprint_hash: "fp_hash",
    fingerprint_code: "fp_code",
    result_json: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    ...overrides,
  }
}

function defaultPersona(): { id: string; name: string } {
  return { id: "pn1", name: "Test Persona" }
}

function defaultTargeting(): {
  primary_lane: string
  primary_sublane: string | null
} {
  return { primary_lane: "technology", primary_sublane: "product_management" }
}

function makeWorkflowPreview(
  overrides: Partial<WorkflowPreview> = {},
): WorkflowPreview {
  return {
    gap_count: 0,
    gap_themes: [],
    content_review_required: false,
    audit_findings_count: null,
    estimated_minutes: 0,
    ...overrides,
  }
}

// ════════════════════════════════════════════════════════════════════════
console.log("=== Case A / B / C happy path ===")
// ════════════════════════════════════════════════════════════════════════

// Test 1: Case A new run — well_positioned_summary surfaces in case_specific
{
  const caseAssignment: CaseAssignment = {
    case: "A",
    reasoning: "strongly aligned with JD",
  }
  const workflowPreview = makeWorkflowPreview({ estimated_minutes: 0 })
  const caseSpecific: CaseSpecificData = {
    well_positioned_summary: "Your resume strongly aligns with the JD.",
    small_refinements: [],
  }
  const run = makeRun({ case_assigned: "A", case_reasoning: caseAssignment.reasoning })
  const resp = buildStartResponse({
    outcome: "new",
    run,
    caseAssignment,
    workflowPreview,
    caseSpecific,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.case !== "A") fail("1: case", resp.case)
  else if (
    resp.case_specific?.well_positioned_summary !==
    caseSpecific.well_positioned_summary
  )
    fail(
      "1: well_positioned_summary",
      String(resp.case_specific?.well_positioned_summary),
    )
  else if (resp.run_id !== run.id) fail("1: run_id passthrough", resp.run_id)
  else if (resp.workflow_preview !== workflowPreview)
    fail("1: workflow_preview passthrough reference")
  else
    pass(
      "1: Case A new run — shape correct, case_specific.well_positioned_summary present",
    )
}

// Test 2: Case B new run — case_specific is null
{
  const caseAssignment: CaseAssignment = {
    case: "B",
    reasoning: "gap work needed",
  }
  const workflowPreview = makeWorkflowPreview({
    gap_count: 3,
    estimated_minutes: 18,
  })
  const run = makeRun({ case_assigned: "B" })
  const resp = buildStartResponse({
    outcome: "new",
    run,
    caseAssignment,
    workflowPreview,
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.case !== "B") fail("2: case", resp.case)
  else if (resp.case_specific !== null)
    fail("2: case_specific should be null for B", String(resp.case_specific))
  else if (resp.workflow_preview.gap_count !== 3)
    fail("2: workflow gap_count", String(resp.workflow_preview.gap_count))
  else pass("2: Case B new run — case_specific=null, workflow_preview populated")
}

// Test 3: Case C new run — inferred_lane_mismatch + high_severity_gap_summary
{
  const caseAssignment: CaseAssignment = {
    case: "C",
    reasoning: "lane mismatch",
  }
  const workflowPreview = makeWorkflowPreview({
    gap_count: 5,
    estimated_minutes: 40,
  })
  const caseSpecific: CaseSpecificData = {
    inferred_lane_mismatch: {
      resume_reads_as: null,
      job_asking_for: "Senior Marketing role",
    },
    high_severity_gap_summary: "Three high-severity gaps in core marketing skills.",
  }
  const run = makeRun({ case_assigned: "C" })
  const resp = buildStartResponse({
    outcome: "new",
    run,
    caseAssignment,
    workflowPreview,
    caseSpecific,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.case !== "C") fail("3: case", resp.case)
  else if (
    resp.case_specific?.inferred_lane_mismatch?.job_asking_for !==
    "Senior Marketing role"
  )
    fail(
      "3: inferred_lane_mismatch",
      JSON.stringify(resp.case_specific?.inferred_lane_mismatch),
    )
  else if (
    resp.case_specific?.high_severity_gap_summary !==
    caseSpecific.high_severity_gap_summary
  )
    fail(
      "3: high_severity_gap_summary",
      resp.case_specific?.high_severity_gap_summary ?? "undefined",
    )
  else
    pass(
      "3: Case C new run — case_specific.inferred_lane_mismatch + high_severity_gap_summary present",
    )
}

// ════════════════════════════════════════════════════════════════════════
console.log("\n=== Outcome variations ===")
// ════════════════════════════════════════════════════════════════════════

// Test 4: new + Case B → is_returning=false, last_visit_days_ago=null, cached=false
{
  const run = makeRun()
  const resp = buildStartResponse({
    outcome: "new",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.is_returning !== false)
    fail("4: is_returning should be false for new", String(resp.is_returning))
  else if (resp.last_visit_days_ago !== null)
    fail(
      "4: last_visit_days_ago should be null for new",
      String(resp.last_visit_days_ago),
    )
  else if (resp.cached !== false)
    fail("4: cached should be false for new", String(resp.cached))
  else pass("4: new → is_returning=false, last_visit_days_ago=null, cached=false")
}

// Test 5: resume + Case B → is_returning=true, last_visit_days_ago=5 (computed)
{
  const now = new Date("2026-05-12T12:00:00.000Z")
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
  const currentVisit: Phase1Visit = {
    visited_at: now.toISOString(),
    action: "viewed",
  }
  const prevVisit: Phase1Visit = {
    visited_at: fiveDaysAgo,
    action: "viewed",
  }
  const run = makeRun({
    phase_data: {
      phase_1: {
        case_assigned_at: fiveDaysAgo,
        visits: [prevVisit, currentVisit],
      },
    },
  })
  const resp = buildStartResponse({
    outcome: "resume",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
    now,
  })
  if (resp.is_returning !== true)
    fail("5: is_returning should be true for resume", String(resp.is_returning))
  else if (resp.last_visit_days_ago !== 5)
    fail(
      "5: last_visit_days_ago should be 5",
      String(resp.last_visit_days_ago),
    )
  else if (resp.cached !== false)
    fail("5: cached should be false for resume", String(resp.cached))
  else
    pass(
      "5: resume → is_returning=true, last_visit_days_ago=5 (computed), cached=false",
    )
}

// Test 6: cache_hit + Case B → is_returning=false (per F12), cached=true
{
  const run = makeRun({ status: "completed", case_assigned: "B" })
  const resp = buildStartResponse({
    outcome: "cache_hit",
    run,
    caseAssignment: { case: "B", reasoning: "from cache" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.is_returning !== false)
    fail(
      "6: is_returning should be false for cache_hit per F12",
      String(resp.is_returning),
    )
  else if (resp.last_visit_days_ago !== null)
    fail(
      "6: last_visit_days_ago should be null for cache_hit",
      String(resp.last_visit_days_ago),
    )
  else if (resp.cached !== true)
    fail("6: cached should be true for cache_hit", String(resp.cached))
  else
    pass(
      "6: cache_hit → is_returning=false (F12), last_visit_days_ago=null, cached=true",
    )
}

// ════════════════════════════════════════════════════════════════════════
console.log("\n=== Null targeting (F7) ===")
// ════════════════════════════════════════════════════════════════════════

// Test 7: targeting=null → context.candidate_targeting field present with null value
{
  const run = makeRun()
  const resp = buildStartResponse({
    outcome: "new",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: null,
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (!("candidate_targeting" in resp.context))
    fail("7: context.candidate_targeting field should be present")
  else if (resp.context.candidate_targeting !== null)
    fail(
      "7: context.candidate_targeting should be null",
      JSON.stringify(resp.context.candidate_targeting),
    )
  else
    pass(
      "7: targeting=null → context.candidate_targeting field present with null value",
    )
}

// ════════════════════════════════════════════════════════════════════════
console.log("\n=== last_visit_days_ago edge cases ===")
// ════════════════════════════════════════════════════════════════════════

// Test 8: previous visit 30 min ago → 0 days (floor semantics)
{
  const now = new Date("2026-05-12T15:00:00.000Z")
  const earlierToday = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  const visits: Phase1Visit[] = [
    { visited_at: earlierToday, action: "viewed" },
    { visited_at: now.toISOString(), action: "viewed" },
  ]
  const run = makeRun({
    phase_data: { phase_1: { case_assigned_at: earlierToday, visits } },
  })
  const resp = buildStartResponse({
    outcome: "resume",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
    now,
  })
  if (resp.last_visit_days_ago !== 0)
    fail(
      "8: previous visit 30 min ago should yield 0",
      String(resp.last_visit_days_ago),
    )
  else pass("8: previous visit 30 min ago → last_visit_days_ago=0 (floor)")
}

// Test 9: multiple visits → uses second-to-last (most recent prior, not the oldest)
{
  const now = new Date("2026-05-12T12:00:00.000Z")
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
  const visits: Phase1Visit[] = [
    { visited_at: tenDaysAgo, action: "viewed" },
    { visited_at: twoDaysAgo, action: "saved_for_later" },
    { visited_at: now.toISOString(), action: "viewed" },
  ]
  const run = makeRun({
    phase_data: { phase_1: { case_assigned_at: tenDaysAgo, visits } },
  })
  const resp = buildStartResponse({
    outcome: "resume",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
    now,
  })
  if (resp.last_visit_days_ago !== 2)
    fail(
      "9: should use most recent prior visit (twoDaysAgo), not oldest",
      String(resp.last_visit_days_ago),
    )
  else pass("9: multiple visits → uses second-to-last (most recent prior), days=2")
}

// Test 10: empty visits array on resume → null (defensive)
{
  const run = makeRun({
    phase_data: {
      phase_1: { case_assigned_at: new Date().toISOString(), visits: [] },
    },
  })
  const resp = buildStartResponse({
    outcome: "resume",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.last_visit_days_ago !== null)
    fail(
      "10: empty visits should yield null",
      String(resp.last_visit_days_ago),
    )
  else pass("10: empty visits array on resume → last_visit_days_ago=null")
}

// Test 11: only the current visit (length=1) on resume → null (no prior)
{
  const now = new Date()
  const visits: Phase1Visit[] = [
    { visited_at: now.toISOString(), action: "viewed" },
  ]
  const run = makeRun({
    phase_data: { phase_1: { case_assigned_at: now.toISOString(), visits } },
  })
  const resp = buildStartResponse({
    outcome: "resume",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.last_visit_days_ago !== null)
    fail(
      "11: single visit (length=1) should yield null",
      String(resp.last_visit_days_ago),
    )
  else pass("11: single visit on resume (no prior) → last_visit_days_ago=null")
}

// Test 12: missing visits array (undefined) on resume → null
{
  const run = makeRun({
    phase_data: { phase_1: { case_assigned_at: new Date().toISOString() } },
  })
  const resp = buildStartResponse({
    outcome: "resume",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.last_visit_days_ago !== null)
    fail(
      "12: missing visits (undefined) should yield null",
      String(resp.last_visit_days_ago),
    )
  else pass("12: undefined visits array on resume → last_visit_days_ago=null")
}

// ════════════════════════════════════════════════════════════════════════
console.log("\n=== Passthroughs ===")
// ════════════════════════════════════════════════════════════════════════

// Test 13: context fields all populated from inputs
{
  const persona = { id: "pn-test", name: "Persona Name" }
  const run = makeRun({
    job_title: "Director of Engineering",
    job_company: "Globex",
  })
  const resp = buildStartResponse({
    outcome: "new",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona,
    jobfitRunId: "jr-test-789",
  })
  if (resp.context.persona !== persona)
    fail("13: context.persona reference", JSON.stringify(resp.context.persona))
  else if (resp.context.jobfit_run_id !== "jr-test-789")
    fail("13: context.jobfit_run_id", resp.context.jobfit_run_id)
  else if (resp.context.job.title !== "Director of Engineering")
    fail("13: context.job.title", resp.context.job.title)
  else if (resp.context.job.company !== "Globex")
    fail("13: context.job.company", resp.context.job.company)
  else if (resp.context.candidate_targeting?.primary_lane !== "technology")
    fail("13: context.candidate_targeting.primary_lane")
  else
    pass(
      "13: context fields all populated from inputs (persona, jobfit_run_id, job, candidate_targeting)",
    )
}

// Test 14: phase_data + current_phase passed through verbatim
{
  const phaseData = {
    phase_1: {
      case_assigned_at: "2026-05-12T08:00:00.000Z",
      reconsider_target_clicked: true,
      reconsider_target_outcome: "proceeded" as const,
      visits: [
        { visited_at: "2026-05-12T08:00:00.000Z", action: "viewed" as const },
      ],
    },
  }
  const run = makeRun({ phase_data: phaseData, current_phase: 2 })
  const resp = buildStartResponse({
    outcome: "new",
    run,
    caseAssignment: { case: "B", reasoning: "default" },
    workflowPreview: makeWorkflowPreview(),
    caseSpecific: null,
    targeting: defaultTargeting(),
    persona: defaultPersona(),
    jobfitRunId: "jr1",
  })
  if (resp.phase_data !== phaseData)
    fail("14: phase_data passthrough (reference)")
  else if (resp.current_phase !== 2)
    fail("14: current_phase passthrough", String(resp.current_phase))
  else pass("14: phase_data + current_phase passed through verbatim")
}

console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
if (failures.length) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("All checks passed.")
