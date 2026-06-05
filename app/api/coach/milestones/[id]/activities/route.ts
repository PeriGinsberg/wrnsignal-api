// app/api/coach/milestones/[id]/activities/route.ts
//
// Deliverable Activities — create one activity on a deliverable.
//
//   POST — { name, owner, sort_order? } → create. owner ∈ (coach, client, both),
//          validated at the edge (400). sort_order defaults to this deliverable's
//          current max + 1. 201 on success.
//
// SECURITY: the PARENT deliverable must belong to the authed coach (ownership
// reaches through milestone_id; activities have no coach_profile_id). A
// deliverable owned by another coach (or a bad id) → 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
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
} from "../../../../_lib/coachActivities"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return withCorsJson(req, { ok: false, error: "name is required" }, 400)

    if (!isValidOwner(body.owner)) {
      return withCorsJson(req, { ok: false, error: `owner must be one of: ${ACTIVITY_OWNERS.join(", ")}` }, 400)
    }

    let sortOrder: number | undefined
    if (body.sort_order !== undefined && body.sort_order !== null) {
      if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) {
        return withCorsJson(req, { ok: false, error: "sort_order must be an integer" }, 400)
      }
      sortOrder = body.sort_order
    }

    const supabase = getSupabaseAdmin()

    // Ownership guard: the parent deliverable must belong to this coach.
    if (!(await isMilestoneOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Milestone not found" }, 404)
    }

    // Default sort_order = this deliverable's current max + 1 (scoped to it).
    if (sortOrder === undefined) {
      const { data: maxRow, error: maxErr } = await supabase
        .from("coach_milestone_activities")
        .select("sort_order")
        .eq("milestone_id", id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (maxErr) {
        return withCorsJson(req, { ok: false, error: `Failed to compute sort_order: ${maxErr.message}` }, 500)
      }
      sortOrder = (typeof maxRow?.sort_order === "number" ? maxRow.sort_order : 0) + 1
    }

    const { data: inserted, error: insErr } = await supabase
      .from("coach_milestone_activities")
      .insert({ milestone_id: id, name, owner: body.owner, sort_order: sortOrder })
      .select(ACTIVITY_SELECT)
      .single()
    if (insErr || !inserted) {
      return withCorsJson(req, { ok: false, error: `Failed to create activity: ${insErr?.message ?? "unknown error"}` }, 500)
    }

    return withCorsJson(req, { ok: true, activity: toApiActivity(inserted as ActivityRow) }, 201)
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
