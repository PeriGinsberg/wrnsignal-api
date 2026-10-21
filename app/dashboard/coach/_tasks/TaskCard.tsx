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
// Rows are CompactRow, one line each, to match the compact Schedule (redesign
// 2026-10-13). The full Tasks page keeps TaskRow.

import { useCallback, useEffect, useState } from "react"
import { isWelcomeTodo } from "../../../../lib/welcome/model"
import { WelcomeEmailDialog } from "../_plan/WelcomeEmailDialog"
import { useRouter } from "next/navigation"
import { T } from "../../../../lib/dashboard-theme"
import { endOfDay, isDueToday, isOverdue, type Task } from "../../../../lib/tasks/model"
import { CompactRow, CompactRowStyles, type CompactTone } from "./CompactRow"
import { apiJson, formatDue } from "./taskClient"


// Coach Home's due-window filter. A window is overdue work plus what is due by
// the end of its last day, today counted as day one (the same rolling count
// isDueThisWeek uses for seven). Undated tasks show only under All. There is
// no row cap: with one, a coach with ten overdue tasks saw the same ten rows
// in every window.
export type DueWindow = "7" | "14" | "30" | "all"
const DUE_WINDOWS: { key: DueWindow; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "14", label: "14 days" },
  { key: "30", label: "30 days" },
  { key: "all", label: "All" },
]
const WINDOW_KEY = "signal_coach_tasks_window"

function inWindow(t: Task, w: DueWindow, now: Date): boolean {
  if (w === "all") return true
  if (!t.due_at) return false
  const due = new Date(t.due_at)
  if (Number.isNaN(due.getTime())) return false
  const horizon = endOfDay(new Date(now.getTime() + (Number(w) - 1) * 24 * 60 * 60 * 1000))
  return due <= horizon
}

/**
 * The window, remembered per browser. Lives with the page rather than the card
 * because the filter sits in the section header, outside the card.
 */
export function useDueWindow(): [DueWindow, (w: DueWindow) => void] {
  // Read once on first render. Coach Home shows its loading shell until its
  // data arrives, so the server render never depends on this value.
  const [w, setW] = useState<DueWindow>(() => {
    try {
      const saved = localStorage.getItem(WINDOW_KEY)
      if (saved === "7" || saved === "14" || saved === "30") return saved
    } catch { /* stays All */ }
    return "all"
  })
  function change(next: DueWindow) {
    setW(next)
    try { localStorage.setItem(WINDOW_KEY, next) } catch { /* not remembered */ }
  }
  return [w, change]
}

export function DueWindowFilter({ value, onChange }: { value: DueWindow; onChange: (w: DueWindow) => void }) {
  return (
    <div
      role="group"
      aria-label="Due within"
      style={{
        display: "inline-flex", flexWrap: "wrap", padding: 3, borderRadius: 999,
        background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`,
      }}
    >
      {DUE_WINDOWS.map((o) => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            style={{
              border: "none", borderRadius: 999, padding: "5px 12px",
              fontSize: 12, fontWeight: 800, letterSpacing: 0.2, fontFamily: "inherit",
              cursor: on ? "default" : "pointer",
              background: on ? T.WRN_ORANGE : "transparent",
              color: on ? "var(--sig-ink-on-bright, #04060F)" : T.MUTED,
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * `order="due"` is Coach Home's "My active tasks": every open task assigned to
 * me (plan tasks included), by due date, within the picked window. The default is the
 * capped card the server builds with ?card=1. `dueWindow` comes from the page
 * (useDueWindow), whose section header shows the filter.
 */
export function TaskCard({ order = "card", dueWindow = "all" }: { order?: "card" | "due"; dueWindow?: DueWindow } = {}) {
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
      if (order === "due") {
        // The list API already returns my open tasks by due date, undated last.
        // Every open task comes back; the due window is applied at render.
        const j = await apiJson<{ tasks: Task[]; total: number }>("/api/coach/tasks")
        setTasks(j.tasks)
        setTotal(j.total)
      } else {
        const j = await apiJson<{ tasks: Task[]; total: number }>("/api/coach/tasks?card=1")
        setTasks(j.tasks)
        setTotal(j.total)
      }
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setTasks([])
    }
  }, [order])

  useEffect(() => { void load() }, [load])

  useEffect(() => { void loadClients() }, [loadClients])

  const [welcome, setWelcome] = useState<Task | null>(null)

  async function toggleDone(task: Task, next: boolean) {
    // Ticking the welcome task's To-Do opens the welcome email instead.
    if (next && isWelcomeTodo(task)) { setWelcome(task); return }
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

  const now = new Date()
  const shown = order === "due"
    ? tasks.filter((t) => inWindow(t, dueWindow, now))
    : tasks

  return (
    // No card chrome of its own: this is mounted inside <Section>, which draws
    // the panel and owns the title and its "View all" link.
    <div>
      <CompactRowStyles />
      {welcome && (
        <WelcomeEmailDialog coachClientId={welcome.coach_client_id!} taskId={welcome.plan_activity_id!}
          onClose={() => setWelcome(null)} onDone={() => { setWelcome(null); void load() }} />
      )}

      {error && <p style={{ color: T.ERROR, fontSize: 13, margin: "10px 0 0 0" }}>{error}</p>}

      {shown.length === 0 && !error && (
        // Now that the card shows every open task and not just the dated ones,
        // empty means empty. Saying "nothing overdue" here would have been
        // true and useless.
        <p style={{ color: T.MUTED, fontSize: 13, margin: "10px 0 0 0" }}>
          {order === "due" && dueWindow !== "all"
            ? `No open tasks due in the next ${dueWindow} days.`
            : "No open tasks."}
        </p>
      )}

      {shown.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {shown.map((t) => {
            const who = clients.find((c) => c.id === t.client_profile_id)?.name ?? t.record?.name ?? null
            const late = isOverdue(t, now)
            const tone: CompactTone = late ? "late" : isDueToday(t, now) ? "today" : "plain"
            const snippet = (t.description ?? "").split(/\r?\n/).find((l) => l.trim()) ?? null
            // Where the work is done, else the client.
            const href = t.link
              ?? (t.client_profile_id ? `/dashboard/coach/clients/${t.client_profile_id}` : t.record?.href ?? null)
            return (
              <CompactRow
                key={t.id}
                testId="task-row"
                title={t.title}
                detail={snippet}
                fullDetail={t.description}
                who={who}
                whoExtra={t.record?.kind === "prospect" ? (
                  <span style={{ fontSize: 10, fontWeight: 800, color: "var(--sig-avatar-2-ink, #7C5CFF)" }}>Prospect</span>
                ) : null}
                meta={late ? "Overdue" : t.due_at ? formatDue(t) : ""}
                tone={tone}
                href={href}
                checkbox={
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={busy === t.id}
                    onChange={(e) => toggleDone(t, e.target.checked)}
                    aria-label={`Mark "${t.title}" done`}
                    title="Mark done"
                    style={{ cursor: "pointer", accentColor: T.TASK_DONE, width: 16, height: 16, margin: 0 }}
                  />
                }
              />
            )
          })}
        </div>
      )}

      {/* ALWAYS SHOWN, even when everything fits. The link is the way to the
          full list, not just an overflow indicator, and a coach with four tasks
          still needs a route to filters and search. */}
      <button
        onClick={() => router.push("/dashboard/coach/tasks")}
        style={{
          background: "none", border: "none", padding: "8px 8px 0", cursor: "pointer",
          color: T.TASK_HEADER, fontSize: 13, fontWeight: 600,
        }}
      >
        View all tasks ({total})
      </button>
    </div>
  )
}
