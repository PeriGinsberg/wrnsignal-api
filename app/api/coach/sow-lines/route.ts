// app/api/coach/sow-lines/route.ts
//
// The practice's standard SOW sections (Settings > Services > SOW).
//
//   GET  { lines, phases }: every line by section and order, and the coach's
//        phases for the "Show for" choice. A delegate reads their principal's.
//   PUT  { lines: [{ section, body, show_for, phase_id }] } replaces the set.
//
// The rules are in lib/sow/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../_lib/coachAuth"
import { owningCoachId } from "@/lib/collab/delegation"
import { ensurePhases } from "@/lib/phases/service"
import { getSowLines, saveSowLines } from "@/lib/sow/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    const coachId = owningCoachId(delegation)
    const [lines, phases] = await Promise.all([getSowLines(db, coachId), ensurePhases(db, coachId)])
    return withCorsJson(req, { ok: true, lines, phases })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const body = await req.json().catch(() => ({}))
    const r = await saveSowLines(getSupabaseAdmin(), owningCoachId(delegation), body?.lines)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, lines: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
