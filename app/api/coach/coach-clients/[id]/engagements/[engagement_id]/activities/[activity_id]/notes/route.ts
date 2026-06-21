// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/activities/[activity_id]/notes/route.ts
//
// Coach-facing notes ON a FROZEN engagement activity (coach_client_activity_notes).
//   GET  — list this activity's ACTIVE notes (deleted_at IS NULL), newest-first.
//   POST — { body, visible_to_client?, action_required? } create a note.
//
// SECURITY — the SAME three-level ownership walk the activity PATCH route does,
// via resolveOwnedEngagementActivity: coach owns coach_clients [id] → engagement
// belongs to [id] → activity belongs to a deliverable of that engagement. Any
// failure → 404. The note is scoped to the coach's own ids: coach_profile_id is
// the authed coach; client_profile_id is denormalized from the relationship.
// visible_to_client defaults FALSE (private to the coach unless shared).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  resolveOwnedEngagementActivity,
} from "../../../../../../../../_lib/coachEngagements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_NOTE_LEN = 5000
const NOTE_SELECT = "id, body, visible_to_client, action_required, client_done_at, created_at, updated_at"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string; activity_id: string }> },
) {
  try {
    const { id, engagement_id, activity_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const owned = await resolveOwnedEngagementActivity(supabase, coachProfileId, id, engagement_id, activity_id)
    if (!owned) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    const { data, error: listErr } = await supabase
      .from("coach_client_activity_notes")
      .select(NOTE_SELECT)
      .eq("engagement_activity_id", activity_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
    if (listErr) return withCorsJson(req, { ok: false, error: `Failed to list notes: ${listErr.message}` }, 500)

    return withCorsJson(req, { ok: true, notes: data ?? [] })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

export async function POST(
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
    const noteBody = typeof body.body === "string" ? body.body.trim() : ""
    if (!noteBody) return withCorsJson(req, { ok: false, error: "body is required" }, 400)
    if (noteBody.length > MAX_NOTE_LEN) {
      return withCorsJson(req, { ok: false, error: `body exceeds ${MAX_NOTE_LEN} characters` }, 400)
    }
    // Optional booleans — default false; reject a non-boolean if explicitly sent.
    if ("visible_to_client" in body && typeof body.visible_to_client !== "boolean") {
      return withCorsJson(req, { ok: false, error: "visible_to_client must be a boolean" }, 400)
    }
    if ("action_required" in body && typeof body.action_required !== "boolean") {
      return withCorsJson(req, { ok: false, error: "action_required must be a boolean" }, 400)
    }
    const visibleToClient = body.visible_to_client === true
    const actionRequired = body.action_required === true

    const supabase = getSupabaseAdmin()
    const owned = await resolveOwnedEngagementActivity(supabase, coachProfileId, id, engagement_id, activity_id)
    if (!owned) return withCorsJson(req, { ok: false, error: "Activity not found" }, 404)

    const { data: inserted, error: insErr } = await supabase
      .from("coach_client_activity_notes")
      .insert({
        engagement_activity_id: activity_id,
        coach_profile_id: coachProfileId,
        client_profile_id: owned.clientProfileId,
        body: noteBody,
        visible_to_client: visibleToClient,
        action_required: actionRequired,
      })
      .select(NOTE_SELECT)
      .single()
    if (insErr) return withCorsJson(req, { ok: false, error: `Failed to create note: ${insErr.message}` }, 500)

    return withCorsJson(req, { ok: true, note: inserted }, 201)
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
