// lib/tasks/records.ts
//
// Who a task is about, when it has no client profile to say so.
//
// A task on a prospect carries coach_client_id only: a prospect has no SIGNAL
// profile yet. The list used to resolve names from client profiles alone, so
// every prospect task read "No client". This attaches the relationship's name
// and what it is (prospect, or a client converted but not yet set up), with a
// link to its page, so the row can name it and badge it.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Task, TaskRecord } from "./model"

type RelRow = { id: string; name: string | null; invited_email: string | null; lifecycle_status: string | null }

/** Tasks with `record` set where the task has a relationship and no profile. Never throws. */
export async function withRecordNames<T extends Pick<Task, "client_profile_id" | "coach_client_id">>(
  db: SupabaseClient,
  tasks: T[],
): Promise<Array<T & { record: TaskRecord | null }>> {
  const ids = [...new Set(tasks.filter((t) => !t.client_profile_id && t.coach_client_id).map((t) => t.coach_client_id as string))]
  const byId = new Map<string, RelRow>()
  if (ids.length) {
    const { data, error } = await db.from("coach_clients")
      .select("id, name, invited_email, lifecycle_status").in("id", ids)
    if (error) console.error("[tasks/records] reading relationships failed:", error.message)
    for (const r of (data ?? []) as RelRow[]) byId.set(r.id, r)
  }
  return tasks.map((t) => {
    const rel = !t.client_profile_id && t.coach_client_id ? byId.get(t.coach_client_id) : undefined
    if (!rel) return { ...t, record: null }
    const prospect = rel.lifecycle_status === "Prospect"
    return {
      ...t,
      record: {
        kind: prospect ? "prospect" : "client",
        name: rel.name?.trim() || rel.invited_email || null,
        href: prospect ? `/dashboard/coach/prospects/${rel.id}` : `/dashboard/coach/coach-clients/${rel.id}`,
      },
    }
  })
}
