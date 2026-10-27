// app/api/supporter/clients/[clientId]/applications/[applicationId]/route.ts
//
// One job, read only: the JobFit result and the cover letter, if the client
// has them, and interviews by stage and date. No running anything: a supporter
// cannot score a job or write a letter.
//
// Every query is scoped to the authorised subject, so an application id from
// another client's tracker returns 404 rather than its content.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { routeError } from "../../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveSupporterRequestScope } from "@/lib/collab/scope"
import { SUPPORTER_APPLICATION_COLUMNS, SUPPORTER_INTERVIEW_COLUMNS } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; applicationId: string }> },
) {
  try {
    const { clientId, applicationId } = await params
    const supabase = getSupabaseAdmin()
    const scope = await resolveSupporterRequestScope(req, supabase, clientId)
    const subject = scope.subjectId

    const { data: app, error } = await supabase
      .from("signal_applications")
      .select(SUPPORTER_APPLICATION_COLUMNS)
      .eq("id", applicationId)
      .eq("profile_id", subject)
      .maybeSingle()
    if (error) throw new Error(`Application lookup failed: ${error.message}`)
    if (!app) return withCorsJson(req, { ok: false, error: "Job not found" }, 404)
    const a = app as any

    let jobfit: any = null
    let coverLetter: { letter: string | null } | null = null
    if (a.jobfit_run_id) {
      const [{ data: jf }, { data: cl }] = await Promise.all([
        supabase
          .from("jobfit_runs")
          .select("id, result_json")
          .eq("id", a.jobfit_run_id)
          .eq("client_profile_id", subject)
          .maybeSingle(),
        supabase
          .from("coverletter_runs")
          .select("result_json")
          .eq("jobfit_run_id", a.jobfit_run_id)
          .eq("client_profile_id", subject)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      jobfit = jf?.result_json ?? null
      const letter = (cl?.result_json as any)?.letter
      coverLetter = cl ? { letter: typeof letter === "string" ? letter : null } : null
    }

    const { data: ivs, error: ivErr } = await supabase
      .from("signal_interviews")
      .select(SUPPORTER_INTERVIEW_COLUMNS)
      .eq("application_id", a.id)
      .eq("profile_id", subject)
      .order("interview_date", { ascending: true })
    if (ivErr) throw new Error(`Interviews lookup failed: ${ivErr.message}`)

    return withCorsJson(req, {
      ok: true,
      application: a,
      jobfit,
      cover_letter: coverLetter,
      interviews: ((ivs ?? []) as any[]).map((i) => ({ interview_stage: i.interview_stage, interview_date: i.interview_date })),
    })
  } catch (err) {
    return routeError(req, err)
  }
}
