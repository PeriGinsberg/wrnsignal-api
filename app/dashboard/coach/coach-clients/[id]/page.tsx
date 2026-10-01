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
import { TaskList } from "../../_tasks/TaskList"
import { useRecordNoteTaskActions } from "../../_notes/RecordNoteTaskActions"
import {
  LegacyTaskLine,
  NOTE_TYPE_BADGE,
  NOTE_TYPE_LABEL,
  NoteTopicChip,
  NoteTopicSelect,
  NoteTypeChips,
  type NoteTaskSummary,
  type NoteTopic,
  type StoredNoteType,
} from "../../_notes/noteUi"

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
  referral:         { bg: "rgba(81,173,229,0.12)",  color: T.INK_LINK },
  social_media:     { bg: "rgba(167,139,250,0.18)", color: "var(--sig-avatar-2-ink, #C8B6F8)" },
  website:          { bg: "rgba(45,165,141,0.15)",  color: T.INK_EMPHASIS },
  personal_contact: { bg: "rgba(0,179,179,0.15)",  color: T.SUCCESS },
  other:            { bg: T.BORDER_SOFT, color: T.MUTED },
}

// source_category is nullable, and "other" is the honest reading of a value the
// map does not know. Without this an unrecognised category crashes the record.
const sourceStyle = (c: SourceCategory | null | undefined) =>
  (c && SOURCE_STYLE[c]) || SOURCE_STYLE.other

// Note types, labels and topics are shared with the client and prospect pages
// (app/dashboard/coach/_notes/noteUi.tsx). Action Item is not offered: work to
// do is a task.
type NoteType = StoredNoteType
type NotePriority = "urgent" | "this_week" | "when_ready"

const DEFAULT_NOTE_TYPE: NoteType = "session_recap"

// Old action items show under All; the type is not offered as a filter.
const NOTE_FILTER_OPTIONS: { value: "" | NoteType; label: string }[] = [
  { value: "", label: "All" },
  { value: "session_recap", label: "Session Recap" },
  { value: "other", label: "Other" },
]

const AVATAR_PALETTE = [
  // Variables, because these read on navy and vanish on white. The
  // wash is the dark fallback; lib/theme/coachSurface.ts supplies a
  // solid tint and a dark ink for the light ground.
  { bg: "var(--sig-avatar-0-bg, rgba(81,173,229,0.18))", text: "var(--sig-avatar-0-ink, #9FC9EE)" },
  { bg: "var(--sig-avatar-1-bg, rgba(254,176,106,0.18))", text: "var(--sig-avatar-1-ink, #FECDA0)" },
  { bg: "var(--sig-avatar-2-bg, rgba(167,139,250,0.18))", text: "var(--sig-avatar-2-ink, #C8B6F8)" },
  { bg: "var(--sig-avatar-3-bg, rgba(244,114,182,0.18))", text: "var(--sig-avatar-3-ink, #F4ADC9)" },
  { bg: "var(--sig-avatar-4-bg, rgba(0,179,179,0.18))", text: "var(--sig-avatar-4-ink, #7FE0DE)" },
] as const

// ── Types ──

type PhasePair = { checked: boolean; at: string | null }

type ProspectNote = {
  id: string
  type: NoteType
  topic?: NoteTopic | null
  body: string
  priority: NotePriority | null
  completed_at: string | null
  created_at: string
  updated_at: string
  /** An old action item's task. Its tick lives on the task, not here. */
  task?: NoteTaskSummary | null
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
      <span style={{ ...label, color: T.INK_LINK, fontSize: 10 }}>{rowLabel}</span>
      <span style={{ fontSize: 13, color: T.TEXT }}>{value}</span>
    </div>
  )
}

// ── Notes section (copy of 4c.2 ProspectNotesSection with the same
//    type system, topics and filter chip bar) ──

