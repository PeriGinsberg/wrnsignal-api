// app/api/me/suggestions/[id]/route.ts
//
// The client acts on a supporter's suggestion. POST { action: "accept" | "dismiss" }.
//
// accept   the job becomes a tracker row, status 'saved', stamped
//          added_by_role 'supporter' + added_by_supporter_id, so the
//          "Added by" tag follows it to the client's and the coach's tracker.
// dismiss  it stays on the supporter's list as "Not added", read-only.
//
// CLAIM FIRST. The suggestion moves off 'pending' before the tracker row is
// written, guarded on status = 'pending', so a double click (or the supporter
// deleting it at the same moment) cannot create two rows. If the insert then
// fails, the claim is put back.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { routeError } from "../../../_lib/routeError"
import { logStatusChange } from "../../../_lib/applicationStatusHistory"
import { getCallerProfile, getSupabaseAdmin } from "@/lib/collab/identity"
import { SUGGESTION_COLUMNS } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const me = await getCallerProfile(req, "id")
    const supabase = getSupabaseAdmin()
    const body = await req.json().catch(() => null)
    const action = body?.action
    if (action !== "accept" && action !== "dismiss") {
      return withCorsJson(req, { ok: false, error: "action must be accept or dismiss" }, 400)
    }

    const decidedAt = new Date().toISOString()
    const { data: claimed, error: claimErr } = await supabase
      .from("supporter_job_suggestions")
      .update({ status: action === "accept" ? "accepted" : "dismissed", decided_at: decidedAt })
      .eq("id", id)
      .eq("client_profile_id", me.id)
      .eq("status", "pending")
      .select(SUGGESTION_COLUMNS)
    if (claimErr) throw new Error(`Suggestion update failed: ${claimErr.message}`)
    if (!claimed?.length) {
      return withCorsJson(req, { ok: false, error: "This suggestion was already handled or removed." }, 409)
    }
    const s = claimed[0] as any
    if (action === "dismiss") return withCorsJson(req, { ok: true, suggestion: s })

    const { data: app, error: appErr } = await supabase
      .from("signal_applications")
      .insert({
        profile_id: me.id,
        company_name: s.company_name,
        job_title: s.job_title,
        job_url: s.job_url,
        location: s.location,
        application_status: "saved",
        added_by_role: "supporter",
        added_by_supporter_id: s.supporter_id,
      })
      .select("*")
      .single()
    if (appErr || !app) {
      await supabase
        .from("supporter_job_suggestions")
        .update({ status: "pending", decided_at: null })
        .eq("id", s.id)
      throw new Error(`Tracker add failed: ${appErr?.message ?? "no row"}`)
    }

    // The client accepted it, so the client is who put it on the tracker.
    await logStatusChange(supabase, app.id, null, "saved", me.id)
    await supabase.from("supporter_job_suggestions").update({ application_id: app.id }).eq("id", s.id)

    return withCorsJson(req, { ok: true, suggestion: { ...s, application_id: app.id }, application: app })
  } catch (err) {
    return routeError(req, err)
  }
}
