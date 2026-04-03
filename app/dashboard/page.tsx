"use client"

import { useEffect, useState, useCallback } from "react"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
import {
  T,
  input,
  textarea,
  btnPrimary,
  btnSecondary,
  card,
  eyebrow,
  headline,
  label,
} from "../../lib/dashboard-theme"

type Profile = {
  id: string
  name: string | null
  email: string | null
  job_type: string | null
  target_roles: string | null
  target_locations: string | null
  preferred_locations: string | null
  timeline: string | null
  resume_text: string | null
  profile_version: number
  profile_structured: Record<string, any> | null
}

type Persona = {
  id: string
  name: string
  resume_text: string
  is_default: boolean
  display_order: number
  persona_version: number
}

const PROFILE_FIELDS: { key: keyof Profile; label: string; multi: boolean; required: boolean }[] = [
  { key: "name", label: "NAME", multi: false, required: true },
  { key: "job_type", label: "JOB TYPE", multi: false, required: true },
  { key: "target_roles", label: "TARGET ROLES", multi: false, required: true },
  { key: "target_locations", label: "TARGET LOCATIONS", multi: false, required: false },
  { key: "preferred_locations", label: "PREFERRED LOCATIONS", multi: false, required: false },
  { key: "timeline", label: "TIMELINE", multi: false, required: false },
]

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        padding: "12px 20px",
        borderRadius: 12,
        background: T.SUCCESS_BG,
        border: "1px solid rgba(74,222,128,0.25)",
        color: T.SUCCESS,
        fontSize: 13,
        fontWeight: 900,
        zIndex: 100,
      }}
    >
      {message}
    </div>
  )
}

