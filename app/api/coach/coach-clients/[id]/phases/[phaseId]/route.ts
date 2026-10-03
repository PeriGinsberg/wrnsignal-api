// app/api/coach/coach-clients/[id]/phases/[phaseId]/route.ts
//
// PATCH { status: "not_started" | "in_progress" | "complete" } sets one phase's
// status for this client and logs it in History. Complete is allowed with tasks
// still open. A phase not in the client's plan (no approved package has a
// deliverable in it) cannot be set. The stepper confirms a move back before it
// calls this. Returns the client's phases afterwards.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../../_lib/coachEngagements"
import { isSettablePhaseStatus } from "@/lib/phases/model"
import { getClientPhases, setPhaseStatus } from "@/lib/phases/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; phaseId: string }> }) {
  try {
    const { id, phaseId } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const body = await req.json().catch(() => ({}))
    if (!isSettablePhaseStatus(body?.status)) {
      return withCorsJson(req, { ok: false, error: "status must be not_started, in_progress or complete" }, 400)
    }
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client not found" }, 404)
    }
    const r = await setPhaseStatus(db, { coachClientId: id, phaseId, status: body.status, actor: coachProfileId })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, changed: r.data.changed, phases: await getClientPhases(db, id) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
