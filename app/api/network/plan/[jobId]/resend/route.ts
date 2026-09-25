// app/api/network/plan/[jobId]/resend/route.ts
// "Re-send email" — the ONLY path that emails a client about a plan twice.
//
// Sharing already emailed them once. Re-sharing an updated plan deliberately
// does not email again, because a second "your plan is ready" for the same plan
// erodes trust faster than a missing feature. This endpoint exists so that when
// a coach genuinely needs the email sent again, it is an explicit act with its
// own button rather than a side effect of re-sharing.
//
// SINCE 2026-09-26 THIS IS JUST A SEND. It used to remove the GoHighLevel tag
// `networking-plan-shared` and add it back, because a plain re-add might not
// re-fire the GHL workflow and a button labelled "Re-send email" has to
// actually re-send. That left a window where the remove succeeded and the add
// failed, and the contact ended up with neither the tag nor the email: the
// route had to report `tag_lost` and ask the coach to click again.
//
// None of that exists now. SIGNAL owns the email, so re-sending is sending
// again. There is no window, no `tag_lost`, and no repair to explain.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errorStatus } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveRequestScope } from "@/lib/collab/scope"
import { emailClientPlanReady, type PlanJob } from "@/lib/networking-plan/job"

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
    if (job.client_profile_id !== scope.subjectId) {
      return withCorsJson(req, { ok: false, error: "Forbidden: that plan is not on this board" }, 403)
    }

    const plan = job as PlanJob

    // Re-sending something that was never sent is not a re-send. Share it
    // first, which is also the path that writes the notes.
    if (!plan.shared_at) {
      return withCorsJson(req, { ok: false, error: "Share the plan first. It has not been sent yet." }, 409)
    }

    // NO GHL CONTACT CHECK ANY MORE. It used to be required here because the
    // GHL contact was how the client got emailed. The email now goes to the
    // client's own address, so a client with no GHL contact can still be
    // re-sent to.
    const updated = await emailClientPlanReady(supabase, plan)

    if (updated.client_email_error) {
      return withCorsJson(req, {
        ok: false,
        emailed: false,
        error: `Re-send failed: ${updated.client_email_error}`,
      }, 502)
    }

    return withCorsJson(req, {
      ok: true,
      emailed: true,
      sent_count: updated.client_email_sent_count,
      // Outside production this is the internal redirect address, not the
      // client's. Returned so the coach UI can say so rather than implying a
      // client was written to when they were not.
      sent_to: updated.client_email_to,
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[plan/resend]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    if (status === 403) return withCorsJson(req, { ok: false, error: "You do not have full access to that client's board." }, 403)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
