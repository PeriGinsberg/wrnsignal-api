// app/api/coach/coach-clients/[id]/engagements/[engagement_id]/route.ts
//
// Client Engagements — read / detach a single engagement.
//
//   GET    — full snapshot (deliverables[] + nested activities[]) + pricing.
//   DELETE — detach (hard delete; CASCADE clears deliverables + activities).
//
// SECURITY (two-step, the one that matters): (1) the coach_clients row [id] must
// belong to the authed coach; (2) the engagement is matched on BOTH engagement_id
// AND coach_client_id = [id]. So a coach can't read/delete another coach's
// engagement by pairing it with one of THEIR OWN coach_clients rows — the
// coach_client_id match fails → 404.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  isCoachClientOwnedByCoach,
  getApiEngagementById,
} from "../../../../../_lib/coachEngagements"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: single engagement (snapshot + pricing) ──
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // Matches on engagement_id AND coach_client_id = [id]; an engagement on a
    // DIFFERENT relationship (even one this coach owns) → no match → 404.
    const engagement = await getApiEngagementById(supabase, id, engagement_id)
    if (!engagement) {
      return withCorsJson(req, { ok: false, error: "Engagement not found" }, 404)
    }
    return withCorsJson(req, { ok: true, engagement })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}

// ── DELETE: detach (hard delete; children CASCADE) ──
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; engagement_id: string }> },
) {
  try {
    const { id, engagement_id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    // Match on BOTH engagement_id and coach_client_id = [id] (see header note).
    const { data: deleted, error: delErr } = await supabase
      .from("coach_client_engagements")
      .delete()
      .eq("id", engagement_id)
      .eq("coach_client_id", id)
      .select("id")
      .maybeSingle()
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to detach engagement: ${delErr.message}` }, 500)
    }
    if (!deleted) {
      return withCorsJson(req, { ok: false, error: "Engagement not found" }, 404)
    }

    return withCorsJson(req, { ok: true, deleted: (deleted as { id: string }).id })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
