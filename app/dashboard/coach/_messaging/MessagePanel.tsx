"use client"

// The Message panel: a coach writes a client or prospect an email from SIGNAL.
// Opened by the Message button on the client page (ClientHeaderStrip) and on
// the prospect and converted-client pages (RecordNoteTaskActions).
//
// To and From are shown, not edited: the server works both out from the record
// and the signed-in coach's settings (lib/messaging/sendCoachMessage.ts). The
// coach's signature is added to the end on send and shown here read-only.
//
// THE DRAFT SURVIVES CLOSING. Closing the panel (×, Escape, the backdrop)
// keeps what was typed; only Delete or a successful send clears it.
//
// SMS is shown only when the record has a phone number, and is disabled until
// it is built.

import { useEffect, useRef, useState } from "react"
import { TYPE } from "../../../../lib/theme/surfaces"
import { T, input, textarea, btnPrimary, btnSecondary, eyebrow, label } from "../../../../lib/dashboard-theme"
import { SavingSpinner } from "../SavingSpinner"
import { apiJson } from "../_tasks/taskClient"
import { SignaturePreview } from "./SignaturePreview"

export type MessageContext = {
  to: string | null
  client_name: string | null
  parent_email: string | null
  parent_name: string | null
  has_phone: boolean
  from: string | null
  signature: string | null
}

type Sent = { to: string; redirected: boolean }

type Props = {
  open: boolean
  onClose: () => void
  /** coach_clients.id */
  coachClientId: string
  /** After a send, so the page's Communications list re-reads. */
  onSent?: () => void
}

const fieldLabel = { ...label, color: T.INK_LINK, display: "block", marginBottom: 6 } as const

function ReadOnlyField({ name, value, missing }: { name: string; value: string | null; missing: string }) {
  return (
    <div>
      <span style={fieldLabel}>{name}</span>
      <div style={{ fontSize: TYPE.secondary, color: value ? T.TEXT : T.ERROR, padding: "2px 0", wordBreak: "break-word" }}>
        {value ?? missing}
      </div>
    </div>
  )
}

