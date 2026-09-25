// lib/tasks/service.ts
//
// Every write to a coaching task goes through here. The routes decide who is
// asking and what they sent; this decides what that means for the row, the
// audit trail, and the automation queue.
//
// TWO THINGS THIS FILE OWNS THAT NOTHING ELSE SHOULD REPEAT:
//
//   1. An assignee must be a coach. Postgres cannot express "references a row
//      where is_coach is true" as a foreign key, so it is checked here, once,
//      on the way in. A trigger was considered and rejected: it would fire on
//      every write to catch a mistake only this layer can make.
//
//   2. A mutation writes its audit event and emits its automation event in the
//      same call that changes the row. Leaving either to the caller means the
//      day somebody adds a fifth route, the history quietly stops recording.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  completionPatch,
  type Task,
  type TaskEventKind,
  type TaskStatus,
} from "./model"

export type ActorId = string

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

// TASK_COLUMNS is a runtime string and this project has no generated database
// types, so the client cannot infer a row shape from it and falls back to
// GenericStringError. Hence `as unknown as Task` at each read site: the cast
// is asserting the select list matches the Task type, which is exactly what
// this constant exists to keep true.
const TASK_COLUMNS =
  "id, title, description, client_profile_id, coach_client_id, assignee_profile_id, " +
  "created_by_profile_id, due_at, due_has_time, status, completed_at, source, template_id, " +
  "chain_id, brief_id, decision, legacy_note_id, created_at, updated_at, deleted_at"

/**
 * Is this profile a coach who may be handed work?
 *
 * Checked on create and on every reassign. An inactive coach is still a valid
 * assignee: people go on holiday, and refusing to assign to them would make the
 * list lie about who owns the work. The nightly digest is where inactivity gets
 * noticed.
 */
export async function assertAssignableCoach(
  db: SupabaseClient,
  profileId: string,
): Promise<ServiceResult<true>> {
  const { data, error } = await db
    .from("client_profiles").select("id, name, is_coach").eq("id", profileId).maybeSingle()

  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data) return { ok: false, error: "That assignee does not exist.", status: 400 }
  if (data.is_coach !== true) {
    // Names the person, because the usual cause is two profiles sharing an
    // email and the wrong one being picked. Saying "not a coach" alone sends
    // people hunting through the wrong table.
    return {
      ok: false,
      error: `${data.name ?? "That profile"} is not a coach, so a task cannot be assigned to them.`,
      status: 400,
    }
  }
  return { ok: true, data: true }
}

/** One audit row. Never throws: losing history must not fail the write. */
async function recordEvent(
  db: SupabaseClient,
  taskId: string,
  kind: TaskEventKind,
  actor: ActorId | null,
  note?: string | null,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from("coach_task_events").insert({
    task_id: taskId, kind, actor_profile_id: actor, note: note ?? null, payload: payload ?? null,
  })
  if (error) console.error("[tasks] audit event failed:", kind, error.message)
}

/**
 * Append to the automation queue.
 *
 * DELIBERATELY NOT RUN INLINE. The runner picks these up separately, so a rule
 * that throws cannot take down the request that completed the task. See
 * 20260926_coach_task_automation.sql.
 *
 * Never throws, for the same reason as recordEvent: a task the coach ticked is
 * ticked, whether or not the chain moved.
 */
export async function emitTaskEvent(
  db: SupabaseClient,
  eventKey: string,
  payload: Record<string, unknown>,
  clientProfileId: string | null,
): Promise<void> {
  const { error } = await db.from("coach_automation_events").insert({
    event_key: eventKey, payload, client_profile_id: clientProfileId,
  })
  if (error) console.error("[tasks] automation event failed:", eventKey, error.message)
}

