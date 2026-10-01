// app/api/coach/prospects/[id]/consult/booked/route.ts
//
// POST — the consult is booked. Body: { date: "YYYY-MM-DD" }.
// Records the date, reaches Consult Scheduled, and creates (or, on a
// reschedule, moves) "Prep for consult with [name]" due that day.
// See bookConsult in lib/prospects/workflow.ts.
//
// Manual for now. When Calendly is connected, its booking webhook calls the
// same function.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../../_lib/coachEngagements"
import { bookConsult } from "@/lib/prospects/workflow"

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
    const body = await req.json().catch(() => ({}))
    const r = await bookConsult(db, {
      coachClientId: id,
      actingIds: delegation.actingIds,
      day: typeof body?.date === "string" ? body.date : "",
      actor: coachProfileId,
    })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, ...r.data })
  } catch (e: any) {
    return withCorsJson(req, { ok: false, error: e?.message || String(e) }, errStatus(e))
  }
}
