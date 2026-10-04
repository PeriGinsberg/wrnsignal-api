// lib/plan/service.ts
//
// A client's plan on the server: every change to a task's state, and every
// customisation of the plan, goes through here so the rules hold everywhere
// (the coach's Plan section, the old Engagements controls, the client's hub).
// Each change is written to History as a "plan_changed" line. Everything takes
// the client it is given, so it runs against tests/_lib/fakeSupabase.ts too.
//
// The rules (agreed 2026-10-03):
//   - approving a package activates the first task of its first deliverable;
//   - finishing a task (Done or Skipped) activates the next one in that
//     deliverable by order, skipping Not needed ones;
//   - activation never releases a client task: it becomes Active, "Release:
//     [task]", and the coach releases it by hand;
//   - the coach can activate or release any Upcoming task by hand;
//   - a deliverable marked Not needed stays on the plan, greyed, and its tasks
//     never activate. The library package is never changed.

import type { SupabaseClient } from "@supabase/supabase-js"
import { logProspectEvent } from "../prospects/history"
import { autoStartPhases } from "../phases/service"
import { syncTodo } from "./todo"
import {
  TASK_STATE_LABEL,
  hasStarted,
  isFinished,
  type PlanDeliverable,
  type PlanTask,
  type TaskAction,
  type TaskState,
  type TaskType,
} from "./model"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number }
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status })

const TASK_COLUMNS =
  "id, engagement_deliverable_id, name, owner, state, assignee_profile_id, due_date, released_at, sort_order, is_signoff"

type TaskRow = {
  id: string
  engagement_deliverable_id: string
  name: string
  owner: TaskType
  state: TaskState
  assignee_profile_id: string | null
  due_date: string | null
  released_at: string | null
  sort_order: number
  is_signoff: boolean
}

const toTask = (r: TaskRow): PlanTask => ({
  id: r.id, deliverable_id: r.engagement_deliverable_id, name: r.name, owner: r.owner, state: r.state,
  assignee_profile_id: r.assignee_profile_id, due_date: r.due_date ?? null, released_at: r.released_at ?? null,
  sort_order: r.sort_order, is_signoff: !!r.is_signoff,
})
const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order

// ── Reading ──────────────────────────────────────────────────────────────────

/** Where a task lives: its deliverable, engagement and client. Null if not this client's. */
async function locate(db: SupabaseClient, coachClientId: string, taskId: string) {
  const { data: t } = await db.from("coach_client_engagement_activities").select(TASK_COLUMNS).eq("id", taskId).maybeSingle()
  if (!t) return null
  const task = t as unknown as TaskRow
  const { data: d } = await db.from("coach_client_engagement_deliverables")
    .select("id, name, engagement_id, not_needed").eq("id", task.engagement_deliverable_id).maybeSingle()
  if (!d) return null
  const { data: e } = await db.from("coach_client_engagements")
    .select("id, coach_client_id, proposal_status").eq("id", (d as { engagement_id: string }).engagement_id).maybeSingle()
  if (!e || (e as { coach_client_id: string }).coach_client_id !== coachClientId) return null
  return {
    task,
    deliverable: d as { id: string; name: string; engagement_id: string; not_needed: boolean },
    engagement: e as { id: string; coach_client_id: string; proposal_status: string },
  }
}

async function deliverableTasks(db: SupabaseClient, deliverableId: string): Promise<TaskRow[]> {
  const { data, error } = await db.from("coach_client_engagement_activities").select(TASK_COLUMNS)
    .eq("engagement_deliverable_id", deliverableId)
  if (error) throw new Error(`Failed to read tasks: ${error.message}`)
  return ((data ?? []) as unknown as TaskRow[]).sort(bySort)
}

/**
 * The client's plan: every deliverable in their APPROVED packages, with its
 * tasks in order. Draft, sent and declined packages are proposals, not plan.
 */
