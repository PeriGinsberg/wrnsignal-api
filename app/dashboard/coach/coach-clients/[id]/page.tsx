"use client"

// Post-conversion client detail page (Prospects v0.1 Commit 4d).
//
// Renders a coach_clients row that has been Converted from Prospect →
// Active but has NOT yet been linked to a client_profiles row (SIGNAL
// account not set up). The page's primary purpose is to expose the
// "Send SIGNAL Invite" CTA, plus surface the prospect-stage info
// (name, email, source, notes) so the coach has continuity from the
// pre-conversion record.
//
// Routing guards (mirrors the prospect detail page's lifecycle gate):
//   - lifecycle_status != 'Active' (e.g. still 'Prospect', or 'Archived')
//     → redirect to /dashboard/coach/prospects/[id]
//   - client_profile_id IS NOT NULL (invite already sent + SIGNAL set up)
//     → redirect to /dashboard/coach/clients/[client_profile_id]
//   - otherwise: render this page
//
// Data source: GET /api/coach/prospects/[id]. That endpoint does NOT
// require lifecycle_status='Prospect' (intentional — see route file
// header). Same response shape as the prospect detail page, including
// the bf8e31c6 name-resolution fallback for coach_clients.name NULL.

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import {
  T,
  textarea,
  btnPrimary,
  btnSecondary,
  card,
  eyebrow,
  label,
} from "../../../../../lib/dashboard-theme"
import { SavingSpinner } from "../../SavingSpinner"
import { LoadingShell } from "../../LoadingShell"

// ── Constants ──

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

const SOURCE_STYLE: Record<SourceCategory, { bg: string; color: string }> = {
  referral:         { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5" },
  social_media:     { bg: "rgba(167,139,250,0.18)", color: "#C8B6F8" },
  website:          { bg: "rgba(45,165,141,0.15)",  color: "#2CA58D" },
  personal_contact: { bg: "rgba(74,222,128,0.15)",  color: "#4ade80" },
  other:            { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.60)" },
}

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

const AVATAR_PALETTE = [
  { bg: "rgba(81,173,229,0.18)",  text: "#9FC9EE" },
  { bg: "rgba(254,176,106,0.18)", text: "#FECDA0" },
  { bg: "rgba(167,139,250,0.18)", text: "#C8B6F8" },
  { bg: "rgba(244,114,182,0.18)", text: "#F4ADC9" },
  { bg: "rgba(74,222,128,0.18)",  text: "#9CE7B5" },
] as const

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

type CoachClientRecord = {
  id: string
  name: string | null
  invited_email: string | null
  phone: string | null
  source_category: SourceCategory | null
  source_detail: string | null
  phases: Record<PhaseKey, PhasePair>
  lifecycle_status: string
  client_profile_id: string | null
  last_activity_at: string | null
  created_at: string | null
  notes: ProspectNote[]
}

// ── Auth helpers (inline per established convention) ──

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

function hashIndex(s: string, mod: number): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return Math.abs(h) % mod
}

function initialsOf(name: string | null, fallback: string | null): string {
  const src = (name && name.trim()) || (fallback && fallback.trim()) || "?"
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function firstNameOf(full: string | null, fallback: string | null): string {
  const src = (full && full.trim()) || (fallback && fallback.trim()) || ""
  const first = src.split(/\s+/)[0] || ""
  return first || "this client"
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

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

// ── Inline atoms ──

function LargeAvatar({ name, email }: { name: string | null; email: string | null }) {
  const seed = (name || email || "?").toLowerCase()
  const palette = AVATAR_PALETTE[hashIndex(seed, AVATAR_PALETTE.length)]
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: palette.bg,
        color: palette.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 20,
        fontWeight: 900,
        letterSpacing: 0.3,
        flexShrink: 0,
      }}
    >
      {initialsOf(name, email)}
    </div>
  )
}

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
        <span style={{ fontSize: 16, fontWeight: 600, color: T.TEXT, letterSpacing: -0.2 }}>{title}</span>
        {count && <span style={{ fontSize: 12, color: T.DIM, fontWeight: 700 }}>{count}</span>}
        {headerRight && <span style={{ marginLeft: "auto" }}>{headerRight}</span>}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label: rowLabel, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...label, color: T.WRN_BLUE, fontSize: 10 }}>{rowLabel}</span>
      <span style={{ fontSize: 13, color: T.TEXT }}>{value}</span>
    </div>
  )
}