function SummaryRow({ label: lbl, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>{lbl}</span>
      <p style={{ fontSize: 13, color: T.TEXT, marginTop: 2, lineHeight: "18px" }}>{value}</p>
    </div>
  )
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // UI state
  const [profileEditOpen, setProfileEditOpen] = useState(false)
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [personaEditId, setPersonaEditId] = useState<string | null>(null)
  const [editPersona, setEditPersona] = useState<Persona | null>(null)
  const [addPersonaOpen, setAddPersonaOpen] = useState(false)
  const [newPersonaName, setNewPersonaName] = useState("")
  const [newPersonaResume, setNewPersonaResume] = useState("")
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  async function getToken() {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    return session?.access_token ?? null
  }

  const loadAll = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    const [pRes, personasRes] = await Promise.all([
      fetch("/api/profile", { headers }),
      fetch("/api/personas", { headers }),
    ])
    if (pRes.ok) {
      const j = await pRes.json()
      setProfile(j.profile)
    } else {
      setError("Failed to load profile")
    }
    if (personasRes.ok) {
      const j = await personasRes.json()
      setPersonas(j.personas || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // --- Profile actions ---
  function openProfileEdit() {
    setEditProfile(profile ? { ...profile } : null)
    setProfileEditOpen(true)
  }

  async function saveProfile() {
    if (!editProfile) return
    setSaving(true)
    const token = await getToken()
    if (!token) { setSaving(false); return }
    const { id, email, profile_version, profile_structured, ...fields } = editProfile
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    })
    if (res.ok) {
      const j = await res.json()
      setProfile(j.profile)
      setProfileEditOpen(false)
      setToast("Profile updated")
    }
    setSaving(false)
  }

  // --- Persona actions ---
  function openPersonaEdit(p: Persona) {
    setEditPersona({ ...p })
    setPersonaEditId(p.id)
    setAddPersonaOpen(false)
  }

  async function savePersona() {
    if (!editPersona) return
    setSaving(true)
    const token = await getToken()
    if (!token) { setSaving(false); return }
    const res = await fetch(`/api/personas/${editPersona.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: editPersona.name, resume_text: editPersona.resume_text }),
    })
    if (res.ok) {
      await loadAll()
      setPersonaEditId(null)
      setEditPersona(null)
      setToast("Persona updated")
    }
    setSaving(false)
  }

  async function setDefault(id: string) {
    const token = await getToken()
    if (!token) return
    await fetch(`/api/personas/${id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    })
    loadAll()
  }

  async function deletePersona(id: string) {
    const token = await getToken()
    if (!token) return
    await fetch(`/api/personas/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    setPersonaEditId(null)
    setEditPersona(null)
    await loadAll()
    setToast("Persona deleted")
  }

  async function createPersona() {
    if (!newPersonaName.trim()) return
    setSaving(true)
    const token = await getToken()
    if (!token) { setSaving(false); return }
    const res = await fetch("/api/personas", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: newPersonaName.trim(), resume_text: newPersonaResume }),
    })
    if (res.ok) {
      await loadAll()
      setAddPersonaOpen(false)
      setNewPersonaName("")
      setNewPersonaResume("")
      setToast("Persona created")
    } else {
      const j = await res.json().catch(() => null)
      setError(j?.error || "Create failed")
    }
    setSaving(false)
  }

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>
  if (error && !profile) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>

  const atLimit = personas.length >= 2

  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 }}>CONTROL CENTER</div>
      <h1 style={{ ...headline, fontSize: 32, letterSpacing: -1 }}>
        Welcome{profile?.name ? `, ${profile.name}` : ""}
      </h1>
      <p style={{ fontSize: 13, color: T.MUTED, marginTop: 4 }}>{profile?.email}</p>

      <div style={{ display: "flex", gap: 24, marginTop: 28, alignItems: "flex-start" }}>
        {/* LEFT COLUMN — Profile */}
        <div style={{ width: "40%", flexShrink: 0 }}>
          <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 10 }}>PROFILE</div>
          <div style={card}>
            <div style={{ height: 3, background: T.GRAD_PROFILE }} />
            <div style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 18, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>
                  {profile?.name || "Unnamed"}
                </span>
                <span style={{ fontSize: 11, color: T.DIM }}>Version {profile?.profile_version}</span>
              </div>

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {profile?.target_roles && <SummaryRow label="Target Roles" value={profile.target_roles} />}
                {profile?.target_locations && <SummaryRow label="Locations" value={profile.target_locations} />}
                {profile?.preferred_locations && <SummaryRow label="Preferred Locations" value={profile.preferred_locations} />}
                {profile?.job_type && <SummaryRow label="Job Type" value={profile.job_type} />}
                {profile?.timeline && <SummaryRow label="Timeline" value={profile.timeline} />}
                {profile?.resume_text && <SummaryRow label="Resume" value={profile.resume_text.length > 200 ? profile.resume_text.slice(0, 200) + "..." : profile.resume_text} />}
              </div>

              {!profileEditOpen && (
                <button onClick={openProfileEdit} style={{ ...btnSecondary, marginTop: 20, fontSize: 12, padding: "9px 16px", borderRadius: 10, color: T.WRN_ORANGE, borderColor: "rgba(254,176,106,0.3)" }}>
                  Edit Profile
                </button>
              )}
            </div>

            {/* Profile edit form */}
            {profileEditOpen && editProfile && (
              <div style={{ borderTop: `1px solid ${T.BORDER_SOFT}`, padding: 24 }}>
                <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>EDIT PROFILE</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {PROFILE_FIELDS.map(({ key, label: lbl, multi, required: req }) => (
                    <div key={key}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <span style={{ ...label, color: req ? T.WRN_BLUE : T.DIM }}>{lbl}</span>
                        {!req && <span style={{ fontSize: 9, color: T.DIM }}>optional</span>}
                      </div>
                      {multi ? (
                        <textarea
                          style={{ ...textarea, minHeight: 100 }}
                          value={(editProfile[key] as string) ?? ""}
                          onChange={(e) => setEditProfile({ ...editProfile, [key]: e.target.value })}
                        />
                      ) : (
                        <input
                          type="text"
                          style={input}
                          value={(editProfile[key] as string) ?? ""}
                          onChange={(e) => setEditProfile({ ...editProfile, [key]: e.target.value })}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button onClick={saveProfile} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button onClick={() => setProfileEditOpen(false)} style={{ ...btnSecondary, fontSize: 13 }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — Personas */}
        <div style={{ flex: 1 }}>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 10 }}>PERSONAS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {personas.map((p) => {
              const isEditing = personaEditId === p.id
              return (
                <div key={p.id} style={card}>
                  <div style={{ height: 3, background: T.GRAD_PERSONA }} />
                  <div style={{ padding: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>{p.name}</span>
                      {p.is_default && (
                        <span style={{
                          fontSize: 9, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase",
                          color: T.WRN_ORANGE, background: T.WARNING_BG, padding: "3px 8px", borderRadius: 6,
                        }}>
                          Default
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>Version {p.persona_version}</span>
                    </div>

                    {!isEditing && (
                      <>
                        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 10, lineHeight: "20px" }}>
                          {p.resume_text
                            ? p.resume_text.slice(0, 200) + (p.resume_text.length > 200 ? "..." : "")
                            : "No resume text yet"}
                        </p>
                        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                          <button onClick={() => openPersonaEdit(p)} style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px", borderRadius: 10, color: T.WRN_ORANGE, borderColor: "rgba(254,176,106,0.3)" }}>
                            Edit
                          </button>
                          {!p.is_default && (
                            <button onClick={() => setDefault(p.id)} style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px", borderRadius: 10 }}>
                              Set as Default
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Persona edit form */}
                  {isEditing && editPersona && (
                    <div style={{ borderTop: `1px solid ${T.BORDER_SOFT}`, padding: 24 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        <div>
                          <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>PERSONA NAME</span>
                          <input
                            type="text"
                            style={input}
                            value={editPersona.name}
                            onChange={(e) => setEditPersona({ ...editPersona, name: e.target.value })}
                          />
                        </div>
                        <div>
                          <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>RESUME TEXT</span>
                          <textarea
                            style={{ ...textarea, minHeight: 260 }}
                            value={editPersona.resume_text}
                            onChange={(e) => setEditPersona({ ...editPersona, resume_text: e.target.value })}
                          />
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                        <button onClick={savePersona} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
                          {saving ? "Saving..." : "Save Changes"}
                        </button>
                        <button onClick={() => { setPersonaEditId(null); setEditPersona(null) }} style={{ ...btnSecondary, fontSize: 13 }}>Cancel</button>
                      </div>
                      {/* Delete link — hide if this is the only persona and it's default */}
                      {!(p.is_default && personas.length === 1) && (
                        <button
                          onClick={() => deletePersona(p.id)}
                          style={{ background: "none", border: "none", color: T.ERROR, fontSize: 12, cursor: "pointer", marginTop: 16, padding: 0, opacity: 0.7 }}
                        >
                          Delete this persona
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {personas.length === 0 && !addPersonaOpen && (
              <p style={{ color: T.MUTED, fontSize: 13 }}>No personas yet. Create one to get started.</p>
            )}

            {/* Add persona form */}
            {addPersonaOpen && (
              <div style={card}>
                <div style={{ height: 3, background: T.GRAD_PERSONA }} />
                <div style={{ padding: 24 }}>
                  <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>NEW PERSONA</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>PERSONA NAME</span>
                      <input
                        type="text"
                        style={input}
                        placeholder="e.g. Sales, Brand Marketing"
                        value={newPersonaName}
                        onChange={(e) => setNewPersonaName(e.target.value)}
                      />
                    </div>
                    <div>
                      <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>RESUME TEXT</span>
                      <textarea
                        style={{ ...textarea, minHeight: 200 }}
                        placeholder="Paste your resume text here..."
                        value={newPersonaResume}
                        onChange={(e) => setNewPersonaResume(e.target.value)}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={createPersona} disabled={saving || !newPersonaName.trim()} style={{ ...btnPrimary, opacity: saving || !newPersonaName.trim() ? 0.5 : 1 }}>
                      {saving ? "Creating..." : "Create Persona"}
                    </button>
                    <button onClick={() => { setAddPersonaOpen(false); setNewPersonaName(""); setNewPersonaResume("") }} style={{ ...btnSecondary, fontSize: 13 }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Add persona button */}
            {!addPersonaOpen && (
              <button
                onClick={() => { setAddPersonaOpen(true); setPersonaEditId(null) }}
                disabled={atLimit}
                title={atLimit ? "You've reached the 2 persona limit" : undefined}
                style={{ ...btnPrimary, opacity: atLimit ? 0.3 : 1, cursor: atLimit ? "not-allowed" : "pointer", alignSelf: "flex-start" }}
              >
                Add New Persona
              </button>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