export async function getPlan(db: SupabaseClient, coachClientId: string): Promise<PlanDeliverable[]> {
  const { data: engs, error: e1 } = await db.from("coach_client_engagements").select("id, name, attached_at")
    .eq("coach_client_id", coachClientId).eq("proposal_status", "approved")
  if (e1) throw new Error(`Failed to read packages: ${e1.message}`)
  const engagements = ((engs ?? []) as { id: string; name: string; attached_at: string | null }[])
    .sort((a, b) => String(a.attached_at ?? "").localeCompare(String(b.attached_at ?? "")))
  if (!engagements.length) return []
  const { data: ds, error: e2 } = await db.from("coach_client_engagement_deliverables")
    .select("id, engagement_id, name, phase_id, not_needed, sort_order").in("engagement_id", engagements.map((e) => e.id))
  if (e2) throw new Error(`Failed to read deliverables: ${e2.message}`)
  const delivs = (ds ?? []) as { id: string; engagement_id: string; name: string; phase_id: string | null; not_needed: boolean; sort_order: number }[]
  const tasks: TaskRow[] = []
  if (delivs.length) {
    const { data, error } = await db.from("coach_client_engagement_activities").select(TASK_COLUMNS)
      .in("engagement_deliverable_id", delivs.map((d) => d.id))
    if (error) throw new Error(`Failed to read tasks: ${error.message}`)
    tasks.push(...((data ?? []) as unknown as TaskRow[]))
  }
  const engOrder = new Map(engagements.map((e, i) => [e.id, i]))
  return delivs
    .sort((a, b) => (engOrder.get(a.engagement_id)! - engOrder.get(b.engagement_id)!) || a.sort_order - b.sort_order)
    .map((d) => ({
      id: d.id,
      engagement_id: d.engagement_id,
      engagement_name: engagements.find((e) => e.id === d.engagement_id)!.name,
      name: d.name,
      phase_id: d.phase_id ?? null,
      not_needed: !!d.not_needed,
      sort_order: d.sort_order,
      tasks: tasks.filter((t) => t.engagement_deliverable_id === d.id).sort(bySort).map(toTask),
    }))
}

// ── History ──────────────────────────────────────────────────────────────────

async function log(
  db: SupabaseClient,
  coachClientId: string,
  actor: string | null,
  context: Record<string, unknown>,
): Promise<void> {
  await logProspectEvent(db, { coachClientId, eventType: "plan_changed", actor, context })
}

// ── Changing a task's state ──────────────────────────────────────────────────

type Ctx = { coachClientId: string; actor: string | null; byClient?: boolean }

/**
 * The one writer of a task's state. Records the release time when a client
 * task is released, logs History, and keeps the "activity completed" line the
 * client's streak reads.
 */
async function setState(
  db: SupabaseClient,
  ctx: Ctx,
  task: TaskRow,
  to: TaskState,
  context: { deliverable: string; auto?: boolean; reason?: string },
): Promise<string | null> {
  if (task.state === to) return null
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { state: to, state_changed_at: now }
  if (to === "waiting_on_client") patch.released_at = now
  const { error } = await db.from("coach_client_engagement_activities").update(patch).eq("id", task.id)
  if (error) return error.message
  // Active means a To-Do item for the assignee; anything else closes it.
  await syncTodo(db, task.id)
  await log(db, ctx.coachClientId, context.auto ? null : ctx.actor, {
    action: "task_state",
    task: task.name,
    deliverable: context.deliverable,
    task_type: task.owner,
    from: task.state,
    to,
    from_label: TASK_STATE_LABEL[task.state],
    to_label: TASK_STATE_LABEL[to],
    auto: !!context.auto,
    ...(ctx.byClient ? { by_client: true } : {}),
    ...(context.reason ? { reason: context.reason } : {}),
  })
  if (to === "done") {
    await logProspectEvent(db, {
      coachClientId: ctx.coachClientId, eventType: "activity_completed", actor: ctx.actor,
      context: { name: task.name, ...(ctx.byClient ? { by_client: true } : {}) },
    })
  }
  task.state = to
  return null
}

/**
 * The next task in this deliverable becomes Active, after a task finished.
 * By order, after the finished one, skipping Not needed; nothing happens in a
 * Not needed deliverable, or when a later task is already under way.
 */
