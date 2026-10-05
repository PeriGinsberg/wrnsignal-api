"use client"

// Welcome emails: Settings > Services > Welcome emails. One template for each
// place a plan can start (Your SIGNAL DNA, Resume Workshop, Search, Land),
// each with a subject, a message and the Calendly link for that first session.
// When the coach releases "Send welcome email (releases: [task])", the editor
// opens with the template matching the phase that task sits in.
//
// GET/PUT /api/coach/welcome-templates. The rules are in lib/welcome/service.ts.

import { useCallback, useEffect, useState } from "react"
import { T, input, btnPrimary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import {
  DRIVE_TOKEN,
  SCHEDULING_TOKEN,
  WELCOME_BODY_MAX,
  WELCOME_LINK_MAX,
  WELCOME_START_LABEL,
  WELCOME_STARTS,
  WELCOME_SUBJECT_MAX,
  type WelcomeStart,
  type WelcomeTemplate,
} from "@/lib/welcome/model"

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

const PHASE_OF: Record<WelcomeStart, string> = {
  dna: "Know",
  resume_workshop: "Build",
  search: "Search",
  land: "Land",
}

type Form = { subject: string; body: string; scheduling_link: string }
const toForm = (t: WelcomeTemplate | undefined): Form => ({ subject: t?.subject ?? "", body: t?.body ?? "", scheduling_link: t?.scheduling_link ?? "" })

const label: React.CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 6, display: "block" }

export function WelcomeTab() {
  const [saved, setSaved] = useState<WelcomeTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch("/api/coach/welcome-templates")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load the welcome emails (${res.status})`); return }
      setSaved(j.templates as WelcomeTemplate[])
    } catch {
      setError("Network error, try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your welcome emails…</p>

  return (
    <div>
      <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 16px" }}>
        The email a new client gets when you release their first task. SIGNAL picks the one that matches where their plan
        starts, and you can change it before it goes. [First Name] becomes their first name, {DRIVE_TOKEN} a button to
        their Drive folder, and {SCHEDULING_TOKEN} a button to the scheduling link below. Your signature is added
        automatically.
      </p>
      {error && <div role="alert" style={{ fontSize: 13, color: "#B42318", marginBottom: 12 }}>{error}</div>}
      {WELCOME_STARTS.map((k) => (
        <TemplateCard key={k} start={k} template={saved.find((t) => t.start_key === k)} onSaved={setSaved} />
      ))}
    </div>
  )
}

function TemplateCard({ start, template, onSaved }: {
  start: WelcomeStart
  template: WelcomeTemplate | undefined
  onSaved: (all: WelcomeTemplate[]) => void
}) {
  const [form, setForm] = useState<Form>(toForm(template))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  useEffect(() => { setForm(toForm(template)) }, [template])

  const base = toForm(template)
  const dirty = form.subject !== base.subject || form.body !== base.body || form.scheduling_link !== base.scheduling_link
  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setError(null); setOk(false) }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await authFetch("/api/coach/welcome-templates", { method: "PUT", body: JSON.stringify({ start_key: start, ...form }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Save failed (${res.status})`); return }
      onSaved(j.templates as WelcomeTemplate[])
      setOk(true)
    } catch {
      setError("Network error, try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid={`welcome-${start}`} style={{ border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.TEXT }}>{WELCOME_START_LABEL[start]}</div>
      <div style={{ fontSize: 12, color: T.MUTED, margin: "2px 0 12px" }}>
        For plans that start in {PHASE_OF[start]}.{!template && " Not set up yet."}
      </div>

      <label style={label} htmlFor={`welcome-${start}-subject`}>Subject</label>
      <input id={`welcome-${start}-subject`} value={form.subject} maxLength={WELCOME_SUBJECT_MAX} onChange={(e) => set({ subject: e.target.value })}
        style={{ ...input, width: "100%", boxSizing: "border-box", marginBottom: 12 }} />

      <label style={label} htmlFor={`welcome-${start}-body`}>Message</label>
      <textarea id={`welcome-${start}-body`} value={form.body} maxLength={WELCOME_BODY_MAX} onChange={(e) => set({ body: e.target.value })}
        style={{ ...input, width: "100%", boxSizing: "border-box", minHeight: 260, resize: "vertical", fontFamily: "inherit", lineHeight: 1.45, marginBottom: 12 }} />

      <label style={label} htmlFor={`welcome-${start}-link`}>Scheduling link</label>
      <input id={`welcome-${start}-link`} value={form.scheduling_link} maxLength={WELCOME_LINK_MAX} placeholder="https://calendly.com/…"
        onChange={(e) => set({ scheduling_link: e.target.value })}
        style={{ ...input, width: "100%", boxSizing: "border-box" }} />
      <p style={{ fontSize: 12, color: T.DIM, margin: "6px 0 12px" }}>
        In Calendly, open Event Types, then Copy link on this session, and paste it here.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" disabled={!dirty || saving} onClick={() => void save()}
          style={{ ...btnPrimary, opacity: !dirty || saving ? 0.5 : 1, cursor: !dirty || saving ? "default" : "pointer" }}>
          {saving ? "Saving…" : "Save"}
        </button>
        {ok && !dirty && <span role="status" style={{ fontSize: 12, color: T.MUTED }}>Saved.</span>}
        {error && <span role="alert" style={{ fontSize: 12, color: "#B42318" }}>{error}</span>}
      </div>
    </div>
  )
}
