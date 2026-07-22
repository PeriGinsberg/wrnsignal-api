"use client"

// ClientJobNotes — the client-side two-way notes section for one job, shown in
// the Job Tracker expanded row. Uses ONLY the new client notes API:
//   GET  /api/notes/applications/[applicationId]  (own private+shared + coach SHARED)
//   POST /api/notes/applications/[applicationId]  ({ artifact_type, body, visibility })
// The server owns access (ownership gate) and already excludes coach PRIVATE
// notes; this component adds no access logic and touches no other system.
//
// DISTINCT from the older "FROM YOUR COACH" (coach_annotations) panel in the
// tracker row: this section has its own blue-accented "JOB NOTES" heading +
// container so a client won't confuse the two while both coexist. Coach notes
// inside here still get the orange treatment (reused from the coach panel).
//
// Notes are grouped by artifact_type (Jobfit / Cover letter); each group has its
// own list + composer, mirroring the coach side.

import { useCallback, useEffect, useState } from "react"
import { T, textarea, btnPrimary, btnSecondary, eyebrow } from "../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"

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
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString()
}

const subLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 900, letterSpacing: 1.2,
  textTransform: "uppercase", color: T.MUTED, marginBottom: 6,
}

function VisibilityChip({ active, label, color, disabled, onClick }: {
  active: boolean; label: string; color: string; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 11, fontWeight: 800, padding: "4px 11px", borderRadius: 999,
        cursor: disabled ? "default" : "pointer",
        border: `1px solid ${active ? color : T.BORDER_SOFT}`,
        background: active ? `${color}22` : "transparent",
        color: active ? color : T.MUTED,
      }}
    >
      {label}
    </button>
  )
}

