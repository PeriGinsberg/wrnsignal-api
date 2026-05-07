"use client"

// Profile & Personas tab on the coach's client view.
// Wires the existing tab UI to the coach API endpoints added 2026-05-07:
//   PATCH /api/coach/clients/[clientId]/profile         — autosave-on-blur for the editable profile fields
//   GET   /api/coach/clients/[clientId]/personas        — list (active + archived)
//   POST  /api/coach/clients/[clientId]/personas        — add new persona
//   PATCH /api/coach/clients/[clientId]/personas/[id]   — rename / set primary / archive / restore / edit resume
//
// Save semantics:
//   • Profile text fields & dropdowns: autosave on blur (text) or change (select)
//   • Persona name: autosave on blur (small field)
//   • Persona resume body: explicit Save button (large blob, autosave is risky)

import React, { useEffect, useMemo, useRef, useState } from "react"
import { T, input, textarea, btnPrimary, btnSecondary, card, eyebrow, label } from "../../../../../lib/dashboard-theme"

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type ClientProfileFull = {
  id: string
  name: string | null
  email: string | null
  job_type: string | null
  target_roles: string | null
  target_locations: string | null
  timeline: string | null
  coach_notes_avoid: string | null
  coach_notes_strengths: string | null
  coach_notes_concerns: string | null
  profile_complete: boolean
}

export type ClientPersonaFull = {
  id: string
  profile_id: string
  name: string
  resume_text: string
  is_default: boolean
  display_order: number
  persona_version: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

type SaveState = "idle" | "saving" | "saved" | "error"

const JOB_TYPE_OPTIONS = ["Full-time", "Part-time", "Internship", "Contract", "Any"] as const
const TIMEFRAME_OPTIONS = [
  "Actively looking",
  "Within 1 month",
  "1-3 months",
  "3-6 months",
  "6-12 months",
  "Exploring options",
] as const

type EditableField =
  | "job_type"
  | "target_roles"
  | "target_locations"
  | "timeline"
  | "coach_notes_avoid"
  | "coach_notes_strengths"
  | "coach_notes_concerns"

type Props = {
  clientId: string
  initialProfile: ClientProfileFull
  initialPersonas: ClientPersonaFull[]
  getToken: () => Promise<string | null>
  /** Refetch parent state (other tabs depend on personas list) */
  onChange: () => void | Promise<void>
}

// ──────────────────────────────────────────────────────────────
// Tiny UI primitives
// ──────────────────────────────────────────────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null
  const text = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Error — retry"
  const color = state === "error" ? T.ERROR : state === "saved" ? "#4ade80" : T.DIM
  return <span style={{ fontSize: 11, color, marginLeft: 8 }}>{text}</span>
}

function FieldRow({ labelText, state, children }: { labelText: string; state: SaveState; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
        <span style={{ ...label, color: T.WRN_BLUE }}>{labelText.toUpperCase()}</span>
        <SaveIndicator state={state} />
      </div>
      {children}
    </div>
  )
}

