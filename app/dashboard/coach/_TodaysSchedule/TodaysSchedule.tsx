"use client"

// Coach Home: Today's Schedule (Coach Calendar Integration, redesigned
// 2026-10-13 with a Today / Week toggle).
//
// Renders the coach's Outlook events via the /api/coach/calendar/* routes.
// Today is a time-ordered list; Week is Monday to Sunday as seven calendar
// columns, stacked into a day-by-day agenda on narrow screens. An event whose
// attendees include one of the coach's clients shows that client's name and
// opens the client's page; the rest show their meeting title.
//
// The only input is the server-derived isCalendarBetaEnabled boolean (Coach
// Home is client-rendered, so the env allowlist is resolved in /api/coach/home
// and passed down as this flag).
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §5, §6.8

import { useEffect, useState } from "react"
import Link from "next/link"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { T, card, btnPrimary, btnSecondary } from "@/lib/dashboard-theme"
import { CollapseToggle } from "../CollapseToggle"

type ScheduleState =
  | "idle"
  | "gated_off"
  | "not_connected"
  | "connecting"
  | "loading"
  | "loaded"
  | "reconnect_required"
  | "error_transient"

type View = "today" | "week"

type ConnectionMeta = {
  connected_email: string | null
  connected_display_name: string | null
  connected_at: string
}

type ScheduleClient = { name: string; href: string }

// The /api/coach/calendar/today event shape: CalendarEvent minus its attendee
// emails, plus the clients matched from them.
type ScheduleEvent = {
  id: string
  subject: string
  start: string
  end: string
  is_all_day: boolean
  location: string | null
  attendee_count: number
  is_online_meeting: boolean
  online_meeting_url: string | null
  organizer_email: string | null
  clients: ScheduleClient[]
}

interface TodaysScheduleProps {
  isCalendarBetaEnabled: boolean
}

const VIEW_KEY = "signal_coach_schedule_view"

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

function isPast(e: ScheduleEvent): boolean {
  const end = new Date(e.end).getTime()
  return !isNaN(end) && end < Date.now()
}

// Calendly writes "Mock Interview between Peri Ginsberg and Jane Doe" to
// Outlook. The part before "between" is the session type.
function sessionType(subject: string): string {
  return subject.replace(/\s+between\s+.+\s+and\s+.+$/i, "").trim()
}

// "YYYY-MM-DD" plus n days, as "YYYY-MM-DD". Date-only arithmetic in UTC so
// no local offset can shift the day.
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function dayParts(dateStr: string): { weekday: string; day: number; month: string } {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return {
    weekday: dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    day: d,
    month: dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
  }
}

function weekLabel(start: string): string {
  const a = dayParts(start)
  const b = dayParts(addDays(start, 6))
  return a.month === b.month ? `${a.month} ${a.day} to ${b.day}` : `${a.month} ${a.day} to ${b.month} ${b.day}`
}

// All-day first, then by start time.
function byStart(a: ScheduleEvent, b: ScheduleEvent): number {
  if (a.is_all_day !== b.is_all_day) return a.is_all_day ? -1 : 1
  return a.start.localeCompare(b.start)
}

// ── Chrome ───────────────────────────────────────────────────────────────────

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

// Layout rules that need media queries. Class names are prefixed ts- to stay
// clear of the rest of Coach Home.
const SCHEDULE_CSS = `
  .ts-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
  .ts-day { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px; border-radius: 12px; min-height: 140px; }
  .ts-day-head { display: flex; flex-direction: column; align-items: center; padding-bottom: 6px; }
  .ts-day-list { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .ts-session { display: block; text-decoration: none; color: inherit; transition: border-color 120ms ease, transform 120ms ease; }
  a.ts-session:hover { transform: translateY(-1px); border-color: ${T.WRN_ORANGE} !important; }
  .ts-today-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px; align-items: stretch; }
  @media (max-width: 900px) {
    .ts-week { grid-template-columns: 1fr; gap: 6px; }
    .ts-day { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: start; gap: 10px; min-height: 0; }
    .ts-day-head { padding-bottom: 0; }
  }
  @media (max-width: 480px) {
    .ts-today-row { grid-template-columns: 64px minmax(0, 1fr); gap: 8px; }
    .ts-header { flex-wrap: wrap; }
  }
`

