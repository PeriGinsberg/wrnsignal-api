"use client"

// The client's Plan, on the client record under the Phase stepper: every
// deliverable in their approved packages, grouped by phase, with its tasks.
// The current phase (every phase In progress, or the first not started) is
// open; the rest are collapsed to "x / y tasks".
//
// Here the coach works the plan: activate, release, finish, skip or mark a
// task Not needed, set its assignee and due date, reorder, add and remove
// tasks and deliverables. The library package never changes. The rules are in
// lib/plan/service.ts; this only shows what they allow.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { card, eyebrow } from "../../../../lib/dashboard-theme"
import { TYPE } from "../../../../lib/theme/surfaces"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { PHASE_COLORS, PHASE_STATUS_LABEL, type ClientPhase } from "@/lib/phases/model"
import {
  TASK_STATE_LABEL,
  TASK_TYPE_LABEL,
  taskTitle,
  type PlanDeliverable,
  type PlanTask,
  type TaskAction,
  type TaskState,
  type TaskType,
} from "@/lib/plan/model"

const NAVY = PHASE_COLORS.text

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

type Plan = {
  phases: ClientPhase[]
  deliverables: PlanDeliverable[]
  packages: { id: string; name: string }[]
  library: { id: string; name: string; phase_id: string | null }[]
}
type Assignee = { id: string; name: string | null; email: string | null }

/** Which actions a task offers, mirroring allowedActions in lib/plan/service.ts. */
function actionsFor(t: { owner: TaskType; state: TaskState }): TaskAction[] {
  switch (t.state) {
    case "upcoming": return t.owner === "client" ? ["activate", "release", "done", "skip", "not_needed"] : ["activate", "done", "skip", "not_needed"]
    case "active": return t.owner === "client" ? ["release", "done", "skip", "not_needed"] : ["done", "skip", "not_needed"]
    case "waiting_on_client": return ["done", "skip"]
    default: return ["undo"]
  }
}
const ACTION_LABEL: Record<TaskAction, string> = {
  activate: "Activate", release: "Release", done: "Done", skip: "Skip", not_needed: "Not needed", undo: "Undo",
}

const STATE_STYLE: Record<TaskState, React.CSSProperties> = {
  upcoming: { color: NAVY, border: `1px solid ${NAVY}`, background: "#fff" },
  active: { color: "#fff", background: PHASE_COLORS.in_progress, border: `1px solid ${PHASE_COLORS.in_progress}` },
  waiting_on_client: { color: NAVY, background: "#FFF1E0", border: "1px solid #FEB06A" },
  done: { color: "#fff", background: PHASE_COLORS.complete, border: `1px solid ${PHASE_COLORS.complete}` },
  skipped: { color: NAVY, background: "#EEF1F4", border: "1px solid #C7CED6" },
  not_needed: { color: "#6B7480", background: "#F1F3F5", border: "1px dashed #9AA3AE" },
}

const small: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: NAVY, background: "#fff", border: `1px solid rgba(8,32,63,0.3)`,
  borderRadius: 7, padding: "4px 9px", cursor: "pointer", fontFamily: "inherit",
}
const fieldStyle: React.CSSProperties = {
  fontSize: 12, color: NAVY, background: "#fff", border: "1px solid rgba(8,32,63,0.25)", borderRadius: 7,
  padding: "4px 6px", fontFamily: "inherit",
}

