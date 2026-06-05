// app/api/coach/coach-clients/[id]/events/route.ts
//
// Client event log — read the relationship's business-event timeline.
//
//   GET — this coach_clients relationship's events, newest first
//         ({ event_type, actor_profile_id, context, created_at }).
//
// READ-ONLY: events are written ONLY by logCoachClientEvent (the best-effort
// helper invoked by other actions), never by request — there is no POST / PATCH
// / DELETE here. Auth / ownership identical to the engagement routes: resolve
// the coach, verify the coach_clients row [id] belongs to them → 404 otherwise.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import {
  getSupabaseAdmin,
  resolveCoach,
  errStatus,
  isCoachClientOwnedByCoach,
} from "../../../../_lib/coachEngagements"
import { listApiEvents } from "../../../../_lib/coachClientEvents"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(supabase, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    }

    const events = await listApiEvents(supabase, id)
    return withCorsJson(req, { ok: true, events })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
