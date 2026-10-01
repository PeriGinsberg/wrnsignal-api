"use client"

import { useEffect, useRef, useState } from "react"
import { SPACE, TYPE } from "../../../../../lib/theme/surfaces"
import {
  T,
  textarea,
  btnPrimary,
  btnSecondary,
  eyebrow,
  label,
} from "../../../../../lib/dashboard-theme"
import { SavingSpinner } from "../../SavingSpinner"
import { NoteTopicSelect, NoteTypeChips, type NoteTopic, type NoteType } from "../../_notes/noteUi"

export type { NoteType }

// Session Recap or Other, with an optional topic. Action Item is not offered:
// work to do is a task, added with the page's Add Task button.
const DEFAULT_TYPE: NoteType = "session_recap"

export type NoteSubmitInput = {
  type: NoteType
  body: string
  /** Files the note under Phase, Deliverable or Milestone. null = no topic. */
  topic: NoteTopic | null
}

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
  // POST handler injected by the parent so this component stays
  // ignorant of clientId/auth plumbing. Returns true on success.
  onSubmit: (input: NoteSubmitInput) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function AddNotePanel({ open, onClose, onSaved, onSubmit }: Props) {
  const [type, setType] = useState<NoteType>(DEFAULT_TYPE)
  const [topic, setTopic] = useState<NoteTopic | "">("")
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Reset form whenever the panel opens fresh, and focus the body field.
  useEffect(() => {
    if (open) {
      setType(DEFAULT_TYPE)
      setTopic("")
      setBody("")
      setError(null)
      setSaving(false)
      // Focus on next paint so the slide-in transition doesn't fight focus.
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

  // Close on Escape. Guarded against in-flight saves to match the
  // Cancel button's disabled state — prevents accidental mid-save
  // dismissal that could orphan an optimistic UI state.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (saving) return
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose, saving])

  async function handleSave() {
    const trimmed = body.trim()
    if (!trimmed) {
      setError("Body is required")
      return
    }
    setSaving(true)
    setError(null)
    const res = await onSubmit({ type, body: trimmed, topic: topic || null })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(4, 6, 15, 0.55)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.18s ease-out",
          zIndex: 40,
        }}
      />

      {/* Slide-in panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add note"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 460,
          maxWidth: "94vw",
          background: T.NAV_BG,
          borderLeft: `1px solid ${T.BORDER}`,
          boxShadow: "-20px 0 60px rgba(0,0,0,0.4)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease-out",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${T.BORDER_SOFT}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ ...eyebrow, color: T.INK_EMPHASIS, fontSize: TYPE.micro, marginBottom: 4 }}>NEW NOTE</div>
            <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>
              Add a note
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: T.MUTED,
              fontSize: 20,
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Form fields dim during save (Phase 4 Item 5) so the textarea
            + chip pickers read as non-interactive. pointer-events:none
            blocks accidental clicks; underlying inputs stay enabled so
            tab-focus + screen readers still see them. */}
        <div
          style={{
            padding: 24,
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            opacity: saving ? 0.5 : 1,
            pointerEvents: saving ? "none" : "auto",
            transition: "opacity 120ms ease",
          }}
        >
          <div>
            <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 8 }}>TYPE</span>
            <NoteTypeChips value={type} onChange={setType} />
          </div>

          <NoteTopicSelect id="add-note-topic" value={topic} onChange={setTopic} />

          <div>
            <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>NOTE</span>
            <textarea
              ref={textareaRef}
              style={{ ...textarea, minHeight: 220, fontSize: TYPE.secondary }}
              placeholder="What did you want to capture?"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSave()
                }
              }}
            />
            <p style={{ fontSize: TYPE.label, color: T.DIM, marginTop: 4 }}>⌘/Ctrl + Enter to save</p>
          </div>

          {error && (
            <div style={{ padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
              <span style={{ fontSize: TYPE.secondary, color: T.ERROR, fontWeight: 700 }}>{error}</span>
            </div>
          )}
        </div>

        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${T.BORDER_SOFT}`,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{ ...btnSecondary, fontSize: TYPE.secondary, padding: "10px 16px", opacity: saving ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || body.trim().length === 0}
            style={{
              ...btnPrimary,
              fontSize: TYPE.secondary,
              padding: "10px 18px",
              opacity: saving || body.trim().length === 0 ? 0.5 : 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {saving && <SavingSpinner />}
            {saving ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </>
  )
}
