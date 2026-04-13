"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
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
} from "../../../lib/dashboard-theme"

type CoachClient = {
  id: string
  name: string | null
  email: string | null
  status: string | null
  attention_level: "high" | "medium" | "low" | null
  stats: {
    applications: number
    interviewing: number
    pending_recs: number
    interview_rate: number
  }
  last_activity: string | null
}

const ATTENTION_COLOR: Record<string, string> = {
  high: "#f87171",
  medium: "#FEB06A",
  low: "#4ade80",
}

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}) {
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

function StatusBadge({ status }: { status: string | null }) {
  const s = status || "active"
  const styles: Record<string, { bg: string; color: string }> = {
    active: { bg: "rgba(74,222,128,0.12)", color: "#4ade80" },
    invited: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
    inactive: { bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" },
  }
  const st = styles[s] || styles.active
  return (
    <span style={{
      fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase",
      background: st.bg, color: st.color, padding: "3px 10px", borderRadius: 999,
    }}>
      {s}
    </span>
  )
}

export default function CoachPage() {
  const router = useRouter()
  const [isCoach, setIsCoach] = useState<boolean | null>(null)
  const [clients, setClients] = useState<CoachClient[]>([])
  const [loading, setLoading] = useState(true)
  const [notesOpen, setNotesOpen] = useState<string | null>(null)

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteAccess, setInviteAccess] = useState("full")
  const [inviteNote, setInviteNote] = useState("")
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<any>(null)

  const loadClients = useCallback(async () => {
    const profileRes = await authFetch("/api/profile")
    if (!profileRes.ok) { setLoading(false); return }
    const { profile } = await profileRes.json()
    if (!profile?.is_coach) {
      setIsCoach(false)
      setLoading(false)
      return
    }
    setIsCoach(true)
    const clientsRes = await authFetch("/api/coach/clients")
    if (clientsRes.ok) {
      const j = await clientsRes.json()
      setClients(j.clients || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadClients() }, [loadClients])

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    const res = await authFetch("/api/coach/invite", {
      method: "POST",
      body: JSON.stringify({ email: inviteEmail.trim(), access_level: inviteAccess, note: inviteNote }),
    })
    const j = await res.json()
    setInviteResult(j)
    setInviting(false)
  }

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>

  if (isCoach === false) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
        <div style={{ ...card, padding: 40, textAlign: "center", maxWidth: 400 }}>
          <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
          <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
          <p style={{ color: T.MUTED, fontSize: 13, marginTop: 8 }}>
            Your account does not have coach permissions. Contact support to request access.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 6 }}>COACH DASHBOARD</div>
          <h1 style={{ ...headline, fontSize: 30, letterSpacing: -1, margin: 0 }}>
            My Clients
            <span style={{
              marginLeft: 12, fontSize: 14, fontWeight: 900, letterSpacing: 0,
              color: T.WRN_BLUE, background: "rgba(81,173,229,0.12)",
              padding: "3px 12px", borderRadius: 999, verticalAlign: "middle",
            }}>
              {clients.length}
            </span>
          </h1>
        </div>
        <button
          onClick={() => { setInviteOpen(true); setInviteResult(null) }}
          style={{ ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900 }}
        >
          + Invite Client
        </button>
      </div>

      {/* Client cards */}
      {clients.length === 0 && (
        <p style={{ color: T.MUTED, fontSize: 13 }}>No clients yet. Invite your first client above.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {clients.map((client) => {
          const accentColor = ATTENTION_COLOR[client.attention_level || "low"] || T.WRN_BLUE
          const isNotesOpen = notesOpen === client.client_profile_id
          return (
            <div key={client.client_profile_id} style={{ ...card, display: "flex" }}>
              {/* Left accent bar */}
              <div style={{ width: 4, background: accentColor, flexShrink: 0 }} />
              <div style={{ flex: 1, padding: 24 }}>
                {/* Name + status */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>
                    {client.name || "Unnamed"}
                  </span>
                  <StatusBadge status={client.status} />
                </div>
                <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 16px" }}>{client.email}</p>

                {/* Stats row */}
                <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
                  {[
                    { label: "Applications", value: client.stats?.applications ?? 0 },
                    { label: "Interviewing", value: client.stats?.interviewing ?? 0 },
                    { label: "Pending Recs", value: client.stats?.pending_recs ?? 0 },
                    { label: "Interview Rate", value: `${client.stats?.interview_rate ?? 0}%` },
                  ].map(({ label: lbl, value }) => (
                    <div key={lbl}>
                      <div style={{ ...eyebrow, fontSize: 9, color: T.DIM, marginBottom: 2 }}>{lbl}</div>
                      <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Last activity */}
                {client.last_activity && (
                  <p style={{ fontSize: 11, color: T.DIM, marginBottom: 16 }}>
                    Last activity: {client.last_activity}
                  </p>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={() => router.push(`/dashboard/coach/clients/${client.client_profile_id}`)}
                    style={{ ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900, fontSize: 12, padding: "9px 16px", borderRadius: 10 }}
                  >
                    Open Dashboard →
                  </button>
                  <button
                    onClick={() => router.push(`/dashboard/coach/clients/${client.client_profile_id}?tab=source`)}
                    style={{ ...btnSecondary, fontSize: 12, padding: "9px 16px", borderRadius: 10, color: T.WRN_ORANGE, borderColor: "rgba(254,176,106,0.3)" }}
                  >
                    Add Job +
                  </button>
                  <button
                    onClick={() => setNotesOpen(isNotesOpen ? null : client.client_profile_id)}
                    style={{ ...btnSecondary, fontSize: 12, padding: "9px 16px", borderRadius: 10 }}
                  >
                    Notes {isNotesOpen ? "▲" : "▼"}
                  </button>
                </div>

                {isNotesOpen && (
                  <div style={{ marginTop: 16, padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 10, border: `1px solid ${T.BORDER_SOFT}` }}>
                    <div style={{ ...eyebrow, color: T.DIM, fontSize: 9, marginBottom: 8 }}>COACH NOTES</div>
                    <p style={{ color: T.MUTED, fontSize: 13 }}>Notes functionality coming soon.</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Invite modal */}
      {inviteOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ ...card, padding: 36, width: 480, maxWidth: "90vw" }}>
            <div style={{ height: 3, background: T.GRAD_PRIMARY, margin: "-36px -36px 28px", borderRadius: "18px 18px 0 0" }} />

            {inviteResult ? (
              <div>
                <div style={{ ...eyebrow, color: T.SUCCESS, marginBottom: 12 }}>INVITE SENT</div>
                <p style={{ fontSize: 15, fontWeight: 900, color: T.TEXT }}>Invitation delivered</p>
                <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, lineHeight: "20px" }}>
                  An invite was sent to <span style={{ color: T.WRN_BLUE }}>{inviteEmail}</span>.
                  They'll receive a link to accept and connect their account to your coaching dashboard.
                </p>
                <button
                  onClick={() => { setInviteOpen(false); setInviteEmail(""); setInviteNote(""); setInviteResult(null) }}
                  style={{ ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900, marginTop: 24, width: "100%" }}
                >
                  Done
                </button>
              </div>
            ) : (
              <div>
                <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>INVITE A CLIENT</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>CLIENT EMAIL</span>
                    <input
                      type="email"
                      style={input}
                      placeholder="client@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>

                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>ACCESS LEVEL</span>
                    <div style={{ display: "flex", gap: 10 }}>
                      {["full", "view_only"].map((level) => (
                        <label key={level} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="access_level"
                            value={level}
                            checked={inviteAccess === level}
                            onChange={() => setInviteAccess(level)}
                            style={{ accentColor: T.WRN_ORANGE }}
                          />
                          <span style={{ fontSize: 13, color: T.TEXT, fontWeight: 700 }}>
                            {level === "full" ? "Full Access" : "View Only"}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>PERSONAL NOTE <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span></span>
                    <textarea
                      style={{ ...textarea, minHeight: 80 }}
                      placeholder="Add a personal message to include with the invite..."
                      value={inviteNote}
                      onChange={(e) => setInviteNote(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                  <button
                    onClick={sendInvite}
                    disabled={inviting || !inviteEmail.trim()}
                    style={{ ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900, flex: 1, opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
                  >
                    {inviting ? "Sending..." : "Send Invite →"}
                  </button>
                  <button
                    onClick={() => { setInviteOpen(false); setInviteEmail(""); setInviteNote(""); setInviteResult(null) }}
                    style={{ ...btnSecondary, fontSize: 13 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
