"use client"

// WRITE THE MESSAGE. This is what stands where SendPanel did, and it is a
// different thing: SendPanel rendered a template from a library and asked you
// to copy it. This asks you to write, and then keeps what you wrote.
//
// A message is a row in network_actions with a body. Draft and sent are the
// same row; sending flips status and stamps the date. There is no revision
// history, so editing a draft overwrites it, and a sent message is immutable
// because it records something that happened in somebody else's inbox.
//
// SIGNAL SENDS NOTHING. "I sent this" is the user saying they sent it, in
// their own mail client or on LinkedIn. The button says so and so does the
// line under it.

import { useCallback, useEffect, useMemo, useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { ACTION_TYPE_OPTIONS } from "../../vocab"

export type Message = {
  id: string
  type: string
  action_date: string
  body: string | null
  channel: string | null
  subject: string | null
  status: string | null
  application_id: string | null
}

type AppOption = { id: string; job_title: string | null; company_name: string | null; application_status: string | null }

const CHANNELS = [
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
] as const

export function MessageComposer({
  contactId, companyId, companyName, firstName, draft, onSaved,
}: {
  contactId: string
  /** The contact's company, or null. Drives the application dropdown entirely. */
  companyId: string | null
  companyName: string | null
  firstName: string
  /** The existing draft, if this contact has one. Editing overwrites it. */
  draft: Message | null
  onSaved: () => void
}) {
  const [body, setBody] = useState(draft?.body ?? "")
  const [channel, setChannel] = useState(draft?.channel ?? "email")
  const [subject, setSubject] = useState(draft?.subject ?? "")
  const [type, setType] = useState(draft?.type ?? "touch_1")
  const [applicationId, setApplicationId] = useState(draft?.application_id ?? "")
  const [apps, setApps] = useState<AppOption[] | null>(null)
  const [busy, setBusy] = useState<"" | "draft" | "sent" | "discard">("")
  const [error, setError] = useState<string | null>(null)

  // Re-seed when a different draft arrives; the record refetches after a save.
  useEffect(() => {
    setBody(draft?.body ?? "")
    setChannel(draft?.channel ?? "email")
    setSubject(draft?.subject ?? "")
    setType(draft?.type ?? "touch_1")
    setApplicationId(draft?.application_id ?? "")
  }, [draft?.id])

  // THE APPLICATION DROPDOWN, and the honest thing about it.
  //
  // Populated ONLY from applications already linked to this contact's company.
  // signal_applications.company_id is set by exactly one thing: the user
  // confirming a link, on the tracker or from JobFit's Networking prompt. On
  // production almost no rows have it, so this list is usually empty, and the
  // note under it says why rather than implying there is nothing to apply to.
  //
  // NEVER MATCHED BY NAME. 20260805_application_company_link.sql forbids it in
  // as many words, and is right to: two boards can hold "Globex" and "Globex
  // Corporation" and nothing here gets to guess they are one employer.
  useEffect(() => {
    if (!companyId) { setApps([]); return }
    let alive = true
    authFetch(`/api/applications?company_id=${encodeURIComponent(companyId)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setApps(Array.isArray(j?.applications) ? j.applications : []) })
      .catch(() => { if (alive) setApps([]) })
    return () => { alive = false }
  }, [companyId])

  const canSave = body.trim().length > 0 && !busy

  const save = useCallback(async (status: "draft" | "sent") => {
    setBusy(status)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        body, channel, type, status,
        subject: channel === "email" ? subject : "",
        application_id: applicationId || null,
      }
      const res = await authFetch(`/api/network/contacts/${contactId}/messages`, {
        method: draft ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft ? { ...payload, id: draft.id } : payload),
      })
      const j = await res.json()
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${res.status}`)
      if (status === "sent") { setBody(""); setSubject("") }
      onSaved()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy("")
    }
  }, [body, channel, subject, type, applicationId, draft, contactId, onSaved])

  const discard = useCallback(async () => {
    if (!draft) return
    setBusy("discard")
    setError(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contactId}/messages`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id }),
      })
      const j = await res.json()
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${res.status}`)
      onSaved()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy("")
    }
  }, [draft, contactId, onSaved])

  const appNote = useMemo(() => {
    if (!companyId) return `${firstName} has no company on your board, so there is no application to link.`
    if (apps === null) return "Looking for applications…"
    if (apps.length === 0)
      return `Nothing linked to ${companyName || "this company"} yet. Applications link from the job tracker, and only when you confirm it.`
    return null
  }, [companyId, apps, companyName, firstName])

  return (
    <section style={wrap} data-testid="message-composer">
      <div style={eyebrow}>{draft ? "Your draft" : `Write to ${firstName}`}</div>

      <div style={row}>
        <label style={lbl}>
          Channel
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={sel} data-testid="composer-channel">
            {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Kind
          <select value={type} onChange={(e) => setType(e.target.value)} style={sel} data-testid="composer-type">
            {ACTION_TYPE_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Email only. A LinkedIn message has no subject line, and a disabled one
          would be a field that exists to be ignored. */}
      {channel === "email" && (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject (optional)"
          style={input}
          data-testid="composer-subject"
        />
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`What do you want to say to ${firstName}?`}
        rows={7}
        style={textarea}
        data-testid="composer-body"
      />

      <label style={lbl}>
        About an application (optional)
        <select
          value={applicationId}
          onChange={(e) => setApplicationId(e.target.value)}
          style={sel}
          disabled={!apps || apps.length === 0}
          data-testid="composer-application"
        >
          <option value="">Not about a specific job</option>
          {(apps ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {[a.job_title, a.application_status].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      </label>
      {appNote && <p style={note} data-testid="composer-application-note">{appNote}</p>}

      {error && <p style={{ ...note, color: S.meaning.error.ink, fontWeight: 700 }}>{error}</p>}

      <div style={actions}>
        <button
          type="button"
          onClick={() => save("sent")}
          disabled={!canSave}
          style={{ ...actionStyle(S, "primary"), ...btn, opacity: canSave ? 1 : 0.5 }}
          data-testid="composer-send"
        >
          {busy === "sent" ? "Saving…" : "I sent this"}
        </button>
        <button
          type="button"
          onClick={() => save("draft")}
          disabled={!canSave}
          style={{ ...quiet, opacity: canSave ? 1 : 0.5 }}
          data-testid="composer-draft"
        >
          {busy === "draft" ? "Saving…" : draft ? "Save draft" : "Save as draft"}
        </button>
        {draft && (
          <button type="button" onClick={discard} disabled={!!busy} style={quiet} data-testid="composer-discard">
            {busy === "discard" ? "Discarding…" : "Discard"}
          </button>
        )}
      </div>

      {/* Said plainly, once. A product that drafts messages could reasonably be
          assumed to send them, and this one never will. */}
      <p style={note}>
        SIGNAL does not send anything. Copy this into {channel === "email" ? "your email" : "LinkedIn"}, then mark it sent.
      </p>
    </section>
  )
}

const wrap: React.CSSProperties = {
  marginTop: 20, borderRadius: 18, padding: "22px 24px",
  background: S.card, border: `1px solid ${S.borderSoft}`, boxShadow: S.shadow.card,
  display: "flex", flexDirection: "column", gap: 12,
}
const eyebrow: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
  color: S.text.muted,
}
const row: React.CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" }
const lbl: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5,
  fontWeight: 700, color: S.text.secondary, flex: "1 1 180px",
}
const sel: React.CSSProperties = {
  padding: "9px 11px", borderRadius: 10, border: `1px solid ${S.border}`,
  background: S.card, color: S.text.primary, fontSize: 14, fontFamily: "inherit",
}
const input: React.CSSProperties = { ...sel, width: "100%", boxSizing: "border-box" }
const textarea: React.CSSProperties = {
  ...sel, width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: "21px",
}
const actions: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }
const btn: React.CSSProperties = {
  borderRadius: 10, padding: "11px 18px", fontSize: 14.5, fontFamily: "inherit",
}
const quiet: React.CSSProperties = {
  background: "none", border: "none", color: S.action.quietInk,
  fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
}
const note: React.CSSProperties = {
  margin: 0, fontSize: 12.5, color: S.text.muted, lineHeight: "18px",
}
