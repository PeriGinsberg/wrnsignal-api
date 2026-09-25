"use client"

// The dashboard card: my overdue tasks and what is due this week, capped at
// five, with a "+N more" link to the full list.
//
// It asks the server for ?card=1 rather than fetching everything and slicing
// here, so that the cap, the ordering and the definition of "overdue" all come
// from lib/tasks/model.ts. Three surfaces show this data and they have to
// agree; the moment the card does its own arithmetic, it starts disagreeing
// with the digest email.
//
// The rows are the SAME TaskRow the full list uses, in its condensed form.
// Step 3 folds Action Items into this card, and one row component is what
// stops the two surfaces drifting.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { T } from "../../../../lib/dashboard-theme"
import type { Task } from "../../../../lib/tasks/model"
import { TaskRow, TaskRowHeader, TaskRowStyles } from "./TaskRow"
import { apiJson } from "./taskClient"

export function TaskCard() {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])

  // The card spans every client, so it has to resolve names the same way the
  // full list does. Failure is silent: the column falls back to "No client"
  // rather than taking the card down with it.
  const loadClients = useCallback(async () => {
    try {
      const c = await apiJson<any>("/api/coach/clients")
      const rows: any[] = c.clients ?? c.data ?? []
      setClients(rows
        .map((r) => ({ id: r.client_profile_id ?? r.id, name: r.name ?? r.client_name ?? r.invited_email ?? "Unnamed" }))
        .filter((r) => r.id))
    } catch { /* column shows "No client" */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const j = await apiJson<{ tasks: Task[]; total: number }>("/api/coach/tasks?card=1")
      setTasks(j.tasks)
      setTotal(j.total)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setTasks([])
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadClients() }, [loadClients])

  async function toggleDone(task: Task, next: boolean) {
    setBusy(task.id)
    const before = tasks
    // The card only ever shows open work, so a completed row leaves it. That
    // is the difference from the full list, where it stays and shows as done.
    if (next) {
      setTasks((ts) => (ts ?? []).filter((t) => t.id !== task.id))
      setTotal((n) => Math.max(0, n - 1))
    }
    try {
      await apiJson(`/api/coach/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next ? "done" : "open" }),
      })
      if (!next) void load()
    } catch (e: any) {
      setTasks(before)
      setTotal(before?.length ?? 0)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  if (tasks === null) return null

  return (
    // No card chrome of its own: this is mounted inside <Section>, which draws
    // the panel and owns the title and its "View all" link.
    <div>
      <TaskRowStyles />

      {error && <p style={{ color: T.ERROR, fontSize: 13, margin: "10px 0 0 0" }}>{error}</p>}

      {tasks.length === 0 && !error && (
        // Now that the card shows every open task and not just the dated ones,
        // empty means empty. Saying "nothing overdue" here would have been
        // true and useless.
        <p style={{ color: T.MUTED, fontSize: 13, margin: "10px 0 0 0" }}>
          No open tasks.
        </p>
      )}

      {tasks.length > 0 && (
        <>
          <TaskRowHeader condensed />
          <div style={{ marginTop: 8 }}>
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                condensed
                clientName={clients.find((c) => c.id === t.client_profile_id)?.name ?? null}
                busy={busy === t.id}
                onToggleDone={toggleDone}
              />
            ))}
          </div>
        </>
      )}

      {/* ALWAYS SHOWN, even when everything fits. The link is the way to the
          full list, not just an overflow indicator, and a coach with four tasks
          still needs a route to filters and search. */}
      <button
        onClick={() => router.push("/dashboard/coach/tasks")}
        style={{
          background: "none", border: "none", padding: "12px 0 0 0", cursor: "pointer",
          color: T.TASK_HEADER, fontSize: 13, fontWeight: 600,
        }}
      >
        View all tasks ({total})
      </button>
    </div>
  )
}
