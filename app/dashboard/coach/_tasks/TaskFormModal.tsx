"use client"

// Add, edit and reassign, in one modal.
//
// One modal rather than three, because the fields are identical and the only
// difference is which of them the coach came to change. Reassigning is just
// editing the assignee, and giving it a separate dialog would mean a coach who
// opened Edit and wanted to reassign had to cancel and start again.
//
// The whole form PATCHes in a single request. The route applies fields, then
// assignment, then status, so a task completed in the same edit that retitles
// it carries the new title into its audit row.

import { useEffect, useState } from "react"
import { T, btnPrimary, btnSecondary, fieldLabel, fieldWrap, input, select, textarea } from "../../../../lib/dashboard-theme"
import { TASK_STATUSES, type Task, type TaskStatus } from "../../../../lib/tasks/model"
import { apiJson, type Assignee } from "./taskClient"

export type TaskFormModalProps = {
  task: Task | null
  assignees: Assignee[]
  clients: Array<{ id: string; name: string }>
  /** Pre-select this client on a new task (the client page passes its own). */
  presetClientId?: string
  /** Pre-select this assignee on a new task. The client page passes "me". */
  presetAssigneeId?: string
  /**
   * Pre-fill the due date on a new task, as an ISO instant.
   *
   * Every one of these is a default and not a decision: the fields stay
   * editable, which is why they are separate props rather than a "locked"
   * mode. A coach adding a task from a client's page is usually adding it for
   * that client, for themselves, for tomorrow, and should have to change only
   * the ones that are wrong.
   */
  presetDueAt?: string
  onClose: () => void
  onSaved: (task: Task) => void
  onDeleted?: (taskId: string) => void
}

/** An ISO instant to what <input type="datetime-local"> and date want. */
function toLocalInput(iso: string | null, withTime: boolean): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

export function TaskFormModal(props: TaskFormModalProps) {
  const { task, assignees, clients } = props
  const editing = !!task

  const [title, setTitle] = useState(task?.title ?? "")
  const [description, setDescription] = useState(task?.description ?? "")
  const [assignee, setAssignee] = useState(
    task?.assignee_profile_id ?? props.presetAssigneeId ?? assignees[0]?.id ?? "",
  )
  const [clientId, setClientId] = useState(task?.client_profile_id ?? props.presetClientId ?? "")
  const [hasTime, setHasTime] = useState(task?.due_has_time ?? false)
  const [due, setDue] = useState(
    toLocalInput(task?.due_at ?? props.presetDueAt ?? null, task?.due_has_time ?? false),
  )
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "open")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The assignee list arrives after the first render, so a preset that is not
  // yet in `assignees` would leave the select on its first option. Re-apply it
  // once the options exist, but only while the field is untouched.
  useEffect(() => {
    if (!editing && props.presetAssigneeId && !assignee) setAssignee(props.presetAssigneeId)
  }, [assignees, props.presetAssigneeId, editing, assignee])

  // Switching the time toggle must not silently drop the day already chosen.
  useEffect(() => { setDue((d) => (d ? toLocalInput(new Date(d).toISOString(), hasTime) : d)) }, [hasTime])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        title,
        description: description.trim() || null,
        assignee_profile_id: assignee,
        client_profile_id: clientId || null,
        due_at: due ? new Date(due).toISOString() : null,
        due_has_time: hasTime,
      }
      if (editing) body.status = status

      const j = editing
        ? await apiJson<{ task: Task }>(`/api/coach/tasks/${task!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await apiJson<{ task: Task }>("/api/coach/tasks", { method: "POST", body: JSON.stringify(body) })

      props.onSaved(j.task)
      props.onClose()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!task) return
    setSaving(true)
    setError(null)
    try {
      await apiJson(`/api/coach/tasks/${task.id}`, { method: "DELETE" })
      props.onDeleted?.(task.id)
      props.onClose()
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setSaving(false)
    }
  }

  return (
    <div
      onClick={props.onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.CARD, borderRadius: 12, padding: 24,
          width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <h2 style={{ margin: "0 0 16px 0", fontSize: 18, color: T.TEXT }}>
          {editing ? "Edit task" : "New task"}
        </h2>

        <div style={fieldWrap}>
          <label style={fieldLabel} htmlFor="task-title">Title</label>
          <input id="task-title" style={input} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div style={fieldWrap}>
          <label style={fieldLabel} htmlFor="task-desc">Description</label>
          <textarea
            id="task-desc" style={{ ...textarea, minHeight: 90 }} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Links pasted here are clickable in the list."
          />
        </div>

        <div style={fieldWrap}>
          <label style={fieldLabel} htmlFor="task-assignee">Assignee</label>
          <select id="task-assignee" style={select} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldWrap}>
          <label style={fieldLabel} htmlFor="task-client">Client (optional)</label>
          <select id="task-client" style={select} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">No client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div style={fieldWrap}>
          <label style={fieldLabel} htmlFor="task-due">Due</label>
          <input
            id="task-due" style={input} type={hasTime ? "datetime-local" : "date"}
            value={due} onChange={(e) => setDue(e.target.value)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: T.MUTED }}>
            <input type="checkbox" checked={hasTime} onChange={(e) => setHasTime(e.target.checked)} />
            Set a time as well as a day
          </label>
        </div>

        {editing && (
          <div style={fieldWrap}>
            <label style={fieldLabel} htmlFor="task-status">Status</label>
            <select id="task-status" style={select} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        {error && <p style={{ color: T.ERROR, fontSize: 13, margin: "8px 0 0 0" }}>{error}</p>}

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "space-between" }}>
          <div>
            {editing && (
              <button onClick={() => void remove()} disabled={saving}
                style={{ ...btnSecondary, color: T.ERROR }}>
                Delete
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={props.onClose} disabled={saving} style={btnSecondary}>Cancel</button>
            <button onClick={() => void save()} disabled={saving || !title.trim()} style={btnPrimary}>
              {saving ? "Saving..." : editing ? "Save" : "Create task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
