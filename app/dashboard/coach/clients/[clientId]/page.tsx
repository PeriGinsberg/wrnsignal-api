"use client"

import React, { useEffect, useMemo, useState, useCallback } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
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
import { NotesTab, type NoteType, type NotePriority } from "./NotesTab"
import { AddNotePanel } from "./AddNotePanel"
import { ClientHeaderStrip } from "./dashboard/ClientHeaderStrip"
import { LanesPanel } from "../../../lanes/LanesPanel"
import type { LifecycleStatus } from "../../LifecycleStatusPill"
import { ApplicationStatusEditPill } from "./ApplicationStatusEditPill"
import type { ApplicationStatus } from "../../../../_lib/applicationStatuses"
import { SavingSpinner } from "../../SavingSpinner"
import { NoteVisibilityIcon } from "../../NoteVisibilityIcon"
import { LoadingShell } from "../../LoadingShell"
import { InfoCard, type InfoGroup } from "../../InfoCard"
import { formatDate } from "../../formatDate"
import { DashboardView } from "./dashboard/DashboardView"
import { EngagementsTab } from "./EngagementsTab"
import { LibraryTab } from "./LibraryTab"
import { HistoryTab } from "./HistoryTab"
import { JobDetailPanel, type PanelSection } from "./JobDetailPanel"
import { describeClientStatus } from "@/lib/coachRecommendations"

// 5-tab layout per Phase 2 Commit 2.4. The previous "history" (Analyses
// History) tab was removed entirely — its surface no longer ships in the
// Beta. jobfit_runs table + sourced_by_coach_id column intentionally
// retained (data is preserved; only the surface is gone).
// "engagements" added for the attached-package snapshots (Client Engagement UI).
// "history" added for the read-only event timeline (Client Event Log UI).
type Tab = "dashboard" | "tracker" | "source" | "lanes" | "notes" | "analysis" | "engagements" | "library" | "history"

// Status filter buckets exposed to Job Tracker tab via URL ?status= param
// or in-app tile click. "all" = no filter.
type StatusFilter = "all" | "interviewing" | "offer" | "rejected"
const STATUS_FILTERS: StatusFilter[] = ["all", "interviewing", "offer", "rejected"]

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
  job_description: string | null
  created_at: string | null
  has_jobfit?: boolean
  has_cover_letter?: boolean
  coach_annotations: any[]
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

// ── Client Information card (arc 1, display-only) ──
// The profile GET `capture` namespace = the coach_clients prospect-capture
// columns, which persist through convert (Commit 1). Source/education label
// maps + timeAgo are duplicated inline per the established coach-route pattern
// (the same maps live on the prospect detail page).

type Capture = {
  source_category: string | null
  source_detail: string | null
  invited_email: string | null
  phone: string | null
  linkedin_url: string | null
  current_title: string | null
  current_company: string | null
  location: string | null
  years_experience_approx: number | null
  education_status: string | null
  university: string | null
  field_of_study: string | null
  grad_date: string | null
  target_roles: string | null
  target_locations: string | null
  preferred_locations: string | null
  timeline: string | null
  job_type: string | null
  tags: string | null
  invited_at: string | null
  last_activity_at: string | null
}

