// app/api/_lib/runSubject.ts
//
// WHOSE PROFILE A POSITIONING OR COVER LETTER RUN IS FOR, AND WHAT IT RUNS ON.
//
// Both routes used to take identity from the caller's token alone, so a coach
// got results built from the coach's own profile. Now the subject comes from
// lib/collab/scope.ts like the network routes: ?client_profile_id= names the
// client, the coach must hold FULL access to them, and a deny throws (403).
// With no ?client_profile_id= the caller is acting for themselves, which is
// every call Framer makes today.
//
// A coach does not send the job, the JobFit result or a persona. They send the
// client's application_id, and everything else is read here from the client's
// own JobFit run for that job, scoped to the client. So a coach cannot feed a
// client's run inputs the client never had, and the result carries the same
// jobfit_run_id the client's tracker opens.

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveRequestScope, type Scope } from "@/lib/collab/scope"
import { getProfileTextById } from "./authProfile"

/** An error that already knows its HTTP status. */
export class RunInputError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message)
    this.name = "RunInputError"
  }
}

export type RunSubject = {
  scope: Scope
  profile: Awaited<ReturnType<typeof getProfileTextById>>
  jobText: string
  /** The JobFit result the run consumes, with jobfit_run_id stamped. */
  jobfitResult: any
  /** Set only on the application_id path: the job's latest positioning. */
  positioning: any
}

export async function resolveRunSubject(
  req: Request,
  supabase: SupabaseClient,
  body: any,
  opts: { withPositioning: boolean },
): Promise<RunSubject> {
  const scope = await resolveRequestScope(req, supabase, { require: "write" })
  const actingForClient = scope.actorRole === "coach"
  const applicationId =
    typeof body?.application_id === "string" && body.application_id.trim() ? body.application_id.trim() : null

  if (actingForClient && !applicationId) {
    throw new RunInputError("application_id is required when acting for a client", 400)
  }

  let jobText = String(body?.job || "").trim()
  let jobfitResult: any = body?.jobfit_result ?? null
  let personaId: string | null =
    typeof body?.persona_id === "string" && body.persona_id.trim() ? body.persona_id.trim() : null
  let positioning: any = body?.positioning ?? null

  if (applicationId) {
    const { data: app, error: appErr } = await supabase
      .from("signal_applications")
      .select("id, jobfit_run_id, persona_id")
      .eq("id", applicationId)
      .eq("profile_id", scope.subjectId)
      .maybeSingle()
    if (appErr) throw new Error(`Application lookup failed: ${appErr.message}`)
    if (!app) throw new RunInputError("Application not found", 404)
    if (!app.jobfit_run_id) throw new RunInputError("This job has no JobFit run yet", 400)

    const { data: run, error: runErr } = await supabase
      .from("jobfit_runs")
      .select("id, result_json, job_description, persona_id")
      .eq("id", app.jobfit_run_id)
      .eq("client_profile_id", scope.subjectId)
      .maybeSingle()
    if (runErr) throw new Error(`JobFit run lookup failed: ${runErr.message}`)
    if (!run) throw new RunInputError("JobFit run not found", 404)
    if (!String(run.job_description || "").trim()) {
      throw new RunInputError("This job's JobFit run has no job description saved", 400)
    }

    jobText = String(run.job_description).trim()
    jobfitResult = { ...((run.result_json as any) ?? {}), jobfit_run_id: run.id }
    personaId = (run.persona_id as string | null) ?? (app.persona_id as string | null) ?? null

    if (opts.withPositioning) {
      const { data: pos } = await supabase
        .from("positioning_runs")
        .select("result_json")
        .eq("jobfit_run_id", run.id)
        .eq("client_profile_id", scope.subjectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      positioning = pos?.result_json ?? null
    }
  }

  if (!jobText) throw new RunInputError("Missing job", 400)

  const profile = await getProfileTextById(scope.subjectId, {
    personaId,
    strictPersona: actingForClient,
  })

  return { scope, profile, jobText, jobfitResult, positioning }
}
