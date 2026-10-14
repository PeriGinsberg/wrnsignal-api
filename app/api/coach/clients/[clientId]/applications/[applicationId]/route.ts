// app/api/coach/clients/[clientId]/applications/[applicationId]/route.ts
//
// DELETE — a coach removes a job from a client's Job Tracker. Only a job a
// coach put there: one created by Recommend a Job, which leaves a
// coach_job_recommendations row pointing at the application. A job the client
// added is theirs, and only the client can delete it (/api/applications/[id]).
//
// SECURITY: the same shape as ./detail. Authority comes from the application's
// own owner, never the URL clientId; the coach needs FULL access to that owner;
// and the recommendation must be from a coach on this client's team (a linked
// coach or one of their delegates), so a principal and her delegate can each
// delete what the other added.
//
// What goes: the recommendation (its client responses cascade) and the
// application (its interviews, status history and job notes cascade). The
// recommendation is deleted explicitly because its FK is ON DELETE SET NULL:
// left alone it would stay in the client's recommendations with no job. The
// JobFit run stays, unlinked, as it does when a client deletes a job.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { verifyCoachAccess } from "@/lib/collab/access"
import { clientTeamCoachIds } from "@/lib/collab/delegation"
import { logCoachClientEvent } from "../../../../../_lib/coachClientEvents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; applicationId: string }> },
) {
  try {
    const { clientId: urlClientId, applicationId } = await params
    const { profileId: coachProfileId, isCoach } = await resolveCaller(req)
    if (!isCoach) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }
    const supabase = getSupabaseAdmin()

    const { data: app, error: appErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id, company_name, job_title")
      .eq("id", applicationId)
      .maybeSingle()
    if (appErr) throw new Error(`Application lookup failed: ${appErr.message}`)
    if (!app) return withCorsJson(req, { ok: false, error: "Application not found" }, 404)

    const ownerClientId = app.profile_id as string
    if (urlClientId && ownerClientId !== urlClientId) {
      return withCorsJson(req, { ok: false, error: "Forbidden: application does not belong to this client" }, 403)
    }
    const access = await verifyCoachAccess(coachProfileId, ownerClientId, "full", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: deleting a job needs full access to this client" }, 403)
    }

    const team = await clientTeamCoachIds(supabase, ownerClientId)
    const { data: recs, error: recErr } = await supabase
      .from("coach_job_recommendations")
      .select("id")
      .eq("application_id", applicationId)
      .eq("client_profile_id", ownerClientId)
      .in("coach_profile_id", team)
    if (recErr) throw new Error(`Recommendation lookup failed: ${recErr.message}`)
    if (!recs?.length) {
      return withCorsJson(req, { ok: false, error: "Only a job a coach added can be deleted. The client added this one." }, 403)
    }

    const { error: delRecErr } = await supabase
      .from("coach_job_recommendations")
      .delete()
      .in("id", recs.map((r) => r.id))
    if (delRecErr) throw new Error(`Recommendation delete failed: ${delRecErr.message}`)

    const { error: delAppErr } = await supabase
      .from("signal_applications")
      .delete()
      .eq("id", applicationId)
    if (delAppErr) throw new Error(`Application delete failed: ${delAppErr.message}`)

    await logCoachClientEvent({
      coachClientId: access.id,
      eventType: "job_deleted",
      actorProfileId: coachProfileId,
      context: { company: app.company_name, title: app.job_title },
    })

    return withCorsJson(req, { ok: true, deleted: applicationId })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
