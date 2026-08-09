"use client"

// ClientJobNotes — the two-way notes on one job, shown on the application
// detail page. Uses ONLY the client notes API:
//   GET  /api/notes/applications/[applicationId]  (own private+shared + coach SHARED)
//   POST /api/notes/applications/[applicationId]  ({ artifact_type, body, visibility })
// The server owns access (ownership gate) and already excludes coach PRIVATE
// notes; this component adds no access logic and touches no other system.
//
// DISTINCT from the read-only coach_annotations panel above it on the detail
// page. That one is the coach talking AT the job; this is a conversation.
//
// Redesign (2026-08-04): light theme, and the wording moved out of system
// register. "Artifact type" became "the job" and "your cover letter";
// PRIVATE/SHARED became "Only you" and "Shared with your coach", which is what
// the visibility flag actually means to the person choosing it. Capability is
// unchanged: both groups, both visibilities, and the share confirmation all
// still here, because sharing is irreversible and deserves the extra tap.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../lib/theme/surfaces"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { areaControl } from "./controls"

type ArtifactType = "jobfit" | "coverletter"
type Note = {
  id: string
  artifact_type: ArtifactType
  body: string
  visibility: "private" | "shared"
  author_role: string
  parent_note_id: string | null
  created_at: string
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } })
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function Choice({ active, label, disabled, onClick }: {
  active: boolean; label: string; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        fontSize: 13, fontWeight: 700, padding: "7px 14px", borderRadius: 999,
        cursor: disabled ? "default" : "pointer", fontFamily: "inherit",
        border: `1px solid ${active ? S.text.primary : S.border}`,
        background: active ? S.text.primary : S.card,
        color: active ? "#FFFFFF" : S.text.muted,
      }}
    >
      {label}
    </button>
  )
}

/** A coach's note is a different voice, so it gets the teal rail and says so. */
function NoteRow({ note }: { note: Note }) {
  const isCoach = note.author_role === "coach"
  const shared = note.visibility === "shared"
  return (
    <div
      style={{
        borderLeft: `3px solid ${isCoach ? S.meaning.replied.accent : shared ? S.meaning.progress.accent : S.border}`,
        background: isCoach ? S.meaning.replied.fill : "transparent",
        borderRadius: "0 8px 8px 0",
        padding: isCoach ? "10px 14px" : "6px 0 6px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 12, fontWeight: 800,
            color: isCoach ? S.meaning.replied.ink : S.text.muted,
          }}
        >
          {isCoach ? "From your coach" : "You"}
        </span>
        {!isCoach && (
          <span style={{ fontSize: 12, color: shared ? S.meaning.progress.ink : S.text.dim }}>
            {shared ? "shared" : "only you"}
          </span>
        )}
        <span style={{ fontSize: 12.5, color: S.text.dim, marginLeft: "auto" }}>{fmtDate(note.created_at)}</span>
      </div>
      <div style={{ fontSize: 14, color: S.text.secondary, lineHeight: "21px", whiteSpace: "pre-wrap" }}>
        {note.body}
      </div>
    </div>
  )
}