async function activateNext(
  db: SupabaseClient,
  ctx: Ctx,
  deliverable: { id: string; name: string; not_needed: boolean },
  after: number,
): Promise<void> {
  if (deliverable.not_needed) return
  const tasks = await deliverableTasks(db, deliverable.id)
  const later = tasks.filter((t) => t.sort_order > after && t.state !== "not_needed")
  if (later.some((t) => t.state === "active" || t.state === "waiting_on_client")) return
  const next = later.find((t) => t.state === "upcoming")
  if (next) await setState(db, ctx, next, "active", { deliverable: deliverable.name, auto: true, reason: "the task before it finished" })
}

/**
 * A package was approved: the first task of its first deliverable (not Not
 * needed) becomes Active, unless something in the package is already under
 * way. Every task gets the client's coach as assignee if it has none.
 */
export async function activateOnApproval(db: SupabaseClient, coachClientId: string, engagementId: string): Promise<void> {
  try {
    const { data: cc } = await db.from("coach_clients").select("coach_profile_id").eq("id", coachClientId).maybeSingle()
    const coachId = (cc as { coach_profile_id: string } | null)?.coach_profile_id ?? null
    const { data: ds } = await db.from("coach_client_engagement_deliverables").select("id, name, not_needed, sort_order")
      .eq("engagement_id", engagementId)
    const delivs = ((ds ?? []) as { id: string; name: string; not_needed: boolean; sort_order: number }[]).sort(bySort)
    const all: { d: (typeof delivs)[number]; tasks: TaskRow[] }[] = []
    for (const d of delivs) all.push({ d, tasks: await deliverableTasks(db, d.id) })
    if (coachId) {
      for (const { tasks } of all) {
        for (const t of tasks.filter((x) => !x.assignee_profile_id)) {
          await db.from("coach_client_engagement_activities").update({ assignee_profile_id: coachId }).eq("id", t.id)
          t.assignee_profile_id = coachId
        }
      }
    }
    if (all.some(({ tasks }) => tasks.some((t) => t.state === "active" || t.state === "waiting_on_client"))) return
    for (const { d, tasks } of all) {
      if (d.not_needed) continue
      const first = tasks.find((t) => t.state === "upcoming")
      if (first) {
        await setState(db, { coachClientId, actor: null }, first, "active", { deliverable: d.name, auto: true, reason: "the package was approved" })
        break
      }
    }
    await autoStartPhases(db, coachClientId, "package approved")
  } catch (e) {
    console.error("[plan] activation on approval failed:", e instanceof Error ? e.message : String(e))
  }
}

/** Which actions a task allows, from where it stands. */
export function allowedActions(t: { owner: TaskType; state: TaskState }): TaskAction[] {
  switch (t.state) {
    case "upcoming": return t.owner === "client" ? ["activate", "release", "done", "skip", "not_needed"] : ["activate", "done", "skip", "not_needed"]
    case "active": return t.owner === "client" ? ["release", "done", "skip", "not_needed"] : ["done", "skip", "not_needed"]
    case "waiting_on_client": return ["done", "skip"]
    case "done": case "skipped": case "not_needed": return ["undo"]
  }
}

/** The state an Undo returns a finished or Not needed task to. */
function undoTarget(t: TaskRow): TaskState {
  if (t.state === "not_needed") return "upcoming"
  if (t.owner === "client" && t.released_at) return "waiting_on_client"
  return "active"
}

/** The coach acts on one task in the client's plan. */
export async function applyTaskAction(
  db: SupabaseClient,
  args: { coachClientId: string; taskId: string; action: TaskAction; actor: string },
): Promise<Result<true>> {
  const where = await locate(db, args.coachClientId, args.taskId)
  if (!where) return fail("Task not found", 404)
  const { task, deliverable } = where
  if (!allowedActions(task).includes(args.action)) {
    return fail(`A task that is ${TASK_STATE_LABEL[task.state]} can't be changed that way.`, 409)
  }
  if (deliverable.not_needed && args.action !== "undo") {
    return fail("This deliverable is marked Not needed. Restore it first.", 409)
  }
  const ctx: Ctx = { coachClientId: args.coachClientId, actor: args.actor }
  const was = task.state
  const to: TaskState =
    args.action === "activate" ? "active"
    : args.action === "release" ? "waiting_on_client"
    : args.action === "done" ? "done"
    : args.action === "skip" ? "skipped"
    : args.action === "not_needed" ? "not_needed"
    : undoTarget(task)
  const err = await setState(db, ctx, task, to, { deliverable: deliverable.name })
  if (err) return fail(`Failed to update the task: ${err}`, 500)
  // Finishing, or taking an under-way task out, hands on to the next one.
  if (isFinished(to) || (to === "not_needed" && (was === "active" || was === "waiting_on_client"))) {
    await activateNext(db, ctx, deliverable, task.sort_order)
  }
  if (hasStarted(to)) await autoStartPhases(db, args.coachClientId, `task "${task.name}" started`)
  return { ok: true, data: true }
}

