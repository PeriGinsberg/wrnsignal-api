"use client"

import { useEffect, useState } from "react"
import { SPACE, TYPE } from "../../../../../../lib/theme/surfaces"
import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"
import { LegacyTaskLine, NoteTopicChip, type NoteTaskSummary, type NoteTopic } from "../../../_notes/noteUi"

type NoteType = "session_recap" | "action_item" | "other"
type Priority = "urgent" | "this_week" | "when_ready"

type Note = {
  id: string
  type: NoteType
  topic?: NoteTopic | null
  body: string
  priority: Priority | null
  completed_at: string | null
  created_at: string
  updated_at: string
  /** An old action item's task. Its tick lives on the task, not here. */
  task?: NoteTaskSummary | null
}

const TYPE_LABEL: Record<NoteType, string> = {
  session_recap: "Session Recap",
  action_item: "Action Item",
  other: "Other",
}

const TYPE_BADGE: Record<NoteType, { bg: string; color: string }> = {
  session_recap: { bg: "rgba(81,173,229,0.12)", color: T.INK_LINK },
  action_item: { bg: "rgba(254,176,106,0.12)", color: T.INK_EMPHASIS },
  other: { bg: T.BORDER_SOFT, color: T.MUTED },
}

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  this_week: "This Week",
  when_ready: "When Ready",
}

const PRIORITY_BADGE: Record<Priority, { bg: string; color: string }> = {
  urgent: { bg: "rgba(248,113,113,0.15)", color: T.ERROR },
  this_week: { bg: "rgba(254,176,106,0.15)", color: T.INK_EMPHASIS },
  when_ready: { bg: "rgba(81,173,229,0.12)", color: T.INK_LINK },
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

  return (
    <section style={{ ...card, padding: 22, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ ...eyebrow, color: T.INK_LINK, fontSize: TYPE.label }}>RECENT NOTES</div>
        {notes.length > 0 && (
          <button
            onClick={onNavigateToNotesTab}
            style={{
              background: "none",
              border: "none",
              color: T.INK_LINK,
              fontSize: TYPE.micro,
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
          <span style={{ fontSize: TYPE.secondary, color: T.ERROR }}>Couldn&apos;t load: {error}</span>
        </div>
      )}

      {loading && notes.length === 0 ? (
        <p style={{ color: T.DIM, fontSize: TYPE.secondary }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: TYPE.secondary, fontStyle: "italic" }}>No notes yet</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notes.map((n) => {
            const isActionItem = n.type === "action_item"
            const isComplete = isActionItem && (n.task ? n.task.status !== "open" : !!n.completed_at)
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
                  background: T.GLASS,
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
                      fontSize: TYPE.micro,
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
                        fontSize: TYPE.micro,
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
                  <NoteTopicChip topic={n.topic} />
                  {isActionItem && <LegacyTaskLine task={n.task} />}
                  <span style={{ fontSize: TYPE.micro, color: T.DIM, marginLeft: "auto" }}>
                    {created}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: TYPE.secondary,
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
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
