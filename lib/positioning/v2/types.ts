// lib/positioning/v2/types.ts
//
// Shared types for the Positioning v2 rebuild. All Phase 1 lib files
// (caseDetermination, workflowPreview, caseSpecific) import from here.
// Future phases (Phase 2 Gap Analysis, Phase 3 Content Review, Phase 5
// Change List) will extend this file with their own types as they ship.
//
// FRD: docs/Features/positioning-phase1-frd.md
// Design ref: docs/Features/positioning-design-reference-v2.md
// Foundation deps:
//   - lib/candidateTargeting.ts (CareerStage)
//   - app/api/jobfit/signals.ts (Decision, Severity)
//
// Pure types only — no runtime values, no logic.

import type { Decision, Severity } from "@/app/api/jobfit/signals"
import type { CareerStage } from "@/lib/laneTaxonomy"

// ============================================================================
// Core enums
// ============================================================================

export type Case = "A" | "B" | "C"

/** Alias for JobFit's Decision type for readability in Positioning code. */
export type JobfitVerdict = Decision

export type PositioningRunV2Status = "in_progress" | "completed" | "abandoned"

// ============================================================================
// JobFit input shapes (subset of jobfit_runs.result_json that Phase 1 reads)
// ============================================================================

/**
 * V5 structured risk item. Each entry has a severity used by case
 * determination. V4 runs do not produce this array — Phase 1 falls
 * back to risk_codes for severity inference (defaulting to medium).
 * Cross-references Foundation DD-23: jobfit_runs result_json fields
 * are unreliable on historical garbage runs; defensive coding required.
 */
export type RiskStructuredItem = {
  keyword: string
  gap: string
  reframe: string
  severity: Severity
}

export type WhyStructuredItem = {
  keyword: string
  lead: string
  connection: string
  action: string
}

/**
 * Minimum shape of jobfit_runs.result_json that Phase 1's case
 * determination + workflow preview + case-specific data need. Other
 * fields in the JSON exist beyond these but Phase 1 doesn't consume
 * them. (Note: job_signals.jobFamily and profile_signals.targetFamilies
 * were added 2026-05-15 for the family-mismatch Case C trigger.)
 *
 * All fields optional because historical V4 runs may be missing V5
 * additions, and malformed/garbage runs may be missing fields entirely.
 * Callers should defend against missing data per FRD section 4.1
 * edge cases.
 */
export type JobfitResultJson = {
  /** Canonical verdict field on V5+ runs. */
  decision?: JobfitVerdict
  /** Some older runs store the verdict under `verdict` instead. */
  verdict?: JobfitVerdict
  /** JobFit score, typically 0-100. */
  score?: number
  why_structured?: WhyStructuredItem[]
  risk_structured?: RiskStructuredItem[]
  risk_codes?: string[]
  job_signals?: {
    jobTitle?: string
    companyName?: string
    /**
     * Canonical job family classification of the JD, e.g. "Marketing",
     * "Sales", "HR", "Finance", "Other". Consumed by caseDetermination's
     * family-mismatch Case C trigger.
     */
    jobFamily?: string
  }
  profile_signals?: {
    /**
     * Candidate's targeted job families. Consumed by caseDetermination's
     * family-mismatch Case C trigger. Single-element ["Other"] is
     * treated as no-signal (see caseDetermination.ts edge-case handling).
     */
    targetFamilies?: string[]
  }
}

// ============================================================================
// Case determination
// ============================================================================

export type CaseInputs = {
  /** JobFit's most recent result for this (profile, job). */
  jobfit: JobfitResultJson
  /**
   * Candidate targeting from Foundation. Null if profile has no
   * candidate_targeting row (rare, but possible for new profiles
   * created post-Foundation that haven't yet provided targeting).
   * Phase 1 trusts whatever is here per DD-25 (no verification step).
   */
  targeting: {
    primary_lane: string
    primary_sublane: string | null
  } | null
  /** Career stage from Foundation's resolveCareerStage. */
  careerStage: CareerStage
}

export type CaseAssignment = {
  case: Case
  reasoning: string
}

// ============================================================================
// Workflow preview (consumed by Phase 1 frontend)
// ============================================================================

export type WorkflowPreview = {
  /** Number of risk findings to address in Phase 2 Gap Analysis. */
  gap_count: number
  /**
   * Top-3 risk_structured.keyword values by severity (high > medium > low).
   * Empty array if no risks (Case A territory).
   */
  gap_themes: string[]
  /** True for Cases B and C; false for clean Case A. */
  content_review_required: boolean
  /**
   * Number of audit findings (Phase 4). Always null in v2 — Phase 4
   * audit detection is stubbed until v2.5 ships.
   */
  audit_findings_count: number | null
  /**
   * Estimated time to complete the workflow.
   *   - Case A (no refinements): 0
   *   - Case A (with small refinements): 5
   *   - Case B: 15-20
   *   - Case C: 30-45
   */
  estimated_minutes: number
}

