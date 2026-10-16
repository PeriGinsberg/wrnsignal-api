// app/api/coach/release-templates/route.ts
//
// The coach's Release emails (Settings > Services > Release emails).
//
//   GET     { steps }: every client step in the coach's library, each with its
//           email or null. A delegate reads their principal's.
//   PUT     { activity_id, subject, body, scheduling_link } saves one.
//   DELETE  ?activity_id= removes one; the step goes back to a plain Release.
//
// The rules are in lib/release/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../_lib/coachAuth"
import { owningCoachId } from "@/lib/collab/delegation"
import { deleteReleaseTemplate, getReleaseSteps, saveReleaseTemplate } from "@/lib/release/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const steps = await getReleaseSteps(getSupabaseAdmin(), owningCoachId(delegation))
    return withCorsJson(req, { ok: true, steps })
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
    const r = await saveReleaseTemplate(db, coachId, await req.json().catch(() => ({})))
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, steps: await getReleaseSteps(db, coachId) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { delegation, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    const coachId = owningCoachId(delegation)
    const r = await deleteReleaseTemplate(db, coachId, req.nextUrl.searchParams.get("activity_id"))
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, steps: await getReleaseSteps(db, coachId) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
