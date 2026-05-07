"use client"

// Coach Home / My Clients landing page.
// Sprint 2 build (2026-05-07). Pulls from /api/coach/home which combines:
//   - greeting (coach.firstName + today's date)
//   - metrics tiles (active clients, prospects placeholder, phases placeholder)
//   - Requires Action list (heuristic-driven, see /api/coach/home for rules)
//   - per-client cards with "since last visit" indicator

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import CreateClientModal from "./CreateClientModal"
import {
  T, input, textarea, btnPrimary, btnSecondary, card, eyebrow, headline, label,
} from "../../../lib/dashboard-theme"

type CoachHome = {
  ok: boolean
  coach: { firstName: string; fullName: string | null }
  metrics: { activeClients: number; activeProspects: number }
  clients: CoachClient[]
  requiresAction: ActionItem[]
}

type CoachClient = {
  id: string
  client_profile_id: string
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
  last_viewed_at: string | null
  updates_since_visit: number
}

type ActionItem = {
  id: string
  kind:
    | "no_login"
    | "rec_pending_review"
    | "moved_interviewing"
    | "moved_rejected"
    | "offer_no_followup"
    | "poor_fit_no_rec"
  client_profile_id: string
  client_name: string
  message: string
  days_elapsed: number
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

// Mirror tracker stats-bar tile style (from app/dashboard/tracker/page.tsx
// lines 459-474). Big number + small label, hoverable card frame.
function MetricTile({
  value, label, color, subtitle, onClick,
}: {
  value: string | number
  label: string
  color?: string
  subtitle?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: T.CARD,
        border: `1px solid ${T.BORDER_SOFT}`,
        borderRadius: 12,
        padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 900, color: color || T.TEXT }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", color: T.MUTED, marginTop: 4 }}>
        {label}
      </div>
      {subtitle && (
        <div style={{ fontSize: 10, color: T.DIM, marginTop: 4, fontStyle: "italic" }}>{subtitle}</div>
      )}
    </div>
  )
}

const RULE_LABEL: Record<ActionItem["kind"], string> = {
  no_login: "Inactive",
  rec_pending_review: "Awaiting review",
  moved_interviewing: "Status change",
  moved_rejected: "Rejection",
  offer_no_followup: "Offer",
  poor_fit_no_rec: "Low-fit app",
}
const RULE_COLOR: Record<ActionItem["kind"], string> = {
  no_login: "#FEB06A",
  rec_pending_review: "#51ADE5",
  moved_interviewing: "#a78bfa",
  moved_rejected: "#E87070",
  offer_no_followup: "#4ade80",
  poor_fit_no_rec: "#FBBF24",
}

function todayLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  })
}

