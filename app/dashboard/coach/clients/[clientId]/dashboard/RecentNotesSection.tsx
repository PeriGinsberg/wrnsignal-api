"use client"

import { useEffect, useState } from "react"
import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"

type NoteType = "session_recap" | "action_item" | "other"
type Priority = "urgent" | "this_week" | "when_ready"

type Note = {
  id: string
  type: NoteType
  body: string
  priority: Priority | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

const TYPE_LABEL: Record<NoteType, string> = {
  session_recap: "Session Recap",
  action_item: "Action Item",
  other: "Other",
}

const TYPE_BADGE: Record<NoteType, { bg: string; color: string }> = {
  session_recap: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
  action_item: { bg: "rgba(254,176,106,0.12)", color: "#FEB06A" },
  other: { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)" },
}

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  this_week: "This Week",
  when_ready: "When Ready",
}

const PRIORITY_BADGE: Record<Priority, { bg: string; color: string }> = {
  urgent: { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
  this_week: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  when_ready: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
}

const RECENT_LIMIT = 3

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  clientId: string
  refreshKey: number
  onNavigateToNotesTab: () => void
}

export function RecentNotesSection({ authFetch, clientId, refreshKey, onNavigateToNotesTab }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      // The /note-feed GET doesn't support limit; slice to 3 client-side.
      // Pilot scale (a coach has tens of notes per client max) makes this
      // negligible cost; revisit if a coach hits hundreds.
      const res = await authFetch(`/api/coach/clients/${clientId}/note-feed`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Couldn't load")
        setNotes([])
      } else {
        setNotes((j.notes || []).slice(0, RECENT_LIMIT))
      }
    } catch {
      setError("Network error")
      setNotes([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, refreshKey])

  async function toggleCompletion(note: Note) {
    if (note.type !== "action_item") return
    setBusyId(note.id)
    const next = note.completed_at ? null : new Date().toISOString()
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/note-feed/${note.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at: next }),
      })
      const j = await res.json().catch(() => null)
      if (res.ok && j?.ok) {
        setNotes((prev) =>
          prev.map((n) => (n.id === note.id ? { ...n, completed_at: next } : n))
        )
      } else {
        setError(j?.error || "Couldn't update")
      }
    } catch {
      setError("Network error")
    }
    setBusyId(null)
  }

  return (
    <section style={{ ...card, padding: 22, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ ...eyebrow, color: T.WRN_BLUE, fontSize: 10 }}>RECENT NOTES</div>
        {notes.length > 0 && (
          <button
            onClick={onNavigateToNotesTab}
            style={{
              background: "none",
              border: "none",
              color: T.WRN_BLUE,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
            }}
          >
            See all in Notes tab →
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#f87171" }}>Couldn&apos;t load: {error}</span>
        </div>
      )}

      {loading && notes.length === 0 ? (
        <p style={{ color: T.DIM, fontSize: 13 }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, fontStyle: "italic" }}>No notes yet</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notes.map((n) => {
            const isActionItem = n.type === "action_item"
            const isComplete = !!n.completed_at
            const typeBadge = TYPE_BADGE[n.type]
            const priorityBadge = n.priority ? PRIORITY_BADGE[n.priority] : null
            const created = new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })

            return (
              <button
                key={n.id}
                onClick={onNavigateToNotesTab}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.025)",
                  border: `1px solid ${T.BORDER_SOFT}`,
                  textAlign: "left",
                  cursor: "pointer",
                  opacity: isComplete ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      background: typeBadge.bg,
                      color: typeBadge.color,
                      fontSize: 9,
                      fontWeight: 900,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: 999,
                    }}
                  >
                    {TYPE_LABEL[n.type]}
                  </span>
                  {isActionItem && priorityBadge && n.priority && (
                    <span
                      style={{
                        background: priorityBadge.bg,
                        color: priorityBadge.color,
                        fontSize: 9,
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {PRIORITY_LABEL[n.priority]}
                    </span>
                  )}
                  {isComplete && (
                    <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 700 }}>
                      ✓ Complete
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>
                    {created}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: T.TEXT,
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textDecoration: isComplete ? "line-through" : "none",
                  }}
                >
                  {n.body}
                </div>
                {isActionItem && (
                  <label
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: T.MUTED,
                      cursor: "pointer",
                      width: "fit-content",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isComplete}
                      disabled={busyId === n.id}
                      onChange={(e) => {
                        e.stopPropagation()
                        toggleCompletion(n)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: T.WRN_ORANGE, width: 14, height: 14, cursor: "pointer" }}
                    />
                    {isComplete ? "Mark incomplete" : "Mark complete"}
                  </label>
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
