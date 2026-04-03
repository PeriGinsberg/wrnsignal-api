"use client"

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
import { T, card, eyebrow, headline } from "../../lib/dashboard-theme"

type Profile = {
  id: string
  name: string | null
  email: string | null
  target_roles: string | null
  profile_version: number
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [personaCount, setPersonaCount] = useState(0)
  const [error, setError] = useState("")

  useEffect(() => {
    async function load() {
      const { data: { session } } = await getSupabaseBrowser().auth.getSession()
      if (!session) return
      const headers = { Authorization: `Bearer ${session.access_token}` }
      const [profileRes, personasRes] = await Promise.all([
        fetch("/api/profile", { headers }),
        fetch("/api/personas", { headers }),
      ])
      if (profileRes.ok) {
        const pj = await profileRes.json()
        setProfile(pj.profile)
      } else {
        setError("Failed to load profile")
      }
      if (personasRes.ok) {
        const pj = await personasRes.json()
        setPersonaCount(pj.personas?.length ?? 0)
      }
    }
    load()
  }, [])

  if (error) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>
  if (!profile) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>

  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 }}>OVERVIEW</div>
      <h1 style={{ ...headline, fontSize: 32, letterSpacing: -1 }}>
        Welcome{profile.name ? `, ${profile.name}` : ""}
      </h1>
      <p style={{ fontSize: 13, color: T.MUTED, marginTop: 4 }}>{profile.email}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 32 }}>
        <a href="/dashboard/profile" style={{ ...card, textDecoration: "none", display: "block" }}>
          <div style={{ height: 3, background: "linear-gradient(90deg, #51ADE5, #218C8C, #FEB06A)" }} />
          <div style={{ padding: 24 }}>
            <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 10 }}>PROFILE</div>
            <p style={{ fontSize: 14, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>
              {profile.target_roles || "No target roles set"}
            </p>
            <p style={{ fontSize: 12, color: T.DIM, marginTop: 8 }}>Version {profile.profile_version}</p>
          </div>
        </a>

        <a href="/dashboard/personas" style={{ ...card, textDecoration: "none", display: "block" }}>
          <div style={{ height: 3, background: "linear-gradient(90deg, #FEB06A, #f97316, #51ADE5)" }} />
          <div style={{ padding: 24 }}>
            <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 10 }}>PERSONAS</div>
            <p style={{ fontSize: 14, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>
              {personaCount} of 2 personas created
            </p>
            <p style={{ fontSize: 12, color: T.DIM, marginTop: 8 }}>Manage your resume personas</p>
          </div>
        </a>
      </div>
    </div>
  )
}
