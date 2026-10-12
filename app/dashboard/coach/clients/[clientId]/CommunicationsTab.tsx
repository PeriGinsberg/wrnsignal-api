"use client"

// Communications: every email SIGNAL sent this client or prospect, newest
// first, from the email log (lib/email/clientEmailLog.ts). Clicking one opens
// it in full, as they received it. Shared by the client page (tab), the
// prospect page and the converted-client page (sections); all pass
// coach_clients.id. Read API:
//   GET /api/coach/coach-clients/[ccId]/emails            the list, no bodies
//   GET /api/coach/coach-clients/[ccId]/emails/[emailId]  one, in full
//
// Private links were replaced when the email was saved, so what shows here is
// safe to show: "[private SOW link]" and "[private sign-in link]" stand in.
//
// getToken/authFetch inlined per the coach-route client convention (same pair
// as HistoryTab).

import { useCallback, useEffect, useState } from "react"
import { TYPE } from "../../../../../lib/theme/surfaces"
import { T, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { CLIENT_EMAIL_TYPE_LABEL, type ClientEmailType } from "../../../../../lib/email/clientEmailLog"

type EmailSummary = {
  id: string
  email_type: ClientEmailType
  sent_at: string
  from_email: string
  to_email: string
  cc_email: string | null
  bcc_emails: string[]
  delivered_to: string
  redirected: boolean
  subject: string
  sent_by_name: string | null
  backfilled: boolean
}

/** Who sent it. A backfilled email with no match in History says so, rather than claiming SIGNAL sent it. */
const senderLabel = (e: EmailSummary) =>
  e.sent_by_name ?? (e.backfilled ? "Sender not recorded" : "SIGNAL (automatic)")
type EmailFull = EmailSummary & { text_body: string | null; html_body: string | null }

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

const typeLabel = (t: string) => CLIENT_EMAIL_TYPE_LABEL[t as ClientEmailType] ?? t

/**
 * The HTML in a sandboxed frame: no scripts, nothing it can reach on this
 * page, and links open in a new tab. White behind it, because email HTML is
 * written for a white page whatever theme SIGNAL is in.
 */
function HtmlFrame({ html }: { html: string }) {
  const doc = `<base target="_blank"><style>html,body{background:#fff;margin:0;}</style>${html}`
  return (
    <iframe
      title="Email as sent"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ width: "100%", height: 640, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 8, background: "#fff" }}
    />
  )
}

function EmailDetail({ coachClientId, id }: { coachClientId: string; id: string }) {
  const [email, setEmail] = useState<EmailFull | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"html" | "text">("html")

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/emails/${id}`)
        const j = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load this email (${res.status})`); return }
        setEmail(j.email)
        if (!j.email.html_body) setView("text")
      } catch {
        if (live) setError("Network error. Try again.")
      }
    })()
    return () => { live = false }
  }, [coachClientId, id])

  if (error) return <p style={{ fontSize: TYPE.secondary, color: T.ERROR, margin: "8px 0 0" }}>{error}</p>
  if (!email) return <p style={{ fontSize: TYPE.secondary, color: T.MUTED, margin: "8px 0 0" }}>Loading email…</p>

  const line = (label: string, value: string | null) =>
    value ? (
      <div style={{ display: "flex", gap: 8, fontSize: TYPE.secondary }}>
        <span style={{ color: T.DIM, width: 64, flexShrink: 0 }}>{label}</span>
        <span style={{ color: T.TEXT, wordBreak: "break-word" }}>{value}</span>
      </div>
    ) : null

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {line("Date", when(email.sent_at))}
        {line("From", email.from_email)}
        {line("To", email.to_email)}
        {line("CC", email.cc_email)}
        {line("BCC", email.bcc_emails.length ? email.bcc_emails.join(", ") : null)}
        {line("Subject", email.subject)}
        {line("Sent by", senderLabel(email))}
      </div>
      {email.backfilled && (
        <div style={{ fontSize: TYPE.micro, color: T.MUTED }}>
          Sent before SIGNAL kept this log; recovered from Postmark's record. No coach copy (BCC) was sent at the time.
        </div>
      )}
      {email.redirected && (
        <div style={{ fontSize: TYPE.micro, color: T.MUTED, background: T.WARNING_BG, border: `1px solid ${T.ORANGE_BORDER}`, borderRadius: 8, padding: "8px 10px" }}>
          Test send: this went to {email.delivered_to} instead, because it was sent from a test environment. Nobody on the To, CC or BCC lines received it.
        </div>
      )}
      {email.html_body && email.text_body && (
        <div style={{ display: "flex", gap: 6 }}>
          {(["html", "text"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              style={{
                ...btnSecondary, minHeight: 0, padding: "5px 12px", fontSize: TYPE.micro,
                border: view === v ? `1px solid ${T.ORANGE_BORDER}` : `1px solid ${T.BORDER_SOFT}`,
              }}
            >
              {v === "html" ? "As they saw it" : "Plain text"}
            </button>
          ))}
        </div>
      )}
      {view === "html" && email.html_body
        ? <HtmlFrame html={email.html_body} />
        : (
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: TYPE.secondary, color: T.TEXT, background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 8, padding: 14 }}>
            {email.text_body ?? ""}
          </pre>
        )}
    </div>
  )
}

export function CommunicationsTab({ coachClientId }: { coachClientId: string | null }) {
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!coachClientId) { setLoading(false); setEmails([]); return }
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/emails`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setLoadError(j?.error || `Couldn't load emails (${res.status})`); return }
      setEmails(j.emails || [])
    } catch {
      setLoadError("Network error. Try again.")
    } finally {
      setLoading(false)
    }
  }, [coachClientId])

  useEffect(() => { void load() }, [load])

  if (loading) return <p style={{ fontSize: TYPE.secondary, color: T.MUTED, margin: 0 }}>Loading emails…</p>
  if (loadError) {
    return (
      <div>
        <div style={{ fontSize: TYPE.secondary, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>
          {loadError}
        </div>
        <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
      </div>
    )
  }
  if (!coachClientId || emails.length === 0) {
    return <p style={{ fontSize: TYPE.secondary, color: T.DIM, margin: 0 }}>No emails sent yet.</p>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {emails.map((e, i) => {
        const open = openId === e.id
        return (
          <div key={e.id} style={{ padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${T.BORDER_SOFT}` }}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : e.id)}
              aria-expanded={open}
              style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: TYPE.secondary, color: T.TEXT, fontWeight: 600, flex: 1, minWidth: 0 }}>{e.subject}</span>
                <span style={{ fontSize: TYPE.micro, color: T.DIM, whiteSpace: "nowrap" }}>{when(e.sent_at)}</span>
              </div>
              <div style={{ fontSize: TYPE.micro, color: T.DIM, marginTop: 2 }}>
                {typeLabel(e.email_type)} · to {e.to_email}{e.cc_email ? `, cc ${e.cc_email}` : ""} · {senderLabel(e)}
                {e.redirected ? " · test send" : ""}
              </div>
            </button>
            {open && <EmailDetail coachClientId={coachClientId} id={e.id} />}
          </div>
        )
      })}
    </div>
  )
}
