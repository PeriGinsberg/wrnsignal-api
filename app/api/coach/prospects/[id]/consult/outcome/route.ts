// app/api/coach/prospects/[id]/consult/outcome/route.ts
//
// POST — record the consult's outcome and run its chain.
// Body:
//   { outcome: "completed", package_id: <uuid> | "custom", minutes?: number }
//   { outcome: "no_show" }
//   { outcome: "not_a_fit", notes?: string }
// What each runs is CONSULT_OUTCOME_CHAIN in lib/prospects/workflow.ts, which
// the screen shows in its confirm dialog before calling this.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../../_lib/coachEngagements"
import { parseOutcomeInput, recordConsultOutcome } from "@/lib/prospects/workflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, delegation, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Prospect not found" }, 404)
    }
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    const input = parseOutcomeInput(body)
    if (!input.ok) return withCorsJson(req, { ok: false, error: input.error }, 400)
    const r = await recordConsultOutcome(db, {
      coachClientId: id,
      actingIds: delegation.actingIds,
      actor: coachProfileId,
      input: input.value,
    })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, ...r.data })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
