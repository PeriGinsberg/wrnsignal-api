// app/api/coach/coach-clients/[id]/plan/welcome/route.ts
//
// The welcome email for one client, opened when the coach ticks or releases
// "Send welcome email (releases: [task])".
//
//   GET  ?task_id=  what the editor opens with: to, parent email, first name,
//        Drive link, the matching template and all the coach's templates.
//   POST { task_id, send, start, subject, body, cc_parent } sends it (send
//        true) or not (send false), then releases the task and shares the
//        Drive workspace, as a plain release does.
//
// The rules are in lib/welcome/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../../_lib/coachEngagements"
import { loadWelcomeDraft, sendWelcome } from "@/lib/welcome/service"

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
    const r = await loadWelcomeDraft(db, id, req.nextUrl.searchParams.get("task_id") ?? "")
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, draft: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client not found" }, 404)
    }
    const b = await req.json().catch(() => ({}))
    const r = await sendWelcome(db, {
      coachClientId: id,
      taskId: typeof b?.task_id === "string" ? b.task_id : "",
      actor: coachProfileId,
      send: b?.send === true,
      start: b?.start,
      subject: b?.subject,
      body: b?.body,
      ccParent: b?.cc_parent,
    })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, result: r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
