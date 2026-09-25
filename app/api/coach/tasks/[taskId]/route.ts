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
import { drain } from "@/lib/automation/run"

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

      // REQUEST CHANGES WITHOUT A REASON IS NOT A DECISION. It reopens work
      // for somebody else, and "this came back, no note" is the message they
      // would otherwise get. Approve needs no note: approval says everything.
      if (body.decision === "request_changes" && !String(body?.note ?? "").trim()) {
        return withCorsJson(req, {
          ok: false,
          error: "Say what needs changing. The note is what goes back with the task.",
        }, 400)
      }

      const r = await setTaskStatus(db, taskId, body.status, coachProfileId, {
        note: body?.note ?? null,
        decision: body?.decision ?? null,
      })
      if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
      task = r.data

      // WORK THE QUEUE BEFORE ANSWERING. setTaskStatus appends the event; if
      // nothing drained it here the next task in the chain would appear only
      // when the half-hourly cron ran, and the coach who just pressed Approve
      // would be looking at a screen that showed nothing happening.
      //
      // Wrapped: the status change is already saved, and a rule that throws
      // must not turn a successful tick into an error. The cron is the
      // fallback.
      if (body.status === "done") {
        try {
          await drain(db)
        } catch (e: any) {
          console.error("[coach/tasks PATCH] drain failed:", e?.message ?? e)
        }
      }
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
