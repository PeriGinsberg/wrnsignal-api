"use client"

// My Clients full list (Sprint 3, 2026-05-08).
// Reuses the single-row client layout from the redesigned Coach Home
// Dashboard, but without the top-5 limit. Pulls from /api/coach/home —
// the existing per-client stats including offers/rejected. No new API.

import { useEffect, useMemo, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { T, btnSecondary, card, eyebrow } from "../../../../lib/dashboard-theme"
import { LifecycleStatusPill, type LifecycleStatus } from "../LifecycleStatusPill"
import { BackToDashboard } from "../BackToDashboard"
import { LoadingShell } from "../LoadingShell"
import { onCoachRowEnter, onCoachRowLeave, COACH_ROW_DEFAULT_BG, COACH_ROW_TRANSITION } from "../coachRowHover"

// Phase 2 Item 12 (revised): only lifecycle-status filters route here.
// Application-count filters go to /dashboard/coach/applications-recent
// in Commit 2.3. Must stay in sync with allowlist in /api/coach/home.
const FILTER_LABELS: Record<string, string> = {
  prospect: "Active Prospects",
  active: "Active Clients",
}

type CoachClient = {
  id: string
  client_profile_id: string
  name: string | null
  email: string | null
  status: string | null
  lifecycle_status: LifecycleStatus
  attention_level: "high" | "medium" | "low" | null
  stats: {
    applications: number
    interviewing: number
    offers: number
    rejected: number
    interview_rate: number
  }
  last_activity: string | null
  last_viewed_at: string | null
  updates_since_visit: number
}

const AVATAR_PALETTE = [
  { bg: "rgba(81,173,229,0.18)",  text: "#9FC9EE" },
  { bg: "rgba(254,176,106,0.18)", text: "#FECDA0" },
  { bg: "rgba(167,139,250,0.18)", text: "#C8B6F8" },
  { bg: "rgba(244,114,182,0.18)", text: "#F4ADC9" },
  { bg: "rgba(74,222,128,0.18)",  text: "#9CE7B5" },
] as const

function hashIndex(s: string, mod: number): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return Math.abs(h) % mod
}

function initialsOf(name: string | null, fallback: string | null): string {
  const src = (name && name.trim()) || (fallback && fallback.trim()) || "?"
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } })
}

function Avatar({ name, email }: { name: string | null; email: string | null }) {
  const seed = (name || email || "?").toLowerCase()
  const palette = AVATAR_PALETTE[hashIndex(seed, AVATAR_PALETTE.length)]
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: palette.bg, color: palette.text,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 900, letterSpacing: 0.3, flexShrink: 0,
    }}>
      {initialsOf(name, email)}
    </div>
  )
}

function MiniCell({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ minWidth: 48, textAlign: "center" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || T.TEXT, marginTop: 2 }}>{value}</div>
    </div>
  )
}

export default function MyClientsFullPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filterParam = searchParams.get("filter")
  // Drop the param entirely if it's not in the allowlist — server ignores
  // unknown filters too, this keeps the chip-render side in sync.
  const filter = filterParam && FILTER_LABELS[filterParam] ? filterParam : null

  const [clients, setClients] = useState<CoachClient[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const url = filter
      ? `/api/coach/home?filter=${encodeURIComponent(filter)}`
      : "/api/coach/home"
    const res = await authFetch(url)
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) {
      const j = await res.json()
      setClients(j.clients || [])
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  function clearFilter() {
    router.push("/dashboard/coach/clients")
  }

  // Same default sort as the Dashboard summary
  const sorted = useMemo(() => {
    if (!clients) return []
    return [...clients].sort((a, b) => {
      if (b.updates_since_visit !== a.updates_since_visit) return b.updates_since_visit - a.updates_since_visit
      if (a.attention_level !== b.attention_level) return a.attention_level === "medium" ? -1 : 1
      return (a.name || "").localeCompare(b.name || "")
    })
  }, [clients])

  if (loading) return <LoadingShell />


  if (forbidden) {
    return (
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
      </div>
    )
  }

  return (
    <div>
      <BackToDashboard />
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          My Clients <span style={{ color: T.DIM, fontWeight: 400, fontSize: 18 }}>({sorted.length})</span>
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Full client list. Click Open → to drill into a client&apos;s tracker, profile, and personas.
        </p>
        {filter && (
          <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(254,176,106,0.10)", border: "1px solid rgba(254,176,106,0.30)",
            color: "#FEB06A", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700,
          }}>
            <span>Filtered: {FILTER_LABELS[filter]}</span>
            <button
              onClick={clearFilter}
              aria-label="Clear filter"
              title="Clear filter"
              style={{
                background: "none", border: "none", color: "#FEB06A",
                fontSize: 14, fontWeight: 900, cursor: "pointer",
                padding: 0, lineHeight: 1, fontFamily: "inherit",
              }}
            >×</button>
          </div>
        )}
      </div>

      <div style={{ ...card, padding: 20 }}>
        {sorted.length === 0 ? (
          <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
            {filter
              ? `No clients match the "${FILTER_LABELS[filter]}" filter. Clear the filter to see your full roster.`
              : "No clients yet. Use Create or Invite from the Dashboard to add one."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.map((c) => {
              const updates = c.updates_since_visit
              return (
                <div
                  key={c.client_profile_id}
                  onClick={() => router.push(`/dashboard/coach/clients/${c.client_profile_id}`)}
                  onMouseEnter={onCoachRowEnter}
                  onMouseLeave={(e) => onCoachRowLeave(e)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "12px 14px",
                    background: COACH_ROW_DEFAULT_BG,
                    border: `1px solid ${T.BORDER_SOFT}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    transition: COACH_ROW_TRANSITION,
                  }}
                >
                  <Avatar name={c.name} email={c.email} />
                  <div style={{ minWidth: 0, flex: "1 1 180px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 14, fontWeight: 700, color: T.TEXT,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{c.name || "Unnamed"}</span>
                      <LifecycleStatusPill
                        value={c.lifecycle_status}
                        getToken={getToken}
                        clientProfileId={c.client_profile_id}
                        onChange={(next) => {
                          setClients((prev) =>
                            prev
                              ? prev.map((cc) =>
                                  cc.client_profile_id === c.client_profile_id
                                    ? { ...cc, lifecycle_status: next }
                                    : cc,
                                )
                              : prev,
                          )
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                    <MiniCell label="Apps"  value={c.stats.applications} />
                    <MiniCell label="Intvw" value={c.stats.interviewing} color={c.stats.interviewing > 0 ? T.WRN_BLUE : undefined} />
                    <MiniCell label="Rate"  value={`${c.stats.interview_rate}%`} />
                    <MiniCell label="Rej"   value={c.stats.rejected} />
                    <MiniCell label="Off"   value={c.stats.offers} color={c.stats.offers > 0 ? T.SUCCESS : undefined} />
                  </div>
                  <div style={{ flexShrink: 0, minWidth: 110, textAlign: "right" }}>
                    {updates > 0 ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: T.WRN_ORANGE }}>{updates} new</span>
                    ) : (
                      <span style={{ fontSize: 11, color: T.DIM }}>No changes</span>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/coach/clients/${c.client_profile_id}`) }}
                    style={{
                      ...btnSecondary,
                      fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8,
                      color: T.WRN_ORANGE, borderColor: "rgba(254,176,106,0.3)",
                      flexShrink: 0,
                    }}
                  >
                    Open →
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
