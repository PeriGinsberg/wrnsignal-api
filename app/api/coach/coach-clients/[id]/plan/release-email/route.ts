// app/api/coach/coach-clients/[id]/plan/release-email/route.ts
//
// The Release email for one client step, opened by "Send email" on the Plan.
//
//   GET  ?task_id=  the draft: the step's template from the client's main
//        coach's Settings, with [First Name], [Drive folder link] and
//        [Scheduling link] filled.
//   POST { task_id, subject, body, cc_parent } sends the coach's edited draft
//        as their own message, then releases the step. Refused while any
//        [bracket] is left.
//
// The rules are in lib/release/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../../_lib/coachEngagements"
import { loadReleaseDraft, sendReleaseEmail } from "@/lib/release/service"

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
    const r = await loadReleaseDraft(db, id, req.nextUrl.searchParams.get("task_id") ?? "")
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
    const r = await sendReleaseEmail(db, {
      coachClientId: id,
      taskId: typeof b?.task_id === "string" ? b.task_id : "",
      actor: coachProfileId,
      subject: b?.subject,
      body: b?.body,
      ccParent: b?.cc_parent,
    })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, ...r.data })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