export default function CoachHomePage() {
  const router = useRouter()
  const [data, setData] = useState<CoachHome | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessForbidden, setAccessForbidden] = useState(false)

  // Modal / inline state
  const [showCreateClient, setShowCreateClient] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteAccess, setInviteAccess] = useState("full")
  const [inviteNote, setInviteNote] = useState("")
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<any>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [notesOpen, setNotesOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch("/api/coach/home")
    if (res.status === 403) {
      setAccessForbidden(true)
      setLoading(false)
      return
    }
    if (res.ok) {
      const j = (await res.json()) as CoachHome
      setData(j)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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

  async function removeClient(clientProfileId: string) {
    setRemoving(true)
    try {
      const res = await authFetch(`/api/coach/clients/${clientProfileId}`, { method: "DELETE" })
      if (res.ok) {
        setConfirmRemoveId(null)
        await load()
      }
    } catch {}
    setRemoving(false)
  }

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>

  if (accessForbidden) {
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

  const home = data!
  const { coach, metrics, clients, requiresAction } = home

  return (
    <div>
      {/* Greeting strip */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 4 }}>{todayLabel().toUpperCase()}</div>
        <h1 style={{ ...headline, fontSize: 26, letterSpacing: -0.8, margin: 0, fontWeight: 700 }}>
          Welcome back, <span style={{ color: T.WRN_ORANGE, fontWeight: 950 }}>{coach.firstName}</span>
        </h1>
      </div>

      {/* Metrics bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 28 }}>
        <MetricTile value={metrics.activeClients} label="Active Clients" color={T.WRN_ORANGE} />
        <MetricTile value="—" label="Active Prospects" subtitle="Coming soon" />
        <MetricTile value="—" label="Clients per phase" subtitle="Methodology not yet configured" />
      </div>

      {/* Requires Action */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE }}>REQUIRES ACTION</div>
          {requiresAction.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase",
              color: "#04060F", background: T.WRN_ORANGE, padding: "2px 8px", borderRadius: 999,
            }}>
              {requiresAction.length}
            </span>
          )}
        </div>
        {requiresAction.length === 0 ? (
          <div style={{ ...card, padding: 18 }}>
            <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>Nothing requires your attention right now.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {requiresAction.map((item) => (
              <div
                key={item.id}
                onClick={() => router.push(`/dashboard/coach/clients/${item.client_profile_id}`)}
                style={{
                  ...card,
                  padding: "12px 16px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase",
                  color: RULE_COLOR[item.kind], background: `${RULE_COLOR[item.kind]}1f`,
                  padding: "3px 8px", borderRadius: 6, flexShrink: 0,
                }}>
                  {RULE_LABEL[item.kind]}
                </span>
                <span style={{ fontSize: 13, color: T.TEXT, flex: 1 }}>{item.message}</span>
                <span style={{ fontSize: 11, color: T.DIM, flexShrink: 0 }}>{item.days_elapsed}d</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Clients header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ ...eyebrow, color: T.WRN_BLUE }}>
          MY CLIENTS{" "}
          <span style={{ color: T.DIM, fontWeight: 700 }}>({clients.length})</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setShowCreateClient(true)}
            style={{
              border: "1px solid #3D1A4A", color: "#3D1A4A", background: "#ffffff",
              borderRadius: 20, padding: "8px 18px", fontSize: 12,
              letterSpacing: "0.04em", cursor: "pointer", fontWeight: 700, fontFamily: "inherit",
            }}
          >
            + Create Client Account
          </button>
          <button
            onClick={() => { setInviteOpen(true); setInviteResult(null) }}
            style={{ ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900 }}
          >
            + Invite Client
          </button>
        </div>
      </div>

      {/* Client cards */}
      {clients.length === 0 && (
        <p style={{ color: T.MUTED, fontSize: 13 }}>No clients yet. Invite your first client above.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {clients.map((client) => {
          const accentColor = ATTENTION_COLOR[client.attention_level || "low"] || T.WRN_BLUE
          const isNotesOpen = notesOpen === client.client_profile_id
          const updates = client.updates_since_visit
          return (
            <div key={client.client_profile_id} style={{ ...card, display: "flex" }}>
              <div style={{ width: 4, background: accentColor, flexShrink: 0 }} />
              <div style={{ flex: 1, padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>
                    {client.name || "Unnamed"}
                  </span>
                  <StatusBadge status={client.status} />
                </div>
                <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 16px" }}>{client.email}</p>

                {/* Stats row */}
                <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
                  {[
                    { label: "Applications", value: client.stats.applications },
                    { label: "Interviewing", value: client.stats.interviewing },
                    { label: "Pending Recs", value: client.stats.pending_recs },
                    { label: "Interview Rate", value: `${client.stats.interview_rate}%` },
                  ].map(({ label: lbl, value }) => (
                    <div key={lbl}>
                      <div style={{ ...eyebrow, fontSize: 9, color: T.DIM, marginBottom: 2 }}>{lbl}</div>
                      <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Since-last-visit indicator (Sprint 2) */}
                <p style={{
                  fontSize: 11, color: updates > 0 ? T.WRN_ORANGE : T.DIM,
                  fontWeight: updates > 0 ? 900 : 400,
                  marginBottom: 14,
                }}>
                  {updates > 0
                    ? `${updates} update${updates === 1 ? "" : "s"} since your last visit`
                    : "No changes since your last visit"}
                </p>

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
                  {confirmRemoveId === client.client_profile_id ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: T.DIM }}>Remove this client?</span>
                      <button
                        onClick={() => removeClient(client.client_profile_id)}
                        disabled={removing}
                        style={{ background: "none", border: "1px solid rgba(248,113,113,0.4)", color: "#f87171", fontSize: 11, fontWeight: 900, borderRadius: 6, padding: "5px 12px", cursor: "pointer", opacity: removing ? 0.5 : 1 }}
                      >
                        {removing ? "Removing..." : "Yes, remove"}
                      </button>
                      <button
                        onClick={() => setConfirmRemoveId(null)}
                        style={{ background: "none", border: "none", color: T.DIM, fontSize: 11, cursor: "pointer", padding: 0 }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemoveId(client.client_profile_id)}
                      style={{ background: "none", border: "none", color: T.DIM, fontSize: 11, cursor: "pointer", padding: "9px 4px" }}
                    >
                      Remove
                    </button>
                  )}
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
                  They&apos;ll receive a link to accept and connect their account to your coaching dashboard.
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
                      {["full", "view"].map((level) => (
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

      {showCreateClient && (
        <CreateClientModal
          onClose={() => setShowCreateClient(false)}
          onSuccess={() => {
            setShowCreateClient(false)
            load()
          }}
        />
      )}
    </div>
  )
}
