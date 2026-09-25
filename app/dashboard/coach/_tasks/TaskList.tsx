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
import { T, btnSecondary } from "../../../../lib/dashboard-theme"
import type { Task } from "../../../../lib/tasks/model"
import { TaskFormModal } from "./TaskFormModal"
import { TaskRow, TaskRowHeader, TaskRowStyles } from "./TaskRow"
import { apiJson, type Assignee } from "./taskClient"

export type TaskListProps = {
  /** "me" (default), "all", or a profile id. */
  assignee?: string
  /** Restrict to one client. */
  client?: string
  emptyText?: string
  /**
   * Show a "New task" button that opens the form with this client pre-filled.
   * Used by the client page, where every task created is about that person and
   * making the coach pick them from a dropdown they just navigated through
   * would be asking twice.
   */
  newTaskClientId?: string
  /** Rows the coach can edit and delete. Off for the read-only surfaces. */
  editable?: boolean
}

export function TaskList({
  assignee = "me",
  client,
  emptyText = "No items due",
  newTaskClientId,
  editable = false,
}: TaskListProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ assignee, status: "open", view: "all" })
      if (client) p.set("client", client)
      const j = await apiJson<{ tasks: Task[] }>(`/api/coach/tasks?${p.toString()}`)
      setTasks(j.tasks)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setTasks([])
    }
  }, [assignee, client])

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

  async function remove(task: Task) {
    setBusy(task.id)
    const before = tasks
    setTasks((ts) => (ts ?? []).filter((t) => t.id !== task.id))
    try {
      await apiJson(`/api/coach/tasks/${task.id}`, { method: "DELETE" })
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

      {newTaskClientId && (
        <button
          style={{ ...btnSecondary, padding: "6px 14px", marginBottom: 12 }}
          onClick={() => setCreating(true)}
        >
          New task
        </button>
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
                onEdit={editable ? setEditing : undefined}
                onDelete={editable ? remove : undefined}
              />
            ))}
          </div>
        </>
      )}

      {(creating || editing) && (
        <TaskFormModal
          task={editing}
          assignees={assignees}
          clients={clients}
          presetClientId={creating ? newTaskClientId : undefined}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { void load() }}
          onDeleted={(id) => setTasks((ts) => (ts ?? []).filter((x) => x.id !== id))}
        />
      )}
    </div>
  )
}
