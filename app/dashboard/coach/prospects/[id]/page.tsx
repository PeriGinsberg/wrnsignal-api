"use client"

// Prospect detail page (Prospects v0.1 Commit 4c).
// Renders /api/coach/prospects/[id] GET response. Scope is State A
// only: lifecycle_status='Prospect'.
//
// Architectural pivot (post-design review): the post-conversion
// (lifecycle='Active' AND client_profile_id IS NULL) state moves
// off this page and onto a future client surface built in Commit 4d
// (/dashboard/coach/coach-clients/[id]). On load, if the prospect
// is not in 'Prospect' lifecycle, we router.replace() to that
// surface — which 404s pre-4d, intentionally.
//
// Convert flow: clicking "Convert to Active" PATCHes lifecycle to
// 'Active' then router.push()es to /coach-clients/[id]. The
// post-conversion send-invite nudge moves to that new surface.
//
// Lifecycle changes always happen via dedicated buttons (Convert /
// Archive); the pill itself is a static "Prospect" chip and is not
// interactive. The LifecycleStatusPill refactor for general
// lifecycle editing lands in Commit 4d.

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
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
import { SavingSpinner } from "../../SavingSpinner"
import { LoadingShell } from "../../LoadingShell"

// ── Constants (duplicated per inline pattern) ──

const PHASE_KEYS = [
  "initial_contact_made",
  "discovery_call_scheduled",
  "discovery_call_completed",
  "sow_sent",
  "sow_signed",
  "invoice_sent",
  "invoice_paid",
] as const
type PhaseKey = (typeof PHASE_KEYS)[number]

const PHASE_LABEL: Record<PhaseKey, string> = {
  initial_contact_made: "Initial contact made",
  discovery_call_scheduled: "Discovery call scheduled",
  discovery_call_completed: "Discovery call completed",
  sow_sent: "SOW sent",
  sow_signed: "SOW signed",
  invoice_sent: "Invoice sent",
  invoice_paid: "Invoice paid",
}

const SOURCE_CATEGORIES = [
  "referral",
  "social_media",
  "website",
  "personal_contact",
  "other",
] as const
type SourceCategory = (typeof SOURCE_CATEGORIES)[number]

const SOURCE_LABEL: Record<SourceCategory, string> = {
  referral: "Referral",
  social_media: "Social Media",
  website: "Website",
  personal_contact: "Personal Contact",
  other: "Other",
}