/**
 * The client marks a released task done in their Coaches Hub, or undoes that.
 * Only their own released client tasks, so nothing else is reachable.
 */
export async function clientSetDone(
  db: SupabaseClient,
  args: { coachClientId: string; taskId: string; done: boolean; actor: string },
): Promise<Result<TaskState>> {
  const where = await locate(db, args.coachClientId, args.taskId)
  if (!where || where.task.owner !== "client") return fail("Task not found", 404)
  const { task, deliverable } = where
  const ctx: Ctx = { coachClientId: args.coachClientId, actor: args.actor, byClient: true }
  if (args.done) {
    if (task.state === "done") return { ok: true, data: "done" }
    if (task.state !== "waiting_on_client") return fail("This task isn't open for you yet.", 409)
    const err = await setState(db, ctx, task, "done", { deliverable: deliverable.name })
    if (err) return fail(`Failed to update the task: ${err}`, 500)
    await activateNext(db, ctx, deliverable, task.sort_order)
    await autoStartPhases(db, args.coachClientId, `task "${task.name}" done`)
    return { ok: true, data: "done" }
  }
  if (task.state !== "done") return { ok: true, data: task.state }
  const err = await setState(db, ctx, task, "waiting_on_client", { deliverable: deliverable.name })
  if (err) return fail(`Failed to update the task: ${err}`, 500)
  return { ok: true, data: "waiting_on_client" }
}

/**
 * The old three-way status, from the Engagements tab, mapped onto the new
 * states so that control keeps obeying the rules.
 */
export async function applyLegacyStatus(
  db: SupabaseClient,
  args: { coachClientId: string; taskId: string; status: "not_started" | "in_progress" | "complete"; actor: string },
): Promise<Result<true>> {
  const where = await locate(db, args.coachClientId, args.taskId)
  if (!where) return fail("Task not found", 404)
  const { task, deliverable } = where
  const ctx: Ctx = { coachClientId: args.coachClientId, actor: args.actor }
  const to: TaskState = args.status === "complete" ? "done"
    : args.status === "in_progress" ? (task.owner === "client" ? "waiting_on_client" : "active")
    : "upcoming"
  const err = await setState(db, ctx, task, to, { deliverable: deliverable.name })
  if (err) return fail(`Failed to update the task: ${err}`, 500)
  if (to === "done") await activateNext(db, ctx, deliverable, task.sort_order)
  if (hasStarted(to)) await autoStartPhases(db, args.coachClientId, `task "${task.name}" started`)
  return { ok: true, data: true }
}

// ── Customising the plan ─────────────────────────────────────────────────────

/** The coach changes who a task is assigned to, or its due date. */
export async function updateTaskDetails(
  db: SupabaseClient,
  args: { coachClientId: string; taskId: string; assignee?: string | null; dueDate?: string | null; actor: string },
): Promise<Result<true>> {
  const where = await locate(db, args.coachClientId, args.taskId)
  if (!where) return fail("Task not found", 404)
  const patch: Record<string, unknown> = {}
  if (args.assignee !== undefined) patch.assignee_profile_id = args.assignee
  if (args.dueDate !== undefined) {
    if (args.dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate)) return fail("Due date must be a date.")
    patch.due_date = args.dueDate
  }
  if (!Object.keys(patch).length) return fail("Nothing to change.")
  const { error } = await db.from("coach_client_engagement_activities").update(patch).eq("id", args.taskId)
  if (error) return fail(`Failed to update the task: ${error.message}`, 500)
  await syncTodo(db, args.taskId)
  await log(db, args.coachClientId, args.actor, {
    action: args.assignee !== undefined ? "task_assigned" : "task_due",
    task: where.task.name, deliverable: where.deliverable.name,
    ...(args.dueDate !== undefined ? { due_date: args.dueDate } : {}),
  })
  return { ok: true, data: true }
}