function ClientNotesSection({
  coachClientId,
  notes,
  onChanged,
  onAddNote,
}: {
  coachClientId: string
  notes: ProspectNote[]
  onChanged: () => void
  /** Opens the page's Add Note panel (shared with the prospect page). */
  onAddNote: () => void
}) {
  const [filter, setFilter] = useState<"" | NoteType>("")

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState("")
  const [editType, setEditType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [editTopic, setEditTopic] = useState<NoteTopic | "">("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const filteredNotes = filter ? notes.filter((n) => n.type === filter) : notes

  function startEdit(n: ProspectNote) {
    setEditingId(n.id)
    setEditBody(n.body)
    setEditType(n.type)
    setEditTopic(n.topic ?? "")
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
        body: JSON.stringify({ body: trimmed, type: editType, topic: editTopic || null }),
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

  const headerRight = (
    <button
      onClick={onAddNote}
      style={{
        ...btnSecondary,
        fontSize: 12,
        fontWeight: 700,
        padding: "6px 12px",
        borderRadius: 8,
        color: T.INK_EMPHASIS,
        borderColor: "rgba(254,176,106,0.3)",
      }}
    >
      + Add note
    </button>
  )

  return (
    <Section title="Notes" count={notes.length > 0 ? `(${notes.length})` : undefined} headerRight={headerRight}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: notes.length > 0 ? 16 : 0 }}>
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
                background: active ? "rgba(254,176,106,0.1)" : T.GLASS,
                color: active ? T.INK_EMPHASIS : T.DIM,
                fontFamily: "inherit",
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {rowError && (
        <div style={{ marginBottom: 12, padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: T.ERROR, fontWeight: 700 }}>{rowError}</span>
        </div>
      )}

      {filteredNotes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
          {filter ? `No ${(NOTE_TYPE_LABEL[filter as NoteType] ?? "note").toLowerCase()} notes` : "No notes yet"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredNotes.map((n) => {
            const isEditing = editingId === n.id
            const isActionItem = n.type === "action_item"
            // An old action item reads as done when its task is done, cancelled or deleted.
            const isCompleted = isActionItem && (n.task ? n.task.deleted || n.task.status !== "open" : !!n.completed_at)
            const typeBadge = NOTE_TYPE_BADGE[n.type]
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
                  background: T.GLASS,
                  border: `1px solid ${T.BORDER_SOFT}`,
                  borderRadius: 10,
                  opacity: isCompleted ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
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
                  <NoteTopicChip topic={n.topic} />
                  {isActionItem && <LegacyTaskLine task={n.task} />}
                  {createdLabel && (
                    <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>
                      {createdLabel}
                      {wasEdited ? " · edited" : ""}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <div style={{ opacity: savingEdit ? 0.5 : 1, pointerEvents: savingEdit ? "none" : "auto", transition: "opacity 120ms ease" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                      <NoteTypeChips compact value={editType} onChange={setEditType} />
                      <NoteTopicSelect id={`converted-edit-topic-${n.id}`} value={editTopic} onChange={setEditTopic} />
                    </div>
                    <textarea
                      style={{ ...textarea, minHeight: 100, fontSize: 13 }}
                      value={editBody}
                      onChange={(e) => { setEditBody(e.target.value); if (editError) setEditError(null) }}
                    />
                    {editError && (
                      <div style={{ padding: 8, marginTop: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
                        <span style={{ fontSize: 12, color: T.ERROR, fontWeight: 700 }}>{editError}</span>
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

  // The record's two buttons, shared with the prospect page.
  const [tasksKey, setTasksKey] = useState(0)
  const actions = useRecordNoteTaskActions({
    coachClientId: id,
    name: record?.name || record?.invited_email || "This client",
    recordLabel: "Client",
    onNoteSaved: () => { load({ silent: true }) },
    onTaskSaved: () => setTasksKey((k) => k + 1),
  })

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
          color: T.INK_EMPHASIS,
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
              color: T.INK_EMPHASIS,
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {actions.element}
          </div>
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
                  <p style={{ fontSize: 12, color: T.INK_EMPHASIS, margin: 0 }}>
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
                    color: "var(--sig-ink-on-bright, #04060F)",
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
                    color: "var(--sig-ink-on-bright, #04060F)",
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
                    background: T.GLASS,
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
                    <span style={{ fontSize: 12, color: T.ERROR, fontWeight: 700 }}>{setupError}</span>
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
                    <span style={{ fontSize: 12, color: T.ERROR, fontWeight: 700 }}>{inviteError}</span>
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
                    background: sourceStyle(record.source_category).bg,
                    color: sourceStyle(record.source_category).color,
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

      {/* Tasks on this client. assignee="all", as on the prospect and client
          pages: what is outstanding for this person, not what is on my plate. */}
      <Section title="Tasks">
        <TaskList
          key={tasksKey}
          showStatusFilter
          assignee="all"
          coachClient={record.id}
          newTaskCoachClient={{ id: record.id, name: displayName, label: "Client" }}
          editable
          onChanged={() => load({ silent: true })}
        />
      </Section>

      {/* Notes section — same type system as the prospect detail page */}
      <ClientNotesSection
        coachClientId={record.id}
        notes={record.notes}
        onChanged={() => load({ silent: true })}
        onAddNote={actions.openNote}
      />
    </div>
  )
}