// ============================================================================
// Case-specific data (consumed by Phase 1 frontend)
// ============================================================================

export type SmallRefinement = {
  id: string
  description: string
}

export type InferredLaneMismatch = {
  /**
   * Resume's perceived targeting lane (from a blind-read pass on the
   * resume). Always null in v2 — blind-read is deferred to a later
   * Positioning feature.
   */
  resume_reads_as: string | null
  /** What this specific job is asking for, in human-readable form. */
  job_asking_for: string
}

/**
 * Case-conditional fields. Discriminated by the parent response's `case`
 * field, not by this type itself. The generator populates only the
 * fields relevant to the assigned case; others remain undefined.
 *
 *   - Case A: well_positioned_summary, small_refinements (optional)
 *   - Case B: (empty object — no case-specific fields beyond workflow_preview)
 *   - Case C: inferred_lane_mismatch, high_severity_gap_summary
 */
export type CaseSpecificData = {
  well_positioned_summary?: string
  small_refinements?: SmallRefinement[]
  inferred_lane_mismatch?: InferredLaneMismatch
  high_severity_gap_summary?: string
}

// ============================================================================
// phase_data JSONB shape on positioning_runs_v2
// ============================================================================

export type Phase1VisitAction = "viewed" | "saved_for_later" | "started"

export type Phase1Visit = {
  /** ISO8601 timestamp. */
  visited_at: string
  action: Phase1VisitAction
}

export type ReconsiderTargetOutcome =
  | "proceeded"
  | "will_think_about_it"
  | "viewed_other_runs"

export type Phase1Data = {
  /** ISO8601 timestamp. */
  case_assigned_at: string
  visits?: Phase1Visit[]
  reconsider_target_clicked?: boolean
  reconsider_target_outcome?: ReconsiderTargetOutcome
  /** ISO8601 timestamp. */
  reconsider_target_clicked_at?: string
}

/**
 * phase_data JSONB shape on positioning_runs_v2. Phase 1 owns the
 * `phase_1` key. Subsequent phases (Phase 2, 3, 5) append their own
 * keys without affecting Phase 1's data; types here will extend as
 * those phases ship.
 */
export type PositioningRunV2PhaseData = {
  phase_1?: Phase1Data
  // phase_2, phase_3, phase_5 added by later FRDs
}

// ============================================================================
// DB row shape
// ============================================================================

/**
 * Full row shape returned by SELECT * on positioning_runs_v2. Mirrors
 * the schema in supabase/migrations/<timestamp>_positioning_runs_v2.sql.
 * Schema and this type must stay in lockstep.
 */
export type PositioningRunV2Row = {
  id: string
  profile_id: string
  persona_id: string
  jobfit_run_id: string | null
  signal_application_id: string | null

  job_title: string
  job_company: string
  job_url: string | null
  job_description: string

  case_assigned: Case
  case_reasoning: string

  /** Active workflow phase. CHECK constraint also enforces 1..5 at DB level. */
  current_phase: 1 | 2 | 3 | 4 | 5
  phase_data: PositioningRunV2PhaseData

  status: PositioningRunV2Status

  fingerprint_hash: string
  fingerprint_code: string

  /** Snapshot of the final result on completion. Null until status='completed'. */
  result_json: Record<string, unknown> | null

  /** ISO8601 timestamp. */
  created_at: string
  /** ISO8601 timestamp. */
  updated_at: string
  /** ISO8601 timestamp. Null until status='completed'. */
  completed_at: string | null
}

/**
 * Payload for INSERT into positioning_runs_v2. Excludes DB-managed
 * fields (id, created_at, updated_at, completed_at). Optional fields
 * use DB defaults: status='in_progress', current_phase=1.
 */
export type PositioningRunV2InsertPayload = {
  profile_id: string
  persona_id: string
  jobfit_run_id: string | null
  /**
   * Typically null at INSERT time, UPDATEd after findOrCreateSignalApplication
   * returns the linked signal_application id. Two-write pattern per
   * FRD section 4.2 (F4 in Phase 1 plan discussion).
   */
  signal_application_id?: string | null
  job_title: string
  job_company: string
  job_url?: string | null
  job_description: string
  case_assigned: Case
  case_reasoning: string
  /** Active workflow phase. Defaults to 1 if omitted (DB default). */
  current_phase?: 1 | 2 | 3 | 4 | 5
  phase_data: PositioningRunV2PhaseData
  status?: PositioningRunV2Status
  fingerprint_hash: string
  fingerprint_code: string
  result_json?: Record<string, unknown> | null
}

// ============================================================================
// Fingerprint inputs (consumed by computeFingerprint in lib/positioning/v2/fingerprint.ts)
// ============================================================================