/** Mark a client's deliverable Not needed, or restore it. Tasks keep their states. */
export async function setDeliverableNeeded(
  db: SupabaseClient,
  args: { coachClientId: string; deliverableId: string; notNeeded: boolean; actor: string },
): Promise<Result<true>> {
  const d = await ownDeliverable(db, args.coachClientId, args.deliverableId)
  if (!d) return fail("Deliverable not found", 404)
  if (d.not_needed === args.notNeeded) return { ok: true, data: true }
  const { error } = await db.from("coach_client_engagement_deliverables").update({ not_needed: args.notNeeded }).eq("id", d.id)
  if (error) return fail(`Failed to update the deliverable: ${error.message}`, 500)
  // A Not needed deliverable's Active tasks leave the To-Do list (and come back on restore).
  for (const t of await deliverableTasks(db, d.id)) await syncTodo(db, t.id)
  await log(db, args.coachClientId, args.actor, { action: args.notNeeded ? "deliverable_not_needed" : "deliverable_restored", deliverable: d.name })
  return { ok: true, data: true }
}

async function ownDeliverable(db: SupabaseClient, coachClientId: string, deliverableId: string) {
  const { data: d } = await db.from("coach_client_engagement_deliverables")
    .select("id, name, engagement_id, not_needed, sort_order").eq("id", deliverableId).maybeSingle()
  if (!d) return null
  const deliv = d as { id: string; name: string; engagement_id: string; not_needed: boolean; sort_order: number }
  const { data: e } = await db.from("coach_client_engagements").select("coach_client_id").eq("id", deliv.engagement_id).maybeSingle()
  return (e as { coach_client_id: string } | null)?.coach_client_id === coachClientId ? deliv : null
}

/** Remove a task from this client's plan. The library is untouched. */
export async function removeTask(
  db: SupabaseClient,
  args: { coachClientId: string; taskId: string; actor: string },
): Promise<Result<true>> {
  const where = await locate(db, args.coachClientId, args.taskId)
  if (!where) return fail("Task not found", 404)
  await cancelTodo(db, args.taskId)
  const { error } = await db.from("coach_client_engagement_activities").delete().eq("id", args.taskId)
  if (error) return fail(`Failed to remove the task: ${error.message}`, 500)
  await log(db, args.coachClientId, args.actor, { action: "task_removed", task: where.task.name, deliverable: where.deliverable.name })
  if (where.task.state === "active" || where.task.state === "waiting_on_client") {
    await activateNext(db, { coachClientId: args.coachClientId, actor: args.actor }, where.deliverable, where.task.sort_order)
  }
  return { ok: true, data: true }
}

/** Remove a deliverable, and its tasks, from this client's plan. */
export async function removeDeliverable(
  db: SupabaseClient,
  args: { coachClientId: string; deliverableId: string; actor: string },
): Promise<Result<true>> {
  const d = await ownDeliverable(db, args.coachClientId, args.deliverableId)
  if (!d) return fail("Deliverable not found", 404)
  for (const t of await deliverableTasks(db, d.id)) await cancelTodo(db, t.id)
  const { error } = await db.from("coach_client_engagement_deliverables").delete().eq("id", d.id)
  if (error) return fail(`Failed to remove the deliverable: ${error.message}`, 500)
  // The fake test database has no cascade; the real one does.
  await db.from("coach_client_engagement_activities").delete().eq("engagement_deliverable_id", d.id)
  await log(db, args.coachClientId, args.actor, { action: "deliverable_removed", deliverable: d.name })
  return { ok: true, data: true }
}

