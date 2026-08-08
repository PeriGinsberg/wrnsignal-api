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
  ACTIVITY_OWNERS,
  ACTIVITY_NAME_MAX,
  isValidActivityOwner,
  normalizeActivityName,
  loadDeliverableActivities,
  requireConfirm,
  resolveOwnedEngagementActivity,
} from "../../../../../../../_lib/coachEngagements"
import { logCoachClientEvent } from "../../../../../../../_lib/coachClientEvents"
import { type ProofActivity } from "@/lib/proofProject"

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
    // Allow-list: status, due_date, name, owner, is_signoff. At least one must be
    // present; any other key is ignored (the update is only ever built from these).
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)
    const hasStatus = has("status")
    const hasDueDate = has("due_date")
    const hasName = has("name")
    const hasOwner = has("owner")
    const hasSignoff = has("is_signoff")
    if (!hasStatus && !hasDueDate && !hasName && !hasOwner && !hasSignoff) {
      return withCorsJson(req, { ok: false, error: "Provide status, due_date, name, owner and/or is_signoff" }, 400)
    }
    if (hasStatus && !isValidActivityStatus(body.status)) {
      return withCorsJson(req, { ok: false, error: `status must be one of: ${ACTIVITY_STATUSES.join(", ")}` }, 400)
    }
    if (hasDueDate && !isValidActivityDueDate(body.due_date)) {
      return withCorsJson(req, { ok: false, error: "due_date must be a YYYY-MM-DD date or null" }, 400)
    }
    const nextName = hasName ? normalizeActivityName(body.name) : null
    if (hasName && !nextName) {
      return withCorsJson(req, { ok: false, error: `name must be 1–${ACTIVITY_NAME_MAX} characters` }, 400)
    }
    if (hasOwner && !isValidActivityOwner(body.owner)) {
      return withCorsJson(req, { ok: false, error: `owner must be one of: ${ACTIVITY_OWNERS.join(", ")}` }, 400)
    }
    if (hasSignoff && typeof body.is_signoff !== "boolean") {
      return withCorsJson(req, { ok: false, error: "is_signoff must be a boolean" }, 400)
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
    const deliverableId = activity.engagement_deliverable_id as string

    // ── Would this edit take the client's reward back? ──
    //
    // Apply the edit to an in-memory copy of the deliverable's activities and
    // ask the SAME unlock rule the client page uses. Reopening a completed
    // sign-off, or moving the flag to an unfinished task, both re-lock — and the
    // coach has to say so explicitly before it lands.
    const before = await loadDeliverableActivities(supabase, deliverableId)
    const next = before.map((a) => {
      if (a.id !== activity_id) {
        // Moving the flag HERE clears it everywhere else, which is what the
        // unique index would otherwise refuse.
        return hasSignoff && body.is_signoff === true ? { ...a, is_signoff: false } : a
      }
      return {
        ...a,
        ...(hasStatus ? { status: nextStatus as ProofActivity["status"] } : {}),
        ...(hasSignoff ? { is_signoff: body.is_signoff as boolean } : {}),
      }
    })
    const gate = requireConfirm({ before, next, confirmed: body.confirm === true })
    if (gate.blocked) {
      return withCorsJson(req, { ok: false, error: gate.reason, requires_confirm: gate.kind }, 409)
    }

    // Taking the sign-off flag from whichever activity currently holds it MUST
    // happen before setting it here: the partial unique index permits one true
    // row per deliverable, so "set new then clear old" fails mid-flight.
    if (hasSignoff && body.is_signoff === true) {
      const { error: clearErr } = await supabase
        .from("coach_client_engagement_activities")
        .update({ is_signoff: false })
        .eq("engagement_deliverable_id", deliverableId)
        .eq("is_signoff", true)
        .neq("id", activity_id)
      if (clearErr) {
        return withCorsJson(req, { ok: false, error: `Failed to move the sign-off: ${clearErr.message}` }, 500)
      }
    }

    // Update ONLY the fields provided (chain already verified above). Building the
    // patch from the allow-list flags keeps the write to the allowed columns.
    const patch: {
      status?: string; due_date?: string | null; name?: string
      owner?: string; is_signoff?: boolean
    } = {}
    if (hasStatus) patch.status = nextStatus as string
    if (hasDueDate) patch.due_date = body.due_date as string | null
    if (hasName) patch.name = nextName as string
    if (hasOwner) patch.owner = body.owner as string
    if (hasSignoff) patch.is_signoff = body.is_signoff as boolean
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

// ── DELETE: remove one activity from the snapshot ──
//
// Hard delete. The row is a per-client snapshot, so there is nothing upstream to
// restore it from and nothing downstream that keeps a foreign key to it except
// its own notes, which CASCADE.
//
// WHAT SURVIVES A DELETE, DELIBERATELY: the activity_completed event. If the
// client finished this task on Tuesday, they finished something on Tuesday, and
// their streak should not retroactively lose a day because the coach later
// restructured the plan. The event log is a record of days worked, not an index
// of rows that still exist.
//
// Deleting the SIGN-OFF task always requires `confirm: true` — see
// requireConfirm. Deleting a completed non-sign-off task can also re-lock
// nothing, but it does move the percentage, which needs no confirmation because
// it is visibly recomputed on the same screen.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string; activity_id: string }> },
) {
  try {
    const { id, engagement_id, activity_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    // DELETE carries no body in most clients, so the confirm rides on the query
    // string. Body is still read when present, so both shapes work.
    const url = new URL(req.url)
    const body = await req.json().catch(() => null)
    const confirmed =
      url.searchParams.get("confirm") === "true" ||
      (!!body && typeof body === "object" && (body as { confirm?: unknown }).confirm === true)

    const supabase = getSupabaseAdmin()
    const owned = await resolveOwnedEngagementActivity(
      supabase, coachProfileId, id, engagement_id, activity_id,
    )
    if (!owned) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    const { data: activity, error: actErr } = await supabase
      .from("coach_client_engagement_activities")
      .select("id, engagement_deliverable_id, is_signoff")
      .eq("id", activity_id)
      .maybeSingle()
    if (actErr) return withCorsJson(req, { ok: false, error: `Failed to read activity: ${actErr.message}` }, 500)
    if (!activity) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    const deliverableId = activity.engagement_deliverable_id as string
    const before = await loadDeliverableActivities(supabase, deliverableId)
    const next = before.filter((a) => a.id !== activity_id)

    const gate = requireConfirm({
      before,
      next,
      deletingSignoff: activity.is_signoff === true,
      confirmed,
    })
    if (gate.blocked) {
      return withCorsJson(req, { ok: false, error: gate.reason, requires_confirm: gate.kind }, 409)
    }

    const { error: delErr } = await supabase
      .from("coach_client_engagement_activities")
      .delete()
      .eq("id", activity_id)
      .eq("engagement_deliverable_id", deliverableId)
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to delete activity: ${delErr.message}` }, 500)
    }

    const updated = await getApiEngagementById(supabase, id, engagement_id)
    return withCorsJson(req, { ok: true, engagement: updated })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
