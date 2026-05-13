// app/api/positioning/v2/start/route.ts
//
// POST /api/positioning/v2/start
//
// Phase 1 entry point — turns a (profile, persona, jobfit_run_id) tuple into
// a positioning_runs_v2 row + case-calibrated workflow response. Integrates
// every D1-D5 lib plus Foundation utilities.
//
// FRD: docs/Features/positioning-phase1-frd.md
//
// Architectural references:
//   - D1: lib/positioning/v2/fingerprint.ts          (computeFingerprint)
//   - D2: lib/positioning/v2/jobfitLookup.ts         (getJobfitRunById)
//   - D3: lib/positioning/v2/runLookup.ts            (findExistingPositioningRun)
//   - D4: lib/positioning/v2/runWriter.ts            (create / link / append)
//   - D5: lib/positioning/v2/responseBuilder.ts      (buildStartResponse)
//   - Stage 1a libs: caseDetermination, workflowPreview, caseSpecific
//   - Foundation: lib/signalApplications.ts, lib/candidateTargeting.ts
//
// Friction items resolved:
//   F6  — persona guard: F6 returns 400 'no_persona_configured' when
//         personaSource==='base_profile_fallback' (no active persona).
//   F7  — null candidate_targeting allowed; response surfaces null value.
//   F10 — visit append happens for ALL outcomes (cache_hit, resume, new)
//         after any outcome-specific writes complete. One place, one call.
//   F11 — ownership mismatch returns 404 (not 403) — don't leak existence.
//   F12 — cache_hit is NOT a returning experience (is_returning=false even
//         though the user has seen this run before). Handled in D5.
//
// Decisions referenced inline:
//   - DD-26 — link is one-directional; do NOT pass positioningRunId to
//             findOrCreateSignalApplication.
//   - DD-27 — company/title sourced from result_json.job_signals with
//             "(Unknown Company)" / "(Unknown Role)" placeholders.
//
// Failure-mode policy (per Q5 in design conversation):
//   - createPositioningRun fails → 500 (no row, can't recover)
//   - linkSignalApplicationToRun fails → 200 + warn (self-heal retries
//     on next visit per DD-26)
//   - appendPhase1Visit fails → 200 + warn (observability gap only)
//   - findOrCreateSignalApplication fails → 200 + warn (positioning_run
//     sits unlinked; self-heal retries on next visit)
//   - Anything BEFORE createPositioningRun fails → appropriate non-200
//
// Log markers (grep-friendly):
//   [positioning-v2/start] PLACEHOLDER_APPLICATION_CREATED runId=… reason=…
//   [positioning-v2/start] LINK_FAILED                     runId=… appId=…
//   [positioning-v2/start] APPEND_VISIT_FAILED             runId=…
//   [positioning-v2/start] FIND_OR_CREATE_APP_FAILED       runId=… profileId=…

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getAuthedProfileText } from "../../../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

import {
  getCandidateTargeting,
  resolveCareerStage,
  type CandidateTargetingRow,
} from "@/lib/candidateTargeting"
import { findOrCreateSignalApplication } from "@/lib/signalApplications"

import { computeFingerprint } from "@/lib/positioning/v2/fingerprint"
import {
  getJobfitRunById,
  type JobfitRunRow,
} from "@/lib/positioning/v2/jobfitLookup"
import { findExistingPositioningRun } from "@/lib/positioning/v2/runLookup"
import {
  appendPhase1Visit,
  createPositioningRun,
  linkSignalApplicationToRun,
} from "@/lib/positioning/v2/runWriter"
import { buildStartResponse } from "@/lib/positioning/v2/responseBuilder"
import { determineCase } from "@/lib/positioning/v2/caseDetermination"
import { generateWorkflowPreview } from "@/lib/positioning/v2/workflowPreview"
import { generateCaseSpecific } from "@/lib/positioning/v2/caseSpecific"
import type {
  Case,
  CaseAssignment,
  CaseInputs,
  CaseSpecificData,
  FingerprintTargetingState,
  JobfitResultJson,
  Phase1Visit,
  PositioningRunV2InsertPayload,
  PositioningRunV2Row,
  WorkflowPreview,
} from "@/lib/positioning/v2/types"

// ============================================================================
// Supabase admin client (service role) — module scope, mirrors existing
// route convention. Built lazily inside the handler to avoid hard-crashing
// dev server import if env vars are absent.
// ============================================================================

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "positioning-v2/start: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient
}

