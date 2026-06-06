"use client"

// History — a read-only, newest-first timeline of the relationship's business
// events (coach_client_events). Shared by the linked-client page (tab) and the
// prospect detail page (section); both pass coach_clients.id directly. Read API:
//   GET /api/coach/coach-clients/[ccId]/events
//   → [{ event_type, actor_profile_id, context, created_at }] newest-first.
//
// Quiet and scannable — a record to read, not a dashboard. Read-only: no actions.
// Log-forward, so older relationships legitimately start empty (not an error).
//
// getToken/authFetch inlined per the coach-route client convention (same pair as
// EngagementsTab / NotesTab).

import { useCallback, useEffect, useState } from "react"
import { T, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

type CoachClientEvent = {
  event_type: string
  actor_profile_id: string | null
  context: Record<string, any> | null
  created_at: string
}

// event_type (+ context) → a readable line. Falls back to the raw type for any
// future event the UI doesn't have copy for yet.
function describe(e: CoachClientEvent): string {
  const name = typeof e.context?.name === "string" ? e.context.name : null
  const withName = (label: string) => (name ? `${label} · ${name}` : label)
  switch (e.event_type) {
    case "prospect_created": return "Prospect created"
    case "stage_changed": return `Moved to stage: ${e.context?.stage_key ?? "—"}`
    case "converted_to_client": return "Converted to client"
    case "proposal_sent": return withName("Proposal sent")
    case "proposal_approved": return withName("Proposal approved")
    case "proposal_declined": return withName("Proposal declined")
    case "engagement_attached": return withName("Engagement attached")
    case "engagement_detached": return withName("Engagement detached")
    case "invite_sent": return "SIGNAL invite sent"
    default: return e.event_type
  }
}

// Relative time ("3 days ago"); the exact datetime rides along as a tooltip.
function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return "just now"
  // Walk up the units, dividing as we cross each threshold.
  let val = Math.floor(sec / 60)
  let label = "minute"
  const steps: [number, string][] = [[60, "hour"], [24, "day"], [30, "month"], [12, "year"]]
  for (const [factor, next] of steps) {
    if (val < factor) break
    val = Math.floor(val / factor)
    label = next
  }
  return `${val} ${label}${val === 1 ? "" : "s"} ago`
}
function exactTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString()
}

// ── Auth (same inline pattern as EngagementsTab) ──
async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
}

export function HistoryTab({ coachClientId }: { coachClientId: string | null }) {
  const [events, setEvents] = useState<CoachClientEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!coachClientId) { setLoading(false); setEvents([]); return } // benign empty
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/events`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load history (${res.status})`)
        return
      }
      setEvents(j.events || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [coachClientId])

  useEffect(() => { void load() }, [load])

  if (!coachClientId) {
    return <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>No activity logged yet.</p>
  }
  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading history…</p>
  }
  if (loadError) {
    return (
      <div>
        <div style={{ fontSize: 12, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>
          {loadError}
        </div>
        <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
      </div>
    )
  }
  if (events.length === 0) {
    return <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>No activity logged yet.</p>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {events.map((e, i) => (
        <div
          key={`${e.created_at}-${i}`}
          style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "9px 0",
            borderTop: i === 0 ? "none" : `1px solid ${T.BORDER_SOFT}`,
          }}
        >
          {/* Quiet timeline marker */}
          <span aria-hidden style={{ marginTop: 6, width: 6, height: 6, borderRadius: 999, background: T.DIM, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: T.TEXT }}>{describe(e)}</div>
            <div style={{ fontSize: 11, color: T.DIM, marginTop: 2 }} title={exactTime(e.created_at)}>
              {relTime(e.created_at)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