export function MessagePanel({ open, onClose, coachClientId, onSent }: Props) {
  const [ctx, setCtx] = useState<MessageContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [ccParent, setCcParent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sent, setSent] = useState<Sent | null>(null)
  const subjectRef = useRef<HTMLInputElement | null>(null)

  const dirty = subject.trim() !== "" || body.trim() !== ""

  function clearDraft() {
    setSubject("")
    setBody("")
    setCcParent(false)
    setError(null)
    setConfirmDelete(false)
  }

  // A different record starts a fresh draft.
  useEffect(() => { clearDraft(); setSent(null) }, [coachClientId])

  // Re-read the context each time it opens: the signature may have changed.
  useEffect(() => {
    if (!open) return
    let live = true
    setLoadError(null)
    setConfirmDelete(false)
    void (async () => {
      try {
        const j = await apiJson<{ context: MessageContext }>(`/api/coach/coach-clients/${coachClientId}/messages`)
        if (live) setCtx(j.context)
      } catch (e) {
        if (live) setLoadError((e instanceof Error && e.message) || "Couldn't load this record's email details.")
      }
    })()
    requestAnimationFrame(() => subjectRef.current?.focus())
    return () => { live = false }
  }, [open, coachClientId])

  function close() {
    if (sending) return
    setSent(null)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const canSend = !!ctx?.to && !!ctx?.from && subject.trim() !== "" && body.trim() !== "" && !sending

  async function send() {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      const j = await apiJson<Sent>(`/api/coach/coach-clients/${coachClientId}/messages`, {
        method: "POST",
        body: JSON.stringify({ channel: "email", subject: subject.trim(), body, cc_parent: ccParent }),
      })
      clearDraft()
      setSent({ to: j.to, redirected: j.redirected })
      onSent?.()
    } catch (e) {
      setError((e instanceof Error && e.message) || "The message did not send.")
    } finally {
      setSending(false)
    }
  }

  function onDelete() {
    if (!dirty) { close(); return }
    if (!confirmDelete) { setConfirmDelete(true); return }
    clearDraft()
    close()
  }

  const chip = (active: boolean, disabled = false) => ({
    fontSize: TYPE.micro, fontWeight: 800, padding: "6px 12px", borderRadius: 999, fontFamily: "inherit",
    border: active ? `1px solid ${T.ORANGE_BORDER}` : `1px solid ${T.BORDER_SOFT}`,
    background: active ? "rgba(254,176,106,0.08)" : "transparent",
    color: disabled ? T.DIM : active ? T.INK_EMPHASIS : T.MUTED,
    cursor: disabled ? "default" : "pointer",
    display: "inline-flex", alignItems: "center", gap: 6,
  })

  return (
    <>
      <div
        onClick={close}
        style={{
          position: "fixed", inset: 0, background: "rgba(4, 6, 15, 0.55)",
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.18s ease-out", zIndex: 40,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Message"
        aria-hidden={!open}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520, maxWidth: "94vw",
          background: T.NAV_BG, borderLeft: `1px solid ${T.BORDER}`, boxShadow: "-20px 0 60px rgba(0,0,0,0.4)",
          transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s ease-out, visibility 0.22s",
          zIndex: 41, display: "flex", flexDirection: "column",
          visibility: open ? "visible" : "hidden",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${T.BORDER_SOFT}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...eyebrow, color: T.INK_EMPHASIS, fontSize: TYPE.micro, marginBottom: 4 }}>NEW MESSAGE</div>
            <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>
              {ctx?.client_name ? `Message ${ctx.client_name}` : "Message"}
            </div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "none", border: "none", color: T.MUTED, fontSize: 20, cursor: "pointer", padding: 4 }}>×</button>
        </div>

        {sent ? (
          <div style={{ padding: 24, flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: TYPE.secondary, color: T.TEXT, fontWeight: 700 }}>Message sent.</div>
            <div style={{ fontSize: TYPE.secondary, color: T.MUTED }}>
              {sent.redirected
                ? `Test send: it went to ${sent.to} instead, because this is not production.`
                : `It went to ${sent.to}. It's saved in Communications.`}
            </div>
            <div>
              <button type="button" onClick={close} style={{ ...btnSecondary, fontSize: TYPE.secondary, padding: "10px 16px" }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                padding: 24, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16,
                opacity: sending ? 0.5 : 1, pointerEvents: sending ? "none" : "auto", transition: "opacity 120ms ease",
              }}
            >
              {loadError && <div style={{ fontSize: TYPE.secondary, color: T.ERROR }}>{loadError}</div>}

              <div>
                <span style={fieldLabel}>CHANNEL</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" aria-pressed="true" style={chip(true)}>Email</button>
                  {ctx?.has_phone && (
                    <button type="button" disabled title="Text messages are coming soon" style={chip(false, true)}>
                      SMS
                      <span style={{ fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" }}>Coming soon</span>
                    </button>
                  )}
                </div>
              </div>

              <ReadOnlyField name="TO" value={ctx ? ctx.to : "…"} missing="This record has no email address. Add one first." />
              {ctx?.parent_email && (
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: TYPE.secondary, color: T.TEXT, cursor: "pointer" }}>
                  <input type="checkbox" checked={ccParent} onChange={(e) => setCcParent(e.target.checked)} />
                  CC {ctx.parent_name ? `${ctx.parent_name} (${ctx.parent_email})` : ctx.parent_email}
                </label>
              )}
              <ReadOnlyField name="FROM" value={ctx ? ctx.from : "…"} missing="You don't have a sending address yet. Ask Peri to set one up." />

              <div>
                <label htmlFor="message-subject" style={fieldLabel}>SUBJECT</label>
                <input
                  id="message-subject"
                  ref={subjectRef}
                  style={{ ...input, fontSize: TYPE.secondary }}
                  value={subject}
                  maxLength={200}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="message-body" style={fieldLabel}>MESSAGE</label>
                <textarea
                  id="message-body"
                  style={{ ...textarea, minHeight: 240, fontSize: TYPE.secondary }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() }
                  }}
                />
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: TYPE.label, color: T.DIM }}>Your signature, added when it sends (edit it in My Settings &gt; Messaging):</span>
                  <div style={{ marginTop: 6 }}>
                    <SignaturePreview signature={ctx?.signature ?? null} />
                  </div>
                </div>
              </div>

              {error && (
                <div style={{ padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
                  <span style={{ fontSize: TYPE.secondary, color: T.ERROR, fontWeight: 700 }}>{error}</span>
                </div>
              )}
            </div>

            <div style={{ padding: "16px 24px", borderTop: `1px solid ${T.BORDER_SOFT}`, display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" }}>
              {confirmDelete && <span style={{ fontSize: TYPE.micro, color: T.MUTED, marginRight: "auto" }}>Discard this draft?</span>}
              <button
                type="button"
                onClick={onDelete}
                disabled={sending}
                style={{ ...btnSecondary, fontSize: TYPE.secondary, padding: "10px 16px", color: confirmDelete ? T.ERROR : undefined }}
              >
                {confirmDelete ? "Yes, delete" : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                style={{ ...btnPrimary, fontSize: TYPE.secondary, padding: "10px 18px", opacity: canSend ? 1 : 0.5, display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                {sending && <SavingSpinner />}
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