// ============================================================================
// Helpers
// ============================================================================

const PLACEHOLDER_COMPANY = "(Unknown Company)"
const PLACEHOLDER_TITLE = "(Unknown Role)"

type PickedJobMeta = {
  company: string
  title: string
  url: string | null
  /** Reason the placeholder was applied (null when no placeholder used). */
  placeholderReason: "empty_company" | "empty_title" | "empty_both" | null
}

/**
 * Pull company name + job title from jobfit.result_json.job_signals, applying
 * JobFit-style "(Unknown Company)" / "(Unknown Role)" placeholders when
 * empty. The route's only source-of-truth for these fields per DD-27.
 */
function pickJobMeta(
  jobfit: JobfitRunRow,
  jobUrlFromRow: string | null,
): PickedJobMeta {
  const js = (jobfit.result_json as JobfitResultJson | null)?.job_signals
  const rawCompany =
    typeof js?.companyName === "string" ? js.companyName.trim() : ""
  const rawTitle = typeof js?.jobTitle === "string" ? js.jobTitle.trim() : ""

  const usedPlaceholderCompany = rawCompany.length === 0
  const usedPlaceholderTitle = rawTitle.length === 0
  const reason: PickedJobMeta["placeholderReason"] =
    usedPlaceholderCompany && usedPlaceholderTitle
      ? "empty_both"
      : usedPlaceholderCompany
        ? "empty_company"
        : usedPlaceholderTitle
          ? "empty_title"
          : null

  return {
    company: usedPlaceholderCompany ? PLACEHOLDER_COMPANY : rawCompany,
    title: usedPlaceholderTitle ? PLACEHOLDER_TITLE : rawTitle,
    url: jobUrlFromRow,
    placeholderReason: reason,
  }
}

/**
 * Translate the Foundation candidate_targeting row into the fingerprint's
 * targeting state shape. Returns null when no targeting row exists for the
 * profile (handled by computeFingerprint's null-targeting sentinel path).
 */
function buildFingerprintTargetingState(
  targeting: CandidateTargetingRow | null,
): FingerprintTargetingState | null {
  if (!targeting) return null
  return {
    primary_lane: targeting.primary_lane,
    primary_sublane: targeting.primary_sublane,
    status_premed: !!targeting.status_premed,
    status_prelaw: !!targeting.status_prelaw,
    status_pregrad: !!targeting.status_pregrad,
  }
}

/**
 * Build the targeting shape that CaseInputs / response context use.
 * Same null semantics as buildFingerprintTargetingState but a smaller
 * field set (no status_* flags).
 */
function buildCaseTargeting(
  targeting: CandidateTargetingRow | null,
): { primary_lane: string; primary_sublane: string | null } | null {
  if (!targeting) return null
  return {
    primary_lane: targeting.primary_lane,
    primary_sublane: targeting.primary_sublane,
  }
}

// ============================================================================
// CORS preflight
// ============================================================================

export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request.headers.get("origin"))
}

// ============================================================================
// POST handler
// ============================================================================

