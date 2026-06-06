// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/activities/[activity_id]/route.ts
//
// Engagement activity status — coach-facing completion tracking on the FROZEN
// snapshot activity (not_started → in_progress → complete).
//
//   PATCH — { status } sets coach_client_engagement_activities.status for one
//           activity. Writes ONLY that column.
//
// SECURITY — a THREE-LEVEL ownership walk (one deeper than the engagement
// routes), so a coach can't PATCH another coach's activity by pairing it with an
// engagement + relationship they legitimately own:
//   (1) the coach_clients row [id] belongs to the authed coach;
//   (2) the engagement [engagement_id]'s coach_client_id === [id];
//   (3) the activity [activity_id]'s deliverable's engagement_id === [engagement_id].
// Step (3) is the deeper guard — without it, B could pass A's activity_id under
// B's own [id]/[engagement_id] and slip through.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  ACTIVITY_STATUSES,
  isValidActivityStatus,
  isCoachClientOwnedByCoach,
  getApiEngagementById,
} from "../../../../../../../_lib/coachEngagements"
import { logCoachClientEvent } from "../../../../../../../_lib/coachClientEvents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string; activity_id: string }> },
) {
  try {
    const { id, engagement_id, activity_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    if (!isValidActivityStatus(body.status)) {
      return withCorsJson(req, { ok: false, error: `status must be one of: ${ACTIVITY_STATUSES.join(", ")}` }, 400)
    }
    const nextStatus = body.status

    const supabase = getSupabaseAdmin()

    // (1) coach owns the relationship.
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // (2) the engagement belongs to this relationship (also gives us its name).
    const { data: engagement, error: engErr } = await supabase
      .from("coach_client_engagements")
      .select("id, name")
      .eq("id", engagement_id)
      .eq("coach_client_id", id)
      .maybeSingle()
    if (engErr) return withCorsJson(req, { ok: false, error: `Failed to read engagement: ${engErr.message}` }, 500)
    if (!engagement) return withCorsJson(req, { ok: false, error: "Engagement not found" }, 404)

    // (3) the activity belongs to a deliverable of THIS engagement. Capture its
    //     CURRENT status (for event de-dup) and name (for the event context).
    const { data: activity, error: actErr } = await supabase
      .from("coach_client_engagement_activities")
      .select("id, name, status, engagement_deliverable_id")
      .eq("id", activity_id)
      .maybeSingle()
    if (actErr) return withCorsJson(req, { ok: false, error: `Failed to read activity: ${actErr.message}` }, 500)
    if (!activity) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    const { data: deliverable, error: delErr } = await supabase
      .from("coach_client_engagement_deliverables")
      .select("engagement_id")
      .eq("id", activity.engagement_deliverable_id)
      .maybeSingle()
    if (delErr) return withCorsJson(req, { ok: false, error: `Failed to read deliverable: ${delErr.message}` }, 500)
    if (!deliverable || deliverable.engagement_id !== engagement_id) {
      return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)
    }

    const priorStatus = activity.status as string

    // Update ONLY the activity's status (chain already verified above).
    const { error: upErr } = await supabase
      .from("coach_client_engagement_activities")
      .update({ status: nextStatus })
      .eq("id", activity_id)
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update activity status: ${upErr.message}` }, 500)
    }

    // Best-effort event log — ONLY on a transition INTO complete (not a re-complete,
    // not other statuses). The helper never throws; a logging failure can't fail
    // the status PATCH.
    if (nextStatus === "complete" && priorStatus !== "complete") {
      await logCoachClientEvent({
        coachClientId: id,
        eventType: "activity_completed",
        actorProfileId: coachProfileId,
        context: { name: activity.name, engagement_name: engagement.name },
      })
    }

    // Return the fresh engagement so the UI re-renders with the new status.
    const updated = await getApiEngagementById(supabase, id, engagement_id)
    return withCorsJson(req, { ok: true, engagement: updated })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
