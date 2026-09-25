"use client"

// The dashboard card: my overdue tasks and what is due this week, capped at
// five, with a "View all" link to the full list.
//
// It asks the server for ?card=1 rather than fetching everything and slicing
// here, so that the cap, the ordering and the definition of "overdue" all come
// from lib/tasks/model.ts. Three surfaces show this data and they have to
// agree; the moment the card does its own arithmetic, it starts disagreeing
// with the digest email.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { T } from "../../../../lib/dashboard-theme"
import { isOverdue, type Task } from "../../../../lib/tasks/model"
import { apiJson, formatDue } from "./taskClient"

export function TaskCard() {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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

  async function complete(id: string) {
    setBusy(id)
    // Optimistic: the row goes immediately, because the coach has already
    // decided. Put back on failure rather than leaving them wondering.
    const before = tasks
    setTasks((ts) => (ts ?? []).filter((t) => t.id !== id))
    setTotal((n) => Math.max(0, n - 1))
    try {
      await apiJson(`/api/coach/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      })
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
    // the panel and owns the title and its "View all" link. A second border
    // here would render a box inside a box.
    <div>
      {error && (
        <p style={{ color: T.ERROR, fontSize: 13, margin: "10px 0 0 0" }}>{error}</p>
      )}

      {tasks.length === 0 && !error && (
        // Said plainly rather than with an empty box. Nothing overdue is good
        // news and should read like it.
        <p style={{ color: T.MUTED, fontSize: 13, margin: "10px 0 0 0" }}>
          Nothing overdue, and nothing due this week.
        </p>
      )}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {tasks.map((t) => {
          const late = isOverdue(t)
          return (
            <div
              key={t.id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "10px 12px", borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                borderLeft: `3px solid ${late ? T.ERROR : "transparent"}`,
              }}
            >
              <input
                type="checkbox"
                checked={false}
                disabled={busy === t.id}
                onChange={() => void complete(t.id)}
                aria-label={`Mark "${t.title}" done`}
                style={{ marginTop: 3, cursor: "pointer" }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, color: T.TEXT, wordBreak: "break-word" }}>{t.title}</div>
                <div style={{ fontSize: 12, color: late ? T.ERROR : T.MUTED, marginTop: 2 }}>
                  {late ? "Overdue: " : ""}{formatDue(t)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {total > tasks.length && (
        <button
          onClick={() => router.push("/dashboard/coach/tasks")}
          style={{
            background: "none", border: "none", padding: "10px 0 0 0", cursor: "pointer",
            color: T.WRN_ORANGE, fontSize: 13, fontWeight: 600,
          }}
        >
          + {total - tasks.length} more
        </button>
      )}
    </div>
  )
}
