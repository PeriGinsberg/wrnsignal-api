// app/api/coach/coach-clients/[id]/phases/route.ts
//
// GET one client's phases, as the Phase stepper shows them: each active phase
// with its status (Not in plan, Not started, In progress, Complete), tasks done
// out of total, and whether every task is done ("ready to mark complete").
// [id] is the coach_clients id. See lib/phases/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../_lib/coachEngagements"
import { getClientPhases } from "@/lib/phases/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client not found" }, 404)
    }
    const phases = await getClientPhases(db, id)
    if (!phases) return withCorsJson(req, { ok: false, error: "Client not found" }, 404)
    return withCorsJson(req, { ok: true, phases })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