// One note. Coach notes get the orange treatment + "FROM YOUR COACH"; the
// client's own notes are neutral + "YOU" with a PRIVATE/SHARED pill.
function NoteRow({ note }: { note: Note }) {
  const isCoach = note.author_role === "coach"
  const shared = note.visibility === "shared"
  const accent = isCoach ? T.WRN_ORANGE : shared ? T.WRN_TEAL : T.DIM
  return (
    <div style={{
      borderLeft: `2px solid ${accent}`,
      background: isCoach ? "rgba(254,176,106,0.06)" : "transparent",
      borderRadius: isCoach ? "0 6px 6px 0" : 0,
      padding: isCoach ? "6px 10px" : "3px 0 3px 8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.5, color: isCoach ? T.WRN_ORANGE : T.MUTED }}>
          {isCoach ? "FROM YOUR COACH" : "YOU"}
        </span>
        {!isCoach && (
          <span style={{
            fontSize: 9, fontWeight: 900, letterSpacing: 0.5, padding: "1px 6px", borderRadius: 999,
            border: `1px solid ${T.BORDER_SOFT}`, color: shared ? T.WRN_TEAL : T.DIM,
          }}>
            {shared ? "SHARED" : "PRIVATE"}
          </span>
        )}
        <span style={{ fontSize: 10, color: T.DIM, marginLeft: "auto" }}>{fmtDate(note.created_at)}</span>
      </div>
      <div style={{ fontSize: 12, color: T.TEXT, lineHeight: "17px", whiteSpace: "pre-wrap" }}>{note.body}</div>
    </div>
  )
}

// One artifact grouping (Jobfit or Cover letter): its notes + a composer.
function ArtifactNotes({ artifactType, title, notes, onSave }: {
  artifactType: ArtifactType
  title: string
  notes: Note[]
  onSave: (artifactType: ArtifactType, body: string, visibility: "private" | "shared") => Promise<{ ok: boolean; error?: string }>
}) {
  const [text, setText] = useState("")
  const [visibility, setVisibility] = useState<"private" | "shared">("private")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doSave() {
    const body = text.trim()
    if (!body) { setError("Write a note first."); return }
    setSaving(true); setError(null)
    const res = await onSave(artifactType, body, visibility)
    setSaving(false)
    if (!res.ok) { setError(res.error || "Couldn't save the note."); return }
    setText(""); setVisibility("private"); setConfirming(false)
  }

  function onSaveClick() {
    const body = text.trim()
    if (!body) { setError("Write a note first."); return }
    setError(null)
    // Sharing sends this note to the coach — confirm first. Private saves now.
    if (visibility === "shared") { setConfirming(true); return }
    void doSave()
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={subLabel}>{title}</div>

      {notes.length === 0 ? (
        <div style={{ fontSize: 12, color: T.DIM, marginBottom: 10 }}>No notes yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {notes.map((n) => <NoteRow key={n.id} note={n} />)}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Add a note about the ${title.toLowerCase()}…`}
        disabled={saving}
        style={{ ...textarea, minHeight: 54, fontSize: 12 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <VisibilityChip active={visibility === "private"} label="Private" color={T.DIM} disabled={saving || confirming} onClick={() => setVisibility("private")} />
        <VisibilityChip active={visibility === "shared"} label="Shared" color={T.WRN_TEAL} disabled={saving || confirming} onClick={() => setVisibility("shared")} />
        <button
          type="button"
          onClick={onSaveClick}
          disabled={saving || confirming}
          style={{ ...btnPrimary, padding: "8px 16px", fontSize: 12, marginLeft: "auto", opacity: saving || confirming ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {confirming && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.WRN_TEAL}55`, background: `${T.WRN_TEAL}14` }}>
          <div style={{ fontSize: 12, color: T.TEXT }}>Share with your coach? This can&apos;t be undone.</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => void doSave()} disabled={saving} style={{ ...btnPrimary, padding: "7px 14px", fontSize: 12 }}>
              {saving ? "Sharing…" : "Share note"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={saving} style={{ ...btnSecondary, padding: "7px 14px", fontSize: 12 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: T.ERROR, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

export function ClientJobNotes({ applicationId, jobfitRunId }: {
  applicationId: string
  jobfitRunId: string | null
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const res = await authFetch(`/api/notes/applications/${applicationId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setLoadError(j?.error || `Couldn't load notes (${res.status})`); return }
      setNotes(Array.isArray(j.notes) ? j.notes : [])
    } catch {
      setLoadError("Network error — try again")
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
        if (!res.ok || !j?.ok) return { ok: false, error: j?.error || `Save failed (${res.status})` }
        await load()
        return { ok: true }
      } catch {
        return { ok: false, error: "Network error — try again" }
      }
    },
    [applicationId, load],
  )

  useEffect(() => {
    if (jobfitRunId) void load()
  }, [jobfitRunId, load])

  const shell = (children: React.ReactNode) => (
    <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: "rgba(81,173,229,0.04)" }}>
      <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 2 }}>JOB NOTES</div>
      <p style={{ fontSize: 11, color: T.DIM, margin: "0 0 4px" }}>
        Notes you and your coach share on this job. Private notes stay with you until you share them.
      </p>
      {children}
    </div>
  )

  // Notes hang off the job's jobfit run; a manual/unscored job has none.
  if (!jobfitRunId) {
    return shell(
      <div style={{ fontSize: 12, color: T.DIM, marginTop: 8 }}>
        Notes become available once this job has been scored by SIGNAL.
      </div>,
    )
  }

  if (loading && notes.length === 0) {
    return shell(<div style={{ fontSize: 12, color: T.MUTED, marginTop: 8 }}>Loading notes…</div>)
  }
  if (loadError) {
    return shell(
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: T.ERROR }}>{loadError}</div>
        <button style={{ ...btnSecondary, marginTop: 10, fontSize: 12, padding: "7px 14px" }} onClick={() => void load()}>Retry</button>
      </div>,
    )
  }

  return shell(
    <>
      <ArtifactNotes
        artifactType="jobfit"
        title="Jobfit"
        notes={notes.filter((n) => n.artifact_type === "jobfit")}
        onSave={saveNote}
      />
      <ArtifactNotes
        artifactType="coverletter"
        title="Cover letter"
        notes={notes.filter((n) => n.artifact_type === "coverletter")}
        onSave={saveNote}
      />
    </>,
  )
}
