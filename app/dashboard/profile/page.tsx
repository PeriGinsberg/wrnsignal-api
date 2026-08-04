"use client"

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, input, textarea, btnPrimary, card, eyebrow, headline, label } from "../../../lib/dashboard-theme"
import { JOB_TYPE_OPTIONS, normalizeJobType } from "../../../lib/jobType"
import { LegacyAccountPanel } from "./LegacyAccountPanel"

type Profile = {
  id: string
  name: string | null
  job_type: string | null
  target_roles: string | null
  target_locations: string | null
  preferred_locations: string | null
  timeline: string | null
  resume_text: string | null
  profile_version: number
}

const FIELDS: { key: keyof Profile; label: string; multi: boolean; required: boolean }[] = [
  { key: "name", label: "NAME", multi: false, required: true },
  { key: "job_type", label: "JOB TYPE", multi: false, required: true },
  { key: "target_roles", label: "TARGET ROLES", multi: false, required: true },
  { key: "target_locations", label: "TARGET LOCATIONS", multi: false, required: false },
  { key: "timeline", label: "TIMELINE", multi: false, required: false },
  { key: "resume_text", label: "RESUME TEXT", multi: true, required: true },
]

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState("")
  const [error, setError] = useState("")

  async function getToken() {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    if (session?.access_token) return session.access_token
    return sessionStorage.getItem("signal_handoff_token")
  }

  useEffect(() => {
    async function load() {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const j = await res.json()
        setProfile(j.profile)
      } else {
        setError("Failed to load profile")
      }
    }
    load()
  }, [])

  function toggleJobType(opt: string) {
    if (!profile) return
    const cur = new Set((profile.job_type || "").split(",").map((s) => s.trim()).filter(Boolean))
    let next: string[]
    if (opt === "Any") next = cur.has("Any") ? [] : ["Any"]
    else if (cur.has(opt)) { cur.delete(opt); next = Array.from(cur) }
    else { cur.delete("Any"); cur.add(opt); next = Array.from(cur) }
    setProfile({ ...profile, job_type: normalizeJobType(next).value ?? "" })
  }

  async function save() {
    if (!profile) return
    setSaving(true)
    setToast("")
    setError("")
    const token = await getToken()
    if (!token) { setError("Session expired"); setSaving(false); return }
    // preferred_locations destructured out so this form no longer writes it
    // (field removed); the column stays as inert dead storage.
    const { id, profile_version, preferred_locations, ...fields } = profile
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    })
    if (res.ok) {
      const j = await res.json()
      setProfile(j.profile)
      setToast("Profile saved")
      setTimeout(() => setToast(""), 3000)
    } else {
      const j = await res.json().catch(() => null)
      setError(j?.error || "Save failed")
    }
    setSaving(false)
  }

  if (error && !profile) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>
  if (!profile) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>

  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 }}>SETTINGS</div>
      <h1 style={{ ...headline, fontSize: 28, letterSpacing: -0.8 }}>Edit Profile</h1>
      <p style={{ fontSize: 12, color: T.DIM, marginTop: 4 }}>Version {profile.profile_version}</p>

      <div style={{ ...card, marginTop: 24 }}>
        <div style={{ height: 3, background: "linear-gradient(90deg, #51ADE5, #218C8C, #FEB06A)" }} />
        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
          {FIELDS.map(({ key, label: lbl, multi, required: req }) => (
            <div key={key}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ ...label, color: req ? T.WRN_BLUE : T.DIM }}>{lbl}</span>
                {!req && <span style={{ fontSize: 10, color: T.DIM }}>optional</span>}
              </div>
              {key === "job_type" ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {JOB_TYPE_OPTIONS.map((opt) => {
                    const active = (profile.job_type || "").split(",").map((s) => s.trim()).includes(opt)
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleJobType(opt)}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 999,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: active ? `1px solid ${T.WRN_BLUE}` : `1px solid ${T.BORDER_SOFT}`,
                          background: active ? "rgba(81,173,229,0.15)" : "rgba(255,255,255,0.04)",
                          color: active ? T.WRN_BLUE : T.DIM,
                        }}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              ) : multi ? (
                <textarea
                  style={{ ...textarea, minHeight: 180 }}
                  value={(profile[key] as string) ?? ""}
                  onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                />
              ) : (
                <input
                  type="text"
                  style={input}
                  value={(profile[key] as string) ?? ""}
                  onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: T.ERROR_BG, color: T.ERROR, fontSize: 12, fontWeight: 900 }}>
          {error}
        </div>
      )}
      {toast && (
        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: T.SUCCESS_BG, color: T.SUCCESS, fontSize: 12, fontWeight: 900 }}>
          {toast}
        </div>
      )}

      <button onClick={save} disabled={saving} style={{ ...btnPrimary, marginTop: 20, opacity: saving ? 0.5 : 1 }}>
        {saving ? "Saving..." : "Save Profile"}
      </button>

      {/* TEMPORARY. Resume personas, coach recommendations and the refund panel
          used to live on /dashboard, which is now the stateful home. They have
          no designed home until My Profile grows its Resume and Account
          sections, so they sit here, unchanged and still dark, rather than
          being dropped. See LegacyAccountPanel.tsx. */}
      <div style={{ marginTop: 44, paddingTop: 28, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        <LegacyAccountPanel />
      </div>
    </div>
  )
}
