"use client"

// Coach Home — Today's Schedule (Phase 1e of the Coach Calendar Integration).
//
// Replaces the static "Calendar integration coming soon" placeholder. Renders
// today's Outlook events for a beta-gated coach via the /api/coach/calendar/*
// routes. Self-contained 9-state machine; the only input is the server-derived
// isCalendarBetaEnabled boolean (Coach Home is client-rendered, so the env
// allowlist is resolved in /api/coach/home and passed down as this flag).
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §5, §6.8

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { T, card, btnPrimary, btnSecondary } from "@/lib/dashboard-theme"
import type { CalendarEvent } from "@/lib/coach/microsoftGraph"

type ScheduleState =
  | "idle"
  | "gated_off"
  | "not_connected"
  | "connecting"
  | "loading"
  | "loaded_with_events"
  | "loaded_empty"
  | "reconnect_required"
  | "error_transient"

type ConnectionMeta = {
  connected_email: string | null
  connected_display_name: string | null
  connected_at: string
}

interface TodaysScheduleProps {
  isCalendarBetaEnabled: boolean
}

// Mirror the page.tsx getToken() pattern (helpers there aren't exported):
// Supabase session lives in localStorage; fall back to the handoff token.
async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return typeof window !== "undefined" ? sessionStorage.getItem("signal_handoff_token") : null
}

function mapErrorCode(code: string): string {
  switch (code) {
    case "state_mismatch":
      return "Connection attempt failed (security check). Please try again."
    case "consent_denied":
      return "Calendar not connected. You can try again anytime."
    case "token_exchange_failed":
      return "Couldn't connect to Microsoft. Please try again."
    case "identity_fetch_failed":
      return "Couldn't read your Microsoft account info. Please try again."
    case "storage_failed":
      return "Couldn't save your connection. Please try again."
    default:
      return "Something went wrong. Please try again."
  }
}

const BROWSER_TZ =
  (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC"

// Graph returns naive wall-clock datetimes in the requested tz (no offset), and
// we requested BROWSER_TZ — so new Date() interprets them in the same local tz
// we display in. No explicit timeZone on the formatter (avoids double-applying).
function formatTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

function formatRange(start: string, end: string): string {
  const s = formatTime(start)
  const e = formatTime(end)
  if (s && e) return `${s} – ${e}`
  return s || e || ""
}

function truncate(s: string, max = 40): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

// ── Section wrapper (mirrors page.tsx <Section icon title="Today's schedule">)
function IconCalendar() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M4 11h16" />
      <path d="M11 15h1" />
      <path d="M12 15v3" />
    </svg>
  )
}

function ScheduleCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...card, padding: 20, marginBottom: 20, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ display: "inline-flex", color: T.WRN_ORANGE }}>
          <IconCalendar />
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, color: T.TEXT, letterSpacing: -0.2 }}>
          Today&apos;s schedule
        </span>
      </div>
      {children}
    </div>
  )
}

// Subtle dashed nested box, reused for the placeholder / prompt states.
function NestedBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 20,
        background: "rgba(255,255,255,0.03)",
        border: `1px dashed ${T.BORDER_SOFT}`,
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  )
}

