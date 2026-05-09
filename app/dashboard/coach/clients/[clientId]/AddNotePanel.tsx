"use client"

import { useEffect, useRef, useState } from "react"
import {
  T,
  textarea,
  btnPrimary,
  btnSecondary,
  eyebrow,
  label,
} from "../../../../../lib/dashboard-theme"

export type NoteType = "session_recap" | "action_item" | "other"
export type NotePriority = "urgent" | "this_week" | "when_ready"

const TYPE_OPTIONS: { value: NoteType; label: string }[] = [
  { value: "session_recap", label: "Session Recap" },
  { value: "action_item", label: "Action Item" },
  { value: "other", label: "Other" },
]

const PRIORITY_OPTIONS: { value: NotePriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "this_week", label: "This Week" },
  { value: "when_ready", label: "When Ready" },
]

const DEFAULT_TYPE: NoteType = "session_recap"
const DEFAULT_PRIORITY: NotePriority = "this_week"

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
  // POST handler injected by the parent so this component stays
  // ignorant of clientId/auth plumbing. Returns true on success.
  onSubmit: (input: {
    type: NoteType
    body: string
    priority: NotePriority | null
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}

export function AddNotePanel({ open, onClose, onSaved, onSubmit }: Props) {
  const [type, setType] = useState<NoteType>(DEFAULT_TYPE)
  const [priority, setPriority] = useState<NotePriority>(DEFAULT_PRIORITY)
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Reset form whenever the panel opens fresh, and focus the body field.
  useEffect(() => {
    if (open) {
      setType(DEFAULT_TYPE)
      setPriority(DEFAULT_PRIORITY)
      setBody("")
      setError(null)
      setSaving(false)
      // Focus on next paint so the slide-in transition doesn't fight focus.
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  async function handleSave() {
    const trimmed = body.trim()
    if (!trimmed) {
      setError("Body is required")
      return
    }
    setSaving(true)
    setError(null)
    const res = await onSubmit({
      type,
      body: trimmed,
      priority: type === "action_item" ? priority : null,
    })
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
            <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 4 }}>NEW NOTE</div>
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

        <div style={{ padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>TYPE</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    padding: "6px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    border: type === opt.value ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
                    background: type === opt.value ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
                    color: type === opt.value ? T.WRN_ORANGE : T.DIM,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {type === "action_item" && (
            <div>
              <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>PRIORITY</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const active = priority === opt.value
                  const accentBorder =
                    opt.value === "urgent"
                      ? "rgba(248,113,113,0.4)"
                      : opt.value === "this_week"
                      ? "rgba(254,176,106,0.4)"
                      : "rgba(81,173,229,0.4)"
                  const accentBg =
                    opt.value === "urgent"
                      ? "rgba(248,113,113,0.1)"
                      : opt.value === "this_week"
                      ? "rgba(254,176,106,0.1)"
                      : "rgba(81,173,229,0.1)"
                  const accentColor =
                    opt.value === "urgent"
                      ? "#f87171"
                      : opt.value === "this_week"
                      ? T.WRN_ORANGE
                      : T.WRN_BLUE
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(opt.value)}
                      style={{
                        fontSize: 11,
                        fontWeight: 900,
                        padding: "6px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        border: active ? `1px solid ${accentBorder}` : `1px solid ${T.BORDER_SOFT}`,
                        background: active ? accentBg : "rgba(255,255,255,0.04)",
                        color: active ? accentColor : T.DIM,
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <p style={{ fontSize: 10, color: T.DIM, marginTop: 4 }}>
                Feeds the Needs Attention list on the dashboard
              </p>
            </div>
          )}

          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6 }}>NOTE</span>
            <textarea
              ref={textareaRef}
              style={{ ...textarea, minHeight: 220, fontSize: 13 }}
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
            <p style={{ fontSize: 10, color: T.DIM, marginTop: 4 }}>⌘/Ctrl + Enter to save</p>
          </div>

          {error && (
            <div style={{ padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{error}</span>
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
            style={{ ...btnSecondary, fontSize: 12, padding: "10px 16px", opacity: saving ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || body.trim().length === 0}
            style={{
              ...btnPrimary,
              fontSize: 12,
              padding: "10px 18px",
              opacity: saving || body.trim().length === 0 ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save note"}
          </button>
        </div>
      </div>
    </>
  )
}
