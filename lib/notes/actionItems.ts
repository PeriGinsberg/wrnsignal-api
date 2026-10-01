// lib/notes/actionItems.ts
//
// Action-item notes: retired as a type, still read.
//
// Until 2026-10-01 a coach could write a note typed Action Item. Work to do is
// a task now, added with the record's Add Task button, and no screen or route
// creates an action-item note (lib/notes/model.ts refuses the type).
//
// What is left here:
//
//   - every action-item note already written has exactly one task, linked by
//     coach_tasks.legacy_note_id (UNIQUE). The 2026-09-26 backfill made the
//     first 55; 20260930_action_item_note_catchup.sql makes the rest and gives
//     each a link back to its note. The note card shows that task's state
//     (withNoteTasks) and is not ticked itself: the task is;
//   - SIGNAL still writes one kind of action-item note in SQL, the coach's
//     "sent the workbook for review" (workbook_send_to_coach). The workbook
//     routes give it its task (ensureSystemNoteTask) and close the task when
//     the RPC completes the note (closeTasksForNotes).
//
// After the task exists the two are separate records: editing or deleting the
// note leaves the task alone (lib/notes/edit.ts).

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  createTask,
  setTaskStatus,
  updateTask,
  TASK_COLUMNS,
  type ServiceResult,
} from "@/lib/tasks/service"
import type { Task } from "@/lib/tasks/model"

/** The task as a note card shows it. */
export type NoteTaskSummary = {
  id: string
  status: Task["status"]
  due_at: string | null
  due_has_time: boolean
  assignee_profile_id: string
  assignee_name: string | null
}

/**
 * The task's title and description from the note's text. Same rule as the
 * 2026-09-26 backfill, so old and new action items read alike: the first line,
 * capped, is the title; the whole body is the description only when it says
 * more than that.
 */
export function taskTextFromNote(body: string): { title: string; description: string | null } {
  const first = body.split("\n")[0].slice(0, 200).trim()
  const title = first || "Action item"
  return { title, description: body.trim().length > first.length ? body.trim() : null }
}

/** The note's task, whatever its status. Null when it has none (or it was deleted). */
export async function findNoteTask(db: SupabaseClient, noteId: string): Promise<Task | null> {
  const { data } = await db.from("coach_tasks")
    .select(TASK_COLUMNS).eq("legacy_note_id", noteId).is("deleted_at", null).maybeSingle()
  return (data as unknown as Task) ?? null
}

/** Each action item's task, for the note cards. Keyed by note id. */
export async function noteTaskSummaries(
  db: SupabaseClient,
  noteIds: string[],
): Promise<Map<string, NoteTaskSummary>> {
  const out = new Map<string, NoteTaskSummary>()
  if (!noteIds.length) return out
  const { data, error } = await db.from("coach_tasks")
    .select("id, status, due_at, due_has_time, assignee_profile_id, legacy_note_id")
    .in("legacy_note_id", noteIds).is("deleted_at", null)
  if (error) {
    console.error("[notes] reading action item tasks failed:", error.message)
    return out
  }
  const rows = (data ?? []) as Array<Omit<NoteTaskSummary, "assignee_name"> & { legacy_note_id: string }>
  const ids = [...new Set(rows.map((r) => r.assignee_profile_id))]
  const names = new Map<string, string | null>()
  if (ids.length) {
    const { data: people } = await db.from("client_profiles").select("id, name").in("id", ids)
    for (const p of people ?? []) names.set(p.id as string, (p.name as string | null) ?? null)
  }
  for (const r of rows) {
    out.set(r.legacy_note_id, {
      id: r.id,
      status: r.status,
      due_at: r.due_at,
      due_has_time: r.due_has_time,
      assignee_profile_id: r.assignee_profile_id,
      assignee_name: names.get(r.assignee_profile_id) ?? null,
    })
  }
  return out
}

/** Hang each note's task summary on it, as `task` (null when it has none). */
export async function withNoteTasks<N extends { id: string; type: string }>(
  db: SupabaseClient,
  notes: N[],
): Promise<Array<N & { task: NoteTaskSummary | null }>> {
  const map = await noteTaskSummaries(db, notes.filter((n) => n.type === "action_item").map((n) => n.id))
  return notes.map((n) => ({ ...n, task: map.get(n.id) ?? null }))
}

/**
 * The task for an action-item note that SIGNAL wrote itself.
 *
 * workbook_send_to_coach (SQL) still writes "<name> sent the workbook for
 * review" as an action-item note, refreshing its text while it is open. That
 * note appeared on no dashboard surface after 2026-09-26, the same way the
 * prospect page's did. The route calls this after the RPC so the note has its
 * task: a system task (no author), for the note's coach, linked where the work
 * is, retitled whenever the RPC refreshes the note.
 */
export async function ensureSystemNoteTask(
  db: SupabaseClient,
  noteId: string,
  opts: { link: string },
): Promise<ServiceResult<Task>> {
  const { data: note, error } = await db.from("coach_client_notes")
    .select("id, type, body, coach_client_id, client_profile_id, coach_profile_id, completed_at, deleted_at")
    .eq("id", noteId).maybeSingle()
  if (error) return { ok: false, error: error.message, status: 500 }
  if (!note || note.deleted_at || note.type !== "action_item") {
    return { ok: false, error: "That note is not an open action item.", status: 404 }
  }
  const { title, description } = taskTextFromNote(note.body)
  const task = await findNoteTask(db, noteId)
  if (task) {
    if (task.status !== "open") return { ok: true, data: task }
    return updateTask(db, task.id, { title, description }, null)
  }
  return createTask(db, {
    title,
    description,
    client_profile_id: note.client_profile_id,
    coach_client_id: note.coach_client_id,
    assignee_profile_id: note.coach_profile_id,
    source: "auto",
    link: opts.link,
    legacy_note_id: note.id,
  }, null)
}

/**
 * Close the open tasks of notes SIGNAL just completed in SQL.
 *
 * workbook_send_to_client stamps the coach's "sent the workbook for review"
 * note complete inside its own transaction, where the task layer cannot reach.
 * The route calls this afterwards so the task closes too, through setTaskStatus
 * like every other completion. Returns how many closed. Never throws.
 */
export async function closeTasksForNotes(db: SupabaseClient, noteIds: string[], actor: string): Promise<number> {
  if (!noteIds.length) return 0
  const { data, error } = await db.from("coach_tasks")
    .select("id").in("legacy_note_id", noteIds).eq("status", "open").is("deleted_at", null)
  if (error) {
    console.error("[notes] finding tasks to close failed:", error.message)
    return 0
  }
  let closed = 0
  for (const t of data ?? []) {
    const r = await setTaskStatus(db, t.id, "done", actor)
    if (r.ok) closed++
    else console.error("[notes] closing a note's task failed:", r.error)
  }
  return closed
}
