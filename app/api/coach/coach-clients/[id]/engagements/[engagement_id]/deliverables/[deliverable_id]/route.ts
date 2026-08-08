// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/deliverables/[deliverable_id]/route.ts
//
// The coach's prose on one snapshot deliverable.
//
//   PATCH — { speaking_point?, why_this_matters? }
//
// speaking_point is the sentence the CLIENT can say once this deliverable is
// signed off. why_this_matters is the coach's framing of why it counts. Both are
// nullable and both normalize ""/whitespace → null, because clearing one is an
// ordinary edit and an empty string would render as a blank card rather than as
// no card.
//
// WRITTEN IN THE CLIENT'S VOICE. The Proof Project page labels speaking_point
// "You can now say:" and renders it in quotation marks, so third-person copy
// ("the client can discuss…") reads as broken. Nothing here can enforce that;
// it is a convention the coach-side UI has to teach with its placeholder.
//
// PER-CLIENT ONLY. This writes to the frozen snapshot deliverable. The catalog
// milestone it came from is untouched, so two clients on the same package can
// hold entirely different speaking points — which is the point, since a generic
// one would be worthless as a thing to say about yourself.
//
// SECURITY — the deliverable-level ownership walk: coach owns [id], engagement
// belongs to [id], deliverable belongs to the engagement.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  COACH_PROSE_MAX,
  normalizeCoachProse,
  resolveOwnedEngagementDeliverable,
  getApiEngagementById,
} from "../../../../../../../_lib/coachEngagements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string; deliverable_id: string }> },
) {
  try {
    const { id, engagement_id, deliverable_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)
    const hasPoint = has("speaking_point")
    const hasWhy = has("why_this_matters")
    if (!hasPoint && !hasWhy) {
      return withCorsJson(req, { ok: false, error: "Provide speaking_point and/or why_this_matters" }, 400)
    }

    const patch: { speaking_point?: string | null; why_this_matters?: string | null } = {}
    if (hasPoint) {
      const r = normalizeCoachProse(body.speaking_point)
      if (!r.ok) {
        return withCorsJson(req, { ok: false, error: `speaking_point must be text of at most ${COACH_PROSE_MAX} characters, or null` }, 400)
      }
      patch.speaking_point = r.value
    }
    if (hasWhy) {
      const r = normalizeCoachProse(body.why_this_matters)
      if (!r.ok) {
        return withCorsJson(req, { ok: false, error: `why_this_matters must be text of at most ${COACH_PROSE_MAX} characters, or null` }, 400)
      }
      patch.why_this_matters = r.value
    }

    const supabase = getSupabaseAdmin()
    const owned = await resolveOwnedEngagementDeliverable(
      supabase, coachProfileId, id, engagement_id, deliverable_id,
    )
    if (!owned) return withCorsJson(req, { ok: false, error: "Deliverable not found" }, 404)

    // No confirm gate here: prose edits cannot change a deliverable's lock
    // state. Clearing a speaking point on an ALREADY-UNLOCKED deliverable does
    // remove something the client could see — but that is the coach deleting
    // their own sentence, not the system revoking an achievement, and the UI
    // says so at the field.
    const { error: upErr } = await supabase
      .from("coach_client_engagement_deliverables")
      .update(patch)
      .eq("id", owned.deliverableId)
      .eq("engagement_id", engagement_id)
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update deliverable: ${upErr.message}` }, 500)
    }

    const engagement = await getApiEngagementById(supabase, id, engagement_id)
    return withCorsJson(req, { ok: true, engagement })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
