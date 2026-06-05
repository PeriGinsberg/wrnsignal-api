// app/api/coach/milestones/[id]/activities/[activity_id]/route.ts
//
// Deliverable Activities — edit / delete one activity.
//
//   PATCH  — partial update; allow-listed { name?, owner?, sort_order? }.
//   DELETE — remove the activity.
//
// SECURITY (two-step, the one that matters): (1) the PARENT deliverable [id]
// must belong to the authed coach; (2) the write matches the activity on BOTH
// activity_id AND milestone_id = [id]. So a coach can't edit another coach's
// activity by passing one of THEIR OWN deliverable ids in the path — the
// milestone_id match fails → 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  ACTIVITY_OWNERS,
  isValidOwner,
  ACTIVITY_SELECT,
  toApiActivity,
  isMilestoneOwnedByCoach,
  type ActivityRow,
} from "../../../../../_lib/coachActivities"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

const PATCH_ALLOWED = new Set(["name", "owner", "sort_order"])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; activity_id: string }> },
) {
  try {
    const { id, activity_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const unknown = Object.keys(body).filter((k) => !PATCH_ALLOWED.has(k))
    if (unknown.length) {
      return withCorsJson(req, { ok: false, error: `Unknown field(s): ${unknown.join(", ")}` }, 400)
    }

    const updates: Record<string, any> = {}
    if ("name" in body) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return withCorsJson(req, { ok: false, error: "name cannot be empty" }, 400)
      }
      updates.name = body.name.trim()
    }
    if ("owner" in body) {
      if (!isValidOwner(body.owner)) {
        return withCorsJson(req, { ok: false, error: `owner must be one of: ${ACTIVITY_OWNERS.join(", ")}` }, 400)
      }
      updates.owner = body.owner
    }
    if ("sort_order" in body) {
      if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) {
        return withCorsJson(req, { ok: false, error: "sort_order must be an integer" }, 400)
      }
      updates.sort_order = body.sort_order
    }

    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No updatable fields supplied" }, 400)
    }

    const supabase = getSupabaseAdmin()

    // (1) Parent deliverable must belong to this coach.
    if (!(await isMilestoneOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Milestone not found" }, 404)
    }

    // (2) Match the activity on BOTH id and milestone_id = [id]. An activity that
    // belongs to a DIFFERENT deliverable (even one this coach owns) → no match → 404.
    const { data: updated, error: upErr } = await supabase
      .from("coach_milestone_activities")
      .update(updates)
      .eq("id", activity_id)
      .eq("milestone_id", id)
      .select(ACTIVITY_SELECT)
      .maybeSingle()
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update activity: ${upErr.message}` }, 500)
    }
    if (!updated) {
      return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)
    }

    return withCorsJson(req, { ok: true, activity: toApiActivity(updated as ActivityRow) })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; activity_id: string }> },
) {
  try {
    const { id, activity_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()

    // (1) Parent deliverable must belong to this coach.
    if (!(await isMilestoneOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Milestone not found" }, 404)
    }

    // (2) Match on BOTH id and milestone_id = [id] (see PATCH note).
    const { data: deleted, error: delErr } = await supabase
      .from("coach_milestone_activities")
      .delete()
      .eq("id", activity_id)
      .eq("milestone_id", id)
      .select("id")
      .maybeSingle()
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to delete activity: ${delErr.message}` }, 500)
    }
    if (!deleted) {
      return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)
    }

    return withCorsJson(req, { ok: true, deleted: (deleted as { id: string }).id })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