/** Add a one-off task at the end of a deliverable, Upcoming. */
export async function addTask(
  db: SupabaseClient,
  args: { coachClientId: string; deliverableId: string; name: string; type: TaskType; actor: string },
): Promise<Result<PlanTask>> {
  const d = await ownDeliverable(db, args.coachClientId, args.deliverableId)
  if (!d) return fail("Deliverable not found", 404)
  const name = args.name.trim()
  if (!name) return fail("Give the task a name.")
  if (name.length > 200) return fail("Task names can be at most 200 characters.")
  const tasks = await deliverableTasks(db, d.id)
  const { data: cc } = await db.from("coach_clients").select("coach_profile_id").eq("id", args.coachClientId).maybeSingle()
  const { data, error } = await db.from("coach_client_engagement_activities").insert({
    engagement_deliverable_id: d.id, name, owner: args.type, state: "upcoming",
    sort_order: (tasks.at(-1)?.sort_order ?? 0) + 1,
    assignee_profile_id: (cc as { coach_profile_id: string } | null)?.coach_profile_id ?? null,
  }).select(TASK_COLUMNS).single()
  if (error || !data) return fail(`Failed to add the task: ${error?.message ?? "no row"}`, 500)
  await log(db, args.coachClientId, args.actor, { action: "task_added", task: name, deliverable: d.name, task_type: args.type })
  return { ok: true, data: toTask(data as unknown as TaskRow) }
}

/** Put a deliverable's tasks in the order given (every task, once). */
export async function reorderTasks(
  db: SupabaseClient,
  args: { coachClientId: string; deliverableId: string; taskIds: unknown; actor: string },
): Promise<Result<true>> {
  const d = await ownDeliverable(db, args.coachClientId, args.deliverableId)
  if (!d) return fail("Deliverable not found", 404)
  const tasks = await deliverableTasks(db, d.id)
  const ids = Array.isArray(args.taskIds) ? args.taskIds.filter((x): x is string => typeof x === "string") : []
  const known = new Set(tasks.map((t) => t.id))
  if (ids.length !== tasks.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    return fail("List every task in the deliverable, once.")
  }
  for (const [i, id] of ids.entries()) {
    const { error } = await db.from("coach_client_engagement_activities").update({ sort_order: i + 1 }).eq("id", id)
    if (error) return fail(`Failed to reorder: ${error.message}`, 500)
  }
  await log(db, args.coachClientId, args.actor, { action: "tasks_reordered", deliverable: d.name })
  return { ok: true, data: true }
}

/**
 * Add a deliverable from the coach's library to one of the client's packages
 * (approved, or a proposal being customized; not a declined one): a copy of it
 * and its tasks (all Upcoming), with its phase. The
 * library deliverable itself is untouched.
 */
export async function addDeliverableFromLibrary(
  db: SupabaseClient,
  args: { coachClientId: string; engagementId: string; milestoneId: string; coachIds: string[]; actor: string },
): Promise<Result<true>> {
  const { data: e } = await db.from("coach_client_engagements").select("id, coach_client_id, proposal_status")
    .eq("id", args.engagementId).maybeSingle()
  const eng = e as { id: string; coach_client_id: string; proposal_status: string } | null
  if (!eng || eng.coach_client_id !== args.coachClientId) return fail("Package not found", 404)
  // A proposal (draft or sent) is customized before it goes out; a declined one is closed.
  if (eng.proposal_status === "declined") return fail("This package was declined. Add deliverables to an open one.", 409)
  const { data: m } = await db.from("coach_milestones")
    .select("id, coach_profile_id, name, fee_cents, category, time_estimate_days, phase_id").eq("id", args.milestoneId).maybeSingle()
  const lib = m as { id: string; coach_profile_id: string; name: string; fee_cents: number | null; category: string | null; time_estimate_days: number | null; phase_id: string | null } | null
  if (!lib || !args.coachIds.includes(lib.coach_profile_id)) return fail("Deliverable not found in your library", 404)

  const { data: existing } = await db.from("coach_client_engagement_deliverables").select("sort_order").eq("engagement_id", eng.id)
  const nextSort = Math.max(0, ...((existing ?? []) as { sort_order: number }[]).map((x) => x.sort_order)) + 1
  const { data: nd, error: dErr } = await db.from("coach_client_engagement_deliverables").insert({
    engagement_id: eng.id, source_milestone_id: lib.id, name: lib.name, fee_cents: lib.fee_cents, category: lib.category,
    time_estimate_days: lib.time_estimate_days, sort_order: nextSort, phase_id: lib.phase_id,
  }).select("id").single()
  if (dErr || !nd) return fail(`Failed to add the deliverable: ${dErr?.message ?? "no row"}`, 500)
  const { data: acts } = await db.from("coach_milestone_activities").select("id, name, owner, sort_order").eq("milestone_id", lib.id)
  const { data: cc } = await db.from("coach_clients").select("coach_profile_id").eq("id", args.coachClientId).maybeSingle()
  const assignee = (cc as { coach_profile_id: string } | null)?.coach_profile_id ?? null
  const rows = ((acts ?? []) as { id: string; name: string; owner: TaskType; sort_order: number }[]).sort(bySort)
  if (rows.length) {
    const { error } = await db.from("coach_client_engagement_activities").insert(rows.map((a) => ({
      engagement_deliverable_id: (nd as { id: string }).id, source_activity_id: a.id, name: a.name,
      owner: a.owner === "client" ? "client" : "coach", state: "upcoming", sort_order: a.sort_order, assignee_profile_id: assignee,
    })))
    if (error) return fail(`Failed to add the deliverable's tasks: ${error.message}`, 500)
  }
  await log(db, args.coachClientId, args.actor, { action: "deliverable_added", deliverable: lib.name, tasks: rows.length })
  return { ok: true, data: true }
}