export function PlanSection({ coachClientId, refreshKey = 0, onChanged }: {
  coachClientId: string | null
  refreshKey?: number
  onChanged?: () => void
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [confirm, setConfirm] = useState<{ text: string; body: Record<string, unknown> } | null>(null)

  const load = useCallback(async () => {
    if (!coachClientId) return
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/plan`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't load the plan"); return }
      setPlan(j as Plan)
      setError(null)
    } catch {
      setError("Couldn't load the plan")
    }
  }, [coachClientId])

  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => {
    if (!coachClientId) return
    void (async () => {
      try {
        const res = await authFetch(`/api/coach/tasks/assignees?coach_client_id=${encodeURIComponent(coachClientId)}`)
        const j = await res.json().catch(() => ({}))
        if (res.ok && j?.ok) setAssignees(j.assignees as Assignee[])
      } catch { /* the assignee picker just shows the current one */ }
    })()
  }, [coachClientId])

  async function send(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/plan`, { method: "POST", body: JSON.stringify(body) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't save that"); return false }
      setPlan(j as Plan)
      onChanged?.()
      return true
    } catch {
      setError("Couldn't save that")
      return false
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  // Deliverables under each phase, in the coach's phase order; then any with no phase.
  const groups = useMemo(() => {
    if (!plan) return []
    const out = plan.phases.map((p) => ({ key: p.phase_id, phase: p as ClientPhase | null, label: p.label, items: plan.deliverables.filter((d) => d.phase_id === p.phase_id) }))
    const known = new Set(plan.phases.map((p) => p.phase_id))
    const loose = plan.deliverables.filter((d) => !d.phase_id || !known.has(d.phase_id))
    if (loose.length) out.push({ key: "none", phase: null, label: "No phase", items: loose })
    return out.filter((g) => g.items.length > 0)
  }, [plan])

  // Open by default: every phase In progress, or else the first one Not started.
  const current = useMemo(() => {
    const ip = groups.filter((g) => g.phase?.status === "in_progress").map((g) => g.key)
    if (ip.length) return new Set(ip)
    const first = groups.find((g) => g.phase?.status === "not_started")
    return new Set(first ? [first.key] : groups.slice(0, 1).map((g) => g.key))
  }, [groups])
  const isOpen = (key: string) => open[key] ?? current.has(key)

  if (!coachClientId) return null
  return (
    <section style={{ ...card, padding: 22, marginBottom: 24 }} aria-label="Plan">
      <div style={{ ...eyebrow, color: NAVY, fontSize: TYPE.label, marginBottom: 6 }}>PLAN</div>
      <p style={{ fontSize: 12, color: NAVY, opacity: 0.8, margin: "0 0 14px" }}>
        The deliverables and tasks in this client&apos;s approved packages. Changes here are for this client only.
      </p>
      {error && <div role="alert" style={{ fontSize: 12, color: "#B42318", marginBottom: 10 }}>{error}</div>}
      {!plan ? (
        !error && <p style={{ fontSize: 13, color: NAVY, margin: 0 }}>Loading the plan…</p>
      ) : groups.length === 0 ? (
        <p style={{ fontSize: 13, color: NAVY, margin: 0 }}>No approved package yet. Approve a package in Engagements and its tasks appear here.</p>
      ) : (
        groups.map((g) => {
          const tasks = g.items.flatMap((d) => (d.not_needed ? [] : d.tasks)).filter((t) => t.state !== "not_needed")
          const done = tasks.filter((t) => t.state === "done" || t.state === "skipped").length
          const expanded = isOpen(g.key)
          return (
            <div key={g.key} style={{ border: "1px solid rgba(8,32,63,0.15)", borderRadius: 12, marginBottom: 10, background: "#fff" }}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${g.label} phase${g.phase ? `, ${PHASE_STATUS_LABEL[g.phase.status]}` : ""}, ${done} / ${tasks.length} tasks`}
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !expanded }))}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
              >
                <span aria-hidden style={{ color: NAVY, fontSize: 11 }}>{expanded ? "▼" : "▶"}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>{g.label}</span>
                {g.phase && <span style={{ fontSize: 12, color: NAVY, opacity: 0.8 }}>{PHASE_STATUS_LABEL[g.phase.status]}</span>}
                <span style={{ marginLeft: "auto", fontSize: 12, color: NAVY }}>{done} / {tasks.length} tasks</span>
              </button>
              {expanded && (
                <div style={{ padding: "0 14px 14px" }}>
                  {g.items.map((d) => (
                    <DeliverableBlock
                      key={d.id} d={d} assignees={assignees} busy={busy}
                      onSend={send} onConfirm={(text, body) => setConfirm({ text, body })}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
      {plan && plan.packages.length > 0 && <AddDeliverable plan={plan} busy={busy} onSend={send} />}

      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(8,32,63,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div role="dialog" aria-label="Confirm" onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 20, maxWidth: 420, width: "100%" }}>
            <p style={{ fontSize: 13, color: NAVY, margin: "0 0 16px" }}>{confirm.text}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={small} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" disabled={busy} onClick={() => void send(confirm.body)} style={{ ...small, background: NAVY, color: "#FEB06A", border: "none" }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function DeliverableBlock({ d, assignees, busy, onSend, onConfirm }: {
  d: PlanDeliverable
  assignees: Assignee[]
  busy: boolean
  onSend: (body: Record<string, unknown>) => Promise<boolean>
  onConfirm: (text: string, body: Record<string, unknown>) => void
}) {
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState<TaskType>("coach")
  const move = (i: number, dir: -1 | 1) => {
    const ids = d.tasks.map((t) => t.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void onSend({ action: "reorder", deliverable_id: d.id, task_ids: ids })
  }
  return (
    <div data-testid="deliverable" style={{ borderTop: "1px solid rgba(8,32,63,0.1)", paddingTop: 10, marginTop: 10, opacity: d.not_needed ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>{d.name}</span>
        <span style={{ fontSize: 11, color: NAVY, opacity: 0.7 }}>{d.engagement_name}</span>
        {d.not_needed && <span style={{ fontSize: 11, fontWeight: 800, color: "#6B7480" }}>Not needed</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" style={small} disabled={busy}
            onClick={() => void onSend({ action: d.not_needed ? "deliverable_restore" : "deliverable_not_needed", deliverable_id: d.id })}>
            {d.not_needed ? "Restore" : "Not needed"}
          </button>
          <button type="button" style={small} disabled={busy}
            onClick={() => onConfirm(`Remove "${d.name}" and its tasks from this client's plan? The library is not changed.`, { action: "remove_deliverable", deliverable_id: d.id })}>
            Remove
          </button>
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {d.tasks.map((t, i) => (
          <TaskRow key={t.id} t={t} first={i === 0} last={i === d.tasks.length - 1} locked={d.not_needed}
            assignees={assignees} busy={busy} onSend={onSend} onMove={(dir) => move(i, dir)}
            onRemove={() => onConfirm(`Remove "${t.name}" from this client's plan?`, { action: "remove_task", task_id: t.id })} />
        ))}
      </div>
      {!d.not_needed && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input aria-label={`New task in ${d.name}`} placeholder="Add a one-off task…" value={newName}
            onChange={(e) => setNewName(e.target.value)} style={{ ...fieldStyle, flex: 1 }} />
          <select aria-label="Task type" value={newType} onChange={(e) => setNewType(e.target.value as TaskType)} style={fieldStyle}>
            <option value="coach">Coach</option>
            <option value="client">Client</option>
          </select>
          <button type="button" style={small} disabled={busy || !newName.trim()}
            onClick={async () => { if (await onSend({ action: "add_task", deliverable_id: d.id, name: newName, type: newType })) setNewName("") }}>
            + Add task
          </button>
        </div>
      )}
    </div>
  )
}

function TaskRow({ t, first, last, locked, assignees, busy, onSend, onMove, onRemove }: {
  t: PlanTask
  first: boolean
  last: boolean
  locked: boolean
  assignees: Assignee[]
  busy: boolean
  onSend: (body: Record<string, unknown>) => Promise<boolean>
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const greyed = locked || t.state === "not_needed"
  const options = assignees.some((a) => a.id === t.assignee_profile_id) || !t.assignee_profile_id
    ? assignees : [...assignees, { id: t.assignee_profile_id, name: "Current assignee", email: null }]
  return (
    <div data-testid="task" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 8px", borderRadius: 8, background: "#F8FAFC", opacity: greyed ? 0.6 : 1 }}>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <button type="button" aria-label={`Move ${t.name} up`} disabled={busy || first} onClick={() => onMove(-1)}
          style={{ background: "none", border: "none", fontSize: 9, cursor: "pointer", color: NAVY, padding: 0 }}>▲</button>
        <button type="button" aria-label={`Move ${t.name} down`} disabled={busy || last} onClick={() => onMove(1)}
          style={{ background: "none", border: "none", fontSize: 9, cursor: "pointer", color: NAVY, padding: 0 }}>▼</button>
      </span>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase", color: NAVY, border: `1px solid ${NAVY}`, borderRadius: 5, padding: "1px 5px" }}>
        {TASK_TYPE_LABEL[t.owner]}
      </span>
      <span style={{ fontSize: 13, color: NAVY, fontWeight: 600, flex: "1 1 160px" }}>{taskTitle(t)}</span>
      <span data-testid="task-state" style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "2px 9px", ...STATE_STYLE[t.state] }}>
        {TASK_STATE_LABEL[t.state]}
      </span>
      <select aria-label={`Assignee for ${t.name}`} value={t.assignee_profile_id ?? ""} disabled={busy || locked}
        onChange={(e) => void onSend({ action: "assign", task_id: t.id, assignee: e.target.value || null })} style={fieldStyle}>
        <option value="">Unassigned</option>
        {options.map((a) => <option key={a.id} value={a.id}>{a.name || a.email || "Coach"}</option>)}
      </select>
      <input type="date" aria-label={`Due date for ${t.name}`} value={t.due_date ?? ""} disabled={busy || locked}
        onChange={(e) => void onSend({ action: "due", task_id: t.id, due_date: e.target.value || null })}
        style={{ ...fieldStyle, colorScheme: "light" }} />
      {!locked && (
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {actionsFor(t).map((a) => (
            <Fragment key={a}>
              <button type="button" style={small} disabled={busy}
                onClick={() => void onSend({ action: a, task_id: t.id })}>{ACTION_LABEL[a]}</button>
            </Fragment>
          ))}
          <button type="button" style={small} disabled={busy} aria-label={`Remove ${t.name}`} onClick={onRemove}>✕</button>
        </span>
      )}
    </div>
  )
}

function AddDeliverable({ plan, busy, onSend }: { plan: Plan; busy: boolean; onSend: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [pkg, setPkg] = useState(plan.packages[0]?.id ?? "")
  const [lib, setLib] = useState("")
  const phaseLabel = (id: string | null) => plan.phases.find((p) => p.phase_id === id)?.label ?? "No phase"
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: NAVY }}>Add a deliverable from your library</span>
      <select aria-label="Deliverable to add" value={lib} onChange={(e) => setLib(e.target.value)} style={fieldStyle}>
        <option value="">Choose…</option>
        {plan.library.map((m) => <option key={m.id} value={m.id}>{m.name} ({phaseLabel(m.phase_id)})</option>)}
      </select>
      {plan.packages.length > 1 && (
        <select aria-label="Into package" value={pkg} onChange={(e) => setPkg(e.target.value)} style={fieldStyle}>
          {plan.packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      <button type="button" style={small} disabled={busy || !lib || !pkg}
        onClick={async () => { if (await onSend({ action: "add_deliverable", engagement_id: pkg, milestone_id: lib })) setLib("") }}>
        + Add deliverable
      </button>
    </div>
  )
}
