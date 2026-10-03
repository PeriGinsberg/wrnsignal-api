// app/api/coach/phases/route.ts
//
// The coach's phases (Settings > Services > Phases).
//
//   GET  the phases in order, seeding Know, Build, Prove, Search, Land the
//        first time. A delegate reads and edits their principal's.
//   PUT  { phases: [{ id?, label, active }] } saves names, order and on/off.
//        An entry without an id adds a phase. Phases are never deleted.
//
// The rules are in lib/phases/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../_lib/coachAuth"
import { owningCoachId } from "@/lib/collab/delegation"
import { ensurePhases, savePhases } from "@/lib/phases/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const phases = await ensurePhases(getSupabaseAdmin(), owningCoachId(delegation))
    return withCorsJson(req, { ok: true, phases })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const body = await req.json().catch(() => ({}))
    const r = await savePhases(getSupabaseAdmin(), owningCoachId(delegation), body?.phases)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, phases: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