// ── Notes section (copy of 4c.2 ProspectNotesSection with the same
//    type system, completion toggle, and filter chip bar) ──

function ClientNotesSection({
  coachClientId,
  notes,
  onChanged,
}: {
  coachClientId: string
  notes: ProspectNote[]
  onChanged: () => void
}) {
  const [filter, setFilter] = useState<"" | NoteType>("")
  const [adding, setAdding] = useState(false)
  const [draftBody, setDraftBody] = useState("")
  const [draftType, setDraftType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [draftPriority, setDraftPriority] = useState<NotePriority>(DEFAULT_ACTION_ITEM_PRIORITY)
  const [savingAdd, setSavingAdd] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState("")
  const [editType, setEditType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [editPriority, setEditPriority] = useState<NotePriority>(DEFAULT_ACTION_ITEM_PRIORITY)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

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
      const body: Record<string, string> = { body: trimmed, type: draftType }
      if (draftType === "action_item") body.priority = draftPriority
      const res = await authFetch(`/api/coach/prospects/${coachClientId}/notes`, {
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
    setEditPriority(n.priority ?? DEFAULT_ACTION_ITEM_PRIORITY)
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
      const res = await authFetch(`/api/coach/prospects/${coachClientId}/notes/${noteId}`, {
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
      const res = await authFetch(`/api/coach/prospects/${coachClientId}/notes/${n.id}`, {
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
      const res = await authFetch(`/api/coach/prospects/${coachClientId}/notes/${noteId}`, {
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
                border: active ? "1px solid rgba(254,176,106,0.4)" : `1px solid ${T.BORDER_SOFT}`,
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
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {NOTE_TYPES.map((t) => {
                const active = draftType === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraftType(t)}
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      padding: "6px 12px",
                      borderRadius: 8,
                      cursor: "pointer",
                      textTransform: "uppercase",
                      letterSpacing: 0.6,
                      border: active ? "1px solid rgba(254,176,106,0.4)" : `1px solid ${T.BORDER_SOFT}`,
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
          </div>
          {draftType === "action_item" && (
            <div>
              <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6, fontSize: 9 }}>PRIORITY</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {NOTE_PRIORITIES.map((p) => {
                  const active = draftPriority === p
                  const s = NOTE_PRIORITY_BADGE[p]
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDraftPriority(p)}
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
                      {NOTE_PRIORITY_LABEL[p]}
                    </button>
                  )
                })}
              </div>
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
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {NOTE_TYPES.map((t) => {
                          const active = editType === t
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setEditType(t)}
                              style={{
                                fontSize: 10,
                                fontWeight: 900,
                                padding: "4px 10px",
                                borderRadius: 8,
                                cursor: "pointer",
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                                border: active ? "1px solid rgba(254,176,106,0.4)" : `1px solid ${T.BORDER_SOFT}`,
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
                    </div>
                    {editType === "action_item" && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {NOTE_PRIORITIES.map((p) => {
                            const active = editPriority === p
                            const s = NOTE_PRIORITY_BADGE[p]
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setEditPriority(p)}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 900,
                                  padding: "4px 10px",
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

export default function CoachClientPostConversionPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const hasLoadedOnceRef = useRef(false)
  const [record, setRecord] = useState<CoachClientRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)

  // Send-invite state (in-session only).
  const [sending, setSending] = useState(false)
  const [inviteResult, setInviteResult] = useState<
    | { ok: true; client_profile_id: string; email_sent: boolean; sent_at: string }
    | null
  >(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [settingUp, setSettingUp] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

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
        setRecord(j.prospect)
      }
      if (!silent) setLoading(false)
    },
    [id],
  )

  useEffect(() => { load() }, [load])

  // Routing guards — redirect away when the record's lifecycle / link
  // state doesn't match the 4d surface contract. Both use router.replace
  // so the dead URL doesn't accumulate in history.
  useEffect(() => {
    if (!record) return
    if (record.lifecycle_status !== "Active") {
      // Still a prospect (or archived) — wrong page. Send back.
      router.replace(`/dashboard/coach/prospects/${record.id}`)
      return
    }
    if (record.client_profile_id) {
      // Invite already accepted (SIGNAL profile linked). Forward to the
      // real client detail page.
      router.replace(`/dashboard/coach/clients/${record.client_profile_id}`)
    }
  }, [record, router])

  async function handleSendInvite() {
    if (!record || sending) return
    if (!record.invited_email) {
      setInviteError("No invited email on record. Add an email to the prospect before sending an invite.")
      return
    }
    setSending(true)
    setInviteError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${record.id}/send-invite`, {
        method: "POST",
        body: "{}", // empty body — no resume_text passed from this surface
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        setInviteResult({
          ok: true,
          client_profile_id: j.client_profile_id,
          email_sent: !!j.email_sent,
          sent_at: new Date().toISOString(),
        })
        // Refetch silently so a manual refresh after this point will
        // see the updated client_profile_id and redirect cleanly.
        load({ silent: true })
      } else {
        setInviteError(j?.error || "Couldn't send invite — try again")
      }
    } catch {
      setInviteError("Network error — try again")
    } finally {
      setSending(false)
    }
  }

  // Set up the account WITHOUT inviting — the deferred-invite twin of the
  // client-side create-client decoupling. Creates + links the account (server
  // nulls invited_at), then navigates straight to the client detail screen,
  // where the shipped Send SIGNAL invite button takes over. The self-guard
  // (:889-901) would also redirect on refetch; direct nav is snappier.
  async function handleSetupAccount() {
    if (!record || settingUp) return
    if (!record.invited_email) {
      setSetupError("No email on record. Add an email to the prospect first.")
      return
    }
    setSettingUp(true)
    setSetupError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${record.id}/setup-account`, {
        method: "POST",
        body: "{}",
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok && j.client_profile_id) {
        router.push(`/dashboard/coach/clients/${j.client_profile_id}`)
      } else {
        setSetupError(j?.error || "Couldn't set up account — try again")
      }
    } catch {
      setSetupError("Network error — try again")
    } finally {
      setSettingUp(false)
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

  if (!record) return null

  // Guard-redirect cases — useEffect above is handling the router.replace,
  // render a placeholder shell briefly.
  if (record.lifecycle_status !== "Active" || record.client_profile_id) {
    return <LoadingShell label="Redirecting..." />
  }

  const displayName = record.name || record.invited_email || "Unnamed client"
  const firstName = firstNameOf(record.name, record.invited_email)
  const inviteWasJustSent = !!inviteResult

  return (
    <div>
      <a
        href="/dashboard/coach/clients"
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
        ← Back to My Clients
      </a>

      {/* Header strip */}
      <div style={{ ...card, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <LargeAvatar name={record.name} email={record.invited_email} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 240px", minWidth: 0 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
              {displayName}
            </h1>
            {record.invited_email && (
              <span style={{ fontSize: 13, color: T.MUTED }}>{record.invited_email}</span>
            )}
            {record.phone && (
              <a
                href={`tel:${record.phone}`}
                style={{ fontSize: 13, color: T.MUTED, textDecoration: "none" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none" }}
              >
                {record.phone}
              </a>
            )}
          </div>
          <span
            style={{
              background: "rgba(255,149,0,0.15)",
              color: "#FF9500",
              border: "1px solid rgba(255,149,0,0.3)",
              fontSize: 11,
              fontWeight: 900,
              padding: "5px 12px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            Awaiting SIGNAL Setup
          </span>
        </div>
      </div>

      {/* Main CTA card — Send SIGNAL Invite */}
      <div
        style={{
          background: "rgba(255,149,0,0.08)",
          border: "1px solid rgba(255,149,0,0.2)",
          borderRadius: 12,
          padding: 24,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FF9500"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0, marginTop: 2 }}
          >
            <path d="M3 7l9 6 9-6" />
            <rect x="3" y="5" width="18" height="14" rx="2" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.TEXT, marginBottom: 6 }}>
              Send SIGNAL Invite
            </div>
            <p style={{ fontSize: 13, color: T.MUTED, lineHeight: "20px", margin: 0, marginBottom: 16 }}>
              Send {firstName} an invitation to create their SIGNAL account.
              Once they accept and set up their profile, you&apos;ll have full
              visibility into their job search.
            </p>

            {inviteWasJustSent ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    fontWeight: 800,
                    color: T.SUCCESS,
                  }}
                >
                  <span>✓ Invite Sent</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.DIM }}>
                    Sent just now
                  </span>
                </div>
                {!inviteResult?.email_sent && (
                  <p style={{ fontSize: 12, color: "#FBBF24", margin: 0 }}>
                    Account created but the email delivery failed — please reach
                    out to {firstName} directly with their sign-in link.
                  </p>
                )}
                <button
                  onClick={() =>
                    router.push(`/dashboard/coach/clients/${inviteResult!.client_profile_id}`)
                  }
                  style={{
                    background: T.GRAD_PRIMARY,
                    color: "#04060F",
                    borderRadius: 10,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    border: "none",
                    fontFamily: "inherit",
                    alignSelf: "flex-start",
                  }}
                >
                  Go to Client Dashboard →
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleSendInvite}
                  disabled={sending || !record.invited_email}
                  style={{
                    background: T.GRAD_PRIMARY,
                    color: "#04060F",
                    borderRadius: 10,
                    padding: "12px 22px",
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: sending || !record.invited_email ? "default" : "pointer",
                    border: "none",
                    fontFamily: "inherit",
                    opacity: sending || !record.invited_email ? 0.55 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {sending && <SavingSpinner />}
                  {sending ? "Sending..." : "Send Invite →"}
                </button>
                <button
                  onClick={handleSetupAccount}
                  disabled={settingUp || sending || !record.invited_email}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    color: T.TEXT,
                    borderRadius: 10,
                    padding: "12px 22px",
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: settingUp || sending || !record.invited_email ? "default" : "pointer",
                    border: `1px solid ${T.BORDER_SOFT}`,
                    fontFamily: "inherit",
                    opacity: settingUp || sending || !record.invited_email ? 0.55 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    marginLeft: 10,
                  }}
                >
                  {settingUp && <SavingSpinner />}
                  {settingUp ? "Setting up..." : "Set up account (no invite)"}
                </button>
                {setupError && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 10,
                      background: "rgba(248,113,113,0.1)",
                      border: "1px solid rgba(248,113,113,0.3)",
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{setupError}</span>
                  </div>
                )}
                {inviteError && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 10,
                      background: "rgba(248,113,113,0.1)",
                      border: "1px solid rgba(248,113,113,0.3)",
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{inviteError}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Client Information card — read-only summary of the prospect-stage data */}
      <Section title="Client Information">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {record.source_category && (
            <InfoRow
              label="SOURCE"
              value={
                <span
                  style={{
                    display: "inline-block",
                    background: SOURCE_STYLE[record.source_category].bg,
                    color: SOURCE_STYLE[record.source_category].color,
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    padding: "3px 10px",
                    borderRadius: 999,
                  }}
                >
                  {SOURCE_LABEL[record.source_category]}
                </span>
              }
            />
          )}
          {record.source_detail && <InfoRow label="SOURCE DETAIL" value={record.source_detail} />}
          {record.invited_email && <InfoRow label="EMAIL" value={record.invited_email} />}
          {record.phone && (
            <InfoRow
              label="PHONE"
              value={
                <a
                  href={`tel:${record.phone}`}
                  style={{ color: T.TEXT, textDecoration: "none" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none" }}
                >
                  {record.phone}
                </a>
              }
            />
          )}
          {record.created_at && (
            <InfoRow label="ADDED AS PROSPECT" value={formatDate(record.created_at)} />
          )}
          {record.last_activity_at && (
            <InfoRow label="LAST ACTIVITY" value={timeAgo(record.last_activity_at)} />
          )}
        </div>
      </Section>

      {/* Notes section — same type system as the prospect detail page */}
      <ClientNotesSection
        coachClientId={record.id}
        notes={record.notes}
        onChanged={() => load({ silent: true })}
      />
    </div>
  )
}
