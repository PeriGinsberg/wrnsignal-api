// lib/positioning/v2/responseBuilder.ts
//
// Pure function that builds the API response shape for
// POST /api/positioning/v2/start. No I/O, no DB access — takes already-
// gathered inputs and assembles the canonical response.
//
// FRD: docs/Features/positioning-phase1-frd.md
// Friction items resolved here:
//
//   F6 — persona resolution: response builder is unreachable if persona
//        is unresolved; route.ts (D6) returns 400 'no_persona_configured'
//        before this function is called. The persona input is therefore
//        documented as always non-null. Not enforced at the type layer
//        (the caller's contract), but enforced at the route layer.
//
//   F7 — null candidate_targeting: targeting=null is a valid input. The
//        response surfaces `context.candidate_targeting: null` (field
//        present, value null) so the frontend can branch on `null` vs
//        object consistently rather than checking for field absence.
//
//  F10 — phase_data formatting: the response embeds run.phase_data
//        verbatim. The "append current visit before responding"
//        responsibility lives in route.ts (D6) — it must call
//        appendPhase1Visit before passing run here. The response builder
//        does not mutate or augment phase_data.
//
//  F12 — last_visit_days_ago + is_returning:
//          - new:       is_returning=false, last_visit_days_ago=null
//          - resume:    is_returning=true,  last_visit_days_ago=floor((now -
//                       prev_visit.visited_at) / ms_per_day) where prev_visit
//                       is the second-to-last entry in phase_1.visits
//                       (the current visit is the last entry, just appended
//                       by route.ts before calling this function)
//          - cache_hit: is_returning=false, last_visit_days_ago=null
//        cache_hit is NOT a returning experience per F12 spec — the user
//        sees identical cached output, so the "welcome back" framing
//        doesn't apply.

import type {
  CaseAssignment,
  CaseSpecificData,
  PositioningRunV2Row,
  StartResponse,
  StartResponseContext,
  WorkflowPreview,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type BuildStartResponseInputs = {
  outcome: "new" | "resume" | "cache_hit"
  /**
   * The positioning_runs_v2 row that was created, resumed, or cache-hit.
   * For new/resume, route.ts MUST have appended the current visit to
   * run.phase_data.phase_1.visits before passing it here (so the array's
   * last entry is the current visit, and the second-to-last is the prior
   * visit used for last_visit_days_ago).
   */
  run: PositioningRunV2Row
  caseAssignment: CaseAssignment
  workflowPreview: WorkflowPreview
  /** Null for Case B; populated for Cases A and C per CaseSpecificData semantics. */
  caseSpecific: CaseSpecificData | null
  /** F7 — null is valid; surfaces as context.candidate_targeting=null. */
  targeting: StartResponseContext["candidate_targeting"]
  /** F6 — always non-null; route.ts returns 400 before reaching this function. */
  persona: { id: string; name: string }
  jobfitRunId: string
  /** Override "now" for deterministic tests. Defaults to a fresh Date(). */
  now?: Date
}

/**
 * Build the StartResponse from already-gathered inputs.
 *
 * Caller (route.ts) is responsible for:
 *   - Resolving persona (must be non-null per F6)
 *   - Calling appendPhase1Visit on the run BEFORE passing it here (F10)
 *   - For cache_hit: extracting caseAssignment / workflowPreview /
 *     caseSpecific from the cached run's result_json
 *   - For new / resume: computing case + workflow + case-specific freshly
 *     via caseDetermination.ts / workflowPreview.ts / caseSpecific.ts
 */
export function buildStartResponse(
  inputs: BuildStartResponseInputs,
): StartResponse {
  const {
    outcome,
    run,
    caseAssignment,
    workflowPreview,
    caseSpecific,
    targeting,
    persona,
    jobfitRunId,
    now = new Date(),
  } = inputs

  const isReturning = outcome === "resume"
  const lastVisitDaysAgo =
    outcome === "resume" ? computeLastVisitDaysAgo(run, now) : null

  return {
    run_id: run.id,
    outcome,

    case: caseAssignment.case,
    case_reasoning: caseAssignment.reasoning,
    case_specific: caseSpecific,

    workflow_preview: workflowPreview,

    is_returning: isReturning,
    last_visit_days_ago: lastVisitDaysAgo,

    current_phase: run.current_phase,
    phase_data: run.phase_data,

    cached: outcome === "cache_hit",

    context: {
      persona,
      jobfit_run_id: jobfitRunId,
      candidate_targeting: targeting,
      job: { title: run.job_title, company: run.job_company },
    },
  }
}

/**
 * For resume outcome: compute days since the visit BEFORE the just-appended
 * current visit. Returns null when the array is empty / missing / has fewer
 * than two entries (defensive — the route is supposed to have appended
 * before calling this function; we don't crash if it didn't).
 *
 * Floor semantics: a prior visit 30 minutes ago is 0 days ago, a prior
 * visit 25 hours ago is 1 day ago.
 */
function computeLastVisitDaysAgo(
  run: PositioningRunV2Row,
  now: Date,
): number | null {
  const visits = run.phase_data?.phase_1?.visits
  if (!Array.isArray(visits) || visits.length < 2) return null
  const prev = visits[visits.length - 2]
  if (!prev?.visited_at) return null
  const prevMs = Date.parse(prev.visited_at)
  if (!Number.isFinite(prevMs)) return null
  return Math.floor((now.getTime() - prevMs) / MS_PER_DAY)
}
