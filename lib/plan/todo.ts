// lib/plan/todo.ts
//
// The To-Do side of a plan task. While a plan task is Active (and its
// deliverable is still needed, and someone is assigned), it has exactly one
// open To-Do item for its assignee, titled as the plan shows it: "Release:
// [task]" for a client task. When it stops being Active, the To-Do item
// closes: done if the task was finished, cancelled otherwise.
//
// syncTodo is the only thing that writes these items, and it writes the table
// directly rather than through lib/tasks/service, so the To-Do's own hooks
// (which call back into the plan when a coach ticks an item) cannot loop.

import type { SupabaseClient } from "@supabase/supabase-js"
import { taskTitle, type TaskState } from "./model"

/** The record page a plan task's To-Do item links to. */
export function planLink(c: { coach_client_id: string; client_profile_id: string | null }): string {
  return c.client_profile_id
    ? `/dashboard/coach/clients/${encodeURIComponent(c.client_profile_id)}`
    : `/dashboard/coach/coach-clients/${encodeURIComponent(c.coach_client_id)}`
}

const dueAt = (day: string | null) => (day ? `${day}T12:00:00.000Z` : null)

export async function syncTodo(db: SupabaseClient, activityId: string): Promise<void> {
  try {
    const { data: a } = await db.from("coach_client_engagement_activities")
      .select("id, name, owner, state, assignee_profile_id, due_date, engagement_deliverable_id").eq("id", activityId).maybeSingle()
    const { data: open } = await db.from("coach_tasks").select("id, title, assignee_profile_id, due_at")
      .eq("plan_activity_id", activityId).eq("status", "open").is("deleted_at", null).limit(1)
    const existing = ((open ?? []) as { id: string; title: string; assignee_profile_id: string; due_at: string | null }[])[0]
    const now = new Date().toISOString()

    if (!a) {
      if (existing) await close(db, existing.id, "cancelled", now)
      return
    }
    const task = a as { id: string; name: string; owner: string; state: TaskState; assignee_profile_id: string | null; due_date: string | null; engagement_deliverable_id: string }
    const { data: d } = await db.from("coach_client_engagement_deliverables")
      .select("engagement_id, not_needed").eq("id", task.engagement_deliverable_id).maybeSingle()
    const deliv = d as { engagement_id: string; not_needed: boolean } | null
    const shouldHave = task.state === "active" && !!task.assignee_profile_id && !!deliv && !deliv.not_needed

    if (!shouldHave) {
      if (existing) await close(db, existing.id, task.state === "done" || task.state === "skipped" ? "done" : "cancelled", now)
      return
    }
    const title = taskTitle({ name: task.name, owner: task.owner, state: task.state })
    const due = dueAt(task.due_date)
    if (existing) {
      if (existing.title !== title || existing.assignee_profile_id !== task.assignee_profile_id || (existing.due_at ?? null) !== due) {
        await db.from("coach_tasks").update({ title, assignee_profile_id: task.assignee_profile_id, due_at: due, updated_at: now }).eq("id", existing.id)
      }
      return
    }
    const { data: e } = await db.from("coach_client_engagements").select("coach_client_id").eq("id", deliv!.engagement_id).maybeSingle()
    const ccId = (e as { coach_client_id: string } | null)?.coach_client_id
    if (!ccId) return
    const { data: cc } = await db.from("coach_clients").select("id, client_profile_id").eq("id", ccId).maybeSingle()
    const rel = cc as { id: string; client_profile_id: string | null } | null
    if (!rel) return
    const { error } = await db.from("coach_tasks").insert({
      title,
      client_profile_id: rel.client_profile_id,
      coach_client_id: rel.id,
      assignee_profile_id: task.assignee_profile_id,
      due_at: due,
      due_has_time: false,
      status: "open",
      source: "auto",
      link: planLink({ coach_client_id: rel.id, client_profile_id: rel.client_profile_id }),
      plan_activity_id: task.id,
    })
    if (error) console.error("[plan/todo] creating the To-Do item failed:", error.message)
  } catch (err) {
    console.error("[plan/todo] sync failed:", err instanceof Error ? err.message : String(err))
  }
}

async function close(db: SupabaseClient, id: string, status: "done" | "cancelled", now: string) {
  await db.from("coach_tasks")
    .update({ status, completed_at: status === "done" ? now : null, updated_at: now })
    .eq("id", id).eq("status", "open")
}