export function TodaysSchedule({ isCalendarBetaEnabled }: TodaysScheduleProps) {
  const [state, setState] = useState<ScheduleState>("idle")
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [connection, setConnection] = useState<ConnectionMeta | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  // Collapse-by-default: show the first 5 of today's events; "Show all"
  // reveals the rest. Render-only, client-side over already-fetched events.
  const [expanded, setExpanded] = useState(false)

  async function fetchToday() {
    setState("loading")
    setRetryAfter(null)
    try {
      const token = await getToken()
      const res = await fetch(`/api/coach/calendar/today?tz=${encodeURIComponent(BROWSER_TZ)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 404) {
        setState("not_connected")
        return
      }
      if (res.status === 401) {
        const body = await res.json().catch(() => ({}))
        setState(body?.error === "reconnect_required" ? "reconnect_required" : "error_transient")
        return
      }
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}))
        setRetryAfter(typeof body?.retry_after_seconds === "number" ? body.retry_after_seconds : 60)
        setState("error_transient")
        return
      }
      if (!res.ok) {
        setState("error_transient")
        return
      }
      const data = await res.json()
      setConnection(data.connection ?? null)
      const evts: CalendarEvent[] = Array.isArray(data.events) ? data.events : []
      setEvents(evts)
      setState(evts.length > 0 ? "loaded_with_events" : "loaded_empty")
    } catch {
      setState("error_transient")
    }
  }

  async function handleConnect() {
    setState("connecting")
    setErrorBanner(null)
    try {
      const token = await getToken()
      const res = await fetch("/api/coach/calendar/connect", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      })
      if (!res.ok) {
        setState("error_transient")
        return
      }
      const { authorize_url } = await res.json()
      if (!authorize_url) {
        setState("error_transient")
        return
      }
      // Navigate to Microsoft. The state cookie set by this fetch response
      // persists across the navigation (normal browser cookie behavior).
      window.location.href = authorize_url
    } catch {
      setState("error_transient")
    }
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect your Outlook calendar from SIGNAL? You can reconnect anytime.")) {
      return
    }
    try {
      const token = await getToken()
      const res = await fetch("/api/coach/calendar/disconnect", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok || res.status === 404) {
        setEvents([])
        setConnection(null)
        setState("not_connected")
      } else {
        console.warn("[TodaysSchedule] disconnect failed:", res.status)
      }
    } catch (err) {
      console.warn("[TodaysSchedule] disconnect failed:", err)
    }
  }

  // Mount: process OAuth round-trip query params, then gate + fetch.
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      let mutated = false
      if (url.searchParams.get("calendar_connected") === "1") {
        url.searchParams.delete("calendar_connected")
        mutated = true
      }
      const errCode = url.searchParams.get("calendar_error")
      if (errCode) {
        setErrorBanner(mapErrorCode(errCode))
        url.searchParams.delete("calendar_error")
        mutated = true
      }
      if (mutated) window.history.replaceState({}, "", url.toString())
    } catch {
      /* no-op: query-param cleanup is best-effort */
    }

    if (isCalendarBetaEnabled) {
      fetchToday()
    } else {
      setState("gated_off")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  const banner = errorBanner ? (
    <div
      style={{
        padding: "8px 12px",
        marginBottom: 12,
        borderRadius: 8,
        background: "rgba(248,113,113,0.10)",
        border: "1px solid rgba(248,113,113,0.35)",
        fontSize: 12,
        color: "#fca5a5",
      }}
    >
      {errorBanner}
    </div>
  ) : null

  // gated_off — unchanged static placeholder for non-beta coaches.
  if (state === "gated_off") {
    return (
      <ScheduleCard>
        <NestedBox>
          <p style={{ fontSize: 13, color: T.MUTED, fontStyle: "italic", margin: 0, textAlign: "center" }}>
            Calendar integration coming soon
          </p>
          <p style={{ fontSize: 12, color: T.DIM, marginTop: 6, marginBottom: 0, textAlign: "center" }}>
            Sessions, prep blocks, and mock interviews will appear here
          </p>
        </NestedBox>
      </ScheduleCard>
    )
  }

  if (state === "idle" || state === "loading") {
    return (
      <ScheduleCard>
        {banner}
        <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>Loading today&apos;s schedule…</p>
      </ScheduleCard>
    )
  }

  if (state === "not_connected" || state === "connecting") {
    const connecting = state === "connecting"
    return (
      <ScheduleCard>
        {banner}
        <NestedBox>
          <p style={{ fontSize: 14, fontWeight: 600, color: T.TEXT, margin: 0 }}>
            Connect your Outlook calendar
          </p>
          <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, marginBottom: 0 }}>
            See today&apos;s events at a glance, refreshed every time you load this page.
          </p>
          <p style={{ fontSize: 12, color: T.DIM, marginTop: 8, marginBottom: 16 }}>
            SIGNAL will read your calendar events only. We do not share this with your clients
            or other coaches. You can disconnect at any time.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            style={{ ...btnPrimary, opacity: connecting ? 0.6 : 1, cursor: connecting ? "default" : "pointer" }}
          >
            {connecting ? "Redirecting…" : "Connect Outlook"}
          </button>
        </NestedBox>
      </ScheduleCard>
    )
  }

  if (state === "reconnect_required") {
    return (
      <ScheduleCard>
        {banner}
        <NestedBox>
          <p style={{ fontSize: 14, fontWeight: 600, color: T.TEXT, margin: 0 }}>
            Reconnect your calendar
          </p>
          <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, marginBottom: 16 }}>
            Your Outlook connection expired. Reconnect to keep seeing today&apos;s schedule.
          </p>
          <button type="button" onClick={handleConnect} style={{ ...btnPrimary, cursor: "pointer" }}>
            Reconnect Outlook
          </button>
        </NestedBox>
      </ScheduleCard>
    )
  }

  if (state === "error_transient") {
    return (
      <ScheduleCard>
        {banner}
        <NestedBox>
          <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Couldn&apos;t load schedule.</p>
          {retryAfter != null && (
            <p style={{ fontSize: 12, color: T.DIM, marginTop: 6, marginBottom: 0 }}>
              Try again in {retryAfter} seconds.
            </p>
          )}
          <button
            type="button"
            onClick={fetchToday}
            style={{ ...btnSecondary, marginTop: 14, cursor: "pointer" }}
          >
            Retry
          </button>
        </NestedBox>
      </ScheduleCard>
    )
  }

  // loaded_with_events / loaded_empty — shared chrome.
  const allDay = events.filter((e) => e.is_all_day)
  const timed = events.filter((e) => !e.is_all_day)
  // Display order = all-day first, then timed (matches the rendered order); the
  // collapse slices THIS, not the raw events array, so "first 5" = first 5 shown.
  const ordered = [...allDay, ...timed]
  const visible = expanded ? ordered : ordered.slice(0, 5)

  return (
    <ScheduleCard>
      {banner}
      {connection?.connected_email && (
        <div style={{ fontSize: 11, color: T.MUTED, textAlign: "right", marginBottom: 10 }}>
          Connected as {connection.connected_email}
        </div>
      )}

      {events.length === 0 ? (
        <NestedBox>
          <p style={{ fontSize: 13, color: T.MUTED, margin: 0, textAlign: "center" }}>
            Nothing on your calendar today
          </p>
        </NestedBox>
      ) : (
        <>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((e) => {
            if (e.is_all_day) {
              return (
                <li
                  key={e.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${T.BORDER_SOFT}`,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.DIM, letterSpacing: 0.4 }}>ALL DAY</div>
                  <div style={{ fontSize: 13, color: T.TEXT, marginTop: 2 }}>{truncate(e.subject || "(no title)")}</div>
                </li>
              )
            }
            const attendeeLabel = e.attendee_count > 1 ? `${e.attendee_count} attendees` : null
            return (
              <li
                key={e.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${T.BORDER_SOFT}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: T.DIM, fontVariantNumeric: "tabular-nums", minWidth: 124 }}>
                    {formatRange(e.start, e.end)}
                  </span>
                  <span style={{ fontSize: 13, color: T.TEXT, fontWeight: 500 }}>
                    {truncate(e.subject || "(no title)")}
                  </span>
                  {attendeeLabel && (
                    <span style={{ fontSize: 11, color: T.MUTED }}>{attendeeLabel}</span>
                  )}
                  {e.is_online_meeting && (
                    <span style={{ fontSize: 11, color: T.MUTED }} title="Online meeting">📹</span>
                  )}
                </div>
                {e.location && !e.is_online_meeting && (
                  <div style={{ fontSize: 11, color: T.DIM, marginTop: 4 }}>{truncate(e.location, 50)}</div>
                )}
              </li>
            )
          })}
        </ul>
        {ordered.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: 16, background: "none", border: "none", padding: 0,
              fontSize: 12, fontWeight: 700, color: T.WRN_BLUE, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {expanded ? "Show less" : `Show all (${ordered.length} events)`}
          </button>
        )}
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
        <button type="button" onClick={fetchToday} style={{ ...btnSecondary, cursor: "pointer" }}>
          Refresh
        </button>
        <button
          type="button"
          onClick={handleDisconnect}
          style={{
            background: "transparent",
            border: "none",
            color: T.DIM,
            fontSize: 12,
            textDecoration: "underline",
            cursor: "pointer",
            padding: 0,
          }}
        >
          Disconnect
        </button>
      </div>
    </ScheduleCard>
  )
}