function ScheduleCard({ children, headerRight }: { children: React.ReactNode; headerRight?: React.ReactNode }) {
  // Open on load; the chevron folds the card to its header for this visit.
  const [open, setOpen] = useState(true)
  return (
    <div style={{ ...card, padding: 20, marginBottom: 20, position: "relative" }}>
      <style>{SCHEDULE_CSS}</style>
      {/* Matches the accent rule <Section> draws, by hand, because this card
          predates that component and is not one. Teal is this section's
          identity in the dashboard scheme. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: T.SECTION_SCHEDULE,
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
        }}
      />
      <div className="ts-header" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: open ? 16 : 0 }}>
        <span style={{ display: "inline-flex", color: T.SECTION_SCHEDULE }}>
          <IconCalendar />
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, color: T.TEXT, letterSpacing: -0.2 }}>
          Today&apos;s schedule
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10 }}>
          {open && headerRight}
          <CollapseToggle open={open} onToggle={() => setOpen((v) => !v)} label="Today's schedule" />
        </span>
      </div>
      <div style={{ display: open ? "block" : "none" }}>{children}</div>
    </div>
  )
}

// Subtle dashed nested box, reused for the placeholder / prompt states.
function NestedBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 20,
        background: T.GLASS,
        border: `1px dashed ${T.BORDER_SOFT}`,
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const opts: { key: View; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "Week" },
  ]
  return (
    <div
      role="group"
      aria-label="Schedule range"
      style={{
        display: "inline-flex", padding: 3, borderRadius: 999,
        background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`,
      }}
    >
      {opts.map((o) => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            style={{
              border: "none", borderRadius: 999, padding: "6px 16px",
              fontSize: 12, fontWeight: 800, letterSpacing: 0.2, fontFamily: "inherit",
              cursor: on ? "default" : "pointer",
              background: on ? T.WRN_ORANGE : "transparent",
              color: on ? "var(--sig-ink-on-bright, #04060F)" : T.MUTED,
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Session cards ────────────────────────────────────────────────────────────

// One event. A client match makes it a link to that client, with an orange
// rule; anything else is a plain card with a blue rule. Past events fade.
function SessionCard({ e, compact }: { e: ScheduleEvent; compact: boolean }) {
  const client = e.clients[0] ?? null
  const type = sessionType(e.subject || "") || "(no title)"
  const title = client ? client.name : type
  const extra = e.clients.length > 1 ? ` +${e.clients.length - 1}` : ""
  const style: React.CSSProperties = {
    padding: compact ? "7px 9px" : "10px 14px",
    borderRadius: 10,
    background: T.GLASS,
    border: `1px solid ${T.BORDER_SOFT}`,
    borderLeft: `3px solid ${client ? T.WRN_ORANGE : T.WRN_BLUE}`,
    opacity: isPast(e) ? 0.55 : 1,
    minWidth: 0,
  }
  const body = (
    <>
      {compact && (
        <div style={{ fontSize: 11, fontWeight: 800, color: client ? T.INK_EMPHASIS : T.INK_LINK, fontVariantNumeric: "tabular-nums" }}>
          {e.is_all_day ? "All day" : formatTime(e.start)}
        </div>
      )}
      <div
        style={{
          fontSize: compact ? 12 : 14, fontWeight: 700, color: T.TEXT,
          marginTop: compact ? 2 : 0, overflowWrap: "anywhere", lineHeight: 1.3,
        }}
      >
        {title}{extra}
      </div>
      {client && (
        <div style={{ fontSize: compact ? 11 : 12, color: T.MUTED, marginTop: 2, overflowWrap: "anywhere", lineHeight: 1.3 }}>
          {type}
        </div>
      )}
      {!compact && (e.is_online_meeting || e.location) && (
        <div style={{ fontSize: 11, color: T.DIM, marginTop: 4, overflowWrap: "anywhere" }}>
          {e.is_online_meeting ? "Online meeting" : e.location}
        </div>
      )}
    </>
  )
  return client ? (
    <Link href={client.href} className="ts-session" style={style} title={`Open ${client.name}`}>
      {body}
    </Link>
  ) : (
    <div className="ts-session" style={style}>{body}</div>
  )
}

function TodayList({ events }: { events: ScheduleEvent[] }) {
  if (events.length === 0) {
    return (
      <NestedBox>
        <p style={{ fontSize: 13, color: T.MUTED, margin: 0, textAlign: "center" }}>
          Nothing on your calendar today
        </p>
      </NestedBox>
    )
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {events.map((e) => (
        <div key={e.id} className="ts-today-row">
          <div style={{ paddingTop: 10, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.TEXT }}>
              {e.is_all_day ? "All day" : formatTime(e.start)}
            </div>
            {!e.is_all_day && (
              <div style={{ fontSize: 11, color: T.DIM, marginTop: 2 }}>{formatTime(e.end)}</div>
            )}
          </div>
          <SessionCard e={e} compact={false} />
        </div>
      ))}
    </div>
  )
}

function WeekGrid({ events, rangeStart, today }: { events: ScheduleEvent[]; rangeStart: string; today: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i))
  const byDay = new Map<string, ScheduleEvent[]>(days.map((d) => [d, []]))
  for (const e of events) {
    // An all-day event that began before Monday sits on Monday.
    const key = e.start.slice(0, 10) < rangeStart ? rangeStart : e.start.slice(0, 10)
    byDay.get(key)?.push(e)
  }
  return (
    <div className="ts-week">
      {days.map((d) => {
        const p = dayParts(d)
        const isToday = d === today
        const list = byDay.get(d) ?? []
        return (
          <div
            key={d}
            className="ts-day"
            style={{
              background: isToday ? "rgba(254,176,106,0.10)" : T.GLASS,
              border: `1px solid ${isToday ? T.WRN_ORANGE : T.BORDER_SOFT}`,
            }}
          >
            <div className="ts-day-head">
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: isToday ? T.INK_EMPHASIS : T.MUTED }}>
                {p.weekday}
              </span>
              <span
                style={{
                  marginTop: 2, width: 28, height: 28, borderRadius: "50%",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 800,
                  background: isToday ? T.WRN_ORANGE : "transparent",
                  color: isToday ? "var(--sig-ink-on-bright, #04060F)" : T.TEXT,
                }}
              >
                {p.day}
              </span>
            </div>
            <div className="ts-day-list">
              {list.length === 0 ? (
                <span style={{ fontSize: 11, color: T.DIM, textAlign: "center", padding: "6px 0" }}>No sessions</span>
              ) : (
                list.map((e) => <SessionCard key={e.id} e={e} compact />)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function TodaysSchedule({ isCalendarBetaEnabled }: TodaysScheduleProps) {
  const [state, setState] = useState<ScheduleState>("idle")
  const [view, setView] = useState<View>("today")
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [rangeStart, setRangeStart] = useState<string | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionMeta | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  async function fetchSchedule(v: View = view) {
    setState("loading")
    setRetryAfter(null)
    try {
      const token = await getToken()
      const res = await fetch(
        `/api/coach/calendar/today?tz=${encodeURIComponent(BROWSER_TZ)}&range=${v}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      )
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
      const evts: ScheduleEvent[] = Array.isArray(data.events) ? data.events : []
      setEvents([...evts].sort(byStart))
      setRangeStart(typeof data.range_start === "string" ? data.range_start : null)
      setToday(typeof data.today === "string" ? data.today : null)
      setState("loaded")
    } catch {
      setState("error_transient")
    }
  }

  function changeView(v: View) {
    if (v === view) return
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* per-viewer convenience only */ }
    fetchSchedule(v)
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

  // Mount: process OAuth round-trip query params, restore the view, then
  // gate + fetch.
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

    let saved: View = "today"
    try { if (localStorage.getItem(VIEW_KEY) === "week") saved = "week" } catch { /* default */ }
    setView(saved)

    if (isCalendarBetaEnabled) {
      fetchSchedule(saved)
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
        color: T.ERROR,
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

  const toggle = <ViewToggle value={view} onChange={changeView} />

  if (state === "idle" || state === "loading") {
    return (
      <ScheduleCard headerRight={toggle}>
        {banner}
        <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>
          {view === "week" ? "Loading this week…" : "Loading today's schedule…"}
        </p>
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
            See today&apos;s and this week&apos;s sessions at a glance, refreshed every time you load this page.
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
            Your Outlook connection expired. Reconnect to keep seeing your schedule.
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
      <ScheduleCard headerRight={toggle}>
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
            onClick={() => fetchSchedule()}
            style={{ ...btnSecondary, marginTop: 14, cursor: "pointer" }}
          >
            Retry
          </button>
        </NestedBox>
      </ScheduleCard>
    )
  }

  // loaded
  return (
    <ScheduleCard headerRight={toggle}>
      {banner}
      {view === "week" && rangeStart && (
        <div style={{ fontSize: 12, fontWeight: 700, color: T.MUTED, marginBottom: 10 }}>
          This week, {weekLabel(rangeStart)}
        </div>
      )}

      {view === "week" && rangeStart && today ? (
        <WeekGrid events={events} rangeStart={rangeStart} today={today} />
      ) : (
        <TodayList events={events} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={() => fetchSchedule()} style={{ ...btnSecondary, cursor: "pointer" }}>
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
        {connection?.connected_email && (
          <span style={{ fontSize: 11, color: T.MUTED, marginLeft: "auto" }}>
            Connected as {connection.connected_email}
          </span>
        )}
      </div>
    </ScheduleCard>
  )
}