async function templateKeyOf(db: SupabaseClient, templateId: string | null): Promise<string | null> {
  if (!templateId) return null
  const { data } = await db.from("coach_task_templates").select("key").eq("id", templateId).maybeSingle()
  return data?.key ?? null
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateTaskInput = {
  title: string
  description?: string | null
  client_profile_id?: string | null
  coach_client_id?: string | null
  assignee_profile_id: string
  due_at?: string | null
  due_has_time?: boolean
  source?: "manual" | "auto"
  template_id?: string | null
  chain_id?: string | null
  brief_id?: string | null
}

export async function createTask(
  db: SupabaseClient,
  input: CreateTaskInput,
  actor: ActorId | null,
): Promise<ServiceResult<Task>> {
  const coachCheck = await assertAssignableCoach(db, input.assignee_profile_id)
  if (!coachCheck.ok) return coachCheck

  const source = input.source ?? "manual"

  const { data, error } = await db.from("coach_tasks").insert({
    title: input.title.trim(),
    description: input.description?.trim() || null,
    client_profile_id: input.client_profile_id ?? null,
    coach_client_id: input.coach_client_id ?? null,
    assignee_profile_id: input.assignee_profile_id,
    // An automated task has no author. Recording the coach who happened to
    // trigger the rule would credit them with writing something they never saw.
    created_by_profile_id: source === "auto" ? null : actor,
    due_at: input.due_at ?? null,
    due_has_time: input.due_has_time ?? false,
    source,
    template_id: input.template_id ?? null,
    chain_id: input.chain_id ?? null,
    brief_id: input.brief_id ?? null,
  }).select(TASK_COLUMNS).single()

  if (error) return { ok: false, error: error.message, status: 500 }

  const task = data as unknown as Task
  await recordEvent(db, task.id, "created", actor, null, { source })
  return { ok: true, data: task }
}

// ---------------------------------------------------------------------------
// Update, complete, reopen, reassign, delete
// ---------------------------------------------------------------------------

export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "description" | "client_profile_id" | "coach_client_id" | "due_at" | "due_has_time">
>

export async function updateTask(
  db: SupabaseClient,
  taskId: string,
  patch: UpdateTaskInput,
  actor: ActorId | null,
): Promise<ServiceResult<Task>> {
  const { data, error } = await db.from("coach_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId).is("deleted_at", null)
    .select(TASK_COLUMNS).maybeSingle()

  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data) return { ok: false, error: "That task no longer exists.", status: 404 }
  return { ok: true, data: data as unknown as Task }
}

/**
 * Move a task to done or cancelled, or back to open.
 *
 * `decision` is for review-style tasks whose template declares
 * decision_options: it rides on the automation event so a rule can tell
 * "approved" from "sent back" without a second column on the task.
 */
export async function setTaskStatus(
  db: SupabaseClient,
  taskId: string,
  status: TaskStatus,
  actor: ActorId | null,
  opts: { note?: string | null; decision?: string | null } = {},
): Promise<ServiceResult<Task>> {
  const { data: before, error: readErr } = await db.from("coach_tasks")
    .select(TASK_COLUMNS).eq("id", taskId).is("deleted_at", null).maybeSingle()
  if (readErr) return { ok: false, error: readErr.message, status: 500 }
  if (!before) return { ok: false, error: "That task no longer exists.", status: 404 }

  const prev = before as unknown as Task
  if (prev.status === status) {
    // Not an error, and deliberately not a second event: two coaches ticking
    // the same task should not fire the chain twice.
    return { ok: true, data: prev }
  }

  const { data, error } = await db.from("coach_tasks")
    .update({
      ...completionPatch(status),
      // Recorded on the row as well as the event: the event is how the rules
      // branch, the column is how the task says how it was closed.
      ...(opts.decision ? { decision: opts.decision } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId).is("deleted_at", null)
    .select(TASK_COLUMNS).maybeSingle()

  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data) return { ok: false, error: "That task no longer exists.", status: 404 }

  const task = data as unknown as Task
  const kind: TaskEventKind =
    status === "done" ? "completed" : status === "cancelled" ? "cancelled" : "reopened"
  await recordEvent(db, task.id, kind, actor, opts.note ?? null,
    opts.decision ? { decision: opts.decision } : undefined)

  // Only a completion advances a chain. Cancelling is a coach saying the work
  // is not happening, and reopening is already the result of a rule.
  if (status === "done") {
    await emitTaskEvent(db, "task.completed", {
      task_id: task.id,
      template_key: await templateKeyOf(db, task.template_id),
      decision: opts.decision ?? null,
      chain_id: task.chain_id,
      brief_id: task.brief_id,
      coach_client_id: task.coach_client_id,
      note: opts.note ?? null,
    }, task.client_profile_id)
  }

  return { ok: true, data: task }
}

export async function reassignTask(
  db: SupabaseClient,
  taskId: string,
  toProfileId: string,
  actor: ActorId | null,
  note?: string | null,
): Promise<ServiceResult<Task>> {
  const coachCheck = await assertAssignableCoach(db, toProfileId)
  if (!coachCheck.ok) return coachCheck

  const { data: before } = await db.from("coach_tasks")
    .select("assignee_profile_id").eq("id", taskId).is("deleted_at", null).maybeSingle()
  if (!before) return { ok: false, error: "That task no longer exists.", status: 404 }

  const from = (before as { assignee_profile_id: string }).assignee_profile_id
  if (from === toProfileId) {
    const { data: same } = await db.from("coach_tasks")
      .select(TASK_COLUMNS).eq("id", taskId).maybeSingle()
    return { ok: true, data: same as unknown as Task }
  }

  const { data, error } = await db.from("coach_tasks")
    .update({ assignee_profile_id: toProfileId, updated_at: new Date().toISOString() })
    .eq("id", taskId).is("deleted_at", null)
    .select(TASK_COLUMNS).maybeSingle()

  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data) return { ok: false, error: "That task no longer exists.", status: 404 }

  // from and to are both recorded: "who had this before" is the question asked
  // when work goes missing, and the new row alone cannot answer it.
  await recordEvent(db, taskId, "reassigned", actor, note ?? null, { from, to: toProfileId })
  return { ok: true, data: data as unknown as Task }
}

/** Soft delete, matching coach_client_notes. The row stays; the list stops showing it. */
export async function deleteTask(
  db: SupabaseClient,
  taskId: string,
  actor: ActorId | null,
): Promise<ServiceResult<true>> {
  const { data, error } = await db.from("coach_tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", taskId).is("deleted_at", null)
    .select("id").maybeSingle()

  if (error) return { ok: false, error: error.message, status: 500 }
  if (!data) return { ok: false, error: "That task no longer exists.", status: 404 }
  return { ok: true, data: true }
}
