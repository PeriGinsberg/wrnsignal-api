// app/api/coach/coach-clients/[id]/plan/route.ts
//
// One client's plan: the deliverables and tasks in their APPROVED packages.
//
//   GET   { phases, deliverables, packages, library }: the client's phases (as
//         the stepper shows them), every deliverable with its tasks in order,
//         the approved packages a deliverable can be added to, and the coach's
//         library deliverables to add from.
//   POST  { action, ... } changes the plan. Task actions: activate, release,
//         done, skip, not_needed, undo ({ task_id }); assign ({ task_id,
//         assignee }); due ({ task_id, due_date }); remove_task ({ task_id }).
//         Deliverable actions: deliverable_not_needed / deliverable_restore /
//         remove_deliverable ({ deliverable_id }); add_task ({ deliverable_id,
//         name, type }); reorder ({ deliverable_id, task_ids }); and
//         add_deliverable ({ engagement_id, milestone_id }). Returns the plan.
//
// The library package is never changed. Every change goes in History. The
// rules are in lib/plan/service.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errStatus, getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "../../../../_lib/coachEngagements"
import { getClientPhases } from "@/lib/phases/service"
import { isTaskType, TASK_ACTIONS, type TaskAction } from "@/lib/plan/model"
import {
  addDeliverableFromLibrary,
  addTask,
  applyTaskAction,
  getPlan,
  removeDeliverable,
  removeTask,
  reorderTasks,
  setDeliverableNeeded,
  updateTaskDetails,
} from "@/lib/plan/service"
import type { SupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

async function planBody(db: SupabaseClient, coachClientId: string, coachIds: string[]) {
  const [phases, deliverables] = await Promise.all([getClientPhases(db, coachClientId), getPlan(db, coachClientId)])
  const { data: pkgs } = await db.from("coach_client_engagements").select("id, name")
    .eq("coach_client_id", coachClientId).eq("proposal_status", "approved")
  const { data: lib } = await db.from("coach_milestones").select("id, name, phase_id, active")
    .in("coach_profile_id", coachIds).eq("active", true).order("sort_order", { ascending: true })
  return { ok: true, phases: phases ?? [], deliverables, packages: pkgs ?? [], library: lib ?? [] }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, delegation, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client not found" }, 404)
    }
    return withCorsJson(req, await planBody(db, id, delegation.actingIds))
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, delegation, error } = await resolveCoach(req)
    if (error) return error
    const db = getSupabaseAdmin()
    if (!(await isCoachClientOwnedByCoach(db, coachProfileId, id))) {
      return withCorsJson(req, { ok: false, error: "Client not found" }, 404)
    }
    const b = await req.json().catch(() => ({}))
    const action = str(b?.action)
    const actor = coachProfileId
    const base = { coachClientId: id, actor }

    let r: { ok: true } | { ok: false; error: string; status: number }
    if ((TASK_ACTIONS as readonly string[]).includes(action)) {
      r = await applyTaskAction(db, { ...base, taskId: str(b.task_id), action: action as TaskAction })
    } else if (action === "assign") {
      if (b.assignee !== null && !delegation.actingIds.includes(str(b.assignee))) {
        // Any coach who can open this client: the principal or a delegate.
        const { data: ok } = await db.from("coach_delegates").select("delegate_coach_profile_id")
          .in("principal_coach_profile_id", delegation.actingIds).eq("delegate_coach_profile_id", str(b.assignee)).eq("status", "active")
        if (!ok?.length) return withCorsJson(req, { ok: false, error: "Assign the task to a coach who works with this client." }, 400)
      }
      r = await updateTaskDetails(db, { ...base, taskId: str(b.task_id), assignee: b.assignee === null ? null : str(b.assignee) })
    } else if (action === "due") {
      r = await updateTaskDetails(db, { ...base, taskId: str(b.task_id), dueDate: b.due_date === null || b.due_date === "" ? null : str(b.due_date) })
    } else if (action === "remove_task") {
      r = await removeTask(db, { ...base, taskId: str(b.task_id) })
    } else if (action === "deliverable_not_needed" || action === "deliverable_restore") {
      r = await setDeliverableNeeded(db, { ...base, deliverableId: str(b.deliverable_id), notNeeded: action === "deliverable_not_needed" })
    } else if (action === "remove_deliverable") {
      r = await removeDeliverable(db, { ...base, deliverableId: str(b.deliverable_id) })
    } else if (action === "add_task") {
      if (!isTaskType(b.type)) return withCorsJson(req, { ok: false, error: "type must be coach or client" }, 400)
      r = await addTask(db, { ...base, deliverableId: str(b.deliverable_id), name: str(b.name), type: b.type })
    } else if (action === "reorder") {
      r = await reorderTasks(db, { ...base, deliverableId: str(b.deliverable_id), taskIds: b.task_ids })
    } else if (action === "add_deliverable") {
      r = await addDeliverableFromLibrary(db, {
        ...base, engagementId: str(b.engagement_id), milestoneId: str(b.milestone_id), coachIds: delegation.actingIds,
      })
    } else {
      return withCorsJson(req, { ok: false, error: "Unknown action" }, 400)
    }
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, await planBody(db, id, delegation.actingIds))
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
