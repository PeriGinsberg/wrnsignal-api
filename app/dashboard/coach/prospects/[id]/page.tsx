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

// ── Note constants (mirror app/dashboard/coach/clients/[clientId]/NotesTab.tsx
//    for visual parity. Duplicated inline per the established coach-route
//    pattern rather than extracted to a shared module.) ──

const NOTE_TYPES = ["session_recap", "action_item", "other"] as const
type NoteType = (typeof NOTE_TYPES)[number]

const NOTE_PRIORITIES = ["urgent", "this_week", "when_ready"] as const
type NotePriority = (typeof NOTE_PRIORITIES)[number]

const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  session_recap: "Session Recap",
  action_item: "Action Item",
  other: "Other",
}

const NOTE_TYPE_BADGE: Record<NoteType, { bg: string; color: string }> = {
  session_recap: { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5" },
  action_item:   { bg: "rgba(254,176,106,0.12)", color: "#FEB06A" },
  other:         { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.60)" },
}

const NOTE_PRIORITY_LABEL: Record<NotePriority, string> = {
  urgent: "Urgent",
  this_week: "This Week",
  when_ready: "When Ready",
}

const NOTE_PRIORITY_BADGE: Record<NotePriority, { bg: string; color: string; border: string }> = {
  urgent:     { bg: "rgba(248,113,113,0.15)", color: "#f87171", border: "rgba(248,113,113,0.4)" },
  this_week:  { bg: "rgba(254,176,106,0.15)", color: "#FEB06A", border: "rgba(254,176,106,0.4)" },
  when_ready: { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5", border: "rgba(81,173,229,0.4)" },
}

const DEFAULT_NOTE_TYPE: NoteType = "session_recap"
const DEFAULT_ACTION_ITEM_PRIORITY: NotePriority = "this_week"

const NOTE_FILTER_OPTIONS: { value: "" | NoteType; label: string }[] = [
  { value: "", label: "All" },
  { value: "session_recap", label: "Session Recap" },
  { value: "action_item", label: "Action Item" },
  { value: "other", label: "Other" },
]

// ── Types ──

type PhasePair = { checked: boolean; at: string | null }

type ProspectNote = {
  id: string
  type: NoteType
  body: string
  priority: NotePriority | null
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

// TypeChipPicker / PriorityChipPicker — small reusable inline pickers
// used by both the Add and Edit forms.

function TypeChipPicker({
  value,
  onChange,
  size = "md",
}: {
  value: NoteType
  onChange: (next: NoteType) => void
  size?: "sm" | "md"
}) {
  const fontSize = size === "sm" ? 10 : 11
  const padding = size === "sm" ? "4px 10px" : "6px 12px"
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {NOTE_TYPES.map((t) => {
        const active = value === t
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            style={{
              fontSize,
              fontWeight: 900,
              padding,
              borderRadius: 8,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              border: active ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
              background: active ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
              color: active ? T.WRN_ORANGE : T.DIM,
              fontFamily: "inherit",
            }}
          >
            {NOTE_TYPE_LABEL[t]}
          </button>
        )
      })}
    </div>
  )
}

function PriorityChipPicker({
  value,
  onChange,
  size = "md",
}: {
  value: NotePriority
  onChange: (next: NotePriority) => void
  size?: "sm" | "md"
}) {
  const fontSize = size === "sm" ? 10 : 11
  const padding = size === "sm" ? "4px 10px" : "6px 12px"
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {NOTE_PRIORITIES.map((p) => {
        const active = value === p
        const s = NOTE_PRIORITY_BADGE[p]
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            style={{
              fontSize,
              fontWeight: 900,
              padding,
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
            {NOTE_PRIORITY_LABEL[p]}
          </button>
        )
      })}
    </div>
  )
}

function ProspectNotesSection({
  prospectId,
  notes,
  onChanged,
}: {
  prospectId: string
  notes: ProspectNote[]
  onChanged: () => void
}) {
  // Local filter (matches NotesTab pattern — no URL sync).
  const [filter, setFilter] = useState<"" | NoteType>("")

  // Add form state.
  const [adding, setAdding] = useState(false)
  const [draftBody, setDraftBody] = useState("")
  const [draftType, setDraftType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [draftPriority, setDraftPriority] = useState<NotePriority>(DEFAULT_ACTION_ITEM_PRIORITY)
  const [savingAdd, setSavingAdd] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Edit form state.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState("")
  const [editType, setEditType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [editPriority, setEditPriority] = useState<NotePriority>(DEFAULT_ACTION_ITEM_PRIORITY)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Per-note busy state for inline operations (complete / delete).
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  // In-memory filter — notes come from the parent via GET detail,
  // and the parent re-fetches via onChanged() after each mutation.
  const filteredNotes = filter ? notes.filter((n) => n.type === filter) : notes

  function startAdd() {
    setAdding(true)
    setDraftBody("")
    setDraftType(DEFAULT_NOTE_TYPE)
    setDraftPriority(DEFAULT_ACTION_ITEM_PRIORITY)
    setAddError(null)
  }

  function cancelAdd() {
    setAdding(false)
    setDraftBody("")
    setAddError(null)
  }

  async function handleAdd() {
    const trimmed = draftBody.trim()
    if (!trimmed) {
      setAddError("Note can't be empty")
      return
    }
    setSavingAdd(true)
    setAddError(null)
    try {
      const body: Record<string, string> = {
        body: trimmed,
        type: draftType,
      }
      if (draftType === "action_item") body.priority = draftPriority
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 201 || j?.ok) {
        cancelAdd()
        onChanged()
      } else {
        setAddError(j?.error || "Couldn't save note — try again")
      }
    } catch {
      setAddError("Network error — try again")
    } finally {
      setSavingAdd(false)
    }
  }

  function startEdit(n: ProspectNote) {
    setEditingId(n.id)
    setEditBody(n.body)
    setEditType(n.type)
    setEditPriority((n.priority ?? DEFAULT_ACTION_ITEM_PRIORITY))
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBody("")
    setEditError(null)
  }

  async function saveEdit(noteId: string) {
    const trimmed = editBody.trim()
    if (!trimmed) {
      setEditError("Note can't be empty")
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes/${noteId}`, {
        method: "PUT",
        body: JSON.stringify({
          body: trimmed,
          type: editType,
          priority: editType === "action_item" ? editPriority : null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        cancelEdit()
        onChanged()
      } else {
        setEditError(j?.error || "Couldn't save note — try again")
      }
    } catch {
      setEditError("Network error — try again")
    } finally {
      setSavingEdit(false)
    }
  }

  async function toggleCompletion(n: ProspectNote) {
    if (n.type !== "action_item") return
    setBusyNoteId(n.id)
    setRowError(null)
    const next = n.completed_at ? null : new Date().toISOString()
    try {
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes/${n.id}`, {
        method: "PUT",
        body: JSON.stringify({ completed_at: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        onChanged()
      } else {
        setRowError(j?.error || "Couldn't update completion")
      }
    } catch {
      setRowError("Network error")
    } finally {
      setBusyNoteId(null)
    }
  }

  async function handleDelete(noteId: string) {
    if (!confirm("Delete this note?")) return
    setBusyNoteId(noteId)
    setRowError(null)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes/${noteId}`, {
        method: "DELETE",
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        onChanged()
      } else {
        setRowError(j?.error || "Couldn't delete note")
      }
    } catch {
      setRowError("Network error")
    } finally {
      setBusyNoteId(null)
    }
  }

  const headerRight = !adding ? (
    <button
      onClick={startAdd}
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
      {/* Filter chip bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: adding || notes.length > 0 ? 16 : 0 }}>
        {NOTE_FILTER_OPTIONS.map((f) => {
          const active = filter === f.value
          return (
            <button
              key={f.value || "all"}
              onClick={() => setFilter(f.value)}
              style={{
                fontSize: 11,
                fontWeight: 900,
                padding: "6px 14px",
                borderRadius: 8,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                border: active ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
                background: active ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
                color: active ? T.WRN_ORANGE : T.DIM,
                fontFamily: "inherit",
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Inline Add form */}
      {adding && (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${T.BORDER_SOFT}`,
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            opacity: savingAdd ? 0.5 : 1,
            pointerEvents: savingAdd ? "none" : "auto",
            transition: "opacity 120ms ease",
          }}
        >
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6, fontSize: 9 }}>TYPE</span>
            <TypeChipPicker value={draftType} onChange={setDraftType} />
          </div>
          {draftType === "action_item" && (
            <div>
              <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6, fontSize: 9 }}>PRIORITY</span>
              <PriorityChipPicker value={draftPriority} onChange={setDraftPriority} />
            </div>
          )}
          <textarea
            style={{ ...textarea, minHeight: 80, fontSize: 13 }}
            placeholder="What did you want to capture?"
            value={draftBody}
            onChange={(e) => { setDraftBody(e.target.value); if (addError) setAddError(null) }}
            autoFocus
          />
          {addError && (
            <div style={{ padding: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{addError}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={savingAdd || draftBody.trim().length === 0}
              style={{
                ...btnPrimary,
                fontSize: 11,
                padding: "6px 14px",
                opacity: savingAdd || draftBody.trim().length === 0 ? 0.5 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {savingAdd && <SavingSpinner size={10} />}
              {savingAdd ? "Saving..." : "Save"}
            </button>
            <button onClick={cancelAdd} disabled={savingAdd} style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {rowError && (
        <div style={{ marginBottom: 12, padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{rowError}</span>
        </div>
      )}

      {/* Notes list (filtered in-memory) */}
      {filteredNotes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
          {filter ? `No ${NOTE_TYPE_LABEL[filter as NoteType].toLowerCase()} notes` : "No notes yet"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredNotes.map((n) => {
            const isEditing = editingId === n.id
            const isActionItem = n.type === "action_item"
            const isCompleted = !!n.completed_at
            const typeBadge = NOTE_TYPE_BADGE[n.type]
            const priorityBadge = n.priority ? NOTE_PRIORITY_BADGE[n.priority] : null
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
            const wasEdited = n.updated_at && n.created_at && n.updated_at !== n.created_at

            return (
              <div
                key={n.id}
                style={{
                  padding: 14,
                  background: "rgba(255,255,255,0.025)",
                  border: `1px solid ${T.BORDER_SOFT}`,
                  borderRadius: 10,
                  opacity: isCompleted ? 0.6 : 1,
                }}
              >
                {/* Header row: completion checkbox (action_item only) + badges + date + edited marker */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {isActionItem && (
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      disabled={busyNoteId === n.id}
                      onChange={() => toggleCompletion(n)}
                      style={{ accentColor: T.WRN_ORANGE, width: 16, height: 16, cursor: "pointer" }}
                      aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
                    />
                  )}
                  <span
                    style={{
                      background: typeBadge.bg,
                      color: typeBadge.color,
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      padding: "3px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {NOTE_TYPE_LABEL[n.type]}
                  </span>
                  {isActionItem && priorityBadge && n.priority && (
                    <span
                      style={{
                        background: priorityBadge.bg,
                        color: priorityBadge.color,
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      {NOTE_PRIORITY_LABEL[n.priority]}
                    </span>
                  )}
                  {isCompleted && (
                    <span style={{ fontSize: 11, color: T.SUCCESS, fontWeight: 700 }}>
                      ✓ Completed {new Date(n.completed_at!).toLocaleDateString()}
                    </span>
                  )}
                  {createdLabel && (
                    <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>
                      {createdLabel}
                      {wasEdited ? " · edited" : ""}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <div style={{ opacity: savingEdit ? 0.5 : 1, pointerEvents: savingEdit ? "none" : "auto", transition: "opacity 120ms ease" }}>
                    <div style={{ marginBottom: 10 }}>
                      <TypeChipPicker value={editType} onChange={setEditType} size="sm" />
                    </div>
                    {editType === "action_item" && (
                      <div style={{ marginBottom: 10 }}>
                        <PriorityChipPicker value={editPriority} onChange={setEditPriority} size="sm" />
                      </div>
                    )}
                    <textarea
                      style={{ ...textarea, minHeight: 100, fontSize: 13 }}
                      value={editBody}
                      onChange={(e) => { setEditBody(e.target.value); if (editError) setEditError(null) }}
                    />
                    {editError && (
                      <div style={{ padding: 8, marginTop: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
                        <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{editError}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        onClick={() => saveEdit(n.id)}
                        disabled={savingEdit || editBody.trim().length === 0}
                        style={{
                          ...btnPrimary,
                          fontSize: 11,
                          padding: "6px 14px",
                          opacity: savingEdit || editBody.trim().length === 0 ? 0.5 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {savingEdit && <SavingSpinner size={10} />}
                        {savingEdit ? "Saving..." : "Save"}
                      </button>
                      <button onClick={cancelEdit} disabled={savingEdit} style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: T.TEXT,
                        lineHeight: "20px",
                        whiteSpace: "pre-wrap",
                        margin: 0,
                        textDecoration: isCompleted ? "line-through" : "none",
                      }}
                    >
                      {n.body}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => startEdit(n)}
                        style={{
                          background: "none",
                          border: `1px solid ${T.BORDER_SOFT}`,
                          color: T.MUTED,
                          fontSize: 11,
                          fontWeight: 900,
                          borderRadius: 6,
                          padding: "4px 12px",
                          cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(n.id)}
                        disabled={busyNoteId === n.id}
                        style={{
                          background: "none",
                          border: `1px solid ${T.BORDER_SOFT}`,
                          color: T.DIM,
                          fontSize: 11,
                          fontWeight: 900,
                          borderRadius: 6,
                          padding: "4px 12px",
                          cursor: "pointer",
                          opacity: busyNoteId === n.id ? 0.5 : 1,
                        }}
                      >
                        {busyNoteId === n.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </>
                )}
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

  // Name edit (header strip click-to-edit, mirrors SourceSection pattern).
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

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
    updates: { name?: string; source_category?: SourceCategory; source_detail?: string | null; invited_email?: string | null },
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
  // lifecycle then pushes to /coach-clients/[id] (the 4d
  // post-conversion-pre-invite surface). A short delay gives the
  // "Converting..." button state + transient banner time to register
  // before the redirect. The lifecycle-mismatch useEffect above also
  // fires once setProspect lands the new lifecycle, but the explicit
  // push gives the back button a clean history entry.
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
      await new Promise((resolve) => setTimeout(resolve, 800))
      router.push(`/dashboard/coach/coach-clients/${prospect.id}`)
    } catch {
      alert("Network error — try again")
    } finally {
      setConverting(false)
    }
  }

  // Save edited name (header strip click-to-edit). PATCHes the same
  // /api/coach/prospects/[id] endpoint via the shared handleSourceUpdate
  // wrapper. Server enforces the 1-200 char + trimmed non-empty rules.
  async function saveName() {
    if (!prospect) return
    const trimmed = draftName.trim()
    if (!trimmed) {
      setNameError("Name cannot be empty")
      return
    }
    if (trimmed === (prospect.name ?? "")) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    setNameError(null)
    const res = await handleSourceUpdate({ name: trimmed })
    setSavingName(false)
    if (!res.ok) {
      setNameError(res.error)
      return
    }
    setEditingName(false)
  }

  function startNameEdit() {
    if (!prospect) return
    setDraftName(prospect.name || "")
    setNameError(null)
    setEditingName(true)
  }

  function cancelNameEdit() {
    setEditingName(false)
    setNameError(null)
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
          {editingName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", minWidth: 240 }}>
              <input
                type="text"
                style={{ ...input, height: 40, fontSize: 18, fontWeight: 500, flex: 1, maxWidth: 400 }}
                value={draftName}
                onChange={(e) => { setDraftName(e.target.value); if (nameError) setNameError(null) }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); saveName() }
                  if (e.key === "Escape") { e.preventDefault(); cancelNameEdit() }
                }}
                autoFocus
                disabled={savingName}
                maxLength={200}
              />
              <button
                onClick={saveName}
                disabled={savingName}
                style={{
                  ...btnPrimary,
                  fontSize: 12,
                  padding: "8px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: savingName ? 0.5 : 1,
                }}
              >
                {savingName && <SavingSpinner size={10} />}
                {savingName ? "Saving..." : "Save"}
              </button>
              <button
                onClick={cancelNameEdit}
                disabled={savingName}
                style={{ ...btnSecondary, fontSize: 12, padding: "8px 12px" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
                {prospect.name || "Unnamed prospect"}
              </h1>
              <button
                onClick={startNameEdit}
                style={{
                  background: "none",
                  border: `1px solid ${T.BORDER_SOFT}`,
                  color: T.MUTED,
                  fontSize: 11,
                  fontWeight: 900,
                  borderRadius: 6,
                  padding: "4px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Edit
              </button>
            </>
          )}
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

      {/* Name save error (inline below the header, parallel to phaseError) */}
      {nameError && (
        <div
          style={{
            padding: 10,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{nameError}</span>
        </div>
      )}

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
