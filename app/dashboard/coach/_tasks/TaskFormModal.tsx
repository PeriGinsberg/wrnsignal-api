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

import { useEffect, useRef, useState } from "react"
import { T, btnPrimary, btnSecondary, fieldLabel, fieldWrap, input, selectDark, selectDarkOption, textarea } from "../../../../lib/dashboard-theme"
import { TASK_STATUSES, type Task, type TaskStatus } from "../../../../lib/tasks/model"
import { apiJson, type Assignee } from "./taskClient"
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea"
import { isSafeTaskLink } from "../../../../lib/tasks/links"
import { TYPE } from "../../../../lib/theme/surfaces"

export type TaskFormModalProps = {
  task: Task | null
  assignees: Assignee[]
  clients: Array<{ id: string; name: string }>
  /** Pre-select this client on a new task (the client page passes its own). */
  presetClientId?: string
  /**
   * A new task on a prospect (or a converted client with no account yet):
   * the relationship it belongs to, its name, and what to call it (default
   * "Prospect").
   * A prospect has no profile for the client select to offer, so the field is
   * shown fixed instead and the task is saved against coach_client_id.
   */
  presetCoachClient?: { id: string; name: string; label?: string }
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

/**
 * What the input holds, back to an instant, read as LOCAL time.
 *
 * THIS IS WHY EDITING A DUE DATE APPEARED NOT TO SAVE. `new Date("2026-09-25")`
 * parses a date-only string as UTC midnight, which in UTC-4 is 8pm on the
 * 24th. Rendering that back through toLocalInput produced the 24th, so the
 * date the coach typed came back a day earlier and looked like it had
 * reverted. Every save and reopen walked it back another day.
 *
 * NOON LOCAL, not midnight: it is the furthest point from both day
 * boundaries, so no timezone or DST shift can move the date onto an adjacent
 * day. A date-only task has no meaningful time anyway, and due_has_time=false
 * tells every reader to ignore it.
 *
 * datetime-local is left to the platform parser, which reads it as local
 * already, per spec.
 */
function fromLocalInput(v: string, withTime: boolean): Date | null {
  if (!v) return null
  if (withTime) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0)
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
  const [link, setLink] = useState(task?.link ?? "")
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "open")
  // A system task's link may be edited but not removed; the API refuses it
  // either way, and saying so here beats a Postgres constraint string.
  const isSystem = task?.source === "auto"
  const linkBad = link.trim().length > 0 && !isSafeTaskLink(link.trim())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The assignee list arrives after the first render, so a preset that is not
  // yet in `assignees` would leave the select on its first option. Re-apply it
  // once the options exist, but only while the field is untouched.
  useEffect(() => {
    if (!editing && props.presetAssigneeId && !assignee) setAssignee(props.presetAssigneeId)
  }, [assignees, props.presetAssigneeId, editing, assignee])

  // Switching the time toggle must not silently drop the day already chosen.
  //
  // SKIPPED ON MOUNT. useEffect with a dependency array runs on the first
  // render too, so this used to reformat the date the instant the modal
  // opened. Combined with the UTC parsing above, simply opening a task and
  // saving it moved the due date back a day without anyone touching the field.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    setDue((d) => {
      const parsed = fromLocalInput(d, !hasTime)
      return parsed ? toLocalInput(parsed.toISOString(), hasTime) : d
    })
  }, [hasTime])

  async function save() {
    if (linkBad) { setError("A link must be a path inside SIGNAL, starting with /dashboard/."); return }
    if (isSystem && !link.trim()) { setError("A system task must keep a link to where the work is done."); return }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        title,
        description: description.trim() || null,
        assignee_profile_id: assignee,
        client_profile_id: props.presetCoachClient ? null : clientId || null,
        ...(props.presetCoachClient ? { coach_client_id: props.presetCoachClient.id } : {}),
        due_at: fromLocalInput(due, hasTime)?.toISOString() ?? null,
        due_has_time: hasTime,
        link: link.trim() || null,
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
          {/* Grows with the text. A task carrying a campaign brief is long,
              and a fixed 90px box put the rest of it behind an inner
              scrollbar that nothing on screen advertised. */}
          <AutoGrowTextarea
            id="task-desc" style={textarea} minRows={3} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What needs doing, and anything the next person needs to know."
          />
        </div>

        {/* OPTIONAL HERE, REQUIRED FOR A SYSTEM TASK. A coach writing their own
            task already knows where they meant; SIGNAL raising one does not get
            to assume that. The field is the same either way so there is one
            place to look, and the hint changes rather than the control. */}
        <div style={fieldWrap}>
          <label style={fieldLabel} htmlFor="task-link">
            Link {isSystem ? "" : <span style={{ fontWeight: 600, color: T.DIM }}>(optional)</span>}
          </label>
          <input
            id="task-link" style={input} value={link} type="text"
            onChange={(e) => setLink(e.target.value)}
            placeholder="/dashboard/coach/clients/..."
            aria-describedby="task-link-hint"
          />
          <p id="task-link-hint" style={{ margin: "5px 0 0", fontSize: TYPE.secondary, color: T.DIM }}>
            {isSystem
              ? "Where this task is done. System tasks always carry one."
              : "A page inside SIGNAL. Leave it empty and the task shows no Go button."}
          </p>
          {linkBad && (
            <p role="alert" style={{ margin: "5px 0 0", fontSize: TYPE.secondary, color: T.ERROR }}>
              A link must be a path inside SIGNAL, starting with /dashboard/.
            </p>
          )}
        </div>

        <div style={fieldWrap}>
          <label style={fieldLabel} htmlFor="task-assignee">Assignee</label>
          <select id="task-assignee" style={selectDark} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {assignees.map((a) => (
              <option key={a.id} value={a.id} style={selectDarkOption}>
                {a.name}{a.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>

        {props.presetCoachClient ? (
          <div style={fieldWrap}>
            <span style={fieldLabel}>{props.presetCoachClient.label ?? "Prospect"}</span>
            <p style={{ margin: 0, fontSize: 14, color: T.TEXT }}>{props.presetCoachClient.name}</p>
          </div>
        ) : (
          <div style={fieldWrap}>
            <label style={fieldLabel} htmlFor="task-client">Client (optional)</label>
            <select id="task-client" style={selectDark} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="" style={selectDarkOption}>No client</option>
              {clients.map((c) => <option key={c.id} value={c.id} style={selectDarkOption}>{c.name}</option>)}
            </select>
          </div>
        )}

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
            <select id="task-status" style={selectDark} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => <option key={s} value={s} style={selectDarkOption}>{s}</option>)}
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
