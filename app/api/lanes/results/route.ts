// app/api/lanes/results/route.ts
// GET  ?lane_id=<uuid>  — the review queue: unactioned results for one lane.
// PATCH { id, action, reason?, note? } — record a decision on one result.
//
// OWNERSHIP. lane_results has no client_profile_id of its own; it is reached
// through its lane. Both handlers therefore verify the lane belongs to the
// caller BEFORE touching results, and the PATCH re-verifies through the row's
// own lane rather than trusting a lane id from the client. RLS exists on both
// tables but service-role bypasses it, so this check is the real guard.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Must stay in step with lane_results_reason_valid in
// 20260817_lane_result_actions.sql. Duplicated deliberately: the database
// rejects a bad value regardless, and this turns that rejection into a clear
// 400 instead of a 500 from a constraint violation.
const REASONS = new Set([
  "too_senior",
  "wrong_function",
  "wrong_location",
  "wrong_employer",
  "right_employer_wrong_level",
  "doesnt_meet_requirements",
])

const RESULT_FIELDS =
  "id, lane_id, job_id, matched_title, title, company, apply_url, location, workplace_type, " +
  "seniority, min_yoe, salary_min, salary_max, salary_currency, tools, requirements_summary, posted_at"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const laneId = new URL(req.url).searchParams.get("lane_id")
    if (!laneId) return withCorsJson(req, { ok: false, error: "lane_id required" }, 400)

    const { data: lane } = await supabase
      .from("search_lanes")
      .select("id, name, client_profile_id")
      .eq("id", laneId)
      .maybeSingle()
    if (!lane) return withCorsJson(req, { ok: false, error: "Lane not found" }, 404)
    if (lane.client_profile_id !== profileId) {
      return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    }

    // action IS NULL is the queue. Newest posting first — a job posted today
    // is worth more of the reviewer's attention than one from three weeks ago.
    const { data, error } = await supabase
      .from("lane_results")
      .select(RESULT_FIELDS)
      .eq("lane_id", laneId)
      .is("action", null)
      .order("posted_at", { ascending: false, nullsFirst: false })
    if (error) throw new Error(`Queue failed: ${error.message}`)

    return withCorsJson(req, { ok: true, lane: { id: lane.id, name: lane.name }, results: data ?? [] }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const body = await req.json().catch(() => ({}))

    const id = typeof body?.id === "string" ? body.id : null
    const action = body?.action === "push" || body?.action === "dismiss" ? body.action : null
    const rawNote = typeof body?.note === "string" ? body.note.trim() : ""
    const note = rawNote || null
    const reason = typeof body?.reason === "string" ? body.reason : null

    if (!id) return withCorsJson(req, { ok: false, error: "id required" }, 400)
    if (!action) return withCorsJson(req, { ok: false, error: "action must be push or dismiss" }, 400)

    // A dismissal without a reason is what makes the taxonomy useless, so it
    // is refused here as well as by the CHECK constraint.
    if (action === "dismiss" && !reason) {
      return withCorsJson(req, { ok: false, error: "reason required to dismiss" }, 400)
    }
    if (action === "dismiss" && !REASONS.has(reason!)) {
      return withCorsJson(req, { ok: false, error: `unknown reason: ${reason}` }, 400)
    }
    // A push carries no reason: reusing dismissal vocabulary on an approval
    // would corrupt the counts that make the taxonomy worth having.
    if (action === "push" && reason) {
      return withCorsJson(req, { ok: false, error: "push takes no reason" }, 400)
    }

    // Ownership through the row's OWN lane, not a lane id supplied by the
    // caller — otherwise a valid lane id of your own would authorize writing
    // to someone else's result.
    const { data: row } = await supabase
      .from("lane_results")
      .select("id, lane_id, search_lanes!inner(client_profile_id)")
      .eq("id", id)
      .maybeSingle()
    if (!row) return withCorsJson(req, { ok: false, error: "Result not found" }, 404)
    const owner = (row as any).search_lanes?.client_profile_id
    if (owner !== profileId) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const { data, error } = await supabase
      .from("lane_results")
      .update({
        action,
        reason: action === "dismiss" ? reason : null,
        note,
        actioned_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, action, reason, note, actioned_at")
      .single()
    if (error) throw new Error(`Action failed: ${error.message}`)

    return withCorsJson(req, { ok: true, result: data }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
