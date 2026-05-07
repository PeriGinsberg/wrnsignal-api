"use client"

import React, { useEffect, useState, useCallback } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import {
  T,
  input,
  textarea,
  btnPrimary,
  btnSecondary,
  card,
  eyebrow,
  label,
} from "../../../../../lib/dashboard-theme"
import ProfilePersonasTab, { type ClientProfileFull, type ClientPersonaFull } from "./ProfilePersonasTab"

type Tab = "tracker" | "source" | "history" | "analysis"

// The Profile & Personas tab needs the full editable shape; other tabs
// only read .name / .email / .id / .is_default — all subsets of these.
type ClientProfile = ClientProfileFull
type ClientPersona = ClientPersonaFull

type CoachRec = {
  id: string
  company: string
  title: string
  priority: string | null
  coaching_note: string | null
  client_status: string | null
  apply_by: string | null
  verdict: string | null
  recommended_action: string | null
  created_at: string | null
}

type ClientApplication = {
  id: string
  company_name: string
  job_title: string
  application_status: string
  signal_decision: string | null
  signal_score: number | null
  job_url: string | null
  created_at: string | null
  coach_annotations: any[]
}

type HistoryRun = {
  id: string
  company: string | null
  title: string | null
  decision: string | null
  score: number | null
  created_at: string
}

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
    },
  })
}

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  urgent: { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
  high: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  normal: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
}

const DECISION_STYLE: Record<string, { bg: string; color: string }> = {
  "Priority Apply": { bg: "rgba(15,214,104,0.15)", color: "#0FD668" },
  Apply: { bg: "rgba(74,222,128,0.12)", color: "#4ade80" },
  Review: { bg: "rgba(212,164,68,0.15)", color: "#D4A444" },
  Pass: { bg: "rgba(232,112,112,0.12)", color: "#E87070" },
}

function Badge({ text, style: s }: { text: string; style: { bg: string; color: string } }) {
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase",
      padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  )
}

