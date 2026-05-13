// lib/signalApplications.ts
//
// Shared utility for the signal_applications "one application =
// one (profile, company, title) tuple" lookup-or-create pattern.
//
// FRD: docs/Features/positioning-foundation-frd.md (section 4.3)
// Runlog: docs/Features/foundation-migration-runlog.md
//
// Today: only JobFit auto-creates signal_applications rows. After Foundation:
//   - Positioning Phase 1 will call this with positioningRunId to link
//     positioning_runs to the application record.
//   - Cover Letter Integration FRD will call with coverletterRunId.
//   (Foundation adds the FK columns + the utility; only JobFit consumes it
//   in this release.)
//
// Scope (locked, "minimal extraction"):
//   - Lookup: (profile_id, ILIKE company_name, ILIKE job_title)
//   - Create-if-missing or update-if-found, setting only the run_id FK(s)
//     the caller passed.
//   - Caller owns its own sanitization (prefix stripping, garbage filtering),
//     caller-specific UPDATE fields (e.g. JobFit's signal_decision /
//     signal_score / signal_run_at), backlinks to *_runs.application_id,
//     and audit logging (e.g. status_history). The utility is deliberately
//     small — see runlog DD-? if scope grows.
//
// Empty-field behavior — KI-01:
//   The utility itself REFUSES to create a row when companyName is empty
//   (returns { id: null, isNew: false }). Callers that want the existing
//   junk-row fallback ("(Unknown Company)" / "(Unknown Role)") must apply
//   that placeholder defaulting BEFORE calling. JobFit does so today; the
//   refactor preserves the behavior at the caller. Runlog KI-01 tracks the
//   underlying junk-row risk for a future product decision.

import type { SupabaseClient } from "@supabase/supabase-js"

export type FindOrCreateSignalApplicationParams = {
  /**
   * Supabase client. The caller decides whether this is service-role or
   * user-scoped — the utility does not pick one.
   */
  supabase: SupabaseClient

  /** Required lookup key. */
  profileId: string
  companyName: string
  jobTitle: string

  /** Optional create-time fields. Ignored when the row already exists. */
  jobUrl?: string | null
  location?: string | null
  personaId?: string | null
  /**
   * Initial application_status on create. Defaults to 'saved' (matching the
   * DB column default and JobFit's current behavior).
   */
  applicationStatus?: string
  /**
   * Initial interest_level on create. Defaults to 1 to match JobFit's
   * historical behavior. NOTE: the DB column default is 3 — the utility
   * deliberately differs to preserve the current observable behavior.
   */
  interestLevel?: number

  /**
   * Run IDs to set. Any value that's NOT undefined gets written on both
   * create and update; undefined values leave existing columns unchanged.
   * Callers typically pass exactly one of these, not all three.
   */
  jobfitRunId?: string
  positioningRunId?: string
  coverletterRunId?: string
}

export type FindOrCreateSignalApplicationResult = {
  /** Application row id; null when no row was created (e.g. empty company). */
  id: string | null
  /** True if a new row was inserted; false if an existing row was updated
   *  or no row exists. */
  isNew: boolean
  /** Postgres error message when an operation failed. Caller decides
   *  whether to fail loudly or swallow (JobFit currently swallows). */
  error?: string
}

/**
 * Look up a signal_applications row by (profile_id, company_name, job_title)
 * with case-insensitive matching (ILIKE on company_name and job_title). If
 * found, update whichever run_id FK fields were provided. If not found and
 * companyName is non-empty, insert a new row.
 *
 * Lookup-key behavior is preserved verbatim from the existing JobFit logic
 * (app/api/jobfit/route.ts:442-503): ILIKE not eq; empty job_title matches
 * empty job_title; refusal to insert when company_name is empty.
 */
export async function findOrCreateSignalApplication(
  params: FindOrCreateSignalApplicationParams,
): Promise<FindOrCreateSignalApplicationResult> {
  const {
    supabase,
    profileId,
    companyName,
    jobTitle,
    jobUrl,
    location,
    personaId,
    applicationStatus = "saved",
    interestLevel = 1,
    jobfitRunId,
    positioningRunId,
    coverletterRunId,
  } = params

  if (!profileId) {
    return { id: null, isNew: false, error: "missing profileId" }
  }

  // ── 1. Lookup ────────────────────────────────────────────────────────────
  // Match JobFit's current behavior: lookup only runs when companyName is
  // non-empty. Empty companyName + empty jobTitle would ILIKE-match every
  // empty-company row globally — a footgun we don't want.
  let existing: { id: string } | null = null
  if (companyName) {
    const { data, error } = await supabase
      .from("signal_applications")
      .select("id")
      .eq("profile_id", profileId)
      .ilike("company_name", companyName)
      .ilike("job_title", jobTitle || "")
      .maybeSingle()
    if (error) {
      return { id: null, isNew: false, error: error.message }
    }
    existing = data
  }

  // Build run_id patch: only the FKs the caller actually passed.
  const runFkPatch: Record<string, string | null> = {}
  if (jobfitRunId !== undefined) runFkPatch.jobfit_run_id = jobfitRunId
  if (positioningRunId !== undefined) runFkPatch.positioning_run_id = positioningRunId
  if (coverletterRunId !== undefined) runFkPatch.coverletter_run_id = coverletterRunId

  // ── 2a. Update existing row ──────────────────────────────────────────────
  if (existing?.id) {
    if (Object.keys(runFkPatch).length > 0) {
      const { error } = await supabase
        .from("signal_applications")
        .update({ ...runFkPatch, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
      if (error) {
        return { id: existing.id, isNew: false, error: error.message }
      }
    }
    return { id: existing.id, isNew: false }
  }

  // ── 2b. Insert new row ───────────────────────────────────────────────────
  // We do NOT insert when companyName is empty (no lookup was performed and
  // we won't manufacture junk). Callers that want JobFit's "(Unknown Company)"
  // fallback must apply that placeholder BEFORE calling — see KI-01.
  if (!companyName) {
    return { id: null, isNew: false }
  }

  const insertPayload: Record<string, unknown> = {
    profile_id: profileId,
    company_name: companyName,
    job_title: jobTitle || "",
    location: location ?? "",
    job_url: jobUrl ?? "",
    persona_id: personaId ?? null,
    application_status: applicationStatus,
    interest_level: interestLevel,
    ...runFkPatch,
  }

  const { data: created, error } = await supabase
    .from("signal_applications")
    .insert(insertPayload)
    .select("id")
    .single()

  if (error || !created) {
    return {
      id: null,
      isNew: false,
      error: error?.message ?? "insert failed",
    }
  }
  return { id: created.id, isNew: true }
}