const SOURCE_LABEL: Record<string, string> = {
  referral: "Referral", social_media: "Social Media", website: "Website",
  personal_contact: "Personal Contact", other: "Other",
}
const SOURCE_STYLE: Record<string, { bg: string; color: string }> = {
  referral:         { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5" },
  social_media:     { bg: "rgba(167,139,250,0.18)", color: "#C8B6F8" },
  website:          { bg: "rgba(45,165,141,0.15)",  color: "#2CA58D" },
  personal_contact: { bg: "rgba(74,222,128,0.15)",  color: "#4ade80" },
  other:            { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.60)" },
}
const EDUCATION_LABEL: Record<string, string> = {
  in_school: "In school", graduated: "Graduated", na: "Not applicable",
}

function timeAgo(iso: string | null): string {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return "Just now"
  const d = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (d === 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 7) return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// Map the capture namespace → InfoCard groups. Lives here (page render), NOT in
// the dumb InfoCard. 6-field null-coalesce — target_roles, target_locations,
// preferred_locations, timeline, job_type, invited_email prefer capture and
// fall back to client_profiles; every other field reads capture directly.
// Each row's `show` is presence-based, so a group whose rows are all null
// collapses entirely (InfoCard's empty-group filter): a capture-NULL client
// shows TARGETING (via fallback) + EMAIL, but no blank CONTACT/EDUCATION.
function buildClientInfoGroups(cap: Capture | null, profile: ClientProfile): InfoGroup[] {
  const c: Partial<Capture> = cap ?? {}
  const email = c.invited_email ?? profile.email ?? null
  const roles = c.target_roles ?? (profile as any).target_roles ?? null
  const locations = c.target_locations ?? (profile as any).target_locations ?? null
  const preferred = c.preferred_locations ?? (profile as any).preferred_locations ?? null
  const timeline = c.timeline ?? (profile as any).timeline ?? null
  const jobType = c.job_type ?? (profile as any).job_type ?? null
  // phone, linkedin, and the education fields are captured on client_profiles
  // by the direct Create Client flow, so fall back to the profile when the
  // coach_clients capture column is null (same pattern as targeting above).
  const phone = c.phone ?? (profile as any).phone ?? null
  const linkedin = c.linkedin_url ?? (profile as any).linkedin_url ?? null
  const educationStatus = c.education_status ?? (profile as any).education_status ?? null
  const university = c.university ?? (profile as any).university ?? null
  const gradDate = c.grad_date ?? (profile as any).grad_date ?? null

  const sourceStyle = c.source_category ? (SOURCE_STYLE[c.source_category] ?? SOURCE_STYLE.other) : SOURCE_STYLE.other
  const sourceBadge = c.source_category ? (
    <span style={{ display: "inline-block", background: sourceStyle.bg, color: sourceStyle.color, fontSize: 11, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", padding: "3px 10px", borderRadius: 999 }}>
      {SOURCE_LABEL[c.source_category] ?? c.source_category}
    </span>
  ) : null
  const phoneVal = phone ? (
    <a href={`tel:${phone}`} style={{ color: T.TEXT, textDecoration: "none" }}>{phone}</a>
  ) : null
  const linkedinVal = linkedin ? (
    <a href={linkedin} target="_blank" rel="noopener noreferrer" style={{ color: T.WRN_BLUE, textDecoration: "none" }}>{linkedin}</a>
  ) : null

  return [
    { title: "CONTACT", rows: [
      { label: "SOURCE", value: sourceBadge, show: !!c.source_category },
      { label: "DETAIL", value: c.source_detail, show: !!c.source_detail },
      { label: "EMAIL", value: email, show: !!email },
      { label: "PHONE", value: phoneVal, show: !!phone },
      { label: "LINKEDIN", value: linkedinVal, show: !!linkedin },
    ] },
    { title: "CURRENT ROLE", rows: [
      { label: "TITLE", value: c.current_title, show: !!c.current_title },
      { label: "COMPANY", value: c.current_company, show: !!c.current_company },
      { label: "LOCATION", value: c.location, show: !!c.location },
      { label: "EXPERIENCE", value: c.years_experience_approx != null ? `${c.years_experience_approx} yrs` : null, show: c.years_experience_approx != null },
    ] },
    { title: "EDUCATION", rows: [
      { label: "STATUS", value: educationStatus ? (EDUCATION_LABEL[educationStatus] ?? educationStatus) : null, show: !!educationStatus },
      { label: "UNIVERSITY", value: university, show: !!university },
      { label: "FIELD", value: c.field_of_study, show: !!c.field_of_study },
      { label: "GRAD DATE", value: gradDate ? formatDate(gradDate) : null, show: !!gradDate },
    ] },
    { title: "TARGETING", rows: [
      { label: "ROLES", value: roles, show: !!roles },
      { label: "LOCATIONS", value: locations, show: !!locations },
      { label: "PREFERRED", value: preferred, show: !!preferred },
      { label: "TIMELINE", value: timeline, show: !!timeline },
      { label: "JOB TYPE", value: jobType, show: !!jobType },
    ] },
    { title: "OTHER", rows: [
      { label: "TAGS", value: c.tags, show: !!c.tags },
      { label: "ADDED", value: c.invited_at ? formatDate(c.invited_at) : null, show: !!c.invited_at },
      { label: "ACTIVITY", value: c.last_activity_at ? timeAgo(c.last_activity_at) : null, show: !!c.last_activity_at },
    ] },
  ]
}

export default function CoachClientPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientId = params.clientId as string

  // Default tab is dashboard. Initial URL param respected if present so
  // deep-links into a tab still work; navigating away and back resets to
  // dashboard because the URL has no ?tab on entry from My Clients.
  const initialTab = (searchParams.get("tab") as Tab) || "dashboard"
  const [tab, setTab] = useState<Tab>(initialTab)

  // Job Tracker status filter. Set by metrics-tile click on dashboard or
  // by ?status= URL param on entry.
  // Prefill carried by Score from a lane result. The job description is
  // deliberately NOT among these — the board has no job description to give, so
  // the coach pastes it. Read once on mount, as initialTab is.
  const [initialSource] = useState(() => ({
    title: searchParams.get("sc_title") || "",
    company: searchParams.get("sc_company") || "",
    url: searchParams.get("sc_url") || "",
    laneResult: searchParams.get("lane_result") || null,
  }))

  const initialStatus = searchParams.get("status") as StatusFilter | null
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialStatus && STATUS_FILTERS.includes(initialStatus) ? initialStatus : "all"
  )

  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null)
  const [clientPersonas, setClientPersonas] = useState<ClientPersona[]>([])
  // coach_clients.id for (this client_profile_id, authed coach) — the engagement
  // API is keyed by it. Resolved once from the profile route on load.
  const [coachClientId, setCoachClientId] = useState<string | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const [lifecycleStatus, setLifecycleStatus] = useState<LifecycleStatus>("Active")
  // Prospect-capture columns from the profile GET `capture` namespace (Commit 1),
  // rendered as the read-only "Client Information" card (arc 1).
  const [capture, setCapture] = useState<Capture | null>(null)
  // invited_at is the single source of truth for the invite badge + button.
  // create-client defers the invite email; the coach sends it from here. Seeded
  // from the profile GET `capture` namespace and updated in place on a
  // successful send so badge + button flip (Send→Re-send, "not yet
  // invited"→"Invited {date}") without a page reload.
  const [invitedAt, setInvitedAt] = useState<string | null>(null)
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [coachRecs, setCoachRecs] = useState<CoachRec[]>([])
  const [clientApps, setClientApps] = useState<ClientApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Source tab state
  const [sourceUrl, setSourceUrl] = useState("")
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [sourceCompany, setSourceCompany] = useState("")
  const [sourceTitle, setSourceTitle] = useState("")
  const [sourceJD, setSourceJD] = useState("")
  // Set when the job on the Source form arrived from a lane result, so a
  // successful send can mark that row. Null for a hand-pasted job.
  const [laneResultId, setLaneResultId] = useState<string | null>(null)
  const [selectedPersona, setSelectedPersona] = useState("")
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<any>(null)
  // Per-job detail side panel, opened from a Job Tracker row's links.
  const [jobPanelOpen, setJobPanelOpen] = useState(false)
  const [jobPanelAppId, setJobPanelAppId] = useState<string | null>(null)
  const [jobPanelSection, setJobPanelSection] = useState<PanelSection>("jobfit")

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
  const [jdOpenIds, setJdOpenIds] = useState<Set<string>>(new Set())
  const [annotatingAppId, setAnnotatingAppId] = useState<string | null>(null)
  const [annotationNote, setAnnotationNote] = useState("")
  const [annotationPriority, setAnnotationPriority] = useState("info")
  const [annotationVisible, setAnnotationVisible] = useState(true)
  const [annotationSaving, setAnnotationSaving] = useState(false)

  // LinkedIn helper state (source tab)
  const [showLinkedInHelper, setShowLinkedInHelper] = useState(false)
  const [linkedInPasteText, setLinkedInPasteText] = useState("")
  // Blocked-site popup (mirrors the D2C JobFit flow): explains the
  // cut/paste workaround and offers to open the posting in a new window
  // (on the button click — a user gesture — so popup blockers allow it).
  const [showBlockedPopup, setShowBlockedPopup] = useState(false)

  // Notes tab + Add Note slide-in panel state.
  // notesRefreshKey gets bumped after the slide-in saves a note so the
  // Notes tab refetches even when the panel was opened from a different tab.
  // needsAttentionRefreshKey similarly drives the dashboard's
  // Needs-Attention section.
  const [addNoteOpen, setAddNoteOpen] = useState(false)
  const [notesRefreshKey, setNotesRefreshKey] = useState(0)
  const [needsAttentionRefreshKey, setNeedsAttentionRefreshKey] = useState(0)
  const [removingClient, setRemovingClient] = useState(false)

  // silent: true skips the setLoading(true) flip so a post-save refetch
  // doesn't unmount the page tree and flash the LoadingShell. Used by
  // Send-to-Dashboard and the per-app annotate flow — both already
  // have their own button-level saving state, so the brief stale
  // window (a few hundred ms) is preferable to a full-page flash.
  // Genuine initial-mount loads (useEffect → loadAll()) still flip
  // setLoading and render LoadingShell.
  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setLoading(true)
    try {
      const [trackerRes, profileRes] = await Promise.all([
        authFetch(`/api/coach/clients/${clientId}/tracker`),
        authFetch(`/api/coach/clients/${clientId}/profile`),
      ])

      if (!trackerRes.ok || !profileRes.ok) {
        setError("Failed to load client data")
        if (!silent) setLoading(false)
        return
      }

      const trackerData = await trackerRes.json()
      const profileData = await profileRes.json()

      setClientProfile(profileData.profile || null)
      setClientPersonas(profileData.personas || [])
      setCoachClientId(profileData.coach_client_id ?? null)
      setAcceptedAt(profileData.accepted_at ?? null)
      setLifecycleStatus((profileData.lifecycle_status as LifecycleStatus) ?? "Active")
      setCapture((profileData.capture as Capture | null) ?? null)
      setInvitedAt((profileData.capture as Capture | null)?.invited_at ?? null)
      setClientApps(trackerData.applications || [])
      setCoachRecs(trackerData.recommendations || [])

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
    if (!silent) setLoading(false)
  }, [clientId])

  useEffect(() => { loadAll() }, [loadAll])

  // Deep-link landing behavior for arrivals from
  // /dashboard/coach/applications-recent. Two URL hints drive two
  // effects on the tracker tab once data is loaded:
  //   - ?expand=app-<id>  → auto-open that card via the existing
  //                          openAppIds Set (same mechanism as the
  //                          header-click toggle, so the rendered
  //                          expanded state is identical)
  //   - #app-<id>          → scroll the card into view centered
  // Browser-native anchor scroll races with React tab-switch + fetch,
  // so we both auto-expand and re-scroll explicitly once
  //   (a) the tracker tab is active, and
  //   (b) loading flipped false → app rows are now in the DOM with
  //       id="app-<id>" anchors.
  useEffect(() => {
    if (loading || tab !== "tracker") return
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const expand = params.get("expand")
    if (expand && expand.startsWith("app-")) {
      const appId = expand.slice(4)
      setOpenAppIds((prev) => {
        if (prev.has(appId)) return prev
        const next = new Set(prev)
        next.add(appId)
        return next
      })
    }
    const hash = window.location.hash
    if (!hash || !hash.startsWith("#app-")) return
    requestAnimationFrame(() => {
      const el = document.getElementById(hash.slice(1))
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }, [loading, tab])

  async function fetchUrl() {
    if (!sourceUrl.trim()) return
    setFetchingUrl(true)
    setShowLinkedInHelper(false)
    setShowBlockedPopup(false)
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
        setShowBlockedPopup(true)
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

  // Apply the Score prefill on first mount only. Not a dependency-driven effect:
  // re-running it would overwrite whatever the coach has since typed.
  useEffect(() => {
    if (!initialSource.title && !initialSource.company && !initialSource.url) return
    setSourceTitle(initialSource.title)
    setSourceCompany(initialSource.company)
    setSourceUrl(initialSource.url)
    setLaneResultId(initialSource.laneResult)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearSourceForm() {
    setSourceUrl(''); setSourceCompany(''); setSourceTitle(''); setSourceJD('')
    setLaneResultId(null)
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
        // The row leaves the lane queue only now, because sending is the
        // decision. A failure here is not surfaced as a send failure: the
        // recommendation did reach the client, and telling the coach otherwise
        // would invite them to send it twice.
        if (laneResultId) {
          await authFetch("/api/lanes/results", {
            method: "PATCH",
            body: JSON.stringify({ id: laneResultId, action: "push" }),
          }).catch(() => {})
          setLaneResultId(null)
        }
        await loadAll({ silent: true })
        setTimeout(() => clearSourceForm(), 3000)
      } else {
        const j = await res.json()
        setRunError(j.error || "Failed to send.")
      }
    } catch { setRunError("Network error.") }
    setSending(false)
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "tracker", label: "Job Tracker" },
    { id: "source", label: "Source a Job" },
    { id: "lanes", label: "Lanes" },
    { id: "notes", label: "Notes" },
    { id: "analysis", label: "Profile & Personas" },
    { id: "engagements", label: "Engagements" },
    { id: "library", label: "Library" },
    { id: "history", label: "History" },
  ]

  const filteredApps = useMemo(() => {
    if (statusFilter === "all") return clientApps
    return clientApps.filter((a) => a.application_status === statusFilter)
  }, [clientApps, statusFilter])

  function handleTileClick(filterStatus: StatusFilter) {
    setStatusFilter(filterStatus)
    setTab("tracker")
  }

  async function handleRemoveClient() {
    if (!confirm(`Remove ${clientProfile?.name || clientProfile?.email || "this client"} from your roster? This frees your seat and removes them from your dashboard. Their account is preserved and can be restored by an admin.`)) {
      return
    }
    setRemovingClient(true)
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/dashboard/coach/clients")
      } else {
        const j = await res.json().catch(() => ({}))
        alert(j?.error || "Failed to remove client.")
      }
    } catch {
      alert("Network error removing client.")
    } finally {
      setRemovingClient(false)
    }
  }

  // Send (or re-send) the deferred SIGNAL invite. The account already exists
  // (create-client provisioned it); this endpoint generates the magic link,
  // emails it, stamps invited_at, and writes the audit trail. Re-send-capable
  // (no 409). On success we flip invited_at locally so the badge/button update
  // without a reload. Mirrors the prospect send-invite handler.
  async function handleSendInvite() {
    if (sendingInvite) return
    setSendingInvite(true)
    setInviteError(null)
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/send-invite`, {
        method: "POST",
        body: "{}",
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        setInvitedAt(j.invited_at ?? new Date().toISOString())
      } else {
        setInviteError(j?.error || "Couldn't send invite — try again")
      }
    } catch {
      setInviteError("Network error — try again")
    } finally {
      setSendingInvite(false)
    }
  }

  if (loading) return <LoadingShell />

  if (error) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>

  return (
    <div>
      {/* Back link sits above the persistent header strip so it doesn't
          eat one of the four action button slots in the strip. */}
      {/* Context-aware back-link (Commit 2.4.1).
          - Dashboard tab → roster (one level up: this is the client's "home")
          - Any other tab → this client's Dashboard (one level up: clears
            the tab param to /dashboard/coach/clients/[id], which lands on
            the default tab — future-proof if the default ever changes).
          Defensive fallback "Back to Client Details" covers the race where
          clientProfile is still loading; reads as deliberate copy. */}
      {(() => {
        const onDashboard = tab === "dashboard"
        const name = clientProfile?.name?.trim() || ""
        const label = onDashboard
          ? "← Back to My Clients"
          : `← Back to ${name || "Client Details"}`
        const href = onDashboard
          ? "/dashboard/coach/clients"
          : `/dashboard/coach/clients/${clientId}`
        return (
          <a
            href={href}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#2CA58D",
              textDecoration: "none",
              display: "inline-block",
              marginBottom: 18,
              letterSpacing: 0.2,
            }}
          >
            {label}
          </a>
        )
      })()}

      {/* Persistent header strip — visible on every tab including dashboard. */}
      {clientProfile && (
        <ClientHeaderStrip
          profile={{
            id: clientProfile.id,
            name: clientProfile.name,
            email: clientProfile.email,
            job_type: (clientProfile as any).job_type ?? null,
            target_roles: (clientProfile as any).target_roles ?? null,
            target_locations: (clientProfile as any).target_locations ?? null,
            timeline: (clientProfile as any).timeline ?? null,
            // accepted_at = when the coach-client invite was accepted.
            // Falls back to client_profiles.created_at only as a last
            // resort for legacy links that pre-date the invite flow.
            engagement_started_at: acceptedAt ?? (clientProfile as any).created_at ?? null,
          }}
          lifecycleStatus={lifecycleStatus}
          getToken={getToken}
          invitedAt={invitedAt}
          onSendInvite={handleSendInvite}
          sendingInvite={sendingInvite}
          inviteError={inviteError}
          onAddNote={() => setAddNoteOpen(true)}
          onSourceJob={() => setTab("source")}
          onRemoveClient={() => {
            if (!removingClient) handleRemoveClient()
          }}
          onLifecycleStatusChange={setLifecycleStatus}
        />
      )}

      {/* Client Information — read-only capture card (arc 1), below the header
          strip and above the tab nav so it's always-visible header content.
          Data mapping lives in buildClientInfoGroups (not inside InfoCard). */}
      {clientProfile && (
        <InfoCard title="Client Information" groups={buildClientInfoGroups(capture, clientProfile)} />
      )}

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
              transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
            }}
            onMouseEnter={(e) => {
              if (tab !== t.id) {
                ;(e.currentTarget.style as any).background = "rgba(255,255,255,0.08)"
                ;(e.currentTarget.style as any).color = T.TEXT
              }
            }}
            onMouseLeave={(e) => {
              if (tab !== t.id) {
                ;(e.currentTarget.style as any).background = "rgba(255,255,255,0.04)"
                ;(e.currentTarget.style as any).color = T.MUTED
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 0 — Dashboard (default landing) */}
      {tab === "dashboard" && (
        <DashboardView
          authFetch={authFetch}
          clientId={clientId}
          notesRefreshKey={notesRefreshKey}
          needsAttentionRefreshKey={needsAttentionRefreshKey}
          onTileClick={handleTileClick}
          onNavigateToNotesTab={() => setTab("notes")}
        />
      )}

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
                                  <option value="tailor_resume" style={{ background: "#0a1628" }}>Tailor Resume</option>
                                  <option value="reach_out_first" style={{ background: "#0a1628" }}>Reach Out First</option>
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
                              style={{ ...btnPrimary, fontSize: 12, padding: "8px 18px", opacity: savingRec ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                            >
                              {savingRec && <SavingSpinner />}
                              {savingRec ? "Saving..." : "Save Changes"}
                            </button>
                            <button
                              onClick={() => setEditingRecId(null)}
                              disabled={savingRec}
                              style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px", opacity: savingRec ? 0.5 : 1 }}
                            >
                              Cancel
                            </button>
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
                                Client: <span style={{ color: T.TEXT, fontWeight: 700 }}>{describeClientStatus(rec.client_status)}</span>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <div style={{ ...eyebrow, color: T.WRN_BLUE }}>THEIR APPLICATIONS</div>
              {statusFilter !== "all" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                  <span style={{ color: T.DIM }}>Filtered:</span>
                  <span
                    style={{
                      background: "rgba(254,176,106,0.10)",
                      border: "1px solid rgba(254,176,106,0.35)",
                      color: T.WRN_ORANGE,
                      fontWeight: 900,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      padding: "3px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {statusFilter.replace(/_/g, " ")}
                  </span>
                  <button
                    onClick={() => setStatusFilter("all")}
                    style={{
                      background: "none",
                      border: "none",
                      color: T.WRN_ORANGE,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {filteredApps.length === 0 ? (
              <p style={{ color: T.MUTED, fontSize: 13 }}>
                {statusFilter === "all"
                  ? "No applications tracked yet."
                  : `No ${statusFilter.replace(/_/g, " ")} applications.`}
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredApps.map((app) => {
                  const isOpen = openAppIds.has(app.id)
                  const isAnnotating = annotatingAppId === app.id
                  return (
                    // overflow: "visible" overrides the card's default
                    // overflow:hidden so ApplicationStatusEditPill
                    // dropdowns on bottom-of-list cards aren't clipped
                    // at the card boundary (same bug class as Coach
                    // Home My Clients section, surfaced by 6.2 smoke).
                    // v1.1 portal refactor will eliminate this need.
                    <div key={app.id} id={`app-${app.id}`} style={{ ...card, padding: 18, overflow: "visible" }}>
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
                        <ApplicationStatusEditPill
                          value={app.application_status}
                          getToken={getToken}
                          clientProfileId={clientId}
                          applicationId={app.id}
                          onChange={(next) => {
                            // Optimistic local update — the row's status pill
                            // reflects the new value immediately; reload is on
                            // the next data fetch. signal_applications_status_history
                            // write happens server-side and feeds R3/R4/R5
                            // signals on Coach Home + Client Dashboard
                            // (Phase 3.0 heuristic engine).
                            setClientApps((prev) =>
                              prev.map((a) =>
                                a.id === app.id ? { ...a, application_status: next as ApplicationStatus } : a,
                              ),
                            )
                          }}
                        />
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
                          {/* Per-job detail links — open the side panel focused on the
                              clicked section. Cover Letter shows only when one was run. */}
                          {(app.has_jobfit || app.has_cover_letter) && (
                            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                              {app.has_jobfit && (
                                <button
                                  onClick={() => { setJobPanelAppId(app.id); setJobPanelSection("jobfit"); setJobPanelOpen(true) }}
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: T.WRN_BLUE, textDecoration: "underline" }}
                                >
                                  Full Jobfit
                                </button>
                              )}
                              {app.has_cover_letter && (
                                <button
                                  onClick={() => { setJobPanelAppId(app.id); setJobPanelSection("coverletter"); setJobPanelOpen(true) }}
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: T.WRN_TEAL, textDecoration: "underline" }}
                                >
                                  Cover Letter
                                </button>
                              )}
                            </div>
                          )}
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

                          {/* Job Description — read-only, saved from the
                              scoring run so the client can reread it for
                              interview prep after the posting comes down.
                              Mirrors the client tracker section. Null for
                              manual/legacy jobs → nothing renders. */}
                          {app.job_description && (
                            <div style={{ marginBottom: 12, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "12px 14px", border: `1px solid ${T.BORDER_SOFT}` }}>
                              <div onClick={() => setJdOpenIds((prev) => { const next = new Set(prev); next.has(app.id) ? next.delete(app.id) : next.add(app.id); return next })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                                <span style={{ ...eyebrow, fontSize: 9, color: T.DIM }}>JOB DESCRIPTION</span>
                                <span style={{ fontSize: 12, color: T.DIM }}>{jdOpenIds.has(app.id) ? "▲" : "▼"}</span>
                              </div>
                              <p style={{ fontSize: 11, color: T.DIM, margin: "4px 0 0" }}>
                                Saved from when this job was scored, so you can reread it even if the original posting comes down.
                              </p>
                              {jdOpenIds.has(app.id) && (
                                <div style={{ marginTop: 10, fontSize: 12, color: T.MUTED, lineHeight: "18px", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 360, overflowY: "auto" }}>
                                  {app.job_description}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Existing annotations */}
                          {app.coach_annotations?.length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ ...eyebrow, fontSize: 9, color: T.DIM, marginBottom: 6 }}>YOUR NOTES</div>
                              {app.coach_annotations.map((ann: any, i: number) => (
                                <p key={i} style={{ fontSize: 12, color: T.MUTED, lineHeight: "18px", marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${T.WRN_ORANGE}40`, display: "flex", alignItems: "flex-start", gap: 6 }}>
                                  <span style={{ marginTop: 3 }}>
                                    <NoteVisibilityIcon visible={ann.visible_to_client !== false} />
                                  </span>
                                  <span>{ann.note}</span>
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
                              {/* Form-fields wrapper: dim during save (Phase 4.1.5). Sibling
                                  of the button row below so the buttons stay full-visibility
                                  with their own disabled/spinner state. */}
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 10,
                                  opacity: annotationSaving ? 0.5 : 1,
                                  pointerEvents: annotationSaving ? "none" : "auto",
                                  transition: "opacity 120ms ease",
                                }}
                              >
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
                              </div>
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
                                        await loadAll({ silent: true })
                                      }
                                    } finally {
                                      setAnnotationSaving(false)
                                    }
                                  }}
                                  disabled={annotationSaving || !annotationNote.trim()}
                                  style={{ ...btnPrimary, fontSize: 11, padding: "6px 14px", background: "#FEB06A", color: "#04060F", opacity: annotationSaving || !annotationNote.trim() ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                                >
                                  {annotationSaving && <SavingSpinner size={10} />}
                                  {annotationSaving ? "Saving..." : "Save Note"}
                                </button>
                                <button
                                  onClick={() => setAnnotatingAppId(null)}
                                  disabled={annotationSaving}
                                  style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px", opacity: annotationSaving ? 0.5 : 1 }}
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

          {laneResultId && (
            <div
              style={{
                ...card, padding: "12px 16px", marginBottom: 16,
                borderColor: T.ORANGE_BORDER, background: T.WARNING_BG,
                fontSize: 13, color: T.TEXT,
              }}
            >
              From a lane result — title, company and link are filled in.{" "}
              <strong>Paste the job description</strong> to score it: the job board only supplies a
              two-sentence summary, which is not enough to score against.
              {sourceUrl && (
                <>
                  {" "}
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: T.WRN_BLUE, fontWeight: 800 }}>
                    Open posting ↗
                  </a>
                </>
              )}
              <div style={{ color: T.DIM, fontSize: 12, marginTop: 6 }}>
                This job stays in the lane queue until you send it to the client.
              </div>
            </div>
          )}

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
                  style={{
                    ...input,
                    flex: 1,
                    opacity: fetchingUrl ? 0.5 : 1,
                    pointerEvents: fetchingUrl ? "none" : "auto",
                    transition: "opacity 120ms ease",
                  }}
                  placeholder="Paste job posting URL..."
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
                <button
                  onClick={fetchUrl}
                  disabled={fetchingUrl || !sourceUrl.trim()}
                  style={{ ...btnSecondary, fontSize: 12, padding: "0 18px", whiteSpace: "nowrap", opacity: fetchingUrl ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {fetchingUrl && <SavingSpinner />}
                  {fetchingUrl ? "Fetching..." : "Fetch JD"}
                </button>
              </div>
              <p style={{ fontSize: 11, color: T.DIM, marginTop: 8 }}>
                LinkedIn, Greenhouse, Lever, Workday, and most ATS URLs supported
              </p>
            </div>

            {/* Blocked-site popup — mirrors the D2C JobFit flow. Explains the
                cut/paste workaround, offers to open the posting in a new window
                (window.open stays on the button click so popup blockers allow
                it), then reveals the paste helper below once dismissed. */}
            {showBlockedPopup && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 1000,
                  background: "rgba(0,0,0,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 20,
                }}
              >
                <div style={{ ...card, padding: 28, maxWidth: 460, width: "100%", textAlign: "center" }}>
                  <div style={{ ...eyebrow, color: "#FBBF24", fontSize: 9, marginBottom: 10 }}>LINKEDIN</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: T.TEXT, marginBottom: 12 }}>
                    We couldn't read this job posting
                  </div>
                  <p style={{ fontSize: 13, color: T.MUTED, lineHeight: "20px", marginBottom: 20, textAlign: "left" }}>
                    LinkedIn blocks automated access to job postings. To continue, open the
                    posting, copy the full job description, and paste it below.
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => { window.open(sourceUrl.trim(), "_blank"); setShowBlockedPopup(false) }}
                      style={{ ...btnPrimary, flex: 1, fontSize: 13, padding: "11px 16px" }}
                    >
                      Open Job Posting
                    </button>
                    <button
                      onClick={() => setShowBlockedPopup(false)}
                      style={{ ...btnSecondary, flex: 1, fontSize: 13, padding: "11px 16px" }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* LinkedIn helper */}
            {showLinkedInHelper && !showBlockedPopup && (
              <div style={{
                background: "rgba(253,186,40,0.08)", border: "1px solid rgba(253,186,40,0.3)",
                borderRadius: 14, padding: 20, marginBottom: 20,
              }}>
                <div style={{ ...eyebrow, color: "#FBBF24", fontSize: 9, marginBottom: 8 }}>LINKEDIN — PASTE MANUALLY</div>
                <p style={{ fontSize: 12, color: T.MUTED, marginBottom: 12, lineHeight: "18px" }}>
                  LinkedIn blocks automated access. Open the job posting in your browser, select all the text (Ctrl+A / Cmd+A), copy it, and paste it below.
                </p>
                <textarea
                  style={{
                    ...textarea,
                    minHeight: 120,
                    marginBottom: 10,
                    opacity: fetchingUrl ? 0.5 : 1,
                    pointerEvents: fetchingUrl ? "none" : "auto",
                    transition: "opacity 120ms ease",
                  }}
                  placeholder="Paste the full LinkedIn job page text here..."
                  value={linkedInPasteText}
                  onChange={(e) => setLinkedInPasteText(e.target.value)}
                />
                <button
                  onClick={parseLinkedInPaste}
                  disabled={fetchingUrl || !linkedInPasteText.trim()}
                  style={{ ...btnSecondary, fontSize: 12, padding: "8px 18px", opacity: fetchingUrl || !linkedInPasteText.trim() ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {fetchingUrl && <SavingSpinner />}
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
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {running && <SavingSpinner />}
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
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}
                  >
                    {sending && <SavingSpinner />}
                    {sending ? "Sending..." : "Send to Dashboard ✓"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2b — Lanes: this client's standing searches and their queues.
          Same components as /dashboard/lanes, scoped to one owner — see
          LanesPanel. Sourcing a job by hand (the tab before this one) and a lane
          finding one on a schedule end in the same place, so they sit together. */}
      {tab === "lanes" && (
        <div>
          <div style={{ marginBottom: 18 }}>
            <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 6 }}>Search lanes</div>
            <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
              Standing searches for {clientProfile?.name || "this client"}, run nightly. Score takes a job to
              Source a Job to be scored against their profile; it stays in the queue here until you send it.
            </p>
          </div>
          <LanesPanel
            clientProfileId={clientId}
            clientName={clientProfile?.name || null}
            emptyHint={`No lanes for ${clientProfile?.name || "this client"} yet. Create one and run it to fill this queue.`}
            onScore={({ row, laneResultId: rid }) => {
              setSourceTitle(row.title || "")
              setSourceCompany(row.company || "")
              setSourceUrl(row.apply_url || "")
              // Empty on purpose — the board gives no job description, so this
              // is the one field the coach has to supply.
              setSourceJD("")
              setLaneResultId(rid)
              setRunResult(null); setShowAnnotation(false); setSendSuccess(false); setRunError("")
              setTab("source")
            }}
          />
        </div>
      )}

      {/* TAB 3 — Notes (typed notes feed) */}
      {tab === "notes" && (
        <NotesTab
          authFetch={authFetch}
          clientId={clientId}
          clientName={clientProfile?.name || null}
          refreshKey={notesRefreshKey}
        />
      )}

      {/* Analyses History tab + section removed in Phase 2 Commit 2.4.
          jobfit_runs table + sourced_by_coach_id column are intentionally
          retained — data preserved, only the surface is gone. */}

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

      {/* TAB 5 — Engagements (attached package snapshots) */}
      {tab === "engagements" && (
        <EngagementsTab
          coachClientId={coachClientId}
          clientName={clientProfile?.name || clientProfile?.email || "this client"}
        />
      )}

      {/* TAB 6 — Library (per-client document links) */}
      {tab === "library" && (
        <LibraryTab
          coachClientId={coachClientId}
          clientName={clientProfile?.name || clientProfile?.email || "this client"}
        />
      )}

      {/* TAB 7 — History (read-only event timeline) */}
      {tab === "history" && <HistoryTab coachClientId={coachClientId} />}

      {/* Per-job detail side panel — opened from a Job Tracker row's
          "Full Jobfit" / "Cover Letter" link. Mounted once; slides in on open. */}
      <JobDetailPanel
        open={jobPanelOpen}
        onClose={() => setJobPanelOpen(false)}
        clientProfileId={clientId}
        applicationId={jobPanelAppId}
        initialSection={jobPanelSection}
      />

      {/* Slide-in Add Note panel — overlays current tab without navigation */}
      <AddNotePanel
        open={addNoteOpen}
        onClose={() => setAddNoteOpen(false)}
        onSaved={() => {
          setNotesRefreshKey((k) => k + 1)
          setNeedsAttentionRefreshKey((k) => k + 1)
        }}
        onSubmit={async ({ type, body, priority }: { type: NoteType; body: string; priority: NotePriority | null }) => {
          try {
            const res = await authFetch(`/api/coach/clients/${clientId}/note-feed`, {
              method: "POST",
              body: JSON.stringify({ type, body, priority }),
            })
            const j = await res.json().catch(() => null)
            if (!res.ok || !j?.ok) {
              return { ok: false as const, error: j?.error || "Failed to save note" }
            }
            return { ok: true as const }
          } catch {
            return { ok: false as const, error: "Network error" }
          }
        }}
      />
    </div>
  )
}
