// app/api/network/plan/[jobId]/share/route.ts
// Share with client: link access on the Drive file, then visibility in the
// library. One button, two systems, in that order deliberately.
//
// Ending a coaching relationship does NOT unshare the Drive link (a decided
// behaviour): hiding the library row is enough, and the job keeps
// drive_permission_id so a manual unshare stays possible later.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errorStatus } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveRequestScope } from "@/lib/collab/scope"
import { sharePlanJob, type PlanJob } from "@/lib/networking-plan/job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params
    const supabase = getSupabaseAdmin()
    const scope = await resolveRequestScope(req, supabase, { require: "write" })

    const { data: job } = await supabase
      .from("networking_plan_jobs").select("*").eq("id", jobId).maybeSingle()
    if (!job) return withCorsJson(req, { ok: false, error: "Plan not found" }, 404)
    // The job says whose board it is; the scope says whether this actor may
    // reach it. Same shape as the contact routes.
    if (job.client_profile_id !== scope.subjectId) {
      return withCorsJson(req, { ok: false, error: "Forbidden: that plan is not on this board" }, 403)
    }

    const result = await sharePlanJob(supabase, job as PlanJob)
    if (!result.ok) {
      // A domain policy refusal is not a bug, and saying "something went wrong"
      // would send someone looking for one.
      return withCorsJson(req, { ok: false, error: result.error, policy: result.policy ?? false }, result.policy ? 409 : 500)
    }

    // shared_at and ghl_tagged_at are reported separately because they mean
    // different things: the first is "the client can see it", the second is
    // "the client has been told". A share can succeed at the first and fail at
    // the second, and the screen has to be able to say so.
    return withCorsJson(req, {
      ok: true,
      shared_at: result.job.shared_at,
      drive_file_url: result.job.drive_file_url,
      ghl_tagged_at: result.job.ghl_tagged_at ?? null,
      ghl_email_sent_count: result.job.ghl_email_sent_count ?? 0,
      ghl_error: result.job.ghl_error ?? null,
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[plan/share]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    if (status === 403) return withCorsJson(req, { ok: false, error: "You do not have full access to that client's board." }, 403)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
