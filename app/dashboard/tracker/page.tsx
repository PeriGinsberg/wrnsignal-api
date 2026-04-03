"use client"

import { useEffect, useState, useCallback } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, card, eyebrow, headline, input, textarea, btnPrimary, btnSecondary, label } from "../../../lib/dashboard-theme"

// ── Status + Decision color maps ────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  saved: { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.45)" },
  applied: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  interviewing: { bg: "rgba(167,139,250,0.15)", color: "#a78bfa" },
  offer: { bg: "rgba(74,222,128,0.15)", color: "#4ade80" },
  rejected: { bg: "rgba(248,113,113,0.10)", color: "rgba(248,113,113,0.7)" },
  withdrawn: { bg: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" },
}

const DECISION_STYLE: Record<string, { bg: string; color: string }> = {
  "Priority Apply": { bg: "rgba(15,214,104,0.15)", color: "#0FD668" },
  Apply: { bg: "rgba(74,222,128,0.12)", color: "#4ade80" },
  Review: { bg: "rgba(212,164,68,0.15)", color: "#D4A444" },
  Pass: { bg: "rgba(232,112,112,0.12)", color: "#E87070" },
}

const INTERVIEW_GRADIENT: Record<string, string> = {
  scheduled: "linear-gradient(90deg,#a78bfa,#51ADE5)",
  awaiting_feedback: "linear-gradient(90deg,#FEB06A,#f97316)",
  offer_extended: "linear-gradient(90deg,#4ade80,#22c55e)",
  rejected: "linear-gradient(90deg,rgba(248,113,113,0.5),rgba(239,68,68,0.3))",
  ghosted: "linear-gradient(90deg,rgba(248,113,113,0.5),rgba(239,68,68,0.3))",
  not_scheduled: "linear-gradient(90deg,#51ADE5,#218C8C)",
}

const APP_LOCATIONS = ["Company Website", "LinkedIn", "Indeed", "Handshake", "Referral", "Other"]
const INTERVIEW_STAGES = ["hr_screening", "phone", "zoom", "in_person", "take_home", "final_round", "other"]
const INTERVIEW_STATUSES = ["not_scheduled", "scheduled", "awaiting_feedback", "offer_extended", "rejected", "ghosted"]
const APP_STATUSES = ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"]

// ── Helpers ─────────────────────────────────────────────────

function Pill({ text, style: s }: { text: string; style: { bg: string; color: string } }) {
  return (
    <span style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 900, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>
      {text}
    </span>
  )
}

function Stars({ count, max = 5, onClick }: { count: number; max?: number; onClick?: (n: number) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          onClick={() => onClick?.(i + 1)}
          style={{ cursor: onClick ? "pointer" : "default", color: i < count ? T.WRN_ORANGE : "rgba(255,255,255,0.15)", fontSize: 13 }}
        >
          ★
        </span>
      ))}
    </span>
  )
}

function ConfidenceDots({ level, onClick }: { level: number; onClick?: (n: number) => void }) {
  const color = level <= 2 ? "#f87171" : level === 3 ? "#FEB06A" : "#4ade80"
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          onClick={() => onClick?.(i + 1)}
          style={{
            width: 8, height: 8, borderRadius: "50%", cursor: onClick ? "pointer" : "default",
            background: i < level ? color : "rgba(255,255,255,0.1)",
          }}
        />
      ))}
    </span>
  )
}

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t) }, [onDone])
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, padding: "12px 18px", borderRadius: 12, background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", fontSize: 13, fontWeight: 900, zIndex: 100 }}>
      {message}
    </div>
  )
}

function SelectField({ value, options, onChange, style: s }: { value: string; options: string[]; onChange: (v: string) => void; style?: React.CSSProperties }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, ...s, height: 38, appearance: "auto" as any }}>
      {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
    </select>
  )
}

function formatDate(d: string | null) {
  if (!d) return "—"
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) } catch { return d }
}

function scoreColor(score: number | null): string {
  if (score === null) return T.DIM
  if (score >= 75) return "#4ade80"
  if (score >= 60) return "#FEB06A"
  return "#E87070"
}

// ── Main Component ──────────────────────────────────────────

