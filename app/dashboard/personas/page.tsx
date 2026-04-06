"use client"

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, card, btnPrimary, btnSecondary, eyebrow, headline } from "../../../lib/dashboard-theme"

type Persona = {
  id: string
  name: string
  resume_text: string
  is_default: boolean
  display_order: number
  persona_version: number
}

export default function PersonasPage() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function getToken() {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    if (session?.access_token) return session.access_token
    return sessionStorage.getItem("signal_handoff_token")
  }

  async function load() {
    const token = await getToken()
    if (!token) return
    const res = await fetch("/api/personas", { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const j = await res.json()
      setPersonas(j.personas || [])
    } else {
      setError("Failed to load personas")
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function setDefault(id: string) {
    const token = await getToken()
    if (!token) return
    await fetch(`/api/personas/${id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    })
    load()
  }

  async function deletePersona(id: string) {
    const token = await getToken()
    if (!token) return
    await fetch(`/api/personas/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    load()
  }

  async function addPersona() {
    const token = await getToken()
    if (!token) return
    const name = prompt("Persona name:")
    if (!name?.trim()) return
    const res = await fetch("/api/personas", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), resume_text: "" }),
    })
    if (res.ok) {
      const j = await res.json()
      window.location.href = `/dashboard/personas/${j.persona.id}/edit`
    } else {
      const j = await res.json().catch(() => null)
      setError(j?.error || "Create failed")
    }
  }

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>

  const atLimit = personas.length >= 2

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 }}>MANAGE</div>
          <h1 style={{ ...headline, fontSize: 28, letterSpacing: -0.8 }}>Personas</h1>
        </div>
        <button
          onClick={addPersona}
          disabled={atLimit}
          style={{ ...btnPrimary, opacity: atLimit ? 0.3 : 1, cursor: atLimit ? "not-allowed" : "pointer" }}
        >
          Add Persona
        </button>
      </div>

      {atLimit && (
        <p style={{ fontSize: 11, color: T.DIM, marginTop: 8 }}>Maximum 2 personas reached.</p>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: T.ERROR_BG, color: T.ERROR, fontSize: 12, fontWeight: 900 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {personas.map((p) => (
          <div key={p.id} style={card}>
            <div style={{ height: 3, background: "linear-gradient(90deg, #FEB06A, #f97316, #51ADE5)" }} />
            <div style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>{p.name}</span>
                {p.is_default && (
                  <span style={{
                    fontSize: 9, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase",
                    color: T.WRN_ORANGE, background: T.WARNING_BG,
                    padding: "3px 8px", borderRadius: 6,
                  }}>
                    Default
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, lineHeight: "20px" }}>
                {p.resume_text
                  ? p.resume_text.slice(0, 100) + (p.resume_text.length > 100 ? "..." : "")
                  : "No resume text yet"}
              </p>
              <p style={{ fontSize: 11, color: T.DIM, marginTop: 6 }}>Version {p.persona_version}</p>

              <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                <a href={`/dashboard/personas/${p.id}/edit`} style={{ ...btnSecondary, textDecoration: "none", fontSize: 12, padding: "8px 14px", borderRadius: 10 }}>
                  Edit
                </a>
                {!p.is_default && (
                  <button onClick={() => setDefault(p.id)} style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px", borderRadius: 10 }}>
                    Set as Default
                  </button>
                )}
                <button
                  onClick={() => deletePersona(p.id)}
                  style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px", borderRadius: 10, color: T.ERROR, borderColor: "rgba(255,120,120,0.2)" }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}

        {personas.length === 0 && (
          <p style={{ color: T.MUTED, fontSize: 13 }}>No personas yet. Create one to get started.</p>
        )}
      </div>
    </div>
  )
}