/**
 * Targeting fields that feed into the fingerprint's targetingStateHash.
 * Subset of CandidateTargetingRow — only the fields that, if changed,
 * should invalidate a cached positioning_run.
 *
 * Notable absences:
 *   - career_stage lives at the top-level FingerprintInputs, not here,
 *     because it's resolved via resolveCareerStage() with a fallback path
 *     (candidate_targeting → profile_structured → mid_career default)
 *     that's independent of whether candidate_targeting has a row at all.
 *   - secondary lanes are excluded — Phase 1 reads only primary_lane /
 *     primary_sublane (per FRD section 4.1 inputs).
 *   - source / locked_by / created_at / updated_at are provenance, not
 *     cache-invalidation signal.
 */
export type FingerprintTargetingState = {
  primary_lane: string
  primary_sublane: string | null
  status_premed: boolean
  status_prelaw: boolean
  status_pregrad: boolean
}

/**
 * Inputs to computeFingerprint. The public API for the fingerprint module.
 *
 * Composition (computed inside fingerprint.ts):
 *   - jdHash = sha256 of [jobTitle, jobCompany, jobDescription]
 *     .map(trim().toLowerCase()).join("|")
 *   - targetingStateHash = sha256 of canonical-JSON of the targeting
 *     payload (sorted keys, lowercased), which is:
 *       * when targeting present:
 *         {primary_lane, primary_sublane, career_stage,
 *          status_premed, status_prelaw, status_pregrad}
 *       * when targeting null:
 *         {_absent: true, career_stage}
 *     The {_absent: true, career_stage} shape is distinguishable from
 *     any real targeting row because (a) primary_lane is NOT NULL at the
 *     schema level, so a real row always has primary_lane present, and
 *     (b) "_absent" is a sentinel key that can't collide with column names.
 *   - fingerprint_hash = sha256 of canonical-JSON
 *     {profileId, personaId, jdHash, targetingStateHash} (sorted, lowercased)
 *   - fingerprint_code = "p:<profileIdShort>|pn:<personaIdShort>|jd:<jdHashShort>|t:<targetingHashShort>"
 *     where each "Short" is the first 8 hex chars of the corresponding
 *     hash (or, for profileId/personaId UUIDs, the first 8 lowercased chars).
 */
export type FingerprintInputs = {
  profileId: string
  personaId: string
  jobTitle: string
  jobCompany: string
  jobDescription: string
  targeting: FingerprintTargetingState | null
  careerStage: CareerStage
}

export type FingerprintResult = {
  hash: string
  code: string
}

// ============================================================================
// API response shape (POST /api/positioning/v2/start)
// ============================================================================

/**
 * Cross-reference data the frontend may need to look up other entities or
 * render context-specific UI (e.g. "you're viewing this for persona X
 * targeting Y for the JobFit run that produced verdict Z").
 *
 * F7 — candidate_targeting:
 *   `null` is a valid value (not all profiles have a candidate_targeting
 *   row). The field is always present in the response so the frontend can
 *   branch on `null` vs object consistently rather than checking for
 *   field absence.
 */
export type StartResponseContext = {
  persona: { id: string; name: string }
  jobfit_run_id: string
  candidate_targeting:
    | { primary_lane: string; primary_sublane: string | null }
    | null
  job: { title: string; company: string }
}

/**
 * Canonical response from POST /api/positioning/v2/start. Returned by
 * buildStartResponse(); consumed by the Phase 1 frontend.
 *
 * Field semantics:
 *   - `outcome`: which cache cascade branch was taken (new / resume / cache_hit)
 *   - `case` + `case_reasoning` + `case_specific`: case calibration
 *   - `workflow_preview`: Phase 2-5 preview signals (gap counts, time estimate)
 *   - `is_returning`: true ONLY for outcome='resume' (per F12 spec — cache_hit
 *     is NOT a returning experience because the user sees identical output)
 *   - `last_visit_days_ago`: days since the prior visit; null for new and
 *     cache_hit, computed for resume (F12)
 *   - `current_phase`, `phase_data`: workflow position passed through from
 *     the row
 *   - `cached`: true ONLY for outcome='cache_hit'
 *   - `context`: cross-reference data (persona, targeting, JD, jobfit_run_id)
 *   - `signal_application_id`: linked signal_applications row id. Null when
 *     the link write failed (rare; self-heals on next visit). Frontend uses
 *     this for application-targeted actions like "I'm ready to apply" CTA →
 *     PUT /api/applications/{id}.
 */
export type StartResponse = {
  run_id: string
  /**
   * Linked signal_applications row id. Null when linkSignalApplicationToRun
   * failed (the row will self-heal on the next visit per F2 / DD-26).
   * Frontend uses this to drive application-targeted actions.
   */
  signal_application_id: string | null
  /**
   * Mirrors runLookup's FindExistingOutcome — kept as a literal union
   * here to avoid a runtime import from runLookup.ts into types.ts.
   */
  outcome: "new" | "resume" | "cache_hit"

  case: Case
  case_reasoning: string
  case_specific: CaseSpecificData | null

  workflow_preview: WorkflowPreview

  is_returning: boolean
  last_visit_days_ago: number | null

  current_phase: 1 | 2 | 3 | 4 | 5
  phase_data: PositioningRunV2PhaseData

  cached: boolean

  context: StartResponseContext
}