export default function TrackerPage() {
  const [activeTab, setActiveTab] = useState("applications")
  const [viewMode, setViewMode] = useState<"list" | "pipeline">("list")
  const [applications, setApplications] = useState<any[]>([])
  const [interviews, setInterviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState("all")
  const [showAddJob, setShowAddJob] = useState(false)
  const [showAddInterview, setShowAddInterview] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [editingApp, setEditingApp] = useState<any>(null)
  const [interviewFilter, setInterviewFilter] = useState("all")

  // Add job form
  const [newJob, setNewJob] = useState({ company_name: "", job_title: "", location: "", job_url: "", application_location: "", interest_level: 3, application_status: "saved", date_posted: "", notes: "" })

  // Add interview form
  const [newInterview, setNewInterview] = useState({ application_id: "", interview_stage: "phone", interviewer_names: "", interview_date: "", status: "scheduled", confidence_level: 3, notes: "" })

  async function getToken() {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    return session?.access_token ?? null
  }

  const loadAll = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const h = { Authorization: `Bearer ${token}` }
    const [aRes, iRes] = await Promise.all([
      fetch("/api/applications", { headers: h }),
      fetch("/api/interviews", { headers: h }),
    ])
    if (aRes.ok) { const j = await aRes.json(); setApplications(j.applications || []) }
    if (iRes.ok) { const j = await iRes.json(); setInterviews(j.interviews || []) }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Application CRUD ──────────────────────────────────────

  async function updateApp(id: string, updates: any) {
    const token = await getToken()
    if (!token) return
    await fetch(`/api/applications/${id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    setApplications((prev) => prev.map((a) => a.id === id ? { ...a, ...updates } : a))
  }

  async function deleteApp(id: string) {
    const token = await getToken()
    if (!token) return
    await fetch(`/api/applications/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
    setApplications((prev) => prev.filter((a) => a.id !== id))
    setInterviews((prev) => prev.filter((i) => i.application_id !== id))
    setExpandedId(null)
    setToast("Application deleted")
  }

  async function createApp() {
    const token = await getToken()
    if (!token || !newJob.company_name.trim() || !newJob.job_title.trim()) return
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(newJob),
    })
    if (res.ok) {
      const j = await res.json()
      setApplications((prev) => [j.application, ...prev])
      setShowAddJob(false)
      setNewJob({ company_name: "", job_title: "", location: "", job_url: "", application_location: "", interest_level: 3, application_status: "saved", date_posted: "", notes: "" })
      setToast("Job added")
    }
  }

  // ── Interview CRUD ────────────────────────────────────────

  async function createInterview() {
    const token = await getToken()
    if (!token || !newInterview.application_id || !newInterview.interview_stage) return
    const res = await fetch("/api/interviews", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(newInterview),
    })
    if (res.ok) {
      const j = await res.json()
      setInterviews((prev) => [j.interview, ...prev])
      // Update app status optimistically
      setApplications((prev) => prev.map((a) => a.id === newInterview.application_id && (a.application_status === "saved" || a.application_status === "applied") ? { ...a, application_status: "interviewing" } : a))
      setShowAddInterview(false)
      setNewInterview({ application_id: "", interview_stage: "phone", interviewer_names: "", interview_date: "", status: "scheduled", confidence_level: 3, notes: "" })
      setToast("Interview logged")
    }
  }

  async function toggleThankYou(interview: any) {
    const token = await getToken()
    if (!token) return
    const val = !interview.thank_you_sent
    await fetch(`/api/interviews/${interview.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ thank_you_sent: val }),
    })
    setInterviews((prev) => prev.map((i) => i.id === interview.id ? { ...i, thank_you_sent: val } : i))
  }

  // ── Stats ─────────────────────────────────────────────────

  const scored = applications.filter((a) => a.signal_score != null)
  const applied = applications.filter((a) => a.application_status === "applied")
  const interviewing = applications.filter((a) => a.application_status === "interviewing")
  const offers = applications.filter((a) => a.application_status === "offer")
  const interviewRate = applied.length > 0 ? Math.round(interviews.length / applied.length * 100) : 0

  // ── Filtered lists ────────────────────────────────────────

  const filteredApps = filterStatus === "all" ? applications : applications.filter((a) => a.application_status === filterStatus)
  const filteredInterviews = interviewFilter === "all" ? interviews : interviews.filter((i) => i.status === interviewFilter)

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading tracker...</p>

  // ── Render ────────────────────────────────────────────────

  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 }}>JOB TRACKER</div>
      <h1 style={{ ...headline, fontSize: 28, letterSpacing: -0.8 }}>Applications &amp; Interviews</h1>

      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginTop: 20 }}>
        {[
          { n: scored.length, label: "ANALYZED", color: "#51ADE5" },
          { n: applied.length, label: "APPLIED", color: "#FEB06A" },
          { n: interviewing.length, label: "INTERVIEWING", color: "#a78bfa" },
          { n: offers.length, label: "OFFERS", color: "#4ade80" },
          { n: `${interviewRate}%`, label: "INTERVIEW RATE", color: "rgba(255,255,255,0.5)" },
        ].map((s) => (
          <div key={s.label} style={{ background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: s.color }}>{s.n}</div>
            <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.MUTED, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 24, borderBottom: `1px solid ${T.BORDER_SOFT}`, marginTop: 24, paddingBottom: 0 }}>
        {["applications", "interviews", "insights"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "10px 0",
              borderBottom: activeTab === tab ? "2px solid #FEB06A" : "2px solid transparent",
              color: activeTab === tab ? T.WRN_ORANGE : T.MUTED,
              fontSize: 13, fontWeight: 900, textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ══════ APPLICATIONS TAB ══════ */}
      {activeTab === "applications" && (
        <div style={{ marginTop: 20 }}>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {["all", "applied", "interviewing", "offer", "rejected"].map((s) => {
                const active = filterStatus === s
                return (
                  <button key={s} onClick={() => setFilterStatus(s)} style={{
                    background: active ? "rgba(254,176,106,0.12)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${active ? "rgba(254,176,106,0.35)" : T.BORDER_SOFT}`,
                    color: active ? T.WRN_ORANGE : T.MUTED,
                    fontSize: 11, fontWeight: 900, borderRadius: 8, padding: "5px 12px", cursor: "pointer", textTransform: "capitalize",
                  }}>
                    {s}
                  </button>
                )
              })}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setViewMode(viewMode === "list" ? "pipeline" : "list")} style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px", borderRadius: 8 }}>
                {viewMode === "list" ? "Pipeline" : "List"}
              </button>
              <button onClick={() => setShowAddJob(!showAddJob)} style={{ ...btnPrimary, fontSize: 11, padding: "6px 14px", borderRadius: 8 }}>
                + Add Job
              </button>
            </div>
          </div>

          {/* Add job form */}
          {showAddJob && (
            <div style={{ ...card, marginBottom: 16, border: "1px solid rgba(254,176,106,0.25)" }}>
              <div style={{ height: 3, background: "linear-gradient(90deg,#FEB06A,#51ADE5)" }} />
              <div style={{ padding: 20 }}>
                <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 14 }}>NEW APPLICATION</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4 }}>COMPANY*</span>
                    <input style={input} value={newJob.company_name} onChange={(e) => setNewJob({ ...newJob, company_name: e.target.value })} placeholder="Company name" />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4 }}>ROLE*</span>
                    <input style={input} value={newJob.job_title} onChange={(e) => setNewJob({ ...newJob, job_title: e.target.value })} placeholder="Job title" />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>LOCATION</span>
                    <input style={input} value={newJob.location} onChange={(e) => setNewJob({ ...newJob, location: e.target.value })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>JOB URL</span>
                    <input style={input} value={newJob.job_url} onChange={(e) => setNewJob({ ...newJob, job_url: e.target.value })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>SOURCE</span>
                    <SelectField value={newJob.application_location || "Company Website"} options={APP_LOCATIONS} onChange={(v) => setNewJob({ ...newJob, application_location: v })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>INTEREST</span>
                    <Stars count={newJob.interest_level} onClick={(n) => setNewJob({ ...newJob, interest_level: n })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>STATUS</span>
                    <SelectField value={newJob.application_status} options={APP_STATUSES} onChange={(v) => setNewJob({ ...newJob, application_status: v })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>DATE POSTED</span>
                    <input type="date" style={{ ...input, height: 38 }} value={newJob.date_posted} onChange={(e) => setNewJob({ ...newJob, date_posted: e.target.value })} />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>NOTES</span>
                  <textarea style={{ ...textarea, minHeight: 60 }} value={newJob.notes} onChange={(e) => setNewJob({ ...newJob, notes: e.target.value })} />
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button onClick={createApp} disabled={!newJob.company_name.trim() || !newJob.job_title.trim()} style={{ ...btnPrimary, opacity: !newJob.company_name.trim() || !newJob.job_title.trim() ? 0.4 : 1 }}>Save Job</button>
                  <button onClick={() => setShowAddJob(false)} style={{ ...btnSecondary, fontSize: 13 }}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Pipeline view */}
          {viewMode === "pipeline" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {(["saved", "applied", "interviewing", "offer", "rejected"] as const).map((status) => {
                const col = applications.filter((a) => a.application_status === status)
                const sc = STATUS_STYLE[status]
                return (
                  <div key={status} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12, padding: 12, minHeight: 300 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase", color: sc.color }}>{status}</span>
                      <span style={{ fontSize: 11, fontWeight: 900, color: sc.color }}>{col.length}</span>
                    </div>
                    {col.map((a) => {
                      const ds = DECISION_STYLE[a.signal_decision] || null
                      return (
                        <div
                          key={a.id}
                          onClick={() => { setExpandedId(a.id); setViewMode("list"); setFilterStatus("all") }}
                          style={{ background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer" }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 900, color: T.TEXT, opacity: 0.85 }}>{a.company_name}</div>
                          <div style={{ fontSize: 11, color: T.MUTED, marginTop: 2 }}>{a.job_title}</div>
                          {a.signal_score != null && ds && (
                            <div style={{ marginTop: 6, fontSize: 10, fontWeight: 900, color: ds.color }}>
                              {a.signal_decision} · {a.signal_score}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* List view */}
          {viewMode === "list" && (
            <div style={{ ...card, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1.2fr 1fr 1.2fr 0.7fr 0.9fr 0.8fr", padding: "10px 18px", background: "rgba(255,255,255,0.03)" }}>
                {["Company / Role", "Location", "Status", "SIGNAL", "Score", "Interest", "Actions"].map((h) => (
                  <span key={h} style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase", color: T.DIM }}>{h}</span>
                ))}
              </div>
              {/* Rows */}
              {filteredApps.length === 0 && (
                <div style={{ padding: "30px 18px", textAlign: "center", color: T.MUTED, fontSize: 13 }}>No applications yet. Add one to get started.</div>
              )}
              {filteredApps.map((a) => {
                const ss = STATUS_STYLE[a.application_status] || STATUS_STYLE.saved
                const ds = DECISION_STYLE[a.signal_decision] || null
                const expanded = expandedId === a.id
                return (
                  <div key={a.id}>
                    <div
                      onClick={() => setExpandedId(expanded ? null : a.id)}
                      style={{ display: "grid", gridTemplateColumns: "2.5fr 1.2fr 1fr 1.2fr 0.7fr 0.9fr 0.8fr", padding: "13px 18px", borderBottom: `1px solid rgba(255,255,255,0.06)`, cursor: "pointer", alignItems: "center", background: expanded ? "rgba(255,255,255,0.02)" : "transparent" }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: T.TEXT }}>{a.company_name}</div>
                        <div style={{ fontSize: 11, color: T.MUTED, marginTop: 2 }}>{a.job_title}</div>
                      </div>
                      <span style={{ fontSize: 12, color: T.MUTED }}>{a.location || "—"}</span>
                      <Pill text={a.application_status} style={ss} />
                      {ds ? <Pill text={a.signal_decision} style={ds} /> : <span style={{ fontSize: 12, color: T.DIM }}>—</span>}
                      <span style={{ fontSize: 14, fontWeight: 900, color: scoreColor(a.signal_score) }}>{a.signal_score ?? "—"}</span>
                      <Stars count={a.interest_level || 0} />
                      <button onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : a.id) }} style={{ background: "none", border: `1px solid ${T.BORDER_SOFT}`, color: T.MUTED, fontSize: 11, fontWeight: 900, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                        {expanded ? "Close" : "View"}
                      </button>
                    </div>

                    {/* Expanded detail */}
                    {expanded && (
                      <div style={{ padding: "20px 18px", borderBottom: `1px solid rgba(255,255,255,0.06)`, background: "rgba(255,255,255,0.02)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>STATUS</span>
                            <SelectField value={a.application_status} options={APP_STATUSES} onChange={(v) => updateApp(a.id, { application_status: v })} />
                          </div>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>APPLIED DATE</span>
                            <input type="date" style={{ ...input, height: 38 }} value={a.applied_date || ""} onBlur={(e) => updateApp(a.id, { applied_date: e.target.value || null })} onChange={(e) => setApplications((prev) => prev.map((x) => x.id === a.id ? { ...x, applied_date: e.target.value } : x))} />
                          </div>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>LOCATION</span>
                            <input style={{ ...input, height: 38 }} defaultValue={a.location || ""} onBlur={(e) => updateApp(a.id, { location: e.target.value })} />
                          </div>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>JOB URL</span>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <input style={{ ...input, height: 38, flex: 1 }} defaultValue={a.job_url || ""} onBlur={(e) => updateApp(a.id, { job_url: e.target.value })} />
                              {a.job_url && <a href={a.job_url} target="_blank" rel="noopener noreferrer" style={{ color: T.WRN_BLUE, fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }}>Open →</a>}
                            </div>
                          </div>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>SOURCE</span>
                            <SelectField value={a.application_location || "Company Website"} options={APP_LOCATIONS} onChange={(v) => updateApp(a.id, { application_location: v })} />
                          </div>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>INTEREST</span>
                            <Stars count={a.interest_level || 0} onClick={(n) => updateApp(a.id, { interest_level: n })} />
                          </div>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>COVER LETTER</span>
                            <button onClick={() => updateApp(a.id, { cover_letter_submitted: !a.cover_letter_submitted })} style={{
                              fontSize: 11, fontWeight: 900, padding: "4px 12px", borderRadius: 8, cursor: "pointer",
                              background: a.cover_letter_submitted ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)",
                              border: `1px solid ${a.cover_letter_submitted ? "rgba(74,222,128,0.25)" : T.BORDER_SOFT}`,
                              color: a.cover_letter_submitted ? "#4ade80" : T.MUTED,
                            }}>
                              {a.cover_letter_submitted ? "Submitted ✓" : "Not submitted"}
                            </button>
                          </div>
                          <div>
                            <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>REFERRAL</span>
                            <button onClick={() => updateApp(a.id, { referral: !a.referral })} style={{
                              fontSize: 11, fontWeight: 900, padding: "4px 12px", borderRadius: 8, cursor: "pointer",
                              background: a.referral ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.05)",
                              border: `1px solid ${a.referral ? "rgba(74,222,128,0.25)" : T.BORDER_SOFT}`,
                              color: a.referral ? "#4ade80" : T.MUTED,
                            }}>
                              {a.referral ? "Yes ✓" : "No"}
                            </button>
                          </div>
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>NOTES</span>
                          <textarea style={{ ...textarea, minHeight: 60 }} defaultValue={a.notes || ""} onBlur={(e) => updateApp(a.id, { notes: e.target.value })} />
                        </div>
                        {a.signal_score != null && ds && (
                          <div style={{ marginTop: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 16px", border: `1px solid ${T.BORDER_SOFT}`, display: "flex", alignItems: "center", gap: 14 }}>
                            <Pill text={a.signal_decision} style={ds} />
                            <span style={{ fontSize: 22, fontWeight: 900, color: scoreColor(a.signal_score) }}>{a.signal_score}</span>
                            <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${a.signal_score}%`, height: "100%", background: scoreColor(a.signal_score), borderRadius: 3 }} />
                            </div>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                          {["interviewing", "offer", "applied"].includes(a.application_status) && (
                            <button onClick={() => { setNewInterview({ ...newInterview, application_id: a.id }); setShowAddInterview(true); setActiveTab("interviews") }} style={{ ...btnSecondary, fontSize: 11, padding: "6px 14px", borderRadius: 8, color: "#a78bfa", borderColor: "rgba(167,139,250,0.3)" }}>
                              + Add Interview
                            </button>
                          )}
                          <button onClick={() => deleteApp(a.id)} style={{ background: "none", border: "none", color: "rgba(248,113,113,0.7)", fontSize: 12, cursor: "pointer", padding: 0 }}>
                            Delete Application
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════ INTERVIEWS TAB ══════ */}
      {activeTab === "interviews" && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {["all", "scheduled", "awaiting_feedback", "offer_extended"].map((s) => {
                const active = interviewFilter === s
                return (
                  <button key={s} onClick={() => setInterviewFilter(s)} style={{
                    background: active ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${active ? "rgba(167,139,250,0.35)" : T.BORDER_SOFT}`,
                    color: active ? "#a78bfa" : T.MUTED,
                    fontSize: 11, fontWeight: 900, borderRadius: 8, padding: "5px 12px", cursor: "pointer", textTransform: "capitalize",
                  }}>
                    {s.replace(/_/g, " ")}
                  </button>
                )
              })}
            </div>
            <button onClick={() => setShowAddInterview(!showAddInterview)} style={{ ...btnPrimary, fontSize: 11, padding: "6px 14px", borderRadius: 8 }}>
              + Log Interview
            </button>
          </div>

          {/* Add interview form */}
          {showAddInterview && (
            <div style={{ ...card, marginBottom: 16, border: "1px solid rgba(167,139,250,0.25)" }}>
              <div style={{ height: 3, background: "linear-gradient(90deg,#a78bfa,#51ADE5)" }} />
              <div style={{ padding: 20 }}>
                <div style={{ ...eyebrow, color: "#a78bfa", marginBottom: 14 }}>LOG INTERVIEW</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4 }}>APPLICATION*</span>
                    <select value={newInterview.application_id} onChange={(e) => setNewInterview({ ...newInterview, application_id: e.target.value })} style={{ ...input, height: 38, appearance: "auto" as any }}>
                      <option value="">Select application...</option>
                      {applications.map((a) => <option key={a.id} value={a.id}>{a.company_name} — {a.job_title}</option>)}
                    </select>
                  </div>
                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4 }}>STAGE*</span>
                    <SelectField value={newInterview.interview_stage} options={INTERVIEW_STAGES} onChange={(v) => setNewInterview({ ...newInterview, interview_stage: v })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>INTERVIEWER</span>
                    <input style={input} value={newInterview.interviewer_names} onChange={(e) => setNewInterview({ ...newInterview, interviewer_names: e.target.value })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>DATE</span>
                    <input type="date" style={{ ...input, height: 38 }} value={newInterview.interview_date} onChange={(e) => setNewInterview({ ...newInterview, interview_date: e.target.value })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>STATUS</span>
                    <SelectField value={newInterview.status} options={INTERVIEW_STATUSES} onChange={(v) => setNewInterview({ ...newInterview, status: v })} />
                  </div>
                  <div>
                    <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>CONFIDENCE</span>
                    <ConfidenceDots level={newInterview.confidence_level} onClick={(n) => setNewInterview({ ...newInterview, confidence_level: n })} />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <span style={{ ...label, color: T.DIM, display: "block", marginBottom: 4 }}>NOTES</span>
                  <textarea style={{ ...textarea, minHeight: 60 }} value={newInterview.notes} onChange={(e) => setNewInterview({ ...newInterview, notes: e.target.value })} />
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button onClick={createInterview} disabled={!newInterview.application_id} style={{ ...btnPrimary, opacity: !newInterview.application_id ? 0.4 : 1 }}>Log Interview</button>
                  <button onClick={() => setShowAddInterview(false)} style={{ ...btnSecondary, fontSize: 13 }}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Interview cards */}
          {filteredInterviews.length === 0 && <p style={{ color: T.MUTED, fontSize: 13 }}>No interviews logged yet.</p>}
          {filteredInterviews.map((iv) => {
            const ss = STATUS_STYLE[iv.status] || STATUS_STYLE.saved
            const grad = INTERVIEW_GRADIENT[iv.status] || INTERVIEW_GRADIENT.not_scheduled
            const ds = DECISION_STYLE[iv.signal_decision] || null
            return (
              <div key={iv.id} style={{ ...card, marginBottom: 12 }}>
                <div style={{ height: 3, background: grad }} />
                <div style={{ padding: "16px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.WRN_ORANGE }}>{iv.interview_stage.replace(/_/g, " ")}</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: T.TEXT, marginTop: 4 }}>{iv.company_name}</div>
                      <div style={{ fontSize: 12, color: T.MUTED, marginTop: 2 }}>{iv.job_title}</div>
                    </div>
                    <Pill text={iv.status.replace(/_/g, " ")} style={ss} />
                  </div>
                  <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>INTERVIEWER</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.TEXT, marginTop: 2 }}>{iv.interviewer_names || "—"}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>DATE</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.TEXT, marginTop: 2 }}>{formatDate(iv.interview_date)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>THANK YOU</div>
                      <button onClick={() => toggleThankYou(iv)} style={{
                        marginTop: 2, fontSize: 11, fontWeight: 900, padding: "2px 10px", borderRadius: 6, cursor: "pointer",
                        background: iv.thank_you_sent ? "rgba(74,222,128,0.12)" : "rgba(248,113,113,0.1)",
                        border: `1px solid ${iv.thank_you_sent ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.2)"}`,
                        color: iv.thank_you_sent ? "#4ade80" : "#f87171",
                      }}>
                        {iv.thank_you_sent ? "Sent ✓" : "Not sent"}
                      </button>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>CONFIDENCE</div>
                      <div style={{ marginTop: 4 }}><ConfidenceDots level={iv.confidence_level || 3} /></div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>SIGNAL</div>
                      <div style={{ marginTop: 2 }}>
                        {ds ? <><Pill text={iv.signal_decision} style={ds} /> <span style={{ fontSize: 12, fontWeight: 900, color: scoreColor(iv.signal_score), marginLeft: 6 }}>{iv.signal_score}</span></> : <span style={{ fontSize: 12, color: T.DIM }}>—</span>}
                      </div>
                    </div>
                  </div>
                  {iv.notes && <p style={{ fontSize: 12, color: T.MUTED, marginTop: 10, lineHeight: "18px" }}>{iv.notes}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══════ INSIGHTS TAB ══════ */}
      {activeTab === "insights" && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Top category */}
            <div style={{ ...card, padding: "16px 18px" }}>
              <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.DIM }}>TOP CATEGORY</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: T.WRN_ORANGE, marginTop: 8 }}>
                {(() => {
                  const highScored = applications.filter((a) => (a.signal_score || 0) >= 75)
                  if (highScored.length < 5) return "Not enough data yet"
                  const words: Record<string, number> = {}
                  highScored.forEach((a) => { const w = (a.job_title || "").split(/\s+/)[0]; if (w) words[w] = (words[w] || 0) + 1 })
                  const sorted = Object.entries(words).sort((a, b) => b[1] - a[1])
                  return sorted[0]?.[0] || "—"
                })()}
              </div>
            </div>
            {/* Interview rate */}
            <div style={{ ...card, padding: "16px 18px" }}>
              <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.DIM }}>INTERVIEW RATE</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: T.WRN_BLUE, marginTop: 8 }}>{interviewRate}%</div>
              <div style={{ fontSize: 11, color: T.MUTED, marginTop: 4 }}>{interviews.length} interviews from {applied.length} applications</div>
            </div>
            {/* High score unapplied */}
            <div style={{ ...card, padding: "16px 18px" }}>
              <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.DIM }}>HIGH SCORE UNAPPLIED</div>
              {(() => {
                const count = applications.filter((a) => (a.signal_score || 0) >= 75 && a.application_status === "saved").length
                return (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 900, color: T.WRN_ORANGE, marginTop: 8 }}>{count}</div>
                    <div style={{ fontSize: 11, color: T.MUTED, marginTop: 4 }}>Score 75+ but not yet applied</div>
                    {count > 0 && <button onClick={() => { setActiveTab("applications"); setFilterStatus("saved") }} style={{ background: "none", border: "none", color: T.WRN_BLUE, fontSize: 11, fontWeight: 900, cursor: "pointer", padding: 0, marginTop: 6 }}>Review them →</button>}
                  </>
                )
              })()}
            </div>
            {/* Avg score */}
            <div style={{ ...card, padding: "16px 18px" }}>
              <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.DIM }}>AVG SIGNAL SCORE</div>
              {(() => {
                const scores = applications.map((a) => a.signal_score).filter((s: any) => s != null) as number[]
                const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
                return <div style={{ fontSize: 28, fontWeight: 900, color: scores.length ? scoreColor(avg) : T.DIM, marginTop: 8 }}>{scores.length ? avg : "—"}</div>
              })()}
            </div>
          </div>

          {/* Status bar chart */}
          <div style={{ ...card, padding: "16px 18px", marginTop: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.DIM, marginBottom: 14 }}>APPLICATIONS BY STATUS</div>
            {(() => {
              const counts = APP_STATUSES.map((s) => ({ status: s, count: applications.filter((a) => a.application_status === s).length })).filter((c) => c.count > 0)
              const max = Math.max(...counts.map((c) => c.count), 1)
              return counts.map((c) => {
                const sc = STATUS_STYLE[c.status]
                return (
                  <div key={c.status} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ width: 100, fontSize: 11, fontWeight: 900, color: sc.color, textTransform: "capitalize" }}>{c.status}</span>
                    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(c.count / max) * 100}%`, height: "100%", background: sc.color, borderRadius: 3 }} />
                    </div>
                    <span style={{ width: 20, textAlign: "right", fontSize: 12, fontWeight: 900, color: T.TEXT }}>{c.count}</span>
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
