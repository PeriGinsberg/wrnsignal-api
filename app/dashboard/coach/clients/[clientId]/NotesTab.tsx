"use client"

import { useEffect, useState } from "react"
import {
  T,
  textarea,
  card,
  eyebrow,
  label,
  btnPrimary,
  btnSecondary,
} from "../../../../../lib/dashboard-theme"
import { SavingSpinner } from "../../SavingSpinner"

export type NoteType = "session_recap" | "action_item" | "other"
export type NotePriority = "urgent" | "this_week" | "when_ready"

export type NoteRow = {
  id: string
  type: NoteType
  body: string
  priority: NotePriority | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

const TYPE_LABEL: Record<NoteType, string> = {
  session_recap: "Session Recap",
  action_item: "Action Item",
  other: "Other",
}

const TYPE_BADGE_STYLE: Record<NoteType, { bg: string; color: string }> = {
  session_recap: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
  action_item: { bg: "rgba(254,176,106,0.12)", color: "#FEB06A" },
  other: { bg: "rgba(255,255,255,0.07)", color: T.MUTED },
}

const PRIORITY_LABEL: Record<NotePriority, string> = {
  urgent: "Urgent",
  this_week: "This Week",
  when_ready: "When Ready",
}

const PRIORITY_BADGE_STYLE: Record<NotePriority, { bg: string; color: string }> = {
  urgent: { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
  this_week: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  when_ready: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
}

const DEFAULT_ACTION_ITEM_PRIORITY: NotePriority = "this_week"

const FILTER_OPTIONS: { value: "" | NoteType; label: string }[] = [
  { value: "", label: "All" },
  { value: "session_recap", label: "Session Recap" },
  { value: "action_item", label: "Action Item" },
  { value: "other", label: "Other" },
]

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  clientId: string
  clientName: string | null
  // Bumped by the parent when a note is added externally (e.g., from the
  // global Add Note panel) so the tab refetches.
  refreshKey: number
}

export function NotesTab({ authFetch, clientId, clientName, refreshKey }: Props) {
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [filter, setFilter] = useState<"" | NoteType>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState("")
  const [editType, setEditType] = useState<NoteType>("session_recap")
  const [editPriority, setEditPriority] = useState<NotePriority>(DEFAULT_ACTION_ITEM_PRIORITY)
  const [savingEdit, setSavingEdit] = useState(false)
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const url = filter
      ? `/api/coach/clients/${clientId}/note-feed?type=${encodeURIComponent(filter)}`
      : `/api/coach/clients/${clientId}/note-feed`
    try {
      const res = await authFetch(url)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Failed to load notes")
        setNotes([])
      } else {
        setNotes(j.notes || [])
      }
    } catch {
      setError("Network error loading notes")
      setNotes([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, filter, refreshKey])

  function startEdit(n: NoteRow) {
    setEditingId(n.id)
    setEditBody(n.body)
    setEditType(n.type)
    setEditPriority(n.priority ?? DEFAULT_ACTION_ITEM_PRIORITY)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBody("")
    setEditType("session_recap")
    setEditPriority(DEFAULT_ACTION_ITEM_PRIORITY)
  }

  async function saveEdit(noteId: string) {
    const trimmed = editBody.trim()
    if (!trimmed) return
    setSavingEdit(true)
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/note-feed/${noteId}`, {
        method: "PUT",
        body: JSON.stringify({
          body: trimmed,
          type: editType,
          priority: editType === "action_item" ? editPriority : null,
        }),
        headers: { "Content-Type": "application/json" },
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Failed to save note")
      } else {
        setEditingId(null)
        await load()
      }
    } catch {
      setError("Network error saving note")
    }
    setSavingEdit(false)
  }

  async function toggleCompletion(n: NoteRow) {
    if (n.type !== "action_item") return
    setBusyNoteId(n.id)
    const next = n.completed_at ? null : new Date().toISOString()
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/note-feed/${n.id}`, {
        method: "PUT",
        body: JSON.stringify({ completed_at: next }),
        headers: { "Content-Type": "application/json" },
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Failed to update completion")
      } else {
        await load()
      }
    } catch {
      setError("Network error")
    }
    setBusyNoteId(null)
  }

  async function deleteNote(noteId: string) {
    if (!confirm("Delete this note?")) return
    setBusyNoteId(noteId)
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/note-feed/${noteId}`, {
        method: "DELETE",
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Failed to delete note")
      } else {
        await load()
      }
    } catch {
      setError("Network error deleting note")
    }
    setBusyNoteId(null)
  }

  const titleSuffix = clientName ? ` for ${clientName.toUpperCase()}` : ""

  return (
    <div>
      <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>
        NOTES{titleSuffix}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.value || "all"}
            onClick={() => setFilter(f.value)}
            style={{
              fontSize: 11,
              fontWeight: 900,
              padding: "6px 14px",
              borderRadius: 8,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              border: filter === f.value ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
              background: filter === f.value ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
              color: filter === f.value ? T.WRN_ORANGE : T.DIM,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: 12, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10 }}>
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{error}</span>
        </div>
      )}

      {loading ? (
        <p style={{ color: T.MUTED, fontSize: 13 }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13 }}>
          {filter ? `No ${TYPE_LABEL[filter as NoteType].toLowerCase()} notes` : "No notes yet"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {notes.map((n) => {
            const isEditing = editingId === n.id
            const isActionItem = n.type === "action_item"
            const isCompleted = !!n.completed_at
            const typeBadge = TYPE_BADGE_STYLE[n.type]
            const priorityBadge = n.priority ? PRIORITY_BADGE_STYLE[n.priority] : null

            const created = n.created_at ? new Date(n.created_at) : null
            const createdLabel = created
              ? created.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: created.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
                  hour: "numeric",
                  minute: "2-digit",
                })
              : null
            const wasEdited = n.updated_at && n.created_at && n.updated_at !== n.created_at

            return (
              <div
                key={n.id}
                style={{
                  ...card,
                  padding: 18,
                  opacity: isCompleted ? 0.6 : 1,
                }}
              >
                {/* Header row: badge, completion checkbox, date, edit/delete */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {isActionItem && (
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      disabled={busyNoteId === n.id}
                      onChange={() => toggleCompletion(n)}
                      style={{ accentColor: T.WRN_ORANGE, width: 16, height: 16, cursor: "pointer" }}
                      aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
                    />
                  )}
                  <span
                    style={{
                      background: typeBadge.bg,
                      color: typeBadge.color,
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      padding: "3px 10px",
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
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      {PRIORITY_LABEL[n.priority]}
                    </span>
                  )}
                  {isCompleted && (
                    <span style={{ fontSize: 11, color: T.SUCCESS, fontWeight: 700 }}>
                      ✓ Completed {new Date(n.completed_at!).toLocaleDateString()}
                    </span>
                  )}
                  {createdLabel && (
                    <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>
                      {createdLabel}
                      {wasEdited ? " · edited" : ""}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                      {[
                        { value: "session_recap" as const, label: "Session Recap" },
                        { value: "action_item" as const, label: "Action Item" },
                        { value: "other" as const, label: "Other" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setEditType(opt.value)}
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            padding: "4px 10px",
                            borderRadius: 6,
                            cursor: "pointer",
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            border: editType === opt.value ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
                            background: editType === opt.value ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
                            color: editType === opt.value ? T.WRN_ORANGE : T.DIM,
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {editType === "action_item" && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                        {[
                          { value: "urgent" as const, label: "Urgent", color: "#f87171", border: "rgba(248,113,113,0.4)", bg: "rgba(248,113,113,0.1)" },
                          { value: "this_week" as const, label: "This Week", color: T.WRN_ORANGE, border: "rgba(254,176,106,0.4)", bg: "rgba(254,176,106,0.1)" },
                          { value: "when_ready" as const, label: "When Ready", color: T.WRN_BLUE, border: "rgba(81,173,229,0.4)", bg: "rgba(81,173,229,0.1)" },
                        ].map((opt) => {
                          const active = editPriority === opt.value
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setEditPriority(opt.value)}
                              style={{
                                fontSize: 10,
                                fontWeight: 900,
                                padding: "4px 10px",
                                borderRadius: 6,
                                cursor: "pointer",
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                border: active ? `1px solid ${opt.border}` : `1px solid ${T.BORDER_SOFT}`,
                                background: active ? opt.bg : "rgba(255,255,255,0.04)",
                                color: active ? opt.color : T.DIM,
                              }}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    <textarea
                      style={{ ...textarea, minHeight: 100, fontSize: 13 }}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        onClick={() => saveEdit(n.id)}
                        disabled={savingEdit || editBody.trim().length === 0}
                        style={{
                          ...btnPrimary,
                          fontSize: 11,
                          padding: "6px 14px",
                          opacity: savingEdit || editBody.trim().length === 0 ? 0.5 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {savingEdit && <SavingSpinner size={10} />}
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: T.TEXT,
                        lineHeight: "20px",
                        whiteSpace: "pre-wrap",
                        margin: 0,
                        textDecoration: isCompleted ? "line-through" : "none",
                      }}
                    >
                      {n.body}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => startEdit(n)}
                        style={{
                          background: "none",
                          border: `1px solid ${T.BORDER_SOFT}`,
                          color: T.MUTED,
                          fontSize: 11,
                          fontWeight: 900,
                          borderRadius: 6,
                          padding: "4px 12px",
                          cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteNote(n.id)}
                        disabled={busyNoteId === n.id}
                        style={{
                          background: "none",
                          border: `1px solid ${T.BORDER_SOFT}`,
                          color: T.DIM,
                          fontSize: 11,
                          fontWeight: 900,
                          borderRadius: 6,
                          padding: "4px 12px",
                          cursor: "pointer",
                          opacity: busyNoteId === n.id ? 0.5 : 1,
                        }}
                      >
                        {busyNoteId === n.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
