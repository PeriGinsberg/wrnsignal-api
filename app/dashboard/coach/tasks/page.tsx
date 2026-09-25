"use client"

// The full task list: views, filters, search, and add / edit / delete /
// reassign, laid out as a table.
//
// The four view tabs are applied on the server, by the same predicates the
// dashboard card and the coming digest use, so all three agree about what
// "overdue" means. Everything else here is a plain column filter.
//
// ASSIGNEE DEFAULTS TO ME. A coach arriving at this page wants their own work;
// showing everyone's by default makes it useless on arrival.
//
// The rows themselves are TaskRow, shared with the condensed Action Items card
// so the two surfaces cannot drift apart.

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, btnPrimary, btnSecondary, card, input } from "../../../../lib/dashboard-theme"
import { TASK_VIEWS, type Task, type TaskView } from "../../../../lib/tasks/model"
import { BackToDashboard } from "../BackToDashboard"
import { TaskFormModal } from "../_tasks/TaskFormModal"
import { TaskRow, TaskRowHeader, TaskRowStyles } from "../_tasks/TaskRow"
import { apiJson, type Assignee } from "../_tasks/taskClient"

const VIEW_LABEL: Record<TaskView, string> = {
  all: "All",
  due_today: "Due today",
  overdue: "Overdue",
  upcoming: "Upcoming",
}

type ClientOpt = { id: string; name: string }

// The shared `select` style in dashboard-theme is explicitly white, and it is
// used across the whole app, so it is left alone and this page gets its own.
// colorScheme:"dark" is the part that matters: it is what makes the native
// dropdown panel dark, which no amount of styling the <select> box can do.
const darkSelect: React.CSSProperties = {
  ...input,
  background: T.CARD,
  color: T.TEXT,
  border: `1px solid ${T.BORDER}`,
  colorScheme: "dark",
  cursor: "pointer",
}

export default function CoachTasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [view, setView] = useState<TaskView>("all")
  const [assignee, setAssignee] = useState("me")
  const [status, setStatus] = useState("open")
  const [client, setClient] = useState("")
  const [source, setSource] = useState("")
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")

  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  // Typing in a search box should not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const query = useMemo(() => {
    const p = new URLSearchParams()
    p.set("view", view)
    p.set("assignee", assignee)
    p.set("status", status)
    if (client) p.set("client", client)
    if (source) p.set("source", source)
    if (debounced.trim()) p.set("search", debounced.trim())
    return p.toString()
  }, [view, assignee, status, client, source, debounced])

  const load = useCallback(async () => {
    try {
      const j = await apiJson<{ tasks: Task[] }>(`/api/coach/tasks?${query}`)
      setTasks(j.tasks)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setTasks([])
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const a = await apiJson<{ assignees: Assignee[]; me: string }>("/api/coach/tasks/assignees")
        setAssignees(a.assignees)
        setMe(a.me)
      } catch { /* the filter falls back to me / all, which still works */ }
      try {
        const c = await apiJson<any>("/api/coach/clients")
        const rows: any[] = c.clients ?? c.data ?? []
        setClients(rows
          .map((r) => ({ id: r.client_profile_id ?? r.id, name: r.name ?? r.client_name ?? r.invited_email ?? "Unnamed" }))
          .filter((r) => r.id))
      } catch { /* client filter simply stays empty */ }
    })()
  }, [])

  const clientName = (id: string | null) => (id && clients.find((c) => c.id === id)?.name) || null
  // First name only in the assignee column: the full name pushes the column
  // wide enough to squeeze the title, which is the one that matters.
  const assigneeName = (id: string | null) => {
    const full = (id && assignees.find((a) => a.id === id)?.name) || null
    return full ? full.split(/\s+/)[0] : null
  }

  async function toggleDone(task: Task, next: boolean) {
    setBusy(task.id)
    const before = tasks
    // Optimistic, because the coach has already decided. The row stays put and
    // changes state rather than vanishing: under "All" it should still be
    // there, ticked.
    setTasks((ts) => (ts ?? []).map((t) => t.id === task.id
      ? { ...t, status: next ? "done" : "open", completed_at: next ? new Date().toISOString() : null }
      : t))
    try {
      await apiJson(`/api/coach/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next ? "done" : "open" }),
      })
      // A status filter is showing a subset, so what qualifies may have
      // changed underneath the edit.
      if (status !== "all") void load()
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

  function upsert(t: Task) {
    setTasks((ts) => {
      const list = ts ?? []
      const i = list.findIndex((x) => x.id === t.id)
      if (i === -1) return [t, ...list]
      const copy = list.slice()
      copy[i] = t
      return copy
    })
  }

  return (
    <div style={{ padding: "24px 20px", maxWidth: 1180, margin: "0 auto" }}>
      <TaskRowStyles />
      <BackToDashboard />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
        <h1 style={{ fontSize: 24, color: T.TEXT, margin: 0 }}>Tasks</h1>
        <button style={btnPrimary} onClick={() => setCreating(true)}>New task</button>
      </div>

      {/* Views */}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {TASK_VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              ...btnSecondary,
              padding: "6px 14px",
              fontWeight: view === v ? 700 : 500,
              borderColor: view === v ? T.TASK_HEADER : undefined,
              color: view === v ? T.TASK_HEADER : undefined,
            }}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: 14, marginTop: 14, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <select style={darkSelect} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="me">Assigned to me</option>
          <option value="all">Anyone</option>
          {assignees.filter((a) => a.id !== me).map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.active ? "" : " (inactive)"}</option>
          ))}
        </select>

        <select style={darkSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">Any status</option>
        </select>

        <select style={darkSelect} value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Any client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select style={darkSelect} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Any source</option>
          <option value="manual">Added by a person</option>
          <option value="auto">Created automatically</option>
        </select>

        <input
          style={{ ...input, gridColumn: "1 / -1" }}
          placeholder="Search titles and descriptions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>}

      {tasks !== null && tasks.length === 0 && !error && (
        <p style={{ color: T.MUTED, fontSize: 14, marginTop: 20 }}>
          Nothing here. {view !== "all" || status !== "open" ? "Try a different view or filter." : "Add a task to get started."}
        </p>
      )}

      {tasks !== null && tasks.length > 0 && (
        <div style={{ marginTop: 18 }}>
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
                onEdit={setEditing}
                onDelete={remove}
              />
            ))}
          </div>
        </div>
      )}

      {(creating || editing) && (
        <TaskFormModal
          task={editing}
          assignees={assignees}
          clients={clients}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={(t) => { upsert(t); void load() }}
          onDeleted={(id) => setTasks((ts) => (ts ?? []).filter((x) => x.id !== id))}
        />
      )}
    </div>
  )
}