// ── The To-Do side ───────────────────────────────────────────────────────────

/** A plan task is going away: its open To-Do item is cancelled first (the link would be lost with it). */
async function cancelTodo(db: SupabaseClient, activityId: string): Promise<void> {
  const now = new Date().toISOString()
  await db.from("coach_tasks").update({ status: "cancelled", completed_at: null, updated_at: now })
    .eq("plan_activity_id", activityId).eq("status", "open")
}

/**
 * A coach ticked or reopened a plan task's To-Do item. Ticking it does what
 * the item says: "Release: [task]" releases the client task, anything else is
 * Done (and the next task activates). Reopening puts the task back to Active.
 * Dismissing (cancelling) the item leaves the plan as it is.
 */
export async function onTodoStatus(
  db: SupabaseClient,
  todo: { plan_activity_id: string | null; coach_client_id: string | null },
  status: "open" | "done" | "cancelled",
  actor: string | null,
): Promise<void> {
  if (!todo.plan_activity_id || !todo.coach_client_id || status === "cancelled") return
  try {
    const where = await locate(db, todo.coach_client_id, todo.plan_activity_id)
    if (!where) return
    const { task, deliverable } = where
    if (status === "done") {
      if (task.state !== "active" || !actor) return
      await applyTaskAction(db, {
        coachClientId: todo.coach_client_id, taskId: task.id, action: task.owner === "client" ? "release" : "done", actor,
      })
      return
    }
    if (task.state === "active" || task.state === "upcoming" || task.state === "not_needed") return
    await setState(db, { coachClientId: todo.coach_client_id, actor }, task, "active", {
      deliverable: deliverable.name, reason: "reopened on the To-Do list",
    })
  } catch (e) {
    console.error("[plan] To-Do sync failed:", e instanceof Error ? e.message : String(e))
  }
}

/** A coach changed a plan task's To-Do item: its due date or assignee follows on the plan. */
export async function onTodoEdited(
  db: SupabaseClient,
  todo: { plan_activity_id: string | null; coach_client_id: string | null; due_at?: string | null; assignee_profile_id?: string },
  actor: string | null,
): Promise<void> {
  if (!todo.plan_activity_id || !todo.coach_client_id || !actor) return
  if (todo.due_at !== undefined) {
    await updateTaskDetails(db, { coachClientId: todo.coach_client_id, taskId: todo.plan_activity_id, dueDate: todo.due_at ? todo.due_at.slice(0, 10) : null, actor })
  }
  if (todo.assignee_profile_id !== undefined) {
    await updateTaskDetails(db, { coachClientId: todo.coach_client_id, taskId: todo.plan_activity_id, assignee: todo.assignee_profile_id, actor })
  }
}
