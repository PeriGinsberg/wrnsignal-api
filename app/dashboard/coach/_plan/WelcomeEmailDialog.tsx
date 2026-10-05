"use client"

// The welcome email, edited before it goes. It opens wherever the coach
// releases "Send welcome email (releases: [task])": the Plan, the Engagements
// tab, or ticking its To-Do item. It starts from the template that matches
// where the plan starts, with [First Name] filled; the picker can change it.
// [Drive folder link] and [Scheduling link] become buttons when it sends.
//
// Send emails the client and releases the task; Don't send only releases it.
// Either way the Drive workspace is shared with them. The rules are in
// lib/welcome/service.ts.

import { useEffect, useState } from "react"
import { btnPrimary } from "@/lib/dashboard-theme"
import { signatureHtml } from "@/lib/email/signature"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import {
  DRIVE_BUTTON,
  DRIVE_TOKEN,
  SCHEDULING_BUTTON,
  SCHEDULING_TOKEN,
  WELCOME_BODY_MAX,
  WELCOME_START_LABEL,
  WELCOME_STARTS,
  WELCOME_SUBJECT_MAX,
  fillFirstName,
  usesDrive,
  usesScheduling,
  welcomeProblem,
  type WelcomeStart,
  type WelcomeTemplate,
} from "@/lib/welcome/model"

type Draft = {
  task: { id: string; name: string }
  to: string | null
  parent_email: string | null
  first_name: string
  drive_url: string | null
  match: WelcomeStart | null
  phase: string | null
  templates: WelcomeTemplate[]
}

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

const field: React.CSSProperties = {
  background: "#fff", color: "#08203F", border: "1px solid #C9D6E3", borderRadius: 8,
  padding: "7px 9px", fontSize: 14, fontFamily: "inherit", width: "100%", boxSizing: "border-box",
}
const small: React.CSSProperties = {
  background: "#fff", color: "#08203F", border: "1px solid #C9D6E3", borderRadius: 8,
  padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
}
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 800, marginBottom: 4 }

