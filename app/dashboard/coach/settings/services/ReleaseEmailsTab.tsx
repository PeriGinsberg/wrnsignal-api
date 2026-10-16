"use client"

// Release emails: Settings > Services > Release emails. One email per client
// step in the coach's library (Book Resume Workshop, Review draft and book
// Finalize session, and so on), each with a subject, a message and the
// Calendly link for that step. A step with no email releases the way it always
// has. When a step with an email comes up on a client's Plan, "Send email"
// opens it in the Message panel; sending it also releases the step.
//
// GET/PUT/DELETE /api/coach/release-templates. The rules are in lib/release/service.ts.

import { useCallback, useEffect, useState } from "react"
import { T, input, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import {
  DRIVE_TOKEN,
  FIRST_NAME_TOKEN,
  RELEASE_BODY_MAX,
  RELEASE_LINK_MAX,
  RELEASE_SUBJECT_MAX,
  SCHEDULING_TOKEN,
  type ReleaseTemplate,
} from "@/lib/release/model"

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

type Step = { activity_id: string; deliverable: string; name: string; template: ReleaseTemplate | null }
type Form = { subject: string; body: string; scheduling_link: string }
const toForm = (t: ReleaseTemplate | null): Form => ({ subject: t?.subject ?? "", body: t?.body ?? "", scheduling_link: t?.scheduling_link ?? "" })

const label: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 6, display: "block" }

export function ReleaseEmailsTab() {
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch("/api/coach/release-templates")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load the release emails (${res.status})`); return }
      setSteps(j.steps as Step[])
    } catch {
      setError("Network error, try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your release emails…</p>

  const deliverables = [...new Set(steps.map((s) => s.deliverable))]
  return (
    <div>
      <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 16px" }}>
        The email a client gets when you release one of their steps. When a step with an email comes up on a client&apos;s
        Plan, Send email opens it with {FIRST_NAME_TOKEN} as their first name, {DRIVE_TOKEN} as their Drive folder, and{" "}
        {SCHEDULING_TOKEN} as the scheduling link below. Any other [bracket] is yours to fill for that client, and the email
        can&apos;t go until you do. Sending it releases the step. Your signature is added automatically.
      </p>
      {error && <div role="alert" style={{ fontSize: 13, color: "#B42318", marginBottom: 12 }}>{error}</div>}
      {!error && steps.length === 0 && (
        <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Your library has no client steps yet. Add them under Deliverables.</p>
      )}
      {deliverables.map((d) => (
        <div key={d} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: T.TEXT, margin: "0 0 8px" }}>{d}</div>
          {steps.filter((s) => s.deliverable === d).map((s) => (
            <StepCard key={s.activity_id} step={s} onSaved={setSteps} />
          ))}
        </div>
      ))}
    </div>
  )
}

function StepCard({ step, onSaved }: { step: Step; onSaved: (all: Step[]) => void }) {
  const [editing, setEditing] = useState(!!step.template)
  const [form, setForm] = useState<Form>(toForm(step.template))
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  useEffect(() => { setForm(toForm(step.template)); setEditing(!!step.template) }, [step.template])

  const base = toForm(step.template)
  const dirty = form.subject !== base.subject || form.body !== base.body || form.scheduling_link !== base.scheduling_link
  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setError(null); setOk(false) }
  const id = `release-${step.activity_id}`

  async function call(method: "PUT" | "DELETE") {
    setSaving(true)
    setError(null)
    try {
      const res = method === "PUT"
        ? await authFetch("/api/coach/release-templates", { method, body: JSON.stringify({ activity_id: step.activity_id, ...form }) })
        : await authFetch(`/api/coach/release-templates?activity_id=${encodeURIComponent(step.activity_id)}`, { method })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Save failed (${res.status})`); return }
      onSaved(j.steps as Step[])
      setOk(method === "PUT")
      setConfirmRemove(false)
    } catch {
      setError("Network error, try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid={id} style={{ border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, borderRadius: 12, padding: 16, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.TEXT }}>{step.name}</div>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} style={{ ...btnSecondary, marginLeft: "auto", fontSize: 12, padding: "6px 12px" }}>
            Add an email
          </button>
        )}
      </div>
      {!editing ? (
        <div style={{ fontSize: 12, color: T.MUTED, marginTop: 2 }}>No email. This step releases without one.</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <label style={label} htmlFor={`${id}-subject`}>Subject</label>
          <input id={`${id}-subject`} value={form.subject} maxLength={RELEASE_SUBJECT_MAX} onChange={(e) => set({ subject: e.target.value })}
            style={{ ...input, width: "100%", boxSizing: "border-box", marginBottom: 12 }} />

          <label style={label} htmlFor={`${id}-body`}>Message</label>
          <textarea id={`${id}-body`} value={form.body} maxLength={RELEASE_BODY_MAX} onChange={(e) => set({ body: e.target.value })}
            style={{ ...input, width: "100%", boxSizing: "border-box", minHeight: 220, resize: "vertical", fontFamily: "inherit", lineHeight: 1.45, marginBottom: 12 }} />

          <label style={label} htmlFor={`${id}-link`}>Scheduling link</label>
          <input id={`${id}-link`} value={form.scheduling_link} maxLength={RELEASE_LINK_MAX} placeholder="https://calendly.com/…"
            onChange={(e) => set({ scheduling_link: e.target.value })}
            style={{ ...input, width: "100%", boxSizing: "border-box" }} />
          <p style={{ fontSize: 12, color: T.DIM, margin: "6px 0 12px" }}>
            Leave blank for a step with no session to book. In Calendly, open Event Types, then Copy link on this session.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" disabled={!dirty || saving} onClick={() => void call("PUT")}
              style={{ ...btnPrimary, opacity: !dirty || saving ? 0.5 : 1, cursor: !dirty || saving ? "default" : "pointer" }}>
              {saving ? "Saving…" : "Save"}
            </button>
            {step.template ? (
              <button type="button" disabled={saving} onClick={() => (confirmRemove ? void call("DELETE") : setConfirmRemove(true))}
                style={{ ...btnSecondary, color: confirmRemove ? T.ERROR : undefined }}>
                {confirmRemove ? "Yes, remove this email" : "Remove email"}
              </button>
            ) : (
              <button type="button" disabled={saving} onClick={() => { setForm(toForm(null)); setEditing(false) }} style={btnSecondary}>
                Cancel
              </button>
            )}
            {ok && !dirty && <span role="status" style={{ fontSize: 12, color: T.MUTED }}>Saved.</span>}
            {error && <span role="alert" style={{ fontSize: 12, color: "#B42318" }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
