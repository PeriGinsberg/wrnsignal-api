"use client"

import { useEffect, useState } from "react"
import { SPACE, TYPE } from "../../../../../lib/theme/surfaces"
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
import {
  LegacyTaskLine,
  NOTE_TYPE_BADGE,
  NOTE_TYPE_LABEL,
  NoteTopicChip,
  NoteTopicSelect,
  NoteTypeChips,
  useScrollToNoteHash,
  type NoteTaskSummary,
  type NoteTopic,
  type StoredNoteType,
} from "../../_notes/noteUi"

export type NoteType = StoredNoteType
export type NotePriority = "urgent" | "this_week" | "when_ready"

export type NoteRow = {
  id: string
  type: NoteType
  topic?: NoteTopic | null
  body: string
  priority: NotePriority | null
  completed_at: string | null
  created_at: string
  updated_at: string
  /** An old action item's task (lib/notes/actionItems.ts). Null when it has none. */
  task?: NoteTaskSummary | null
}

// Old action items show under All; the type is not offered as a filter.
const FILTER_OPTIONS: { value: "" | NoteType; label: string }[] = [
  { value: "", label: "All" },
  { value: "session_recap", label: "Session Recap" },
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
  const [editTopic, setEditTopic] = useState<NoteTopic | "">("")
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

  // A task's Go button lands on #note-<id>; scroll there once the list exists.
  useScrollToNoteHash(!loading && notes.length > 0)

  function startEdit(n: NoteRow) {
    setEditingId(n.id)
    setEditBody(n.body)
    setEditType(n.type)
    setEditTopic(n.topic ?? "")
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBody("")
    setEditType("session_recap")
    setEditTopic("")
  }

  async function saveEdit(noteId: string) {
    const trimmed = editBody.trim()
    if (!trimmed) return
    setSavingEdit(true)
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/note-feed/${noteId}`, {
        method: "PUT",
        body: JSON.stringify({ body: trimmed, type: editType, topic: editTopic || null }),
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
      <div style={{ ...eyebrow, color: T.INK_EMPHASIS, marginBottom: 16 }}>
        NOTES{titleSuffix}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {FILTER_OPTIONS.map((f) => (
          <button
            key={f.value || "all"}
            onClick={() => setFilter(f.value)}
            style={{
              fontSize: TYPE.micro,
              fontWeight: 900,
              padding: "6px 14px",
              borderRadius: 8,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              border: filter === f.value ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
              background: filter === f.value ? "rgba(254,176,106,0.1)" : T.GLASS,
              color: filter === f.value ? T.INK_EMPHASIS : T.DIM,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: 12, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10 }}>
          <span style={{ fontSize: TYPE.secondary, color: T.ERROR, fontWeight: 700 }}>{error}</span>
        </div>
      )}

      {loading ? (
        <p style={{ color: T.MUTED, fontSize: TYPE.secondary }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: TYPE.secondary }}>
          {filter ? `No ${(NOTE_TYPE_LABEL[filter as NoteType] ?? "note").toLowerCase()} notes` : "No notes yet"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {notes.map((n) => {
            const isEditing = editingId === n.id
            const isActionItem = n.type === "action_item"
            // An old action item reads as done when its task is.
            const isCompleted = isActionItem && (n.task ? n.task.status !== "open" : !!n.completed_at)
            const typeBadge = NOTE_TYPE_BADGE[n.type]

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
                id={`note-${n.id}`}
                style={{
                  ...card,
                  padding: 18,
                  opacity: isCompleted ? 0.6 : 1,
                }}
              >
                {/* Header row: badge, completion checkbox, date, edit/delete */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <span
                    style={{
                      background: typeBadge.bg,
                      color: typeBadge.color,
                      fontSize: TYPE.label,
                      fontWeight: 900,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      padding: "3px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {NOTE_TYPE_LABEL[n.type]}
                  </span>
                  <NoteTopicChip topic={n.topic} />
                  {isActionItem && <LegacyTaskLine task={n.task} />}
                  {createdLabel && (
                    <span style={{ fontSize: TYPE.micro, color: T.DIM, marginLeft: "auto" }}>
                      {createdLabel}
                      {wasEdited ? " · edited" : ""}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                      <NoteTypeChips compact value={editType} onChange={setEditType} />
                      <NoteTopicSelect id={`edit-topic-${n.id}`} value={editTopic} onChange={setEditTopic} />
                    </div>
                    <textarea
                      style={{ ...textarea, minHeight: 100, fontSize: TYPE.secondary }}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        onClick={() => saveEdit(n.id)}
                        disabled={savingEdit || editBody.trim().length === 0}
                        style={{
                          ...btnPrimary,
                          fontSize: TYPE.micro,
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
                        style={{ ...btnSecondary, fontSize: TYPE.micro, padding: "6px 12px" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        fontSize: TYPE.secondary,
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
                          fontSize: TYPE.micro,
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
                          fontSize: TYPE.micro,
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
