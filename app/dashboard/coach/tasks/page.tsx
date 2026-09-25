"use client"

// The full task list: views, filters, search, and add / edit / delete /
// reassign.
//
// The four view tabs are applied on the server, by the same predicates the
// dashboard card and the overdue digest use, so all three agree about what
// "overdue" means. Everything else here is a plain column filter.
//
// ASSIGNEE DEFAULTS TO ME. A coach arriving at this page wants their own work;
// showing everyone's by default makes it useless on arrival.

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, btnPrimary, btnSecondary, card, eyebrow, input, select } from "../../../../lib/dashboard-theme"
import { TASK_VIEWS, isOverdue, type Task, type TaskView } from "../../../../lib/tasks/model"
import { BackToDashboard } from "../BackToDashboard"
import { TaskFormModal } from "../_tasks/TaskFormModal"
import { apiJson, formatDue, linkifyParts, type Assignee } from "../_tasks/taskClient"

const VIEW_LABEL: Record<TaskView, string> = {
  all: "All",
  due_today: "Due today",
  overdue: "Overdue",
  upcoming: "Upcoming",
}

type ClientOpt = { id: string; name: string }

export default function CoachTasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [error, setError] = useState<string | null>(null)

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

  const nameOf = (id: string | null) =>
    (id && assignees.find((a) => a.id === id)?.name) || "Unassigned"

  return (
    <div style={{ padding: "24px 20px", maxWidth: 1000, margin: "0 auto" }}>
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
              borderColor: view === v ? (T.WRN_ORANGE) : undefined,
              color: view === v ? (T.WRN_ORANGE) : undefined,
            }}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ ...card, padding: 14, marginTop: 14, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <select style={select} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="me">Assigned to me</option>
          <option value="all">Anyone</option>
          {assignees.filter((a) => a.id !== me).map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.active ? "" : " (inactive)"}</option>
          ))}
        </select>

        <select style={select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">Any status</option>
        </select>

        <select style={select} value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Any client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select style={select} value={source} onChange={(e) => setSource(e.target.value)}>
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

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {(tasks ?? []).map((t) => {
          const late = isOverdue(t)
          return (
            <div
              key={t.id}
              style={{
                ...card, padding: 14, display: "flex", gap: 12, alignItems: "flex-start",
                borderLeft: `3px solid ${late ? T.ERROR : "transparent"}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, color: T.TEXT, wordBreak: "break-word" }}>{t.title}</div>

                {t.description && (
                  <p style={{ fontSize: 13, color: T.MUTED, margin: "6px 0 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {linkifyParts(t.description).map((p, i) =>
                      p.kind === "link" ? (
                        <a key={i} href={p.value} target="_blank" rel="noopener noreferrer"
                           style={{ color: T.WRN_ORANGE }}>{p.value}</a>
                      ) : (
                        <span key={i}>{p.value}</span>
                      ),
                    )}
                  </p>
                )}

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 12, color: late ? T.ERROR : T.MUTED }}>
                  <span>{late ? "Overdue: " : ""}{formatDue(t)}</span>
                  <span style={{ color: T.MUTED }}>{nameOf(t.assignee_profile_id)}</span>
                  {t.status !== "open" && <span style={{ color: T.MUTED }}>{t.status}</span>}
                  {/* Said plainly so a coach knows a rule put this here, not a person. */}
                  {t.source === "auto" && <span style={{ color: T.MUTED }}>added automatically</span>}
                </div>
              </div>

              <button style={{ ...btnSecondary, padding: "6px 12px" }} onClick={() => setEditing(t)}>Edit</button>
            </div>
          )
        })}
      </div>

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
