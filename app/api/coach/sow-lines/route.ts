// app/api/coach/sow-lines/route.ts
//
// The practice's standard SOW sections (Settings > Services > SOW).
//
//   GET  { lines, phases, default_opening }: every line by section and order,
//        the coach's phases for the "Show for" choice, and the default opening
//        paragraph new SOWs start with. A delegate reads their principal's.
//   PUT  { lines: [{ section, body, show_for, phase_id }], default_opening? }
//        replaces the set of lines, and saves the default opening when sent.
//
// The rules are in lib/sow/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../_lib/coachAuth"
import { owningCoachId } from "@/lib/collab/delegation"
import { ensurePhases } from "@/lib/phases/service"
import { getDefaultOpening, getSowLines, saveDefaultOpening, saveSowLines } from "@/lib/sow/service"
import { SOW_OPENING_MAX, normalizeText } from "@/lib/sow/model"

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
    const [lines, phases, defaultOpening] = await Promise.all([getSowLines(db, coachId), ensurePhases(db, coachId), getDefaultOpening(db, coachId)])
    return withCorsJson(req, { ok: true, lines, phases, default_opening: defaultOpening })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const body = await req.json().catch(() => ({}))
    const db = getSupabaseAdmin()
    const coachId = owningCoachId(delegation)
    const sendsOpening = body && typeof body === "object" && "default_opening" in body
    // Check the opening before writing anything, so a bad one saves nothing.
    if (sendsOpening) {
      const v = normalizeText(body.default_opening, SOW_OPENING_MAX, "The default opening paragraph")
      if ("error" in v) return withCorsJson(req, { ok: false, error: v.error }, 400)
    }
    const r = await saveSowLines(db, coachId, body?.lines)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    if (sendsOpening) {
      const o = await saveDefaultOpening(db, coachId, body.default_opening)
      if (!o.ok) return withCorsJson(req, { ok: false, error: o.error }, o.status)
    }
    return withCorsJson(req, { ok: true, lines: r.data, default_opening: await getDefaultOpening(db, coachId) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
