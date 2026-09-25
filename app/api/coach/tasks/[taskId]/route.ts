// app/api/coach/tasks/[taskId]/route.ts
//
// PATCH  edit a task, change its status, or reassign it.
// DELETE soft-delete it.
//
// STATUS AND REASSIGNMENT COME THROUGH HERE rather than having endpoints of
// their own, because the edit modal can change all three at once and three
// round trips would let a half-applied edit survive a dropped connection. Each
// still goes through its own service function, so each still writes its own
// audit row and the completion still emits its automation event.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveCoach } from "@/app/api/_lib/coachAuth"
import { isTaskStatus, validateTaskWrite, type Task } from "@/lib/tasks/model"
import { deleteTask, reassignTask, setTaskStatus, updateTask } from "@/lib/tasks/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => ({}))
    const errors = validateTaskWrite(body, { partial: true })
    if (errors.length) return withCorsJson(req, { ok: false, error: errors[0], errors }, 400)

    const db = getSupabaseAdmin()
    let task: Task | null = null

    // ORDER MATTERS. Fields first, then assignment, then status. A task being
    // completed in the same edit that retitles it should carry the new title
    // into the audit row and the automation event, not the old one.
    const fieldKeys = ["title", "description", "client_profile_id", "coach_client_id", "due_at", "due_has_time"] as const
    const patch: Record<string, unknown> = {}
    for (const k of fieldKeys) {
      if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = body[k]
    }
    if (Object.keys(patch).length) {
      const r = await updateTask(db, taskId, patch, coachProfileId)
      if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
      task = r.data
    }

    if (body?.assignee_profile_id) {
      const r = await reassignTask(db, taskId, String(body.assignee_profile_id), coachProfileId, body?.note ?? null)
      if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
      task = r.data
    }

    if (body?.status) {
      if (!isTaskStatus(body.status)) {
        return withCorsJson(req, { ok: false, error: "Unknown status." }, 400)
      }
      const r = await setTaskStatus(db, taskId, body.status, coachProfileId, {
        note: body?.note ?? null,
        decision: body?.decision ?? null,
      })
      if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
      task = r.data
    }

    if (!task) return withCorsJson(req, { ok: false, error: "Nothing to change." }, 400)
    return withCorsJson(req, { ok: true, task }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/tasks PATCH]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const { taskId } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const r = await deleteTask(getSupabaseAdmin(), taskId, coachProfileId)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/tasks DELETE]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