export function WelcomeEmailDialog({ coachClientId, taskId, onDone, onClose }: {
  coachClientId: string
  taskId: string
  /** After it sent or released; the message says what happened. */
  onDone: (message: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [start, setStart] = useState<WelcomeStart | "">("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [ccParent, setCcParent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/plan/welcome?task_id=${encodeURIComponent(taskId)}`)
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) { setLoadError(j?.error || "Couldn't open the welcome email"); return }
        const d = j.draft as Draft
        setDraft(d)
        const first = d.match && d.templates.some((t) => t.start_key === d.match) ? d.match : ""
        if (first) pick(first, d)
      } catch {
        setLoadError("Couldn't open the welcome email")
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachClientId, taskId])

  function pick(key: WelcomeStart | "", d: Draft | null = draft) {
    setStart(key)
    const t = d?.templates.find((x) => x.start_key === key)
    setSubject(t ? fillFirstName(t.subject, d?.first_name) : "")
    setBody(t ? fillFirstName(t.body, d?.first_name) : "")
  }

  const template = draft?.templates.find((t) => t.start_key === start) ?? null
  const problem = !draft ? null
    : !draft.to ? "This client has no email address. Add one to their record first."
    : !template ? "Pick which welcome email this is."
    : welcomeProblem({ subject, body, driveUrl: draft.drive_url, schedulingLink: template.scheduling_link })

  async function go(send: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/plan/welcome`, {
        method: "POST",
        body: JSON.stringify(send ? { task_id: taskId, send: true, start, subject, body, cc_parent: ccParent } : { task_id: taskId, send: false }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't do that"); return }
      const r = j.result as { sent: boolean; to: string | null; cc: string | null; redirected: boolean }
      onDone(r.sent
        ? `Welcome email sent to ${r.to}${r.cc ? ` (cc ${r.cc})` : ""}${r.redirected ? ", redirected to Peri outside production" : ""}. The task is released and the Drive folder shared.`
        : "Released without an email. The Drive folder is shared.")
    } catch {
      setError("Couldn't do that")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,32,63,0.45)", zIndex: 1000, overflowY: "auto", padding: "24px 12px" }}>
      <div role="dialog" aria-label="Send welcome email" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 16, padding: 20, color: "#08203F" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Send the welcome email</h2>
        {draft && (
          <p style={{ fontSize: 13, margin: "0 0 14px", color: "#4A6478" }}>
            Either way, &ldquo;{draft.task.name}&rdquo; is released to the client and their Drive folder is shared with them.
          </p>
        )}

        {loadError && <div role="alert" style={{ fontSize: 13, color: "#B42318", marginBottom: 10 }}>{loadError}</div>}
        {!draft && !loadError && <p style={{ fontSize: 13 }}>Loading…</p>}

        {draft && (
          <>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              <strong>To:</strong> {draft.to ?? <span style={{ color: "#B42318" }}>no email on this record. Add one to send.</span>}
            </div>
            {draft.parent_email && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 10 }}>
                <input type="checkbox" checked={ccParent} onChange={(e) => setCcParent(e.target.checked)} />
                cc the parent ({draft.parent_email})
              </label>
            )}

            <label style={label} htmlFor="welcome-template">Welcome email</label>
            <select id="welcome-template" aria-label="Welcome email" value={start} onChange={(e) => pick(e.target.value as WelcomeStart | "")} style={{ ...field, marginBottom: 4 }}>
              <option value="">Pick one</option>
              {WELCOME_STARTS.map((k) => {
                const has = draft.templates.some((t) => t.start_key === k)
                return <option key={k} value={k} disabled={!has}>{WELCOME_START_LABEL[k]}{has ? "" : " (not set up in Settings)"}</option>
              })}
            </select>
            <p style={{ fontSize: 12, color: "#4A6478", margin: "0 0 12px" }}>
              {draft.match
                ? `The plan starts in ${draft.phase ?? "this phase"}, so this is the ${WELCOME_START_LABEL[draft.match]} email${draft.templates.some((t) => t.start_key === draft.match) ? "" : ", which isn't set up in Settings yet"}. Switching replaces the subject and message.`
                : `The plan starts in ${draft.phase ?? "no phase"}, which matches none of the four. Pick one.`}
            </p>

            {draft.templates.length === 0 && (
              <p role="note" style={{ background: "#FFF1E0", border: "1px solid #FEB06A", borderRadius: 8, padding: "8px 10px", fontSize: 13, margin: "0 0 12px" }}>
                No welcome emails are set up yet. Add them in Settings &gt; Services &gt; Welcome emails, or release without one.
              </p>
            )}

            {template && (
              <>
                <label style={label} htmlFor="welcome-subject">Subject</label>
                <input id="welcome-subject" aria-label="Subject" value={subject} maxLength={WELCOME_SUBJECT_MAX} onChange={(e) => setSubject(e.target.value)} style={{ ...field, marginBottom: 10 }} />

                <label style={label} htmlFor="welcome-body">Message</label>
                <textarea id="welcome-body" aria-label="Message" value={body} maxLength={WELCOME_BODY_MAX} onChange={(e) => setBody(e.target.value)}
                  style={{ ...field, minHeight: 320, resize: "vertical", lineHeight: 1.5 }} />
                <ul style={{ fontSize: 12, color: "#4A6478", margin: "6px 0 12px", paddingLeft: 18 }}>
                  {usesDrive(body) && (
                    <li>{DRIVE_TOKEN} becomes an &ldquo;{DRIVE_BUTTON}&rdquo; button to {draft.drive_url
                      ? <a href={draft.drive_url} target="_blank" rel="noreferrer" style={{ color: "#08203F" }}>their Drive folder</a>
                      : <span style={{ color: "#B42318" }}>nothing: there is no Drive folder yet</span>}</li>
                  )}
                  {usesScheduling(body) && (
                    <li>{SCHEDULING_TOKEN} becomes a &ldquo;{SCHEDULING_BUTTON}&rdquo; button to {template.scheduling_link
                      ? <a href={template.scheduling_link} target="_blank" rel="noreferrer" style={{ color: "#08203F" }}>{template.scheduling_link}</a>
                      : <span style={{ color: "#B42318" }}>nothing: add the link in Settings</span>}</li>
                  )}
                  <li>An all-capitals line at the top of a paragraph is shown in bold.</li>
                </ul>

                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>Your signature (added automatically)</div>
                <div style={{ border: "1px dashed #C9D6E3", borderRadius: 8, padding: 10, marginBottom: 14, overflowX: "auto" }}
                  dangerouslySetInnerHTML={{ __html: signatureHtml() }} />
              </>
            )}

            {(error || problem) && (
              <div role="alert" style={{ fontSize: 13, color: "#B42318", marginBottom: 10 }}>{error ?? problem}</div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" style={small} onClick={onClose}>Cancel</button>
          {draft && (
            <>
              <button type="button" style={small} disabled={busy} onClick={() => void go(false)}>Don&rsquo;t send</button>
              <button type="button" disabled={busy || !!problem} onClick={() => void go(true)}
                style={{ ...btnPrimary, padding: "8px 18px", fontSize: 14, opacity: busy || problem ? 0.5 : 1, cursor: busy || problem ? "default" : "pointer" }}>
                {busy ? "Working…" : "Send"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
