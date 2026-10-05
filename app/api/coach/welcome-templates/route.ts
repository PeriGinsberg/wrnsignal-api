// app/api/coach/welcome-templates/route.ts
//
// The coach's welcome emails (Settings > Services > Welcome emails).
//
//   GET  { templates }: one per starting point the coach has saved (Your
//        SIGNAL DNA, Resume Workshop, Search, Land). A delegate reads their
//        principal's.
//   PUT  { start_key, subject, body, scheduling_link } saves one.
//
// The rules are in lib/welcome/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../_lib/coachAuth"
import { owningCoachId } from "@/lib/collab/delegation"
import { getWelcomeTemplates, saveWelcomeTemplate } from "@/lib/welcome/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const templates = await getWelcomeTemplates(getSupabaseAdmin(), owningCoachId(delegation))
    return withCorsJson(req, { ok: true, templates })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    const coachId = owningCoachId(delegation)
    const r = await saveWelcomeTemplate(db, coachId, await req.json().catch(() => ({})))
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, templates: await getWelcomeTemplates(db, coachId) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
