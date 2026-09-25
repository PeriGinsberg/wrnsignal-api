"use client"

// The cross-client Action Items list, as full task rows.
//
// Used by Required Actions. It replaces CrossClientActionItemsList, which read
// /api/coach/action-items and rendered coach_client_notes rows with an urgent /
// this-week / when-ready badge.
//
// WHY THE PRIORITY BADGES ARE GONE. A task has a due date, not a priority, and
// the two are not the same claim: "urgent" was how a coach felt about an item,
// a due date is when it is actually late. Keeping both would have meant two
// competing answers to "what should I do next". The backfilled items kept their
// old priority on their created audit event, so nothing was thrown away.

import { useCallback, useEffect, useState } from "react"
import { T } from "../../../../lib/dashboard-theme"
import type { Task } from "../../../../lib/tasks/model"
import { TaskRow, TaskRowHeader, TaskRowStyles } from "./TaskRow"
import { apiJson, type Assignee } from "./taskClient"

export type TaskListProps = {
  /** "me" (default), "all", or a profile id. */
  assignee?: string
  emptyText?: string
}

export function TaskList({ assignee = "me", emptyText = "No items due" }: TaskListProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const j = await apiJson<{ tasks: Task[] }>(
        `/api/coach/tasks?assignee=${encodeURIComponent(assignee)}&status=open&view=all`,
      )
      setTasks(j.tasks)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setTasks([])
    }
  }, [assignee])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const a = await apiJson<{ assignees: Assignee[] }>("/api/coach/tasks/assignees")
        setAssignees(a.assignees)
      } catch { /* names simply fall back to the avatar placeholder */ }
      try {
        const c = await apiJson<any>("/api/coach/clients")
        const rows: any[] = c.clients ?? c.data ?? []
        setClients(rows
          .map((r) => ({ id: r.client_profile_id ?? r.id, name: r.name ?? r.client_name ?? r.invited_email ?? "Unnamed" }))
          .filter((r) => r.id))
      } catch { /* client column shows "No client" */ }
    })()
  }, [])

  async function toggleDone(task: Task, next: boolean) {
    setBusy(task.id)
    const before = tasks
    // This list only shows open work, so a completed row leaves it.
    if (next) setTasks((ts) => (ts ?? []).filter((t) => t.id !== task.id))
    try {
      await apiJson(`/api/coach/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next ? "done" : "open" }),
      })
    } catch (e: any) {
      setTasks(before)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  if (tasks === null) return null

  const clientName = (id: string | null) => (id && clients.find((c) => c.id === id)?.name) || null
  const assigneeName = (id: string | null) => {
    const full = (id && assignees.find((a) => a.id === id)?.name) || null
    return full ? full.split(/\s+/)[0] : null
  }

  return (
    <div>
      <TaskRowStyles />
      {error && <p style={{ color: T.ERROR, fontSize: 13, margin: "8px 0 0 0" }}>{error}</p>}

      {tasks.length === 0 && !error && (
        <p style={{ color: T.MUTED, fontSize: 13, margin: "10px 0 0 0" }}>{emptyText}</p>
      )}

      {tasks.length > 0 && (
        <>
          <TaskRowHeader />
          <div style={{ marginTop: 8 }}>
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                clientName={clientName(t.client_profile_id)}
                assigneeName={assigneeName(t.assignee_profile_id)}
                busy={busy === t.id}
                onToggleDone={toggleDone}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
