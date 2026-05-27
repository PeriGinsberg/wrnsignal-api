"use client"

import { useEffect, useRef, useState } from "react"
import { T, textarea, btnPrimary, btnSecondary, label } from "@/lib/dashboard-theme"

// Pure feedback form. No API knowledge — renders inputs, validates client-side
// (mirrors the server rules in app/api/feedback/route.ts), and fires onSubmit
// with the assembled FeedbackFormData. Type/severity/body/reply_ok only; the
// page_url + user_agent context is attached by the caller (FeedbackSlideIn).

export type FeedbackType =
  | "issue_bug"
  | "enhancement"
  | "technical_question"
  | "general_feedback"
  | "other"

export type FeedbackSeverity = "blocker" | "high" | "medium" | "low"

export type FeedbackFormData = {
  type: FeedbackType
  severity: FeedbackSeverity | null
  body: string
  reply_ok: boolean
}

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: "issue_bug", label: "Issue / Bug" },
  { value: "enhancement", label: "Enhancement" },
  { value: "technical_question", label: "Technical Question" },
  { value: "general_feedback", label: "General Feedback" },
  { value: "other", label: "Other" },
]

const SEVERITY_OPTIONS: { value: FeedbackSeverity; label: string }[] = [
  { value: "blocker", label: "Blocker" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

const PLACEHOLDERS: Record<FeedbackType, string> = {
  issue_bug: "What were you trying to do? What happened instead?",
  enhancement: "What would you like to see? What problem would it solve?",
  technical_question: "What are you trying to figure out?",
  general_feedback: "Share whatever's on your mind.",
  other: "Tell us what's up.",
}

const BODY_MIN = 10
const BODY_MAX = 5000

type Props = {
  onSubmit: (data: FeedbackFormData) => void
  submitting: boolean
  error: string | null
  onCancel: () => void
}

const chipStyle = (active: boolean, accent: { border: string; bg: string; color: string }) => ({
  fontSize: 11,
  fontWeight: 900 as const,
  padding: "6px 12px",
  borderRadius: 8,
  cursor: "pointer",
  textTransform: "uppercase" as const,
  letterSpacing: 0.6,
  border: active ? `1px solid ${accent.border}` : `1px solid ${T.BORDER_SOFT}`,
  background: active ? accent.bg : "rgba(255,255,255,0.04)",
  color: active ? accent.color : T.DIM,
})

const ORANGE_ACCENT = { border: "rgba(254,176,106,0.4)", bg: "rgba(254,176,106,0.1)", color: T.WRN_ORANGE }

export function FeedbackForm({ onSubmit, submitting, error, onCancel }: Props) {
  const [type, setType] = useState<FeedbackType | null>(null)
  const [severity, setSeverity] = useState<FeedbackSeverity | null>(null)
  const [body, setBody] = useState("")
  const [replyOk, setReplyOk] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Focus the body field once the panel is mounted/open, on next paint so the
  // slide-in transition doesn't fight focus (matches AddNotePanel).
  useEffect(() => {
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const trimmedLen = body.trim().length
  const severityRequired = type === "issue_bug"
  const disabled =
    submitting ||
    !type ||
    trimmedLen < BODY_MIN ||
    trimmedLen > BODY_MAX ||
    (severityRequired && !severity)

  function handleTypeChange(next: FeedbackType) {
    setType(next)
    // Severity only applies to bugs; clear it whenever leaving issue_bug so a
    // stale value can't be submitted for a non-bug type.
    if (next !== "issue_bug") setSeverity(null)
  }

  function handleSubmit() {
    if (disabled || !type) return
    onSubmit({
      type,
      severity: type === "issue_bug" ? severity : null,
      body: body.trim(),
      reply_ok: replyOk,
    })
  }

  const placeholder = type ? PLACEHOLDERS[type] : "What's on your mind?"
  const countColor = trimmedLen > BODY_MAX ? "#f87171" : T.DIM

  return (
    <>
      {/* Fields (scrollable). Dim during submit so the form reads as
          non-interactive while in flight (matches AddNotePanel). */}
      <div
        style={{
          padding: 24,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          opacity: submitting ? 0.5 : 1,
          pointerEvents: submitting ? "none" : "auto",
          transition: "opacity 120ms ease",
        }}
      >
        <div>
          <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>TYPE</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleTypeChange(opt.value)}
                style={chipStyle(type === opt.value, ORANGE_ACCENT)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {type === "issue_bug" && (
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>SEVERITY</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSeverity(opt.value)}
                  style={chipStyle(severity === opt.value, ORANGE_ACCENT)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6 }}>
            WHAT HAPPENED / WHAT WOULD YOU LIKE?
          </span>
          <textarea
            ref={textareaRef}
            style={{ ...textarea, minHeight: 200, fontSize: 13 }}
            placeholder={placeholder}
            value={body}
            maxLength={BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
          />
          <p style={{ fontSize: 10, color: countColor, marginTop: 4, textAlign: "right" }}>
            {body.length} / {BODY_MAX}
          </p>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: T.MUTED }}>
          <input
            type="checkbox"
            checked={replyOk}
            onChange={(e) => setReplyOk(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          OK to reply via email
        </label>
      </div>

      {/* Footer (pinned) */}
      <div
        style={{
          padding: "16px 24px",
          borderTop: `1px solid ${T.BORDER_SOFT}`,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flexShrink: 0,
        }}
      >
        {error && (
          <div
            style={{
              padding: 10,
              background: "rgba(248,113,113,0.1)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{error}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{ ...btnSecondary, fontSize: 12, padding: "10px 16px", opacity: submitting ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disabled}
            style={{
              ...btnPrimary,
              fontSize: 12,
              padding: "10px 18px",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {submitting ? "Sending…" : "Submit"}
          </button>
        </div>
      </div>
    </>
  )
}