const SOURCE_STYLE: Record<SourceCategory, { bg: string; color: string; border: string }> = {
  referral:         { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5", border: "rgba(81,173,229,0.40)" },
  social_media:     { bg: "rgba(167,139,250,0.18)", color: "#C8B6F8", border: "rgba(167,139,250,0.40)" },
  website:          { bg: "rgba(45,165,141,0.15)",  color: "#2CA58D", border: "rgba(45,165,141,0.40)" },
  personal_contact: { bg: "rgba(74,222,128,0.15)",  color: "#4ade80", border: "rgba(74,222,128,0.40)" },
  other:            { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.60)", border: "rgba(255,255,255,0.18)" },
}

// ── Types ──

type PhasePair = { checked: boolean; at: string | null }

type ProspectNote = {
  id: string
  type: string
  body: string
  priority: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

type Prospect = {
  id: string
  name: string | null
  invited_email: string | null
  source_category: SourceCategory | null
  source_detail: string | null
  phases: Record<PhaseKey, PhasePair>
  lifecycle_status: string
  client_profile_id: string | null
  last_activity_at: string | null
  created_at: string | null
  notes: ProspectNote[]
}

// ── Auth helpers (inline) ──

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
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

// ── Helpers ──

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

function countCheckedPhases(phases: Record<PhaseKey, PhasePair>): number {
  let n = 0
  for (const k of PHASE_KEYS) if (phases[k]?.checked) n++
  return n
}

// ── Section wrapper ──

function Section({
  title,
  count,
  headerRight,
  children,
}: {
  title: string
  count?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ ...card, padding: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: T.TEXT, letterSpacing: -0.2 }}>
          {title}
        </span>
        {count && (
          <span style={{ fontSize: 12, color: T.DIM, fontWeight: 700 }}>{count}</span>
        )}
        {headerRight && <span style={{ marginLeft: "auto" }}>{headerRight}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Phase row ──

function PhaseRow({
  phaseKey,
  pair,
  onToggle,
}: {
  phaseKey: PhaseKey
  pair: PhasePair
  onToggle: (key: PhaseKey, next: boolean) => void
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
      <input
        type="checkbox"
        checked={pair.checked}
        onChange={(e) => onToggle(phaseKey, e.target.checked)}
        style={{ accentColor: T.WRN_ORANGE, width: 16, height: 16, cursor: "pointer" }}
        aria-label={`${PHASE_LABEL[phaseKey]} ${pair.checked ? "(checked)" : "(unchecked)"}`}
      />
      <span style={{ fontSize: 13, color: T.TEXT, fontWeight: pair.checked ? 700 : 400 }}>
        {PHASE_LABEL[phaseKey]}
      </span>
      {pair.checked && pair.at && (
        <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>{timeAgo(pair.at)}</span>
      )}
    </div>
  )
}

// ── Source section (click-to-edit) ──

function SourceSection({
  category,
  detail,
  invitedEmail,
  onSave,
}: {
  category: SourceCategory | null
  detail: string | null
  invitedEmail: string | null
  onSave: (next: { source_category?: SourceCategory; source_detail?: string | null; invited_email?: string | null }) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [editing, setEditing] = useState(false)
  const [editCategory, setEditCategory] = useState<SourceCategory | "">(category ?? "")
  const [editDetail, setEditDetail] = useState(detail ?? "")
  const [editEmail, setEditEmail] = useState(invitedEmail ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit() {
    setEditCategory(category ?? "")
    setEditDetail(detail ?? "")
    setEditEmail(invitedEmail ?? "")
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setError(null)
  }

  async function handleSave() {
    if (!editCategory) {
      setError("Source category is required")
      return
    }
    setSaving(true)
    setError(null)
    const updates: { source_category?: SourceCategory; source_detail?: string | null; invited_email?: string | null } = {}
    if (editCategory !== category) updates.source_category = editCategory
    const nextDetail = editDetail.trim() || null
    if (nextDetail !== detail) updates.source_detail = nextDetail
    const nextEmail = editEmail.trim() || null
    if (nextEmail !== invitedEmail) updates.invited_email = nextEmail

    if (Object.keys(updates).length === 0) {
      setEditing(false)
      setSaving(false)
      return
    }
    const res = await onSave(updates)
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4 }}>CATEGORY</span>
            <div style={{ fontSize: 13, color: T.TEXT }}>
              {category ? SOURCE_LABEL[category] : <span style={{ color: T.DIM }}>—</span>}
            </div>
          </div>
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4 }}>DETAIL</span>
            <div style={{ fontSize: 13, color: T.TEXT, lineHeight: "20px", whiteSpace: "pre-wrap" }}>
              {detail || <span style={{ color: T.DIM }}>—</span>}
            </div>
          </div>
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 4 }}>INVITED EMAIL</span>
            <div style={{ fontSize: 13, color: T.TEXT }}>
              {invitedEmail || <span style={{ color: T.DIM }}>—</span>}
            </div>
          </div>
        </div>
        <button
          onClick={startEdit}
          style={{
            background: "none",
            border: `1px solid ${T.BORDER_SOFT}`,
            color: T.MUTED,
            fontSize: 11,
            fontWeight: 900,
            borderRadius: 6,
            padding: "4px 12px",
            cursor: "pointer",
            marginTop: 14,
          }}
        >
          Edit
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: saving ? 0.5 : 1, pointerEvents: saving ? "none" : "auto", transition: "opacity 120ms ease" }}>
      <div>
        <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>CATEGORY</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SOURCE_CATEGORIES.map((cat) => {
            const active = editCategory === cat
            const s = SOURCE_STYLE[cat]
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setEditCategory(cat)}
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  padding: "6px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  border: active ? `1px solid ${s.border}` : `1px solid ${T.BORDER_SOFT}`,
                  background: active ? s.bg : "rgba(255,255,255,0.04)",
                  color: active ? s.color : T.DIM,
                  fontFamily: "inherit",
                }}
              >
                {SOURCE_LABEL[cat]}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6 }}>DETAIL</span>
        <textarea
          style={{ ...textarea, minHeight: 60 }}
          value={editDetail}
          onChange={(e) => setEditDetail(e.target.value)}
          placeholder="e.g. Met at conference, intro from Sarah"
          maxLength={500}
        />
      </div>
      <div>
        <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6 }}>INVITED EMAIL</span>
        <input
          type="email"
          style={input}
          value={editEmail}
          onChange={(e) => setEditEmail(e.target.value)}
          placeholder="prospect@example.com"
        />
      </div>
      {error && (
        <div style={{ padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{error}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            ...btnPrimary,
            fontSize: 12,
            padding: "8px 16px",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity: saving ? 0.5 : 1,
          }}
        >
          {saving && <SavingSpinner size={10} />}
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={cancelEdit} disabled={saving} style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px" }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Notes section ──

function ProspectNotesSection({
  prospectId,
  notes,
  onChanged,
}: {
  prospectId: string
  notes: ProspectNote[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)

  async function handleAdd() {
    const trimmed = draft.trim()
    if (!trimmed) {
      setError("Note can't be empty")
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Prospect notes lock type to 'other' per FRD §6.4.2 Q11.
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: trimmed, type: "other" }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 201 || j?.ok) {
        setDraft("")
        setAdding(false)
        onChanged()
      } else {
        setError(j?.error || "Couldn't save note — try again")
      }
    } catch {
      setError("Network error — try again")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(noteId: string) {
    if (!confirm("Delete this note?")) return
    setBusyNoteId(noteId)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes/${noteId}`, {
        method: "DELETE",
      })
      if (res.ok) {
        onChanged()
      }
    } catch {
      // Silent — list reload will reflect actual state on next refresh.
    } finally {
      setBusyNoteId(null)
    }
  }

  const headerRight = !adding ? (
    <button
      onClick={() => { setAdding(true); setDraft(""); setError(null) }}
      style={{
        ...btnSecondary,
        fontSize: 12,
        fontWeight: 700,
        padding: "6px 12px",
        borderRadius: 8,
        color: T.WRN_ORANGE,
        borderColor: "rgba(254,176,106,0.3)",
      }}
    >
      + Add note
    </button>
  ) : null

  return (
    <Section title="Notes" count={notes.length > 0 ? `(${notes.length})` : undefined} headerRight={headerRight}>
      {adding && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 10 }}>
          <textarea
            style={{ ...textarea, minHeight: 80, fontSize: 13 }}
            placeholder="What did you want to capture?"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (error) setError(null) }}
            autoFocus
          />
          {error && (
            <div style={{ padding: 8, marginTop: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{error}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={handleAdd}
              disabled={saving || draft.trim().length === 0}
              style={{
                ...btnPrimary,
                fontSize: 11,
                padding: "6px 14px",
                opacity: saving || draft.trim().length === 0 ? 0.5 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {saving && <SavingSpinner size={10} />}
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => { setAdding(false); setDraft(""); setError(null) }}
              disabled={saving}
              style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>No notes yet</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notes.map((n) => {
            const created = n.created_at ? new Date(n.created_at) : null
            const createdLabel = created
              ? created.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: created.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
                  hour: "numeric",
                  minute: "2-digit",
                })
              : null
            return (
              <div
                key={n.id}
                style={{
                  padding: 14,
                  background: "rgba(255,255,255,0.025)",
                  border: `1px solid ${T.BORDER_SOFT}`,
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  {createdLabel && (
                    <span style={{ fontSize: 11, color: T.DIM }}>{createdLabel}</span>
                  )}
                  <button
                    onClick={() => handleDelete(n.id)}
                    disabled={busyNoteId === n.id}
                    style={{
                      marginLeft: "auto",
                      background: "none",
                      border: "none",
                      color: T.DIM,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                      opacity: busyNoteId === n.id ? 0.5 : 1,
                    }}
                  >
                    {busyNoteId === n.id ? "..." : "Delete"}
                  </button>
                </div>
                <p style={{ fontSize: 13, color: T.TEXT, lineHeight: "20px", whiteSpace: "pre-wrap", margin: 0 }}>
                  {n.body}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ── Page ──

export default function ProspectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const hasLoadedOnceRef = useRef(false)
  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [phaseError, setPhaseError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [archiveHover, setArchiveHover] = useState(false)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true || hasLoadedOnceRef.current
      hasLoadedOnceRef.current = true
      if (!silent) setLoading(true)
      const res = await authFetch(`/api/coach/prospects/${id}`)
      if (res.status === 403) {
        setAccessDenied(true)
        if (!silent) setLoading(false)
        return
      }
      if (res.ok) {
        const j = await res.json()
        setProspect(j.prospect)
      }
      if (!silent) setLoading(false)
    },
    [id],
  )

  useEffect(() => { load() }, [load])

  // Redirect-away for any non-Prospect lifecycle. The prospect detail
  // page only handles State A (lifecycle='Prospect') in 4c; the
  // post-conversion surface (Active without client_profile_id, or
  // anything else) belongs on /dashboard/coach/coach-clients/[id],
  // shipping in 4d. Pre-4d, that route 404s — accepted intentionally.
  useEffect(() => {
    if (prospect && prospect.lifecycle_status !== "Prospect") {
      router.replace(`/dashboard/coach/coach-clients/${prospect.id}`)
    }
  }, [prospect, router])

  // ── Phase toggle (optimistic + revert on failure) ──
  async function togglePhase(key: PhaseKey, nextChecked: boolean) {
    if (!prospect) return
    const prev = prospect
    setProspect({
      ...prospect,
      phases: {
        ...prospect.phases,
        [key]: { checked: nextChecked, at: nextChecked ? new Date().toISOString() : null },
      },
    })
    setPhaseError(null)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}`, {
        method: "PATCH",
        body: JSON.stringify({ phases: { [key]: nextChecked } }),
      })
      if (!res.ok) {
        setProspect(prev)
        const j = await res.json().catch(() => ({}))
        setPhaseError(j?.error || "Couldn't save — try again")
        setTimeout(() => setPhaseError(null), 4000)
        return
      }
      const j = await res.json()
      if (j?.prospect) {
        setProspect({
          ...j.prospect,
          notes: j.prospect.notes ?? prev.notes,
        })
      }
    } catch {
      setProspect(prev)
      setPhaseError("Network error — try again")
      setTimeout(() => setPhaseError(null), 4000)
    }
  }

  async function handleSourceUpdate(
    updates: { source_category?: SourceCategory; source_detail?: string | null; invited_email?: string | null },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!prospect) return { ok: false, error: "No prospect loaded" }
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, error: j?.error || "Couldn't save — try again" }
      }
      if (j?.prospect) {
        setProspect({ ...j.prospect, notes: j.prospect.notes ?? prospect.notes })
      }
      return { ok: true }
    } catch {
      return { ok: false, error: "Network error — try again" }
    }
  }

  // Convert to Active (one-click, no confirm — per C2). PATCHes
  // lifecycle then pushes to /coach-clients/[id]. The redirect
  // useEffect above will also fire when setProspect lands the new
  // lifecycle, but the explicit push gives the back button a clean
  // history entry pointing back to /prospects.
  async function handleConvert() {
    if (!prospect) return
    setConverting(true)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}`, {
        method: "PATCH",
        body: JSON.stringify({ lifecycle_status: "Active" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(j?.error || "Couldn't convert — try again")
        return
      }
      router.push(`/dashboard/coach/coach-clients/${prospect.id}`)
    } catch {
      alert("Network error — try again")
    } finally {
      setConverting(false)
    }
  }

  // Archive (soft-revoke, with confirm()).
  async function handleArchive() {
    if (!prospect) return
    const name = prospect.name || "this prospect"
    if (!confirm(`Archive ${name}? This can be undone.`)) return
    setArchiving(true)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/dashboard/coach/prospects")
        return
      }
      const j = await res.json().catch(() => ({}))
      alert(j?.error || "Couldn't archive — try again")
    } catch {
      alert("Network error — try again")
    } finally {
      setArchiving(false)
    }
  }

  if (loading) return <LoadingShell />

  if (accessDenied) {
    return (
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
      </div>
    )
  }

  if (!prospect) return null

  // Single guard: any non-Prospect lifecycle renders the redirect
  // shell while the useEffect above does router.replace().
  if (prospect.lifecycle_status !== "Prospect") {
    return <LoadingShell label="Redirecting..." />
  }

  const phasesCount = countCheckedPhases(prospect.phases)

  return (
    <div>
      <a
        href="/dashboard/coach/prospects"
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
        ← Back to Prospects
      </a>

      {/* Header strip */}
      <div style={{ ...card, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
            {prospect.name || "Unnamed prospect"}
          </h1>
          <span
            style={{
              background: "#F4A261",
              color: "#FFFFFF",
              fontSize: 12,
              fontWeight: 900,
              padding: "6px 14px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              letterSpacing: 0.2,
              display: "inline-block",
            }}
          >
            Prospect
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleConvert}
              disabled={converting}
              style={{
                background: T.GRAD_PRIMARY,
                color: "#04060F",
                borderRadius: 10,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 800,
                cursor: converting ? "wait" : "pointer",
                border: "none",
                fontFamily: "inherit",
                opacity: converting ? 0.5 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {converting && <SavingSpinner size={10} />}
              {converting ? "Converting..." : "Convert to Active"}
            </button>
            <button
              onClick={handleArchive}
              onMouseEnter={() => setArchiveHover(true)}
              onMouseLeave={() => setArchiveHover(false)}
              disabled={archiving}
              style={{
                ...btnSecondary,
                fontSize: 12,
                padding: "8px 14px",
                background: archiveHover ? "rgba(255,120,120,0.08)" : T.CARD,
                border: archiveHover ? "1px solid rgba(255,120,120,0.3)" : `1px solid ${T.BORDER_SOFT}`,
                color: archiveHover ? T.TEXT : T.DIM,
                cursor: "pointer",
                transition: "all 120ms ease",
                opacity: archiving ? 0.5 : 1,
              }}
            >
              {archiving ? "Archiving..." : "Archive"}
            </button>
          </div>
        </div>
      </div>

      {/* Transient phase save error banner */}
      {phaseError && (
        <div
          style={{
            padding: 10,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{phaseError}</span>
        </div>
      )}

      <Section title="Source">
        <SourceSection
          category={prospect.source_category}
          detail={prospect.source_detail}
          invitedEmail={prospect.invited_email}
          onSave={handleSourceUpdate}
        />
      </Section>

      <Section title={`Phases (${phasesCount} / 7 complete)`}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {PHASE_KEYS.map((k) => (
            <PhaseRow
              key={k}
              phaseKey={k}
              pair={prospect.phases[k]}
              onToggle={togglePhase}
            />
          ))}
        </div>
      </Section>

      <ProspectNotesSection
        prospectId={prospect.id}
        notes={prospect.notes}
        onChanged={() => load({ silent: true })}
      />
    </div>
  )
}