function ReadOnlyRow({ labelText, value }: { labelText: string; value: string | null }) {
  return (
    <div>
      <div style={{ ...eyebrow, fontSize: 9, color: T.DIM, marginBottom: 3 }}>{labelText.toUpperCase()}</div>
      <div style={{ fontSize: 13, color: value ? T.TEXT : T.DIM }}>{value || "—"}</div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────

export default function ProfilePersonasTab({
  clientId,
  initialProfile,
  initialPersonas,
  getToken,
  onChange,
}: Props) {
  // Server-confirmed state, mirrored locally so saves are reflected immediately
  const [profile, setProfile] = useState<ClientProfileFull>(initialProfile)
  const [personas, setPersonas] = useState<ClientPersonaFull[]>(initialPersonas)

  // Sync local state when parent reloads
  useEffect(() => { setProfile(initialProfile) }, [initialProfile])
  useEffect(() => { setPersonas(initialPersonas) }, [initialPersonas])

  // ── Per-field draft + saveState ──
  const initDrafts = (p: ClientProfileFull): Record<EditableField, string> => ({
    job_type: p.job_type ?? "",
    target_roles: p.target_roles ?? "",
    target_locations: p.target_locations ?? "",
    timeline: p.timeline ?? "",
    coach_notes_avoid: p.coach_notes_avoid ?? "",
    coach_notes_strengths: p.coach_notes_strengths ?? "",
    coach_notes_concerns: p.coach_notes_concerns ?? "",
  })
  const [drafts, setDrafts] = useState<Record<EditableField, string>>(() => initDrafts(initialProfile))
  useEffect(() => { setDrafts(initDrafts(initialProfile)) }, [initialProfile])

  const initSaveStates = (): Record<EditableField, SaveState> => ({
    job_type: "idle", target_roles: "idle", target_locations: "idle", timeline: "idle",
    coach_notes_avoid: "idle", coach_notes_strengths: "idle", coach_notes_concerns: "idle",
  })
  const [saveStates, setSaveStates] = useState<Record<EditableField, SaveState>>(initSaveStates)

  // Track timers to fade "Saved" back to idle after 2s
  const savedTimers = useRef<Partial<Record<EditableField, ReturnType<typeof setTimeout>>>>({})
  useEffect(() => () => {
    for (const t of Object.values(savedTimers.current)) if (t) clearTimeout(t)
  }, [])

  function setSaveState(field: EditableField, s: SaveState) {
    setSaveStates((prev) => ({ ...prev, [field]: s }))
    if (s === "saved") {
      const existing = savedTimers.current[field]
      if (existing) clearTimeout(existing)
      savedTimers.current[field] = setTimeout(() => {
        setSaveStates((prev) => ({ ...prev, [field]: "idle" }))
      }, 2000)
    }
  }

  async function saveField(field: EditableField, rawValue: string) {
    const value = rawValue
    const original = (profile[field] ?? "")
    if (value === original) return  // no-op

    setSaveState(field, "saving")
    try {
      const token = await getToken()
      if (!token) throw new Error("No auth token")
      const res = await fetch(`/api/coach/clients/${clientId}/profile`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || `Save failed (${res.status})`)
      }
      const j = await res.json()
      setProfile(j.profile)
      setSaveState(field, "saved")
    } catch (e) {
      console.warn("[ProfilePersonasTab] saveField error:", (e as Error).message)
      setSaveState(field, "error")
    }
  }

  // ── Personas ──
  // Sort: active default first, then other active by created_at desc, then archived (newest first)
  const sortedPersonas = useMemo(() => {
    const active = personas.filter((p) => !p.archived_at)
    const archived = personas.filter((p) => !!p.archived_at)
    active.sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1
      return (b.created_at || "").localeCompare(a.created_at || "")
    })
    archived.sort((a, b) => (b.archived_at || "").localeCompare(a.archived_at || ""))
    return { active, archived }
  }, [personas])

  const [showArchived, setShowArchived] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editingResumeId, setEditingResumeId] = useState<string | null>(null)
  // per-persona action state for transient indicators
  const [personaSaveStates, setPersonaSaveStates] = useState<Record<string, SaveState>>({})

  function setPersonaSaveState(id: string, s: SaveState) {
    setPersonaSaveStates((prev) => ({ ...prev, [id]: s }))
    if (s === "saved") {
      setTimeout(() => {
        setPersonaSaveStates((prev) => ({ ...prev, [id]: "idle" }))
      }, 2000)
    }
  }

  async function refreshPersonas() {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/coach/clients/${clientId}/personas`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const j = await res.json()
        setPersonas(j.personas || [])
      }
    } catch {}
    // Tell parent so its clientPersonas (used by other tabs) updates too
    try { await onChange() } catch {}
  }

  async function patchPersona(id: string, body: Record<string, any>): Promise<boolean> {
    setPersonaSaveState(id, "saving")
    try {
      const token = await getToken()
      if (!token) throw new Error("No auth token")
      const res = await fetch(`/api/coach/clients/${clientId}/personas/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || `Save failed (${res.status})`)
      }
      await refreshPersonas()
      setPersonaSaveState(id, "saved")
      return true
    } catch (e) {
      console.warn("[ProfilePersonasTab] patchPersona error:", (e as Error).message)
      setPersonaSaveState(id, "error")
      return false
    }
  }

  // ── Add-persona form state ──
  const [newName, setNewName] = useState("")
  const [newResume, setNewResume] = useState("")
  const [resumeTab, setResumeTab] = useState<"paste" | "upload">("paste")
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  async function uploadPdf(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setUploadMsg("File too large (max 5MB)")
      return
    }
    setUploading(true)
    setUploadMsg(null)
    try {
      const token = await getToken()
      if (!token) { setUploadMsg("Not authenticated"); return }
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/resume-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (res.ok && data.text) {
        setNewResume(data.text)
        setUploadMsg("Resume extracted")
      } else {
        setUploadMsg(data.error || "Extraction failed")
      }
    } catch {
      setUploadMsg("Upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function createPersona() {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const token = await getToken()
      if (!token) throw new Error("No auth token")
      const res = await fetch(`/api/coach/clients/${clientId}/personas`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), resume_text: newResume }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || `Create failed (${res.status})`)
      }
      // Reset form and close
      setNewName("")
      setNewResume("")
      setUploadMsg(null)
      setResumeTab("paste")
      setAddOpen(false)
      await refreshPersonas()
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // ── Resume edit (inline below persona) ──
  const [resumeDraft, setResumeDraft] = useState("")
  const [resumeSaving, setResumeSaving] = useState(false)
  const [resumeMsg, setResumeMsg] = useState<string | null>(null)

  function openResumeEdit(p: ClientPersonaFull) {
    setEditingResumeId(p.id)
    setResumeDraft(p.resume_text || "")
    setResumeMsg(null)
  }
  function cancelResumeEdit() {
    setEditingResumeId(null)
    setResumeDraft("")
    setResumeMsg(null)
  }
  async function saveResume(p: ClientPersonaFull) {
    if (resumeDraft === (p.resume_text || "")) {
      setResumeMsg("No changes")
      return
    }
    setResumeSaving(true)
    const ok = await patchPersona(p.id, { resume_text: resumeDraft })
    setResumeSaving(false)
    if (ok) {
      setResumeMsg("Saved")
      setTimeout(() => cancelResumeEdit(), 800)
    }
  }

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>CLIENT PROFILE & PERSONAS</div>

      {/* ── PROFILE ── */}
      <div style={{ ...card, padding: 24, marginBottom: 28 }}>
        <div style={{ height: 3, background: "linear-gradient(90deg,#51ADE5,#218C8C,#FEB06A)", margin: "-24px -24px 20px", borderRadius: "18px 18px 0 0" }} />

        {/* Read-only header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <ReadOnlyRow labelText="Name" value={profile.name} />
          <ReadOnlyRow labelText="Email" value={profile.email} />
        </div>

        {/* Editable fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <FieldRow labelText="Job Type" state={saveStates.job_type}>
            <select
              style={{ ...input, height: 38, colorScheme: "dark", cursor: "pointer" } as React.CSSProperties}
              value={drafts.job_type}
              onChange={(e) => {
                const v = e.target.value
                setDrafts((d) => ({ ...d, job_type: v }))
                saveField("job_type", v)  // selects commit immediately
              }}
            >
              <option value="" style={{ background: "#0a1628" }}>—</option>
              {JOB_TYPE_OPTIONS.map((v) => (
                <option key={v} value={v} style={{ background: "#0a1628" }}>{v}</option>
              ))}
            </select>
          </FieldRow>

          <FieldRow labelText="Timeline" state={saveStates.timeline}>
            <select
              style={{ ...input, height: 38, colorScheme: "dark", cursor: "pointer" } as React.CSSProperties}
              value={drafts.timeline}
              onChange={(e) => {
                const v = e.target.value
                setDrafts((d) => ({ ...d, timeline: v }))
                saveField("timeline", v)
              }}
            >
              <option value="" style={{ background: "#0a1628" }}>—</option>
              {TIMEFRAME_OPTIONS.map((v) => (
                <option key={v} value={v} style={{ background: "#0a1628" }}>{v}</option>
              ))}
            </select>
          </FieldRow>

          <FieldRow labelText="Target Roles" state={saveStates.target_roles}>
            <input
              type="text"
              style={input}
              value={drafts.target_roles}
              onChange={(e) => setDrafts((d) => ({ ...d, target_roles: e.target.value }))}
              onBlur={(e) => saveField("target_roles", e.target.value)}
            />
          </FieldRow>

          <FieldRow labelText="Target Locations" state={saveStates.target_locations}>
            <input
              type="text"
              style={input}
              value={drafts.target_locations}
              onChange={(e) => setDrafts((d) => ({ ...d, target_locations: e.target.value }))}
              onBlur={(e) => saveField("target_locations", e.target.value)}
            />
          </FieldRow>
        </div>

        {/* Coaching notes (full width each) */}
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 18 }}>
          <FieldRow labelText="Coaching note — roles / locations / companies to avoid" state={saveStates.coach_notes_avoid}>
            <textarea
              style={{ ...textarea, minHeight: 70 }}
              placeholder="What should this client steer clear of?"
              value={drafts.coach_notes_avoid}
              onChange={(e) => setDrafts((d) => ({ ...d, coach_notes_avoid: e.target.value }))}
              onBlur={(e) => saveField("coach_notes_avoid", e.target.value)}
            />
          </FieldRow>

          <FieldRow labelText="Coaching note — what does this client do well?" state={saveStates.coach_notes_strengths}>
            <textarea
              style={{ ...textarea, minHeight: 70 }}
              placeholder="Client strengths to lead with"
              value={drafts.coach_notes_strengths}
              onChange={(e) => setDrafts((d) => ({ ...d, coach_notes_strengths: e.target.value }))}
              onBlur={(e) => saveField("coach_notes_strengths", e.target.value)}
            />
          </FieldRow>

          <FieldRow labelText="Coaching note — gaps or challenges to address" state={saveStates.coach_notes_concerns}>
            <textarea
              style={{ ...textarea, minHeight: 70 }}
              placeholder="What needs work?"
              value={drafts.coach_notes_concerns}
              onChange={(e) => setDrafts((d) => ({ ...d, coach_notes_concerns: e.target.value }))}
              onBlur={(e) => saveField("coach_notes_concerns", e.target.value)}
            />
          </FieldRow>
        </div>
      </div>

      {/* ── PERSONAS ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ ...eyebrow, color: T.WRN_BLUE }}>
          PERSONAS{" "}
          <span style={{ color: T.DIM, fontWeight: 700 }}>
            ({sortedPersonas.active.length} active{sortedPersonas.archived.length > 0 ? `, ${sortedPersonas.archived.length} archived` : ""})
          </span>
        </div>
        {!addOpen && (
          <button
            onClick={() => { setAddOpen(true); setCreateError(null) }}
            style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px", borderRadius: 10, color: T.WRN_ORANGE, borderColor: "rgba(254,176,106,0.3)" }}
          >
            + Add Persona
          </button>
        )}
      </div>

      {/* Add persona form */}
      {addOpen && (
        <div style={{ ...card, padding: 24, marginBottom: 16 }}>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 14 }}>NEW PERSONA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <FieldRow labelText="Persona Name" state="idle">
              <input
                type="text"
                style={input}
                placeholder="e.g. Sales-flavored, Marketing-flavored"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </FieldRow>

            <div>
              <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>RESUME</span>
              <div style={{
                display: "inline-flex", border: `1px solid ${T.BORDER_SOFT}`,
                borderRadius: 8, overflow: "hidden", marginBottom: 12,
              }}>
                {(["paste", "upload"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setResumeTab(t)}
                    style={{
                      padding: "7px 16px", fontSize: 12, border: "none", cursor: "pointer",
                      background: resumeTab === t ? "rgba(254,176,106,0.10)" : "rgba(255,255,255,0.03)",
                      color: resumeTab === t ? T.WRN_ORANGE : T.MUTED,
                      fontWeight: 900, letterSpacing: 0.5,
                    }}
                  >
                    {t === "paste" ? "Paste Text" : "Upload PDF"}
                  </button>
                ))}
              </div>

              {resumeTab === "paste" && (
                <textarea
                  style={{ ...textarea, minHeight: 180 }}
                  placeholder="Paste the resume text here..."
                  value={newResume}
                  onChange={(e) => setNewResume(e.target.value)}
                />
              )}

              {resumeTab === "upload" && (
                <div>
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadPdf(f)
                    }}
                    style={{ fontSize: 12, color: T.MUTED }}
                  />
                  {uploading && <p style={{ fontSize: 11, color: T.DIM, marginTop: 6 }}>Extracting...</p>}
                  {uploadMsg && <p style={{ fontSize: 11, color: uploadMsg === "Resume extracted" ? "#4ade80" : T.ERROR, marginTop: 6 }}>{uploadMsg}</p>}
                  {newResume && (
                    <p style={{ fontSize: 11, color: T.DIM, marginTop: 6 }}>{newResume.length.toLocaleString()} characters extracted</p>
                  )}
                </div>
              )}
            </div>

            {createError && (
              <p style={{ fontSize: 12, color: T.ERROR }}>{createError}</p>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={createPersona}
                disabled={creating || !newName.trim()}
                style={{ ...btnPrimary, fontSize: 12, padding: "8px 18px", opacity: creating || !newName.trim() ? 0.5 : 1 }}
              >
                {creating ? "Creating…" : "Create Persona"}
              </button>
              <button
                onClick={() => {
                  setAddOpen(false)
                  setNewName("")
                  setNewResume("")
                  setUploadMsg(null)
                  setCreateError(null)
                  setResumeTab("paste")
                }}
                style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active personas */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sortedPersonas.active.length === 0 && !addOpen && (
          <p style={{ color: T.MUTED, fontSize: 13 }}>No personas yet. Click + Add Persona to create one.</p>
        )}
        {sortedPersonas.active.map((p) => (
          <PersonaCard
            key={p.id}
            p={p}
            saveState={personaSaveStates[p.id] ?? "idle"}
            isEditingResume={editingResumeId === p.id}
            resumeDraft={resumeDraft}
            resumeSaving={resumeSaving}
            resumeMsg={resumeMsg}
            onRename={(name) => patchPersona(p.id, { name })}
            onSetPrimary={() => patchPersona(p.id, { is_default: true })}
            onArchive={() => patchPersona(p.id, { archive: true })}
            onOpenResumeEdit={() => openResumeEdit(p)}
            onResumeDraftChange={setResumeDraft}
            onResumeSave={() => saveResume(p)}
            onResumeCancel={cancelResumeEdit}
          />
        ))}
      </div>

      {/* Archived */}
      {sortedPersonas.archived.length > 0 && (
        <div style={{ marginTop: 24 }}>
          {sortedPersonas.archived.length >= 3 ? (
            <button
              onClick={() => setShowArchived((s) => !s)}
              style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 900, cursor: "pointer", padding: 0, marginBottom: 10 }}
            >
              {showArchived ? "▼" : "▶"} Show archived ({sortedPersonas.archived.length})
            </button>
          ) : (
            <div style={{ ...eyebrow, color: T.DIM, marginBottom: 10 }}>ARCHIVED</div>
          )}

          {(sortedPersonas.archived.length < 3 || showArchived) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: 0.55 }}>
              {sortedPersonas.archived.map((p) => (
                <ArchivedPersonaCard
                  key={p.id}
                  p={p}
                  saveState={personaSaveStates[p.id] ?? "idle"}
                  onRestore={() => patchPersona(p.id, { restore: true })}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Active persona card
// ──────────────────────────────────────────────────────────────

function PersonaCard(props: {
  p: ClientPersonaFull
  saveState: SaveState
  isEditingResume: boolean
  resumeDraft: string
  resumeSaving: boolean
  resumeMsg: string | null
  onRename: (name: string) => Promise<boolean>
  onSetPrimary: () => Promise<boolean>
  onArchive: () => Promise<boolean>
  onOpenResumeEdit: () => void
  onResumeDraftChange: (s: string) => void
  onResumeSave: () => Promise<void>
  onResumeCancel: () => void
}) {
  const { p, saveState, isEditingResume, resumeDraft, resumeSaving, resumeMsg } = props
  const [draftName, setDraftName] = useState(p.name)
  useEffect(() => setDraftName(p.name), [p.name])

  return (
    <div style={{ ...card, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          type="text"
          style={{ ...input, height: 32, fontSize: 14, fontWeight: 900, padding: "4px 10px", flex: "0 1 320px" } as React.CSSProperties}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => {
            const trimmed = draftName.trim()
            if (trimmed && trimmed !== p.name) props.onRename(trimmed)
            else if (!trimmed) setDraftName(p.name)
          }}
        />
        {p.is_default && (
          <span style={{
            fontSize: 9, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase",
            color: T.WRN_ORANGE, background: "rgba(254,176,106,0.12)", padding: "3px 8px", borderRadius: 6,
          }}>
            Primary
          </span>
        )}
        <SaveIndicator state={saveState} />
        <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>v{p.persona_version}</span>
      </div>

      <p style={{ fontSize: 12, color: T.MUTED, marginTop: 10, lineHeight: "18px", whiteSpace: "pre-wrap" }}>
        {p.resume_text
          ? (p.resume_text.length > 200 ? p.resume_text.slice(0, 200) + "…" : p.resume_text)
          : <span style={{ color: T.DIM, fontStyle: "italic" }}>No resume text yet</span>}
      </p>

      {!isEditingResume && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button
            onClick={props.onOpenResumeEdit}
            style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px", borderRadius: 8, color: T.WRN_BLUE, borderColor: "rgba(81,173,229,0.3)" }}
          >
            Edit Resume
          </button>
          {!p.is_default && (
            <button
              onClick={() => props.onSetPrimary()}
              style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px", borderRadius: 8 }}
            >
              Set as Primary
            </button>
          )}
          <button
            onClick={() => props.onArchive()}
            style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px", borderRadius: 8, color: T.DIM }}
          >
            Archive
          </button>
        </div>
      )}

      {isEditingResume && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
            <span style={{ ...label, color: T.WRN_BLUE }}>RESUME BODY</span>
            {resumeMsg && (
              <span style={{ fontSize: 11, color: resumeMsg === "Saved" ? "#4ade80" : T.DIM, marginLeft: 8 }}>
                {resumeMsg}
              </span>
            )}
          </div>
          <textarea
            style={{ ...textarea, minHeight: 240 }}
            value={resumeDraft}
            onChange={(e) => props.onResumeDraftChange(e.target.value)}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              onClick={props.onResumeSave}
              disabled={resumeSaving}
              style={{ ...btnPrimary, fontSize: 12, padding: "8px 18px", opacity: resumeSaving ? 0.5 : 1 }}
            >
              {resumeSaving ? "Saving…" : "Save Resume"}
            </button>
            <button
              onClick={props.onResumeCancel}
              style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Archived persona card
// ──────────────────────────────────────────────────────────────

function ArchivedPersonaCard({
  p, saveState, onRestore,
}: {
  p: ClientPersonaFull
  saveState: SaveState
  onRestore: () => Promise<boolean>
}) {
  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: T.MUTED }}>{p.name}</span>
        <span style={{
          fontSize: 9, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase",
          color: T.DIM, background: "rgba(255,255,255,0.04)", padding: "3px 8px", borderRadius: 6,
        }}>
          Archived
        </span>
        <SaveIndicator state={saveState} />
        <button
          onClick={() => onRestore()}
          style={{ ...btnSecondary, fontSize: 11, padding: "5px 10px", borderRadius: 8, marginLeft: "auto", color: T.WRN_BLUE, borderColor: "rgba(81,173,229,0.3)" }}
        >
          Restore
        </button>
      </div>
      {p.resume_text && (
        <p style={{ fontSize: 11, color: T.DIM, marginTop: 8, fontStyle: "italic" }}>
          {p.resume_text.length > 120 ? p.resume_text.slice(0, 120) + "…" : p.resume_text}
        </p>
      )}
    </div>
  )
}