export async function POST(request: NextRequest) {
  let supabaseAdmin: SupabaseClient
  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch (e) {
    return withCorsJson(
      request,
      { error: "server_misconfigured", detail: (e as Error).message },
      500,
    )
  }

  // ── 1. Parse body ───────────────────────────────────────────────────────
  let body: { jobfit_run_id?: string; persona_id?: string | null }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return withCorsJson(request, { error: "invalid_json" }, 400)
  }
  const jobfitRunId = (body.jobfit_run_id ?? "").trim()
  if (!jobfitRunId) {
    return withCorsJson(
      request,
      { error: "missing_jobfit_run_id" },
      400,
    )
  }
  const requestedPersonaId =
    typeof body.persona_id === "string" && body.persona_id.trim()
      ? body.persona_id.trim()
      : null

  // ── 2. Auth + persona guard (F6) ────────────────────────────────────────
  let authed: Awaited<ReturnType<typeof getAuthedProfileText>>
  try {
    authed = await getAuthedProfileText(request, { personaId: requestedPersonaId })
  } catch (e) {
    return withCorsJson(
      request,
      { error: "unauthorized", detail: (e as Error).message },
      401,
    )
  }

  if (
    authed.personaSource === "base_profile_fallback" ||
    !authed.activePersonaId
  ) {
    // F6: response builder is unreachable without a persona; reject here.
    return withCorsJson(
      request,
      {
        error: "no_persona_configured",
        detail:
          "This profile has no active persona. Create a persona before starting Positioning.",
      },
      400,
    )
  }
  const profileId = authed.profileId
  const personaId = authed.activePersonaId

  // ── 3. JobFit fetch + ownership (A2, F11) ───────────────────────────────
  const jf = await getJobfitRunById(supabaseAdmin, jobfitRunId)
  if (jf.error) {
    return withCorsJson(
      request,
      { error: "jobfit_lookup_failed", detail: jf.error },
      500,
    )
  }
  if (!jf.row) {
    // F11 — return 404, not 403; don't leak existence-with-wrong-owner.
    return withCorsJson(request, { error: "jobfit_not_found" }, 404)
  }
  if (jf.row.client_profile_id !== profileId) {
    // F11 — same 404 envelope as "actually not found." A wrong-owner request
    // gets the same response as a non-existent ID.
    return withCorsJson(request, { error: "jobfit_not_found" }, 404)
  }
  const jobfit = jf.row

  // Resolve company/title (DD-27) — used by fingerprint, by
  // findOrCreateSignalApplication, and in the response context.
  // job_url + job_description aren't on JobfitRunRow's narrow shape;
  // fetch them separately with an explicit type so the projection's
  // shape is preserved through PostgREST's `never` default.
  //
  // TODO: cleanup opportunity — this is a second SELECT on the same row
  // already fetched in step 3 (PK lookup, operationally cheap but
  // architecturally a smell). Future cleanup: expand JobfitRunRow /
  // SELECT_COLS in lib/positioning/v2/jobfitLookup.ts to include job_url
  // and job_description so getJobfitRunById returns everything D6 needs in
  // one call. Not done now to avoid touching D2's tested surface area
  // during D6 integration.
  const { data: extraJobfit } = await supabaseAdmin
    .from("jobfit_runs")
    .select("job_url, job_description")
    .eq("id", jobfitRunId)
    .maybeSingle<{ job_url: string | null; job_description: string | null }>()
  const jobMeta = pickJobMeta(
    jobfit,
    typeof extraJobfit?.job_url === "string" ? extraJobfit.job_url : null,
  )
  const jobDescription =
    typeof extraJobfit?.job_description === "string"
      ? extraJobfit.job_description
      : ""

  // ── 4. Targeting + career stage (Foundation) ────────────────────────────
  // Note: getCandidateTargeting takes (supabase, profileId);
  // resolveCareerStage takes (profileId, supabase) — different arg orders
  // by Foundation convention, both correct.
  const { row: targeting } = await getCandidateTargeting(
    supabaseAdmin,
    profileId,
  )
  const careerStage = await resolveCareerStage(profileId, supabaseAdmin)

  // ── 5. Persona name lookup (for response context) ───────────────────────
  const { data: personaRow, error: personaErr } = await supabaseAdmin
    .from("client_personas")
    .select("id, name")
    .eq("id", personaId)
    .maybeSingle<{ id: string; name: string | null }>()
  if (personaErr || !personaRow) {
    // Persona resolved in step 2 but disappeared between calls — possible
    // race or deletion.
    //
    // Status-code choice (deliberate): 400 rather than 409 (Conflict) or
    // 500 (Server Error). This is technically a race / state mismatch
    // rather than a malformed request, but:
    //   - The client's path forward is the same as any "bad input" 400:
    //     they need to re-fetch personas and re-select before retrying.
    //   - 409 implies the client could resolve the conflict, which it
    //     can't (the persona is genuinely gone).
    //   - 500 implies a server bug, which this isn't.
    // Frontends that handle 4xx as "user-actionable" do the right thing
    // with 400 + a named error code.
    return withCorsJson(
      request,
      { error: "persona_not_found", detail: personaErr?.message ?? "no row" },
      400,
    )
  }
  const persona = {
    id: personaRow.id as string,
    name:
      typeof personaRow.name === "string" && personaRow.name.trim()
        ? personaRow.name.trim()
        : "Persona",
  }

  // ── 6. Fingerprint ──────────────────────────────────────────────────────
  const fingerprint = computeFingerprint({
    profileId,
    personaId,
    jobTitle: jobMeta.title,
    jobCompany: jobMeta.company,
    jobDescription,
    targeting: buildFingerprintTargetingState(targeting),
    careerStage,
  })

  // ── 7. runLookup (D3 cascade) ───────────────────────────────────────────
  const lookup = await findExistingPositioningRun(
    supabaseAdmin,
    profileId,
    personaId,
    jobfitRunId,
    fingerprint.hash,
  )
  if (lookup.error) {
    console.warn(
      `[positioning-v2/start] LOOKUP_ERROR profileId=${profileId} jobfitRunId=${jobfitRunId} error=${lookup.error}`,
    )
    // Fall through with outcome='new' per runLookup's contract — guard
    // errors degrade to new-run creation rather than failing the request.
  }

  // ── 8. Outcome branch ───────────────────────────────────────────────────
  // For all outcomes we end up with: runRow, caseAssignment, workflowPreview,
  // caseSpecific. These feed buildStartResponse uniformly.
  let runRow: PositioningRunV2Row
  let caseAssignment: CaseAssignment
  let workflowPreview: WorkflowPreview
  let caseSpecific: CaseSpecificData | null

  const caseInputs: CaseInputs = {
    jobfit: jobfit.result_json,
    targeting: buildCaseTargeting(targeting),
    careerStage,
  }

  if (lookup.outcome === "cache_hit" && lookup.row) {
    // ── 8a. cache_hit: extract case + workflow + case_specific from
    //                  the cached result_json (frozen at completion).
    //                  See Q4: phase_data is still mutable; result_json
    //                  is the frozen "what the user saw last time."
    runRow = lookup.row
    const cached = (runRow.result_json ?? {}) as Record<string, unknown>
    caseAssignment = {
      case: runRow.case_assigned,
      reasoning: runRow.case_reasoning,
    }
    workflowPreview = (cached.workflow_preview as WorkflowPreview | undefined) ??
      generateWorkflowPreview(caseInputs, runRow.case_assigned)
    caseSpecific =
      (cached.case_specific as CaseSpecificData | null | undefined) ??
      generateCaseSpecific(caseInputs, runRow.case_assigned)
  } else if (lookup.outcome === "resume" && lookup.row) {
    // ── 8b. resume: REUSE case from row (Q1) — preserve mid-session
    //               continuity. RECOMPUTE workflow_preview + case_specific
    //               from fresh JobFit data (A1) — these aren't on the row.
    //               Same JobFit content produces identical output.
    //
    //               Targeting could have drifted since the row was created
    //               (runLookup intentionally ignores fingerprint mismatch
    //               on in_progress per D3 comments). We use the FRESH
    //               targeting for workflow_preview/case_specific even
    //               though we reuse the row's stored case. Inconsistency
    //               window: small; resolved on the user's next session
    //               when they either resume again (same path) or abandon
    //               and start fresh (full recompute).
    runRow = lookup.row
    caseAssignment = {
      case: runRow.case_assigned,
      reasoning: runRow.case_reasoning,
    }
    workflowPreview = generateWorkflowPreview(caseInputs, runRow.case_assigned)
    caseSpecific = generateCaseSpecific(caseInputs, runRow.case_assigned)
  } else {
    // ── 8c. new: compute case + workflow + case_specific freshly.
    //            Create positioning_runs_v2 (signal_application_id=null).
    //            Then findOrCreateSignalApplication (NO positioningRunId
    //            per DD-26). Then linkSignalApplicationToRun (best-effort).
    caseAssignment = determineCase(caseInputs)
    workflowPreview = generateWorkflowPreview(caseInputs, caseAssignment.case)
    caseSpecific = generateCaseSpecific(caseInputs, caseAssignment.case)

    const nowIso = new Date().toISOString()
    const insertPayload: PositioningRunV2InsertPayload = {
      profile_id: profileId,
      persona_id: personaId,
      jobfit_run_id: jobfitRunId,
      signal_application_id: null, // F2 self-heal: filled by linkSignalApplicationToRun below
      job_title: jobMeta.title,
      job_company: jobMeta.company,
      job_url: jobMeta.url,
      job_description: jobDescription,
      case_assigned: caseAssignment.case,
      case_reasoning: caseAssignment.reasoning,
      current_phase: 1,
      phase_data: { phase_1: { case_assigned_at: nowIso } },
      status: "in_progress",
      fingerprint_hash: fingerprint.hash,
      fingerprint_code: fingerprint.code,
      result_json: null,
    }

    const createRes = await createPositioningRun(supabaseAdmin, insertPayload)
    if (createRes.error || !createRes.row) {
      return withCorsJson(
        request,
        {
          error: "create_positioning_run_failed",
          detail: createRes.error ?? "no row returned",
        },
        500,
      )
    }
    runRow = createRes.row

    // findOrCreateSignalApplication — best-effort. Failure here leaves
    // runRow with signal_application_id=null; the next visit's runLookup
    // returns outcome='resume' and we retry the link from there.
    //
    // JobFit's result_json.job_signals.companyName/jobTitle are empty on ~20%
    // of non-error runs (extraction failures on poorly-scraped JDs). Rather
    // than blocking Positioning for these users, we use JobFit's
    // "(Unknown Company)" placeholder convention (set by pickJobMeta above).
    // The resulting signal_applications row is junk-flavored but the case
    // determination is correct and the user gets their experience. This
    // contributes to KI-01's "junk signal_applications rows" pile; logged
    // via PLACEHOLDER_APPLICATION_CREATED for ops visibility (DD-27).
    if (jobMeta.placeholderReason !== null) {
      console.warn(
        `[positioning-v2/start] PLACEHOLDER_APPLICATION_CREATED runId=${runRow.id} profileId=${profileId} jobfitRunId=${jobfitRunId} reason=${jobMeta.placeholderReason}`,
      )
    }

    const sigApp = await findOrCreateSignalApplication({
      supabase: supabaseAdmin,
      profileId,
      companyName: jobMeta.company,
      jobTitle: jobMeta.title,
      jobUrl: jobMeta.url,
      personaId,
      jobfitRunId,
      // DELIBERATELY OMITTING positioningRunId per DD-26 — the column FKs
      // to v1 positioning_runs (legacy), and the v2 link is one-directional
      // via positioning_runs_v2.signal_application_id (set via
      // linkSignalApplicationToRun below).
    })
    if (sigApp.error || !sigApp.id) {
      console.warn(
        `[positioning-v2/start] FIND_OR_CREATE_APP_FAILED runId=${runRow.id} profileId=${profileId} error=${sigApp.error ?? "no id"}`,
      )
    } else {
      const linkRes = await linkSignalApplicationToRun(
        supabaseAdmin,
        runRow.id,
        sigApp.id,
      )
      if (!linkRes.ok) {
        console.warn(
          `[positioning-v2/start] LINK_FAILED runId=${runRow.id} appId=${sigApp.id} error=${linkRes.error ?? "unknown"}`,
        )
      } else {
        // Reflect the link locally so the response carries the populated
        // value without a re-fetch. linkSignalApplicationToRun has already
        // confirmed the write landed; mirroring is safe.
        runRow = { ...runRow, signal_application_id: sigApp.id }
      }
    }
  }

  // ── 9. Visit append (F10) — runs for ALL outcomes, including cache_hit
  //      (Q4: engagement signal matters even for cache hits; the response
  //      still sets cached=true and is_returning=false per F12). Best-effort.
  //
  //      Asymmetry note for cache_hit: response body comes from cached
  //      result_json (frozen at completion); the row's phase_data is
  //      mutable. Visit list grows; result_json stays frozen.
  const newVisit: Phase1Visit = {
    visited_at: new Date().toISOString(),
    action: "viewed", // Q3: /start is page-load semantics; "started" reserved
    //                  for future endpoints signaling active engagement.
  }
  const appendRes = await appendPhase1Visit(supabaseAdmin, runRow.id, newVisit)
  if (!appendRes.ok) {
    console.warn(
      `[positioning-v2/start] APPEND_VISIT_FAILED runId=${runRow.id} error=${appendRes.error ?? "unknown"}`,
    )
  } else {
    // Mirror the appended visit into runRow.phase_data so buildStartResponse
    // can compute last_visit_days_ago without re-fetching.
    const phase1 = runRow.phase_data?.phase_1 ?? {
      case_assigned_at: newVisit.visited_at,
    }
    const existingVisits = Array.isArray(phase1.visits) ? phase1.visits : []
    runRow = {
      ...runRow,
      phase_data: {
        ...runRow.phase_data,
        phase_1: { ...phase1, visits: [...existingVisits, newVisit] },
      },
    }
  }

  // ── 10. Response ────────────────────────────────────────────────────────
  const response = buildStartResponse({
    outcome: lookup.outcome,
    run: runRow,
    caseAssignment,
    workflowPreview,
    caseSpecific,
    targeting: buildCaseTargeting(targeting),
    persona,
    jobfitRunId,
  })

  return withCorsJson(request, response, 200)
}
