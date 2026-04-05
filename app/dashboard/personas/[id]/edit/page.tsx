"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { T, input, textarea, btnPrimary, btnSecondary, card, eyebrow, headline, label } from "../../../../../lib/dashboard-theme"

type Persona = {
  id: string
  name: string
  resume_text: string
  is_default: boolean
  persona_version: number
}

export default function EditPersonaPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [persona, setPersona] = useState<Persona | null>(null)
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
      const res = await fetch("/api/personas", { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const j = await res.json()
        const found = (j.personas || []).find((p: Persona) => p.id === id)
        if (found) setPersona(found)
        else setError("Persona not found")
      } else {
        setError("Failed to load personas")
      }
    }
    load()
  }, [id])

  async function save() {
    if (!persona) return
    setSaving(true)
    setToast("")
    setError("")
    const token = await getToken()
    if (!token) { setError("Session expired"); setSaving(false); return }
    const res = await fetch(`/api/personas/${persona.id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: persona.name, resume_text: persona.resume_text }),
    })
    if (res.ok) {
      const j = await res.json()
      setPersona(j.persona)
      setToast("Persona saved")
      setTimeout(() => setToast(""), 3000)
    } else {
      const j = await res.json().catch(() => null)
      setError(j?.error || "Save failed")
    }
    setSaving(false)
  }

  if (error && !persona) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>
  if (!persona) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>

  return (
    <div>
      <button
        onClick={() => router.push("/dashboard/personas")}
        style={{ ...btnSecondary, fontSize: 12, padding: "7px 14px", borderRadius: 10, marginBottom: 20 }}
      >
        &larr; Back to Personas
      </button>

      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 }}>EDIT</div>
      <h1 style={{ ...headline, fontSize: 28, letterSpacing: -0.8 }}>Edit Persona</h1>
      <p style={{ fontSize: 12, color: T.DIM, marginTop: 4 }}>Version {persona.persona_version}</p>

      <div style={{ ...card, marginTop: 24 }}>
        <div style={{ height: 3, background: "linear-gradient(90deg, #FEB06A, #f97316, #51ADE5)" }} />
        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, marginBottom: 6, display: "block" }}>PERSONA NAME</span>
            <input
              type="text"
              style={input}
              value={persona.name}
              onChange={(e) => setPersona({ ...persona, name: e.target.value })}
            />
          </div>
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, marginBottom: 6, display: "block" }}>RESUME TEXT</span>
            <textarea
              style={{ ...textarea, minHeight: 320 }}
              value={persona.resume_text}
              onChange={(e) => setPersona({ ...persona, resume_text: e.target.value })}
            />
          </div>
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
        {saving ? "Saving..." : "Save Persona"}
      </button>
    </div>
  )
}
