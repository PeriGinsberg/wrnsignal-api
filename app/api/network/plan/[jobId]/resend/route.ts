// app/api/network/plan/[jobId]/resend/route.ts
// "Re-send email" — the ONLY path that emails a client about a plan twice.
//
// Sharing already emailed them once. Re-sharing an updated plan deliberately
// does not email again, because a second "your plan is ready" for the same plan
// erodes trust faster than a missing feature. This endpoint exists so that when
// a coach genuinely needs the email sent again, it is an explicit act with its
// own button rather than a side effect of re-sharing.
//
// It removes the tag and adds it back, because a plain re-add may or may not
// re-fire the GHL workflow depending on its re-entry setting, and a button
// labelled "Re-send email" is promising that it definitely does.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errorStatus } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveRequestScope } from "@/lib/collab/scope"
import { ghlConfig } from "@/lib/ghl/client"
import { resendNetworkingPlanEmail } from "@/lib/ghl/networkingPlanSync"
import { type PlanJob } from "@/lib/networking-plan/job"

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

    // Re-sending something that was never sent is not a re-send. Share it first,
    // which is also the path that writes the note.
    if (!plan.shared_at) {
      return withCorsJson(req, { ok: false, error: "Share the plan first — it has not been sent yet." }, 409)
    }
    if (!plan.ghl_contact_id) {
      return withCorsJson(req, {
        ok: false,
        error: "No GHL contact is wired for this client, so there is no one to email. Set it on the client's folder setup.",
      }, 409)
    }

    const res = await resendNetworkingPlanEmail({ contactId: plan.ghl_contact_id }, ghlConfig())

    if (res.emailed) {
      const { data: updated } = await supabase.from("networking_plan_jobs")
        .update({
          ghl_tagged_at: new Date().toISOString(),
          ghl_email_sent_count: (plan.ghl_email_sent_count ?? 0) + 1,
          ghl_error: null,
        })
        .eq("id", plan.id).select("ghl_email_sent_count").single()
      return withCorsJson(req, { ok: true, emailed: true, sent_count: updated?.ghl_email_sent_count ?? null }, 200)
    }

    // THE ONE STATE THAT NEEDS A SPECIFIC MESSAGE. The tag was removed and could
    // not be put back after a retry, so the contact no longer shows the plan as
    // shared AND no email went out. Clicking again is the repair: remove is a
    // no-op on an untagged contact and the add is what was missing.
    await supabase.from("networking_plan_jobs")
      .update({ ghl_tagged_at: res.tagLost ? null : plan.ghl_tagged_at, ghl_error: res.error ?? "Re-send failed" })
      .eq("id", plan.id)

    return withCorsJson(req, {
      ok: false,
      emailed: false,
      tag_lost: res.tagLost,
      error: res.tagLost
        ? "Re-send failed, click again."
        : `Re-send failed: ${res.error ?? "unknown error"}`,
    }, 502)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[plan/resend]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    if (status === 403) return withCorsJson(req, { ok: false, error: "You do not have full access to that client's board." }, 403)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
