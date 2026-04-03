"use client"

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, input, textarea, btnPrimary, card, eyebrow, headline, label } from "../../../lib/dashboard-theme"

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
  { key: "preferred_locations", label: "PREFERRED LOCATIONS", multi: false, required: false },
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
    return session?.access_token ?? null
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

  async function save() {
    if (!profile) return
    setSaving(true)
    setToast("")
    setError("")
    const token = await getToken()
    if (!token) { setError("Session expired"); setSaving(false); return }
    const { id, profile_version, ...fields } = profile
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
              {multi ? (
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
    </div>
  )
}