function ArtifactNotes({ artifactType, title, placeholder, notes, onSave, onDirtyChange }: {
  artifactType: ArtifactType
  title: string
  placeholder: string
  notes: Note[]
  onSave: (a: ArtifactType, body: string, v: "private" | "shared") => Promise<{ ok: boolean; error?: string }>
  /**
   * Reported upward so the drawer around this composer can refuse to collapse
   * while there is unsaved text. Nothing here auto-saves, and it must not: this
   * creates a NEW note each time, so committing on blur would fill the log with
   * half-written fragments. The text has to survive instead.
   */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [text, setText] = useState("")
  const [visibility, setVisibility] = useState<"private" | "shared">("private")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doSave() {
    const body = text.trim()
    if (!body) { setError("Write something first."); return }
    setSaving(true); setError(null)
    const res = await onSave(artifactType, body, visibility)
    setSaving(false)
    if (!res.ok) { setError(res.error || "That didn't save. Try again."); return }
    setText(""); setVisibility("private"); setConfirming(false)
    onDirtyChange?.(false)
  }

  function onSaveClick() {
    const body = text.trim()
    if (!body) { setError("Write something first."); return }
    setError(null)
    // Sharing sends this note to a real person and cannot be taken back.
    if (visibility === "shared") { setConfirming(true); return }
    void doSave()
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: 12, fontWeight: 800, letterSpacing: 1.2,
          textTransform: "uppercase", color: S.text.muted, marginBottom: 10,
        }}
      >
        {title}
      </div>

      {notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {notes.map((n) => <NoteRow key={n.id} note={n} />)}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onDirtyChange?.(!!e.target.value.trim())
        }}
        placeholder={placeholder}
        disabled={saving}
        aria-label={title}
        style={{ ...areaControl, minHeight: 64 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <Choice active={visibility === "private"} label="Only you" disabled={saving || confirming} onClick={() => setVisibility("private")} />
        <Choice active={visibility === "shared"} label="Share with your coach" disabled={saving || confirming} onClick={() => setVisibility("shared")} />
        <button
          type="button"
          onClick={onSaveClick}
          disabled={saving || confirming}
          style={{
            ...actionStyle(S, "primary"), marginLeft: "auto",
            borderRadius: 10, padding: "9px 18px", fontSize: 13.5, fontFamily: "inherit",
            opacity: saving || confirming ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>

      {confirming && (
        <div
          style={{
            marginTop: 12, padding: "12px 16px", borderRadius: 12,
            background: S.meaning.replied.fill,
          }}
        >
          <div style={{ fontSize: 14, color: S.meaning.replied.ink, fontWeight: 700 }}>
            Send this to your coach? You can&apos;t unshare it later.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              type="button" onClick={() => void doSave()} disabled={saving}
              style={{ ...actionStyle(S, "primary"), borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontFamily: "inherit" }}
            >
              {saving ? "Sharing…" : "Yes, share it"}
            </button>
            <button
              type="button" onClick={() => setConfirming(false)} disabled={saving}
              style={{
                background: "none", border: "none", color: S.action.quietInk,
                fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Keep it to myself
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: S.meaning.error.ink, marginTop: 8 }}>{error}</div>}
    </div>
  )
}

export function ClientJobNotes({ applicationId, jobfitRunId, onDirtyChange }: {
  applicationId: string
  jobfitRunId: string | null
  /** True while EITHER composer holds unsaved text — the drawer above uses this
   *  to refuse to collapse and destroy it. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  /**
   * Per-composer, then OR'd — one shared boolean would let whichever box was
   * edited last clear the other's flag and hand the drawer permission to
   * destroy it. The value itself is never rendered, only folded in the updater
   * below, so the binding is dropped.
   */
  const [, setDirty] = useState({ jobfit: false, coverletter: false })

  /**
   * Reported from the EVENT, not from render. Updating a parent's state while
   * this component is rendering is the "cannot update a component while
   * rendering a different component" bug, and it would fire on every keystroke.
   * Both writes happen in the same handler, so the drawer above knows before
   * any click on its toggle can be processed.
   */
  function markDirty(key: "jobfit" | "coverletter", value: boolean) {
    setDirty((prev) => {
      const next = { ...prev, [key]: value }
      onDirtyChange?.(next.jobfit || next.coverletter)
      return next
    })
  }
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const res = await authFetch(`/api/notes/applications/${applicationId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setLoadError(j?.error || `We couldn't load your notes (${res.status})`); return }
      setNotes(Array.isArray(j.notes) ? j.notes : [])
    } catch {
      setLoadError("Something went wrong loading your notes.")
    } finally {
      setLoading(false)
    }
  }, [applicationId])

  const saveNote = useCallback(
    async (artifactType: ArtifactType, body: string, visibility: "private" | "shared") => {
      try {
        const res = await authFetch(`/api/notes/applications/${applicationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifact_type: artifactType, body, visibility }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) return { ok: false, error: j?.error || `That didn't save (${res.status})` }
        await load()
        return { ok: true }
      } catch {
        return { ok: false, error: "Something went wrong. Try again." }
      }
    },
    [applicationId, load],
  )

  useEffect(() => {
    if (jobfitRunId) void load()
  }, [jobfitRunId, load])

  // Notes hang off the job's scoring run; a job typed in by hand has none yet.
  if (!jobfitRunId) {
    return (
      <p style={{ fontSize: 14, color: S.text.muted, margin: 0 }}>
        Notes open up once this job has been scored by SIGNAL.
      </p>
    )
  }

  if (loading && notes.length === 0) {
    return <p style={{ fontSize: 14, color: S.text.muted, margin: 0 }}>Loading your notes…</p>
  }

  if (loadError) {
    return (
      <div>
        <div style={{ fontSize: 14, color: S.meaning.error.ink }}>{loadError}</div>
        <button
          onClick={() => void load()}
          style={{
            background: "none", border: "none", padding: "8px 0 0", color: S.action.quietInk,
            fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <>
      <p style={{ fontSize: 14, color: S.text.muted, margin: 0, lineHeight: "21px" }}>
        Notes on this job. Anything you write stays with you until you choose to share it.
      </p>
      <ArtifactNotes
        onDirtyChange={(d) => markDirty("jobfit", d)}
        artifactType="jobfit"
        title="This job"
        placeholder="What you're thinking about this one"
        notes={notes.filter((n) => n.artifact_type === "jobfit")}
        onSave={saveNote}
      />
      <ArtifactNotes
        onDirtyChange={(d) => markDirty("coverletter", d)}
        artifactType="coverletter"
        title="Your cover letter"
        placeholder="What you want to say, or what you'd change"
        notes={notes.filter((n) => n.artifact_type === "coverletter")}
        onSave={saveNote}
      />
    </>
  )
}