export default function CoachClientPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const clientId = params.clientId as string

  const initialTab = (searchParams.get("tab") as Tab) || "tracker"
  const [tab, setTab] = useState<Tab>(initialTab)

  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null)
  const [clientPersonas, setClientPersonas] = useState<ClientPersona[]>([])
  const [coachRecs, setCoachRecs] = useState<CoachRec[]>([])
  const [clientApps, setClientApps] = useState<ClientApplication[]>([])
  const [historyRuns, setHistoryRuns] = useState<HistoryRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Source tab state
  const [sourceUrl, setSourceUrl] = useState("")
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [sourceCompany, setSourceCompany] = useState("")
  const [sourceTitle, setSourceTitle] = useState("")
  const [sourceJD, setSourceJD] = useState("")
  const [selectedPersona, setSelectedPersona] = useState("")
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<any>(null)

  // Annotation state (sent with run)
  const [annPriority, setAnnPriority] = useState("this_week")
  const [annAction, setAnnAction] = useState("apply")
  const [annNote, setAnnNote] = useState("")
  const [annApplyBy, setAnnApplyBy] = useState("")
  const [runError, setRunError] = useState("")
  const [runSuccess, setRunSuccess] = useState(false)
  const [showAnnotation, setShowAnnotation] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [recsExpanded, setRecsExpanded] = useState(false)
  const [editingRecId, setEditingRecId] = useState<string | null>(null)
  const [editRecNote, setEditRecNote] = useState("")
  const [editRecPriority, setEditRecPriority] = useState("")
  const [editRecAction, setEditRecAction] = useState("")
  const [editRecApplyBy, setEditRecApplyBy] = useState("")
  const [savingRec, setSavingRec] = useState(false)

  // Application card expand state (tracker tab)
  const [openAppIds, setOpenAppIds] = useState<Set<string>>(new Set())
  const [annotatingAppId, setAnnotatingAppId] = useState<string | null>(null)
  const [annotationNote, setAnnotationNote] = useState("")
  const [annotationPriority, setAnnotationPriority] = useState("info")
  const [annotationVisible, setAnnotationVisible] = useState(true)
  const [annotationSaving, setAnnotationSaving] = useState(false)

  // LinkedIn helper state (source tab)
  const [showLinkedInHelper, setShowLinkedInHelper] = useState(false)
  const [linkedInPasteText, setLinkedInPasteText] = useState("")

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [trackerRes, profileRes] = await Promise.all([
        authFetch(`/api/coach/clients/${clientId}/tracker`),
        authFetch(`/api/coach/clients/${clientId}/profile`),
      ])

      if (!trackerRes.ok || !profileRes.ok) {
        setError("Failed to load client data")
        setLoading(false)
        return
      }

      const trackerData = await trackerRes.json()
      const profileData = await profileRes.json()

      setClientProfile(profileData.profile || null)
      setClientPersonas(profileData.personas || [])
      setClientApps(trackerData.applications || [])
      setCoachRecs(trackerData.recommendations || [])
      setHistoryRuns(trackerData.history || [])

      // Default to first ACTIVE persona for the Source-a-Job selector.
      // Archived personas should never be auto-selected for new analyses.
      const personas = profileData.personas || []
      const activePersonas = personas.filter((p: ClientPersona) => !p.archived_at)
      if (activePersonas.length > 0 && !selectedPersona) {
        const def = activePersonas.find((p: ClientPersona) => p.is_default) || activePersonas[0]
        setSelectedPersona(def.id)
      }
    } catch {
      setError("Failed to load client data")
    }
    setLoading(false)
  }, [clientId])

  useEffect(() => { loadAll() }, [loadAll])

  async function fetchUrl() {
    if (!sourceUrl.trim()) return
    setFetchingUrl(true)
    setShowLinkedInHelper(false)
    setRunError('')
    try {
      const res = await authFetch("/api/parse-job-url", {
        method: "POST",
        body: JSON.stringify({ url: sourceUrl.trim() }),
      })
      const j = await res.json()
      if (res.ok) {
        if (j.jobDescription) setSourceJD(j.jobDescription)
        if (j.companyName) setSourceCompany(j.companyName)
        if (j.jobTitle) setSourceTitle(j.jobTitle)
        if (!j.jobDescription && !j.companyName && !j.jobTitle) {
          setRunError("Fetched the URL but could not extract job details. Try pasting the job description manually below.")
        }
      } else if (j.code === "LINKEDIN") {
        setShowLinkedInHelper(true)
        setLinkedInPasteText("")
      } else {
        setRunError(j.error || "Failed to fetch job details from this URL. Try pasting the description manually.")
      }
    } catch {
      setRunError("Network error fetching URL. Please try again or paste the job description manually.")
    } finally {
      setFetchingUrl(false)
    }
  }

  async function parseLinkedInPaste() {
    if (!linkedInPasteText.trim()) return
    if (linkedInPasteText.trim().length < 50) {
      setRunError("Please paste more content — select the full job page, not just the title.")
      return
    }
    setFetchingUrl(true)
    setRunError('')
    try {
      const res = await authFetch("/api/parse-job-text", {
        method: "POST",
        body: JSON.stringify({ text: linkedInPasteText.trim() }),
      })
      const j = await res.json()
      if (!res.ok) {
        setRunError(j.error || "Failed to parse the pasted text. Try pasting more content or enter the job details manually.")
        return
      }
      const hasDescription = j.jobDescription && j.jobDescription.length > 20
      const hasTitle = j.jobTitle && j.jobTitle.length > 1
      const hasCompany = j.companyName && j.companyName.length > 1
      if (!hasDescription && !hasTitle && !hasCompany) {
        setRunError("Could not extract job details from the pasted text. Try copying the entire page, or enter the company, title, and description manually below.")
        return
      }
      if (j.jobDescription) setSourceJD(j.jobDescription)
      if (j.companyName) setSourceCompany(j.companyName)
      if (j.jobTitle) setSourceTitle(j.jobTitle)
      setShowLinkedInHelper(false)
      setLinkedInPasteText("")
      if (!hasDescription) {
        setRunError("Extracted company and title but the job description was too short. Paste the full description in the Job Description field below.")
      }
    } catch {
      setRunError("Network error. Please try again or enter the job details manually.")
    } finally {
      setFetchingUrl(false)
    }
  }

  function clearSourceForm() {
    setSourceUrl(''); setSourceCompany(''); setSourceTitle(''); setSourceJD('')
    {
      const active = clientPersonas.filter(p => !p.archived_at)
      setSelectedPersona(active.find(p => p.is_default)?.id || active[0]?.id || '')
    }
    setRunResult(null); setShowAnnotation(false); setSendSuccess(false)
    setAnnPriority('this_week'); setAnnAction('apply'); setAnnNote(''); setAnnApplyBy('')
    setRunError('')
  }

  async function runDryAnalysis() {
    if (!sourceJD.trim() || !selectedPersona) return
    setRunning(true); setRunResult(null); setRunError(''); setSendSuccess(false); setShowAnnotation(false)
    try {
      const res = await authFetch("/api/coach/recommend-job", {
        method: "POST",
        body: JSON.stringify({
          client_profile_id: clientId,
          persona_id: selectedPersona,
          company_name: sourceCompany,
          job_title: sourceTitle,
          job_description: sourceJD,
          job_url: sourceUrl || null,
          dry_run: true,
        }),
      })
      const j = await res.json()
      if (res.ok) {
        setRunResult(j.jobfit || j)
        const decision = j.jobfit?.decision || j.decision || ''
        if (decision === 'Priority Apply') { setAnnPriority('urgent'); setAnnAction('apply'); setAnnNote('Strong fit — apply immediately. This aligns well with your background.') }
        else if (decision === 'Apply') { setAnnPriority('this_week'); setAnnAction('apply'); setAnnNote('Good opportunity worth pursuing this week.') }
        else if (decision === 'Review') { setAnnPriority('when_ready'); setAnnAction('research_first'); setAnnNote('Proceed carefully — review the requirements against your background before applying.') }
        else { setAnnPriority('not_recommended'); setAnnAction('skip'); setAnnNote('Low fit based on your current profile — flagging for your awareness.') }
      } else {
        setRunError(j.error || "Analysis failed.")
      }
    } catch { setRunError("Network error.") }
    setRunning(false)
  }

  async function sendToClientDashboard() {
    if (annNote.trim().length < 20) return
    setSending(true)
    try {
      const res = await authFetch("/api/coach/recommend-job", {
        method: "POST",
        body: JSON.stringify({
          client_profile_id: clientId,
          persona_id: selectedPersona,
          company_name: sourceCompany,
          job_title: sourceTitle,
          job_description: sourceJD,
          job_url: sourceUrl || null,
          dry_run: false,
          cached_analysis: runResult,
          priority: annPriority,
          coaching_note: annNote,
          recommended_action: annAction,
          apply_by_date: annApplyBy || null,
        }),
      })
      if (res.ok) {
        setSendSuccess(true)
        setRunSuccess(true)
        await loadAll()
        setTimeout(() => clearSourceForm(), 3000)
      } else {
        const j = await res.json()
        setRunError(j.error || "Failed to send.")
      }
    } catch { setRunError("Network error.") }
    setSending(false)
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "tracker", label: "Job Tracker" },
    { id: "source", label: "Source a Job" },
    { id: "history", label: "Analyses History" },
    { id: "analysis", label: "Profile & Personas" },
  ]

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>
  if (error) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>

  return (
    <div>
      {/* Context banner */}
      <div style={{
        background: "rgba(254,176,106,0.07)",
        border: "1px solid rgba(254,176,106,0.18)",
        borderRadius: 14,
        padding: "14px 20px",
        marginBottom: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 4 }}>COACHING SESSION</div>
          <span style={{ fontSize: 16, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>
            {clientProfile?.name || clientProfile?.email || "Client"}
          </span>
          {clientProfile?.email && clientProfile.name && (
            <span style={{ fontSize: 12, color: T.DIM, marginLeft: 10 }}>{clientProfile.email}</span>
          )}
        </div>
        <a
          href="/dashboard/coach"
          style={{ fontSize: 12, fontWeight: 900, color: T.WRN_ORANGE, textDecoration: "none" }}
        >
          ← Back to My Clients
        </a>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 28, borderBottom: `1px solid ${T.BORDER_SOFT}`, paddingBottom: 12 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              fontSize: 12, fontWeight: 900, padding: "8px 16px", borderRadius: 10, cursor: "pointer",
              border: tab === t.id ? `1px solid rgba(254,176,106,0.35)` : `1px solid ${T.BORDER_SOFT}`,
              background: tab === t.id ? "rgba(254,176,106,0.08)" : "rgba(255,255,255,0.04)",
              color: tab === t.id ? T.WRN_ORANGE : T.MUTED,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1 — Job Tracker */}
      {tab === "tracker" && (
        <div>
          {/* Section A: From You (collapsible) */}
          <div style={{ marginBottom: 32 }}>
            <div
              onClick={() => setRecsExpanded(!recsExpanded)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: recsExpanded ? 12 : 0 }}
            >
              <div style={{ ...eyebrow, color: T.WRN_ORANGE }}>
                FROM YOU — COACH RECOMMENDATIONS {coachRecs.length > 0 && <span style={{ color: T.DIM, fontWeight: 700 }}>({coachRecs.length})</span>}
              </div>
              <span style={{ fontSize: 12, color: T.DIM }}>{recsExpanded ? "▲" : "▼"}</span>
            </div>
            {!recsExpanded ? null : coachRecs.length === 0 ? (
              <p style={{ color: T.MUTED, fontSize: 13 }}>No recommendations sent yet. Use the "Source a Job" tab to find and send jobs.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {coachRecs.map((rec) => {
                  const sentDate = rec.created_at
                    ? new Date(rec.created_at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
                    : null
                  const priorityLabels: Record<string, string> = { urgent: "Urgent", this_week: "This Week", when_ready: "When Ready", not_recommended: "For Awareness" }
                  const priorityLabel = rec.priority ? priorityLabels[rec.priority] || rec.priority : null

                  return (
                    <div key={rec.id} style={{ ...card, padding: 20 }}>
                      {/* Company + title + verdict */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 950, color: T.TEXT }}>{rec.company}</span>
                        <span style={{ fontSize: 13, color: T.MUTED }}>— {rec.title}</span>
                        {rec.verdict && (
                          <Badge text={rec.verdict} style={DECISION_STYLE[rec.verdict] || { bg: "rgba(255,255,255,0.08)", color: T.MUTED }} />
                        )}
                      </div>

                      {/* Sent date + priority pill */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        {sentDate && (
                          <span style={{ fontSize: 12, color: T.MUTED }}>
                            <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1, color: T.DIM, marginRight: 6 }}>SENT</span>
                            {sentDate}
                          </span>
                        )}
                        {priorityLabel && (
                          <span style={{
                            fontSize: 9, fontWeight: 900, padding: "2px 8px", borderRadius: 99, letterSpacing: 0.5,
                            ...(PRIORITY_STYLE[rec.priority || ""] || PRIORITY_STYLE.normal),
                          }}>
                            {priorityLabel}
                          </span>
                        )}
                      </div>

                      {/* Inline edit form */}
                      {editingRecId === rec.id ? (
                        <div style={{ marginBottom: 8, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10, border: `1px solid ${T.BORDER_SOFT}` }}>
                          <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 10 }}>EDIT RECOMMENDATION</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <div>
                              <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4, fontSize: 9 }}>COACHING NOTE</span>
                              <textarea style={{ ...textarea, minHeight: 60 }} value={editRecNote} onChange={(e) => setEditRecNote(e.target.value)} placeholder="Your coaching note..." />
                            </div>
                            <div style={{ display: "flex", gap: 12 }}>
                              <div style={{ flex: 1 }}>
                                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4, fontSize: 9 }}>PRIORITY</span>
                                <select style={{ ...input, cursor: "pointer", colorScheme: "dark", height: 38 } as React.CSSProperties} value={editRecPriority} onChange={(e) => setEditRecPriority(e.target.value)}>
                                  <option value="urgent" style={{ background: "#0a1628" }}>Urgent</option>
                                  <option value="this_week" style={{ background: "#0a1628" }}>This Week</option>
                                  <option value="when_ready" style={{ background: "#0a1628" }}>When Ready</option>
                                  <option value="not_recommended" style={{ background: "#0a1628" }}>For Awareness</option>
                                </select>
                              </div>
                              <div style={{ flex: 1 }}>
                                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4, fontSize: 9 }}>ACTION</span>
                                <select style={{ ...input, cursor: "pointer", colorScheme: "dark", height: 38 } as React.CSSProperties} value={editRecAction} onChange={(e) => setEditRecAction(e.target.value)}>
                                  <option value="apply" style={{ background: "#0a1628" }}>Apply</option>
                                  <option value="research_first" style={{ background: "#0a1628" }}>Research First</option>
                                  <option value="hold" style={{ background: "#0a1628" }}>Hold</option>
                                  <option value="skip" style={{ background: "#0a1628" }}>Skip</option>
                                </select>
                              </div>
                              <div style={{ flex: 1 }}>
                                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4, fontSize: 9 }}>APPLY BY</span>
                                <input type="date" style={{ ...input, height: 38, colorScheme: "dark" } as React.CSSProperties} value={editRecApplyBy} onChange={(e) => setEditRecApplyBy(e.target.value)} />
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                            <button
                              disabled={savingRec}
                              onClick={async () => {
                                setSavingRec(true)
                                try {
                                  await authFetch(`/api/coach/recommendations/${rec.id}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({
                                      coaching_note: editRecNote || null,
                                      priority: editRecPriority,
                                      recommended_action: editRecAction,
                                      apply_by_date: editRecApplyBy || null,
                                    }),
                                  })
                                  setCoachRecs(prev => prev.map(r => r.id === rec.id ? { ...r, coaching_note: editRecNote || null, priority: editRecPriority, recommended_action: editRecAction, apply_by: editRecApplyBy || null } : r))
                                  setEditingRecId(null)
                                } catch {}
                                setSavingRec(false)
                              }}
                              style={{ ...btnPrimary, fontSize: 12, padding: "8px 18px", opacity: savingRec ? 0.5 : 1 }}
                            >
                              {savingRec ? "Saving..." : "Save Changes"}
                            </button>
                            <button onClick={() => setEditingRecId(null)} style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Coaching note (read-only) */}
                          {rec.coaching_note && (
                            <div style={{ marginBottom: 8 }}>
                              <p style={{ fontSize: 12, color: T.MUTED, lineHeight: "18px" }}>
                                <span style={{ color: T.WRN_ORANGE, fontWeight: 900 }}>Note: </span>
                                {rec.coaching_note}
                              </p>
                            </div>
                          )}

                          {/* Client status + apply by */}
                          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
                            {rec.client_status && (
                              <span style={{ fontSize: 11, color: T.DIM }}>
                                Client: <span style={{ color: T.TEXT, fontWeight: 700 }}>{rec.client_status}</span>
                              </span>
                            )}
                            {rec.apply_by && (
                              <span style={{ fontSize: 11, color: T.DIM }}>
                                Apply by: <span style={{ color: T.WRN_ORANGE, fontWeight: 700 }}>{rec.apply_by}</span>
                              </span>
                            )}
                            {rec.recommended_action && (
                              <span style={{ fontSize: 11, color: T.DIM }}>
                                Action: <span style={{ color: T.TEXT, fontWeight: 700 }}>{rec.recommended_action.replace(/_/g, " ")}</span>
                              </span>
                            )}
                          </div>

                          {/* Edit button */}
                          <button
                            onClick={() => {
                              setEditingRecId(rec.id)
                              setEditRecNote(rec.coaching_note || "")
                              setEditRecPriority(rec.priority || "this_week")
                              setEditRecAction(rec.recommended_action || "apply")
                              setEditRecApplyBy(rec.apply_by || "")
                            }}
                            style={{ background: "none", border: `1px solid ${T.BORDER_SOFT}`, color: T.MUTED, fontSize: 11, fontWeight: 900, borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Section B: Their Applications */}
          <div>
            <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 12 }}>THEIR APPLICATIONS</div>
            {clientApps.length === 0 ? (
              <p style={{ color: T.MUTED, fontSize: 13 }}>No applications tracked yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {clientApps.map((app) => {
                  const isOpen = openAppIds.has(app.id)
                  const isAnnotating = annotatingAppId === app.id
                  return (
                    <div key={app.id} style={{ ...card, padding: 18 }}>
                      {/* Clickable header row */}
                      <div
                        onClick={() => {
                          setOpenAppIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(app.id)) next.delete(app.id)
                            else next.add(app.id)
                            return next
                          })
                        }}
                        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer", userSelect: "none" }}
                      >
                        <span style={{ fontSize: 14, fontWeight: 950, color: T.TEXT }}>{app.company_name}</span>
                        <span style={{ fontSize: 13, color: T.MUTED }}>— {app.job_title}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 999,
                          background: "rgba(255,255,255,0.06)", color: T.MUTED,
                        }}>
                          {app.application_status}
                        </span>
                        {app.signal_decision && (
                          <Badge text={app.signal_decision} style={DECISION_STYLE[app.signal_decision] || { bg: "rgba(255,255,255,0.08)", color: T.MUTED }} />
                        )}
                        {app.signal_score !== null && (
                          <span style={{ fontSize: 11, color: T.DIM }}>Score: {app.signal_score}</span>
                        )}
                        <span style={{ marginLeft: "auto", fontSize: 12, color: T.DIM }}>{isOpen ? "▲" : "▼"}</span>
                      </div>

                      {/* Expanded content */}
                      {isOpen && (
                        <div style={{ marginTop: 14, borderTop: `1px solid ${T.BORDER_SOFT}`, paddingTop: 14 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                            <div style={{ fontSize: 12, color: T.DIM }}>
                              <span style={{ color: T.MUTED, fontWeight: 700 }}>URL: </span>
                              {app.job_url
                                ? <a href={app.job_url} target="_blank" rel="noopener noreferrer" style={{ color: T.WRN_BLUE, textDecoration: "underline" }}>{app.job_url}</a>
                                : <span style={{ color: T.DIM }}>No URL saved</span>
                              }
                            </div>
                            {app.created_at && (
                              <div style={{ fontSize: 12, color: T.DIM }}>
                                <span style={{ color: T.MUTED, fontWeight: 700 }}>Date: </span>
                                {new Date(app.created_at).toLocaleDateString()}
                              </div>
                            )}
                          </div>

                          {/* Existing annotations */}
                          {app.coach_annotations?.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ ...eyebrow, fontSize: 9, color: T.DIM, marginBottom: 6 }}>YOUR NOTES</div>
                              {app.coach_annotations.map((ann: any, i: number) => (
                                <p key={i} style={{ fontSize: 12, color: T.MUTED, lineHeight: "18px", marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${T.WRN_ORANGE}40` }}>
                                  {ann.note}
                                </p>
                              ))}
                            </div>
                          )}

                          {/* Add coaching note button / inline form */}
                          {!isAnnotating ? (
                            <button
                              onClick={() => {
                                setAnnotatingAppId(app.id)
                                setAnnotationNote("")
                                setAnnotationPriority("info")
                                setAnnotationVisible(true)
                              }}
                              style={{ ...btnSecondary, fontSize: 11, padding: "6px 14px", borderRadius: 8, color: T.WRN_ORANGE, borderColor: "rgba(254,176,106,0.3)" }}
                            >
                              + Add coaching note
                            </button>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                              <div>
                                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5, fontSize: 9 }}>PRIORITY</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                  {(["urgent", "important", "info", "positive"] as const).map((p) => (
                                    <button
                                      key={p}
                                      onClick={() => setAnnotationPriority(p)}
                                      style={{
                                        fontSize: 10, fontWeight: 900, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                                        textTransform: "uppercase", letterSpacing: 0.6,
                                        border: annotationPriority === p ? `1px solid ${T.WRN_ORANGE}50` : `1px solid ${T.BORDER_SOFT}`,
                                        background: annotationPriority === p ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.03)",
                                        color: annotationPriority === p ? T.WRN_ORANGE : T.DIM,
                                      }}
                                    >
                                      {p}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <textarea
                                style={{ ...textarea, minHeight: 60, fontSize: 12 }}
                                placeholder="Coaching note..."
                                value={annotationNote}
                                onChange={(e) => setAnnotationNote(e.target.value)}
                              />
                              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.MUTED, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={annotationVisible}
                                  onChange={(e) => setAnnotationVisible(e.target.checked)}
                                  style={{ accentColor: T.WRN_ORANGE }}
                                />
                                Visible to client
                              </label>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={async () => {
                                    if (!annotationNote.trim()) return
                                    setAnnotationSaving(true)
                                    try {
                                      const res = await authFetch("/api/coach/annotate", {
                                        method: "POST",
                                        body: JSON.stringify({
                                          client_profile_id: clientId,
                                          target_type: "application",
                                          target_id: app.id,
                                          application_id: app.id,
                                          note: annotationNote,
                                          priority: annotationPriority,
                                          visible_to_client: annotationVisible,
                                        }),
                                      })
                                      if (res.ok) {
                                        setAnnotatingAppId(null)
                                        setAnnotationNote("")
                                        await loadAll()
                                      }
                                    } finally {
                                      setAnnotationSaving(false)
                                    }
                                  }}
                                  disabled={annotationSaving || !annotationNote.trim()}
                                  style={{ ...btnPrimary, fontSize: 11, padding: "6px 14px", background: "#FEB06A", color: "#04060F", opacity: annotationSaving || !annotationNote.trim() ? 0.5 : 1 }}
                                >
                                  {annotationSaving ? "Saving..." : "Save Note"}
                                </button>
                                <button
                                  onClick={() => setAnnotatingAppId(null)}
                                  style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2 — Source a Job */}
      {tab === "source" && (
        <div style={{ maxWidth: 700 }}>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>SOURCE A JOB FOR {clientProfile?.name?.toUpperCase() || "CLIENT"}</div>

          {/* Step indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
            {[
              { n: 1, label: "Job Details", done: sourceJD.length > 50 },
              { n: 2, label: "Run Analysis", done: !!runResult },
              { n: 3, label: "Review Results", done: showAnnotation },
              { n: 4, label: "Send to Client", done: sendSuccess },
            ].map((step, i) => (
              <React.Fragment key={step.n}>
                {i > 0 && (
                  <div style={{
                    flex: 1, height: 1,
                    background: step.done ? T.WRN_ORANGE : "rgba(255,255,255,0.1)",
                  }} />
                )}
                <div style={{
                  width: 24, height: 24, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 900,
                  background: step.done ? T.WRN_ORANGE : "rgba(255,255,255,0.08)",
                  color: step.done ? "#04060F" : T.DIM,
                  flexShrink: 0,
                }}>
                  {step.done ? "✓" : step.n}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: step.done ? T.WRN_ORANGE : T.DIM, whiteSpace: "nowrap" }}>{step.label}</span>
              </React.Fragment>
            ))}
          </div>

          {/* STEP 1 — Job Details (always visible) */}
          <div style={{ marginBottom: 24 }}>
            {/* URL fetch block */}
            <div style={{ ...card, padding: 24, marginBottom: 20 }}>
              <div style={{ ...eyebrow, color: T.WRN_BLUE, fontSize: 9, marginBottom: 10 }}>FETCH FROM URL</div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="url"
                  style={{ ...input, flex: 1 }}
                  placeholder="Paste job posting URL..."
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
                <button
                  onClick={fetchUrl}
                  disabled={fetchingUrl || !sourceUrl.trim()}
                  style={{ ...btnSecondary, fontSize: 12, padding: "0 18px", whiteSpace: "nowrap", opacity: fetchingUrl ? 0.5 : 1 }}
                >
                  {fetchingUrl ? "Fetching..." : "Fetch JD"}
                </button>
              </div>
              <p style={{ fontSize: 11, color: T.DIM, marginTop: 8 }}>
                LinkedIn, Greenhouse, Lever, Workday, and most ATS URLs supported
              </p>
            </div>

            {/* LinkedIn helper */}
            {showLinkedInHelper && (
              <div style={{
                background: "rgba(253,186,40,0.08)", border: "1px solid rgba(253,186,40,0.3)",
                borderRadius: 14, padding: 20, marginBottom: 20,
              }}>
                <div style={{ ...eyebrow, color: "#FBBF24", fontSize: 9, marginBottom: 8 }}>LINKEDIN — PASTE MANUALLY</div>
                <p style={{ fontSize: 12, color: T.MUTED, marginBottom: 12, lineHeight: "18px" }}>
                  LinkedIn blocks automated access. Open the job posting in your browser, select all the text (Ctrl+A / Cmd+A), copy it, and paste it below.
                </p>
                <textarea
                  style={{ ...textarea, minHeight: 120, marginBottom: 10 }}
                  placeholder="Paste the full LinkedIn job page text here..."
                  value={linkedInPasteText}
                  onChange={(e) => setLinkedInPasteText(e.target.value)}
                />
                <button
                  onClick={parseLinkedInPaste}
                  disabled={fetchingUrl || !linkedInPasteText.trim()}
                  style={{ ...btnSecondary, fontSize: 12, padding: "8px 18px", opacity: fetchingUrl || !linkedInPasteText.trim() ? 0.5 : 1 }}
                >
                  {fetchingUrl ? "Parsing..." : "Parse Text →"}
                </button>
              </div>
            )}

            {/* Error from fetch/parse */}
            {runError && (
              <div style={{ marginBottom: 14, padding: 12, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10 }}>
                <span style={{ fontSize: 13, color: "#f87171", fontWeight: 700 }}>{runError}</span>
              </div>
            )}

            {/* Manual entry */}
            <div style={{ ...eyebrow, color: T.DIM, fontSize: 9, textAlign: "center", marginBottom: 16 }}>OR ENTER MANUALLY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>COMPANY</span>
                <input type="text" style={input} placeholder="Company name" value={sourceCompany} onChange={(e) => setSourceCompany(e.target.value)} />
              </div>
              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>JOB TITLE</span>
                <input type="text" style={input} placeholder="Job title" value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} />
              </div>
              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>JOB APPLICATION URL</span>
                <input type="url" style={input} placeholder="https://... (link where client should apply)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
                <p style={{ fontSize: 11, color: T.DIM, marginTop: 4 }}>This link will appear on the client's tracker so they can apply directly</p>
              </div>
              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>JOB DESCRIPTION</span>
                <textarea
                  style={{ ...textarea, minHeight: 200 }}
                  placeholder="Paste the full job description here..."
                  value={sourceJD}
                  onChange={(e) => setSourceJD(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* STEP 2 — Persona + Run Analysis (visible once JD has content) */}
          {sourceJD.length > 50 && (
            <div style={{ ...card, padding: 24, marginBottom: 20 }}>
              <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 14 }}>STEP 2 — SELECT PERSONA & RUN</div>

              {clientPersonas.filter(p => !p.archived_at).length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 10 }}>CLIENT PERSONA</span>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {clientPersonas.filter(p => !p.archived_at).map((p) => (
                      <label key={p.id} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 16px", borderRadius: 12, cursor: "pointer",
                        border: selectedPersona === p.id ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
                        background: selectedPersona === p.id ? "rgba(254,176,106,0.07)" : "rgba(255,255,255,0.03)",
                      }}>
                        <input
                          type="radio"
                          name="persona"
                          value={p.id}
                          checked={selectedPersona === p.id}
                          onChange={() => setSelectedPersona(p.id)}
                          style={{ accentColor: T.WRN_ORANGE }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 900, color: selectedPersona === p.id ? T.WRN_ORANGE : T.TEXT }}>
                          {p.name}
                          {p.is_default && <span style={{ fontSize: 10, color: T.DIM, marginLeft: 6 }}>default</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {runError && (
                <div style={{ marginBottom: 14, padding: 12, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10 }}>
                  <span style={{ fontSize: 13, color: "#f87171", fontWeight: 700 }}>{runError}</span>
                </div>
              )}

              <button
                onClick={runDryAnalysis}
                disabled={running || !selectedPersona}
                style={{
                  ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900,
                  width: "100%", opacity: running || !selectedPersona ? 0.5 : 1,
                }}
              >
                {running ? "Running SIGNAL Analysis..." : "Run SIGNAL Analysis →"}
              </button>
            </div>
          )}

          {/* STEP 3 — Results (visible once runResult is set) */}
          {runResult !== null && (
            <div style={{ ...card, padding: 24, marginBottom: 20 }}>
              <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 14 }}>STEP 3 — REVIEW RESULTS</div>

              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
                {runResult.decision && (
                  <Badge
                    text={runResult.decision}
                    style={DECISION_STYLE[runResult.decision] || { bg: "rgba(255,255,255,0.08)", color: T.MUTED }}
                  />
                )}
                {runResult.score !== undefined && (
                  <span style={{ fontSize: 14, color: T.DIM }}>Score: <span style={{ color: T.TEXT, fontWeight: 900 }}>{runResult.score}</span></span>
                )}
              </div>

              {/* ── ACTION BANNER ── */}
              {((runResult.bullets || runResult.why || []).length > 0 || (runResult.risk || runResult.risk_flags || []).length > 0) && (
                <div style={{
                  borderRadius: 14,
                  background: "linear-gradient(135deg, rgba(254,176,106,0.10) 0%, rgba(81,173,229,0.08) 100%)",
                  border: "1px solid rgba(254,176,106,0.28)",
                  padding: "14px 18px", marginBottom: 16,
                  display: "flex", alignItems: "flex-start", gap: 12,
                }}>
                  <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>⚡</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.95)", marginBottom: 3 }}>
                      Read this before you apply.
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: "18px" }}>
                      Your strengths tell you what to lead with. Your risks tell you what to address.
                      This is how you stand out — most applicants never do this work.
                    </div>
                  </div>
                </div>
              )}

              {/* ── TWO COLUMN WHY / RISK CARDS ── */}
              {(() => {
                const whyBullets: string[] = (runResult.bullets || runResult.why || []).filter(Boolean)
                const riskBullets: string[] = (runResult.risk || runResult.risk_flags || []).filter(Boolean)
                const isPass = String(runResult.decision || "").toLowerCase().includes("pass")
                if (whyBullets.length === 0 && riskBullets.length === 0) return null
                return (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: whyBullets.length > 0 && riskBullets.length > 0 ? "1fr 1fr" : "1fr",
                    gap: 14, alignItems: "start", marginBottom: 16,
                  }}>
                    {/* WHY CARD */}
                    {whyBullets.length > 0 && (
                      <div style={{
                        borderRadius: 18, border: "1px solid rgba(74,222,128,0.22)",
                        background: "#0D1829", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                      }}>
                        <div style={{ height: 3, background: "linear-gradient(90deg, #4ade80, #22c55e, #51ADE5)" }} />
                        <div style={{
                          padding: "16px 20px 14px", borderBottom: "1px solid rgba(74,222,128,0.12)",
                          background: "rgba(74,222,128,0.06)", display: "flex", alignItems: "center", gap: 10,
                        }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                            background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.35)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 15, color: "#4ade80",
                          }}>✦</div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#4ade80" }}>
                              {isPass ? "Strengths to Remember" : "Why You Are Competitive"}
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                              Lead with these in your application
                            </div>
                          </div>
                        </div>
                        <div style={{ padding: "14px 18px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                          {whyBullets.map((bullet: string, i: number) => {
                            const mWhy = bullet.match(/this role relies on (.+?),\s+and you\b/i)
                            const keyword = mWhy ? mWhy[1].trim().toUpperCase() : ""
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                                <div style={{
                                  width: 22, height: 22, borderRadius: "50%",
                                  background: "rgba(74,222,128,0.15)", border: "1.5px solid rgba(74,222,128,0.50)",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  flexShrink: 0, marginTop: 2, fontSize: 11, color: "#4ade80", fontWeight: 900,
                                }}>✓</div>
                                <div style={{ flex: 1 }}>
                                  {keyword && (
                                    <div style={{
                                      fontSize: 10, fontWeight: 900, letterSpacing: "1.4px",
                                      textTransform: "uppercase" as const, color: "#4ade80", marginBottom: 4,
                                    }}>{keyword} |</div>
                                  )}
                                  <div style={{ fontSize: 13, lineHeight: "19px", color: "rgba(255,255,255,0.82)", fontWeight: 400 }}>
                                    {bullet}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* RISK CARD */}
                    {riskBullets.length > 0 && (
                      <div style={{
                        borderRadius: 18, border: "1px solid rgba(248,113,113,0.22)",
                        background: "#0D1829", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                      }}>
                        <div style={{ height: 3, background: "linear-gradient(90deg, #f87171, #ef4444, #FEB06A)" }} />
                        <div style={{
                          padding: "16px 20px 14px", borderBottom: "1px solid rgba(248,113,113,0.12)",
                          background: "rgba(248,113,113,0.06)", display: "flex", alignItems: "center", gap: 10,
                        }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                            background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.35)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 15, color: "#f87171",
                          }}>⚠</div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#f87171" }}>
                              {isPass ? "Why This Is a Pass" : "Your Risks"}
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                              Address these before you apply
                            </div>
                          </div>
                        </div>
                        <div style={{ padding: "14px 18px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                          {riskBullets.map((bullet: string, i: number) => (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                              <div style={{
                                width: 22, height: 22, borderRadius: "50%",
                                background: "rgba(248,113,113,0.15)", border: "1.5px solid rgba(248,113,113,0.50)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                flexShrink: 0, marginTop: 2, fontSize: 11, color: "#f87171", fontWeight: 900,
                              }}>!</div>
                              <div style={{ fontSize: 13, lineHeight: "19px", color: "rgba(255,255,255,0.82)", fontWeight: 400, flex: 1 }}>
                                {bullet}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {(runResult.decision === "Pass") && (
                <p style={{ fontSize: 12, color: T.DIM, marginBottom: 16, fontStyle: "italic" }}>
                  Score suggests low fit. Send anyway?
                </p>
              )}

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  onClick={() => setShowAnnotation(true)}
                  style={{ ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900 }}
                >
                  Add Coaching Note & Send →
                </button>
                <button
                  onClick={clearSourceForm}
                  style={{ fontSize: 12, color: T.DIM, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: "8px 4px" }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 — Annotation (visible once showAnnotation is true) */}
          {showAnnotation && (
            <div style={{ ...card, padding: 24, marginBottom: 20 }}>
              <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 16 }}>STEP 4 — COACHING ANNOTATION</div>

              {sendSuccess ? (
                <div style={{ padding: 16, background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 10 }}>
                  <span style={{ color: "#4ade80", fontWeight: 900, fontSize: 13 }}>
                    Sent to {clientProfile?.name || "client"}'s dashboard. Clearing form...
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>PRIORITY</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[
                        { val: "urgent", label: "Urgent" },
                        { val: "this_week", label: "This Week" },
                        { val: "when_ready", label: "When Ready" },
                        { val: "not_recommended", label: "Not Recommended" },
                      ].map((p) => (
                        <button
                          key={p.val}
                          onClick={() => setAnnPriority(p.val)}
                          style={{
                            fontSize: 11, fontWeight: 900, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                            textTransform: "uppercase", letterSpacing: 0.8,
                            border: annPriority === p.val ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
                            background: annPriority === p.val ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
                            color: annPriority === p.val ? T.WRN_ORANGE : T.DIM,
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>RECOMMENDED ACTION</span>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[
                        { val: "apply", label: "Apply" },
                        { val: "research_first", label: "Research First" },
                        { val: "tailor_resume", label: "Tailor Resume" },
                        { val: "reach_out_first", label: "Reach Out First" },
                        { val: "skip", label: "Skip" },
                      ].map((a) => (
                        <button
                          key={a.val}
                          onClick={() => setAnnAction(a.val)}
                          style={{
                            fontSize: 11, fontWeight: 900, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
                            textTransform: "uppercase", letterSpacing: 0.8,
                            border: annAction === a.val ? `1px solid rgba(81,173,229,0.4)` : `1px solid ${T.BORDER_SOFT}`,
                            background: annAction === a.val ? "rgba(81,173,229,0.1)" : "rgba(255,255,255,0.04)",
                            color: annAction === a.val ? T.WRN_BLUE : T.DIM,
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>
                      COACHING NOTE{" "}
                      <span style={{ color: annNote.trim().length > 0 && annNote.trim().length < 20 ? T.ERROR : T.DIM, fontWeight: 400 }}>
                        (required, min 20 chars — {annNote.trim().length} entered)
                      </span>
                    </span>
                    <textarea
                      style={{ ...textarea, minHeight: 90 }}
                      placeholder="What should the client know about this role?"
                      value={annNote}
                      onChange={(e) => setAnnNote(e.target.value)}
                    />
                    {annNote.trim().length > 0 && annNote.trim().length < 20 && (
                      <p style={{ fontSize: 11, color: T.ERROR, marginTop: 4 }}>{20 - annNote.trim().length} more characters needed</p>
                    )}
                  </div>

                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>APPLY-BY DATE <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span></span>
                    <input
                      type="date"
                      style={{ ...input, colorScheme: "dark" }}
                      value={annApplyBy}
                      onChange={(e) => setAnnApplyBy(e.target.value)}
                    />
                  </div>

                  {runError && (
                    <div style={{ padding: 12, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10 }}>
                      <span style={{ fontSize: 13, color: "#f87171", fontWeight: 700 }}>{runError}</span>
                    </div>
                  )}

                  <button
                    onClick={sendToClientDashboard}
                    disabled={sending || annNote.trim().length < 20}
                    style={{
                      ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900,
                      width: "100%", opacity: sending || annNote.trim().length < 20 ? 0.5 : 1,
                    }}
                  >
                    {sending ? "Sending..." : "Send to Dashboard ✓"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3 — Analyses History */}
      {tab === "history" && (
        <div>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>ALL ANALYSES FOR {clientProfile?.name?.toUpperCase() || "CLIENT"}</div>
          {historyRuns.length === 0 ? (
            <p style={{ color: T.MUTED, fontSize: 13 }}>No analyses run yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {historyRuns.map((run) => (
                <div key={run.id} style={{ ...card, padding: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 950, color: T.TEXT }}>{run.company || "—"}</span>
                    <span style={{ fontSize: 13, color: T.MUTED }}>{run.title || "—"}</span>
                    {run.decision && (
                      <Badge text={run.decision} style={DECISION_STYLE[run.decision] || { bg: "rgba(255,255,255,0.08)", color: T.MUTED }} />
                    )}
                    {run.score !== null && (
                      <span style={{ fontSize: 11, color: T.DIM }}>Score: {run.score}</span>
                    )}
                    <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>
                      {new Date(run.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4 — Profile & Personas */}
      {tab === "analysis" && clientProfile && (
        <ProfilePersonasTab
          clientId={clientId}
          initialProfile={clientProfile}
          initialPersonas={clientPersonas}
          getToken={getToken}
          onChange={loadAll}
        />
      )}
    </div>
  )
}
