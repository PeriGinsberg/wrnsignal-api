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
import { SPACE, TYPE } from "../../../../lib/theme/surfaces"
import { apiJson, type Assignee } from "./taskClient"

export type TaskListProps = {
  /** "me" (default), "all", or a profile id. */
  assignee?: string
  /** Restrict to one client. */
  client?: string
  /**
   * Restrict to one relationship, for the prospect page. A prospect has no
   * profile for `client` to name, and every task on it carries coach_client_id.
   */
  coachClient?: string
  /**
   * Show a "New task" button that opens the form fixed to this prospect. The
   * prospect counterpart of newTaskClientId.
   */
  newTaskCoachClient?: { id: string; name: string; label?: string }
  /**
   * Called after this list changes a task. The prospect page uses it to
   * re-read its notes, because ticking an action item's task ticks the note.
   */
  onChanged?: () => void
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
  /**
   * Show an Open / Done / All control above the list.
   *
   * ON FOR THE CLIENT PAGE. Without it that tab asked the server for open
   * tasks and had no way to ask for anything else, so a task a coach ticked
   * yesterday was simply gone: no record on the client of work that was
   * actually done. Off elsewhere, where the surrounding page already owns the
   * filtering.
   */
  showStatusFilter?: boolean
}

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
]

export function TaskList({
  assignee = "me",
  client,
  coachClient,
  newTaskCoachClient,
  onChanged,
  emptyText = "No open tasks.",
  newTaskClientId,
  editable = false,
  showStatusFilter = false,
}: TaskListProps) {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  // OPEN BY DEFAULT. The question a coach opens this tab with is "what is
  // outstanding"; history is a deliberate second click.
  const [status, setStatus] = useState("open")
  // Which template each task came from, and what closes it. Sent with the
  // list so the row does not have to guess from the title which tasks are
  // decided rather than ticked.
  const [templates, setTemplates] = useState<Record<string, { key: string; decision_options: string[] | null }>>({})
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ assignee, status, view: "all" })
      if (client) p.set("client", client)
      if (coachClient) p.set("coach_client", coachClient)
      const j = await apiJson<{ tasks: Task[]; templates?: Record<string, { key: string; decision_options: string[] | null }> }>(
        `/api/coach/tasks?${p.toString()}`)
      setTasks(j.tasks)
      setTemplates(j.templates ?? {})
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setTasks([])
    }
  }, [assignee, client, coachClient, status])

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
      onChanged?.()
    } catch (e: any) {
      setTasks(before)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  /**
   * Approve, or send it back.
   *
   * REQUEST CHANGES ASKS FOR THE NOTE HERE, before the request goes out. The
   * server rejects a note-less request_changes, and meeting that as a red
   * error after the click would be a worse way to learn it. The note is what
   * reopens the previous task and what gets emailed to whoever has to redo it.
   */
  async function decide(task: Task, decision: string) {
    let note: string | null = null
    if (decision === "request_changes") {
      note = window.prompt("What needs changing? This goes back with the task.")
      // Cancelled, or left empty. Not an error: the coach changed their mind.
      if (note === null || !note.trim()) return
    }

    setBusy(task.id)
    const before = tasks
    setTasks((ts) => (ts ?? []).filter((t) => t.id !== task.id))
    try {
      await apiJson(`/api/coach/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done", decision, note }),
      })
      // RE-READ, because the decision creates or reopens another task and the
      // list has to show it. The route drains the queue before answering, so
      // by the time this runs the new row exists.
      await load()
      onChanged?.()
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
      onChanged?.()
    } catch (e: any) {
      setTasks(before)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  if (tasks === null) return null

  const clientName = (t: Task) =>
    (t.client_profile_id && clients.find((c) => c.id === t.client_profile_id)?.name)
    // A prospect has no profile, so its name comes from the page that owns it.
    || (newTaskCoachClient && t.coach_client_id === newTaskCoachClient.id ? newTaskCoachClient.name : null)
    || null
  const assigneeName = (id: string | null) => {
    const full = (id && assignees.find((a) => a.id === id)?.name) || null
    return full ? full.split(/\s+/)[0] : null
  }

  return (
    <div>
      <TaskRowStyles />
      {showStatusFilter && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }} role="tablist" aria-label="Task status">
          {STATUS_TABS.map((t) => {
            const on = t.key === status
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={on}
                onClick={() => setStatus(t.key)}
                style={{
                  fontSize: TYPE.control,
                  fontWeight: 800,
                  // 40px minimum, because anything a coach clicks all day has
                  // to be hittable without aiming.
                  minHeight: SPACE.control,
                  padding: "0 18px",
                  borderRadius: 999,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  border: `1px solid ${on ? T.TASK_HEADER : T.BORDER_SOFT}`,
                  background: on ? "rgba(0,155,255,0.12)" : "transparent",
                  color: on ? T.TASK_HEADER : T.MUTED,
                }}
              >{t.label}</button>
            )
          })}
        </div>
      )}

      {error && <p style={{ color: T.ERROR, fontSize: 13, margin: "8px 0 0 0" }}>{error}</p>}

      {tasks.length === 0 && !error && (
        <p style={{ color: T.MUTED, fontSize: TYPE.secondary, margin: "10px 0 0 0" }}>
          {showStatusFilter
            ? status === "done" ? "No completed tasks for this client yet."
              : status === "all" ? "No tasks for this client yet."
              : "No open tasks."
            : emptyText}
        </p>
      )}

      {(newTaskClientId || newTaskCoachClient) && (
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
                clientName={clientName(t)}
                assigneeName={assigneeName(t.assignee_profile_id)}
                busy={busy === t.id}
                onToggleDone={toggleDone}
                decisionOptions={t.template_id ? templates[t.template_id]?.decision_options : null}
                onDecide={decide}
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
          presetCoachClient={creating ? newTaskCoachClient : undefined}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { void load(); onChanged?.() }}
          onDeleted={(id) => setTasks((ts) => (ts ?? []).filter((x) => x.id !== id))}
        />
      )}
    </div>
  )
}
