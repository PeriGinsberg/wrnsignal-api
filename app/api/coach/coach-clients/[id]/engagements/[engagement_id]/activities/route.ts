// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/activities/route.ts
//
// Engagement activity COLLECTION — add one, or reorder a deliverable's list.
//
//   POST  — { deliverable_id, name, owner, due_date?, is_signoff? } appends an
//           activity to one deliverable of this engagement.
//   PATCH — { deliverable_id, ordered_activity_ids[] } rewrites sort_order for
//           that deliverable's activities. The whole set, or nothing.
//
// THE SNAPSHOT IS THE POINT. These write ONLY to
// coach_client_engagement_activities rows under this engagement. The catalog
// (coach_milestones / coach_milestone_activities) is never touched, and neither
// is any other client's snapshot — that is what "frozen at attach" buys, and
// adding a task for one client must never edit the package it came from.
//
// SECURITY — the deliverable-level ownership walk: the coach owns [id], the
// engagement belongs to [id], and the deliverable belongs to the engagement.
// Without the third step a coach could append activities to another coach's
// deliverable by pairing its id with their own path.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  ACTIVITY_OWNERS,
  isValidActivityOwner,
  isValidActivityDueDate,
  normalizeActivityName,
  ACTIVITY_NAME_MAX,
  resolveOwnedEngagementDeliverable,
  loadDeliverableActivities,
  getApiEngagementById,
} from "../../../../../../_lib/coachEngagements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── POST: append an activity to a deliverable ──
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const name = normalizeActivityName(body.name)
    if (!name) {
      return withCorsJson(req, { ok: false, error: `name is required, and must be 1–${ACTIVITY_NAME_MAX} characters` }, 400)
    }
    if (!isValidActivityOwner(body.owner)) {
      return withCorsJson(req, { ok: false, error: `owner must be one of: ${ACTIVITY_OWNERS.join(", ")}` }, 400)
    }
    const dueProvided = body.due_date !== undefined
    if (dueProvided && !isValidActivityDueDate(body.due_date)) {
      return withCorsJson(req, { ok: false, error: "due_date must be YYYY-MM-DD or null" }, 400)
    }
    if (typeof body.deliverable_id !== "string" || !body.deliverable_id) {
      return withCorsJson(req, { ok: false, error: "deliverable_id is required" }, 400)
    }
    const wantsSignoff = body.is_signoff === true

    const supabase = getSupabaseAdmin()
    const owned = await resolveOwnedEngagementDeliverable(
      supabase, coachProfileId, id, engagement_id, body.deliverable_id,
    )
    if (!owned) return withCorsJson(req, { ok: false, error: "Deliverable not found" }, 404)

    const existing = await loadDeliverableActivities(supabase, owned.deliverableId)

    // Appending a sign-off where one already exists would violate the partial
    // unique index. Caught here so the coach gets a sentence instead of a
    // Postgres constraint name.
    if (wantsSignoff && existing.some((a) => a.is_signoff)) {
      return withCorsJson(req, {
        ok: false,
        error: "This deliverable already has a sign-off task. Clear the existing one first.",
      }, 409)
    }

    // Append. sort_order is max+1 over the CURRENT rows rather than a count, so
    // a list that has had deletions does not collide.
    const nextOrder = existing.reduce((m, a) => Math.max(m, a.sort_order), -1) + 1

    const { data: inserted, error: insErr } = await supabase
      .from("coach_client_engagement_activities")
      .insert({
        engagement_deliverable_id: owned.deliverableId,
        name,
        owner: body.owner,
        status: "not_started", // a new task always starts untouched
        due_date: dueProvided ? body.due_date : null,
        is_signoff: wantsSignoff,
        sort_order: nextOrder,
      })
      .select("id")
      .maybeSingle()
    if (insErr) {
      return withCorsJson(req, { ok: false, error: `Failed to add activity: ${insErr.message}` }, 500)
    }

    const engagement = await getApiEngagementById(supabase, id, engagement_id)
    return withCorsJson(req, { ok: true, activity_id: inserted?.id ?? null, engagement })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── PATCH: reorder one deliverable's activities ──
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    if (typeof body.deliverable_id !== "string" || !body.deliverable_id) {
      return withCorsJson(req, { ok: false, error: "deliverable_id is required" }, 400)
    }
    const ids = body.ordered_activity_ids
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
      return withCorsJson(req, { ok: false, error: "ordered_activity_ids must be an array of ids" }, 400)
    }

    const supabase = getSupabaseAdmin()
    const owned = await resolveOwnedEngagementDeliverable(
      supabase, coachProfileId, id, engagement_id, body.deliverable_id,
    )
    if (!owned) return withCorsJson(req, { ok: false, error: "Deliverable not found" }, 404)

    const existing = await loadDeliverableActivities(supabase, owned.deliverableId)

    // THE WHOLE SET OR NOTHING. A reorder that names a subset would leave the
    // unnamed rows with stale sort_order values interleaved among the new ones,
    // which is a scrambled list rather than a partial one. Comparing sorted ids
    // rejects omissions, extras, duplicates and foreign ids in a single check.
    const have = existing.map((a) => a.id).sort()
    const want = [...ids].sort()
    const sameSet = have.length === want.length && have.every((v, i) => v === want[i])
    if (!sameSet) {
      return withCorsJson(req, {
        ok: false,
        error: "ordered_activity_ids must list exactly this deliverable's activities, once each.",
      }, 400)
    }

    // Reorder cannot change the unlock — that is precisely what is_signoff
    // bought — so there is no confirm here and no lock-state check.
    for (let i = 0; i < ids.length; i++) {
      const { error: upErr } = await supabase
        .from("coach_client_engagement_activities")
        .update({ sort_order: i })
        .eq("id", ids[i])
        .eq("engagement_deliverable_id", owned.deliverableId)
      if (upErr) {
        return withCorsJson(req, { ok: false, error: `Failed to reorder: ${upErr.message}` }, 500)
      }
    }

    const engagement = await getApiEngagementById(supabase, id, engagement_id)
    return withCorsJson(req, { ok: true, engagement })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
