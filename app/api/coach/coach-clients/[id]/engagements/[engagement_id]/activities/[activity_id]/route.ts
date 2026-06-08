// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/activities/[activity_id]/route.ts
//
// Engagement activity write — coach-facing edits on the FROZEN snapshot activity:
// completion status (not_started → in_progress → complete) and an optional due date.
//
//   PATCH — { status?, due_date? } updates coach_client_engagement_activities for
//           one activity. status is the 3-way completion; due_date is a YYYY-MM-DD
//           string or null (clears it). At least one of the two must be present;
//           writes ONLY the fields provided — nothing else.
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
  isValidActivityDueDate,
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
    // Allow-list: status and/or due_date. At least one must be present; any other
    // key is simply ignored (we only ever build an update from these two).
    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status")
    const hasDueDate = Object.prototype.hasOwnProperty.call(body, "due_date")
    if (!hasStatus && !hasDueDate) {
      return withCorsJson(req, { ok: false, error: "Provide status and/or due_date" }, 400)
    }
    if (hasStatus && !isValidActivityStatus(body.status)) {
      return withCorsJson(req, { ok: false, error: `status must be one of: ${ACTIVITY_STATUSES.join(", ")}` }, 400)
    }
    if (hasDueDate && !isValidActivityDueDate(body.due_date)) {
      return withCorsJson(req, { ok: false, error: "due_date must be a YYYY-MM-DD date or null" }, 400)
    }
    const nextStatus = hasStatus ? (body.status as string) : null

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

    // Update ONLY the fields provided (chain already verified above). Building the
    // patch from the allow-list flags keeps the write to status/due_date only.
    const patch: { status?: string; due_date?: string | null } = {}
    if (hasStatus) patch.status = nextStatus as string
    if (hasDueDate) patch.due_date = body.due_date as string | null
    const { error: upErr } = await supabase
      .from("coach_client_engagement_activities")
      .update(patch)
      .eq("id", activity_id)
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update activity: ${upErr.message}` }, 500)
    }

    // Best-effort event log — ONLY on a transition INTO complete (not a re-complete,
    // not other statuses, not a due_date-only edit). The helper never throws; a
    // logging failure can't fail the PATCH.
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
