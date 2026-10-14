"use client"

// Coach Home: Today's Schedule (Coach Calendar Integration, redesigned
// 2026-10-13 with a Today / Week toggle, made compact the same day).
//
// Renders the coach's Outlook events via the /api/coach/calendar/* routes.
// Today is one line per event: time, the client's name (bold navy, opens the
// client's page), the session type, and Join when the event has a meeting
// link. The next session to start says "Next up"; ended ones dim. Events with
// none of the coach's clients among their attendees are "personal": one small
// gray line, hidden unless "Show personal" is on. Week is Monday to Sunday as
// seven columns of small chips, stacked into a day-by-day agenda on narrow
// screens. Refresh, the connected account and Disconnect sit in a menu.
//
// The only input is the server-derived isCalendarBetaEnabled boolean (Coach
// Home is client-rendered, so the env allowlist is resolved in /api/coach/home
// and passed down as this flag).
//
// FRD: docs/Features/coach-calendar-integration-v0-1-frd.md §5, §6.8

import { useEffect, useRef, useState } from "react"
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
// emails, plus the clients matched from them and the session type.
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
  session_type: string | null
  clients: ScheduleClient[]
}

interface TodaysScheduleProps {
  isCalendarBetaEnabled: boolean
}

const VIEW_KEY = "signal_coach_schedule_view"
const PERSONAL_KEY = "signal_coach_schedule_personal"

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

// "9:30a", "2p": for the week chips.
function shortTime(iso: string): string {
  return formatTime(iso).replace(":00", "").replace(/\s?([AP])M$/i, (_, x: string) => x.toLowerCase())
}

function isPast(e: ScheduleEvent, now: number): boolean {
  const end = new Date(e.end).getTime()
  return !isNaN(end) && end < now
}

// Personal = none of the coach's clients among the attendees.
function isPersonal(e: ScheduleEvent): boolean {
  return e.clients.length === 0
}

// The first timed event that has not started yet.
function nextUpId(events: ScheduleEvent[], now: number): string | null {
  for (const e of events) {
    if (e.is_all_day) continue
    const start = new Date(e.start).getTime()
    if (!isNaN(start) && start > now) return e.id
  }
  return null
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

// Layout rules that need media queries or :hover. Class names are prefixed
// ts- to stay clear of the rest of Coach Home.
const SCHEDULE_CSS = `
  .ts-row { display: grid; grid-template-columns: 70px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 8px; min-height: 34px; }
  .ts-row--client:hover { background: ${T.ROW_HOVER}; }
  .ts-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .ts-name { text-decoration: none; }
  .ts-name:hover { text-decoration: underline; }
  .ts-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
  .ts-day { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 6px; border-radius: 10px; min-height: 96px; }
  .ts-day-head { display: flex; align-items: baseline; justify-content: center; gap: 4px; padding-bottom: 2px; }
  .ts-day-list { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .ts-chip { display: block; padding: 3px 6px; border-radius: 6px; font-size: 11px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
  a.ts-chip:hover { background: ${T.ROW_HOVER} !important; }
  @media (max-width: 900px) {
    .ts-week { grid-template-columns: 1fr; }
    .ts-day { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: start; gap: 8px; min-height: 0; }
    .ts-day-head { justify-content: flex-start; padding: 3px 0 0; }
  }
  @media (max-width: 480px) {
    .ts-row { grid-template-columns: 58px minmax(0, 1fr) auto; gap: 8px; padding: 6px 4px; }
    .ts-header { flex-wrap: wrap; }
  }
`

function ScheduleCard({ children, headerRight }: { children: React.ReactNode; headerRight?: React.ReactNode }) {
  // Open on load; the chevron folds the card to its header for this visit.
  const [open, setOpen] = useState(true)
  return (
    // overflow visible: the card's own overflow:hidden would clip the menu.
    <div style={{ ...card, padding: 20, marginBottom: 20, position: "relative", overflow: "visible" }}>
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
      <div className="ts-header" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: open ? 14 : 0 }}>
        <span style={{ display: "inline-flex", color: T.SECTION_SCHEDULE }}>
          <IconCalendar />
        </span>
        <span style={{ fontSize: 16, fontWeight: 600, color: T.TEXT, letterSpacing: -0.2 }}>
          Schedule
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
          {open && headerRight}
          <CollapseToggle open={open} onToggle={() => setOpen((v) => !v)} label="Schedule" />
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

// ── Menu ─────────────────────────────────────────────────────────────────────

// Refresh, Disconnect and the connected account, folded behind one button so
// they do not take a row under the schedule.
function ScheduleMenu({ email, onRefresh, onDisconnect }: { email: string | null; onRefresh: () => void; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (ev: MouseEvent) => { if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false) }
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", esc)
    }
  }, [open])
  const item: React.CSSProperties = {
    display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
    padding: "8px 12px", fontSize: 13, color: T.TEXT, cursor: "pointer", fontFamily: "inherit", borderRadius: 6,
  }
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label="Schedule options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: 999, padding: 0, cursor: "pointer",
          background: "transparent", border: `1px solid ${T.BORDER_SOFT}`, color: T.MUTED,
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: 36, zIndex: 20, minWidth: 220, padding: 4,
            background: T.CARD, border: `1px solid ${T.BORDER}`, borderRadius: 10,
            boxShadow: "0 8px 24px rgba(8,32,63,0.14)",
          }}
        >
          <button type="button" role="menuitem" style={item} onClick={() => { setOpen(false); onRefresh() }}>
            Refresh
          </button>
          <button type="button" role="menuitem" style={{ ...item, color: T.MUTED }} onClick={() => { setOpen(false); onDisconnect() }}>
            Disconnect Outlook
          </button>
          {email && (
            <div
              style={{
                padding: "8px 12px 6px", marginTop: 4, borderTop: `1px solid ${T.BORDER_SOFT}`,
                fontSize: 11, color: T.DIM, overflowWrap: "anywhere",
              }}
            >
              Connected as {email}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PersonalSwitch({ on, count, onChange }: { on: boolean; count: number; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none",
        padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: T.MUTED,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "relative", display: "inline-block", width: 30, height: 18, borderRadius: 999,
          background: on ? T.WRN_ORANGE : T.BORDER, transition: "background 120ms ease",
        }}
      >
        <span
          style={{
            position: "absolute", top: 2, left: on ? 14 : 2, width: 14, height: 14, borderRadius: "50%",
            background: "#FFFFFF", boxShadow: "0 1px 2px rgba(0,0,0,0.25)", transition: "left 120ms ease",
          }}
        />
      </span>
      Show personal ({count})
    </button>
  )
}

// ── Today ────────────────────────────────────────────────────────────────────

function TodayRow({ e, now, nextUp }: { e: ScheduleEvent; now: number; nextUp: boolean }) {
  const client = e.clients[0] ?? null
  const time = e.is_all_day ? "All day" : formatTime(e.start)
  const dim = isPast(e, now) ? 0.5 : 1
  if (!client) {
    return (
      <div className="ts-row" style={{ opacity: dim, minHeight: 26, padding: "3px 10px" }}>
        <span style={{ fontSize: 12, color: T.DIM, fontVariantNumeric: "tabular-nums" }}>{time}</span>
        <span className="ts-line" style={{ fontSize: 12, color: T.DIM }}>{e.subject || "(no title)"}</span>
        <span />
      </div>
    )
  }
  const extra = e.clients.length > 1 ? ` +${e.clients.length - 1}` : ""
  return (
    <div className="ts-row ts-row--client" style={{ opacity: dim, background: nextUp ? T.ORANGE_GLOW : undefined }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: T.TEXT, fontVariantNumeric: "tabular-nums" }}>{time}</span>
      <span className="ts-line" style={{ fontSize: 14 }}>
        <Link href={client.href} className="ts-name" style={{ fontWeight: 800, color: T.INK_EMPHASIS }} title={`Open ${client.name}`}>
          {client.name}{extra}
        </Link>
        {e.session_type && <span style={{ color: T.MUTED }}>{"  ·  "}{e.session_type}</span>}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {nextUp && (
          <span
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase",
              padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
              background: T.WRN_ORANGE, color: "var(--sig-ink-on-bright, #04060F)",
            }}
          >
            Next up
          </span>
        )}
        {e.online_meeting_url && !isPast(e, now) && (
          <a
            href={e.online_meeting_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12, fontWeight: 800, padding: "5px 12px", borderRadius: 999, whiteSpace: "nowrap",
              background: T.GRAD_PRIMARY, color: "#FFFFFF", textDecoration: "none",
            }}
          >
            Join
          </a>
        )}
      </span>
    </div>
  )
}

function TodayList({ events, now, emptyText }: { events: ScheduleEvent[]; now: number; emptyText: string }) {
  if (events.length === 0) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: "4px 0", textAlign: "center" }}>{emptyText}</p>
  }
  const next = nextUpId(events.filter((e) => !isPersonal(e)), now)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {events.map((e) => <TodayRow key={e.id} e={e} now={now} nextUp={e.id === next} />)}
    </div>
  )
}

// ── Week ─────────────────────────────────────────────────────────────────────

function WeekChip({ e, now }: { e: ScheduleEvent; now: number }) {
  const client = e.clients[0] ?? null
  const time = e.is_all_day ? "All day" : shortTime(e.start)
  const style: React.CSSProperties = {
    opacity: isPast(e, now) ? 0.5 : 1,
    background: client ? T.CARD : "transparent",
    border: `1px solid ${client ? T.BORDER : "transparent"}`,
    borderLeft: client ? `3px solid ${T.WRN_ORANGE}` : undefined,
  }
  if (!client) {
    return (
      <span className="ts-chip" style={{ ...style, color: T.DIM }} title={e.subject}>
        {time} {e.subject || "(no title)"}
      </span>
    )
  }
  const label = `${time} ${client.name}${e.session_type ? `, ${e.session_type}` : ""}`
  return (
    <Link href={client.href} className="ts-chip" style={style} title={label}>
      <span style={{ fontWeight: 700, color: T.MUTED, fontVariantNumeric: "tabular-nums" }}>{time}</span>{" "}
      <span style={{ fontWeight: 800, color: T.INK_EMPHASIS }}>{client.name}</span>
    </Link>
  )
}

function WeekGrid({ events, rangeStart, today, now }: { events: ScheduleEvent[]; rangeStart: string; today: string; now: number }) {
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
              background: isToday ? T.ORANGE_GLOW : T.GLASS,
              border: `1px solid ${isToday ? T.WRN_ORANGE : T.BORDER_SOFT}`,
            }}
          >
            <div className="ts-day-head">
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: isToday ? T.INK_EMPHASIS : T.MUTED }}>
                {p.weekday}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: isToday ? T.INK_EMPHASIS : T.TEXT }}>{p.day}</span>
            </div>
            <div className="ts-day-list">
              {list.length === 0 ? (
                <span style={{ fontSize: 11, color: T.DIM, textAlign: "center", padding: "2px 0" }}>No sessions</span>
              ) : (
                list.map((e) => <WeekChip key={e.id} e={e} now={now} />)
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
  const [showPersonal, setShowPersonal] = useState(false)

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

  function changePersonal(v: boolean) {
    setShowPersonal(v)
    try { localStorage.setItem(PERSONAL_KEY, v ? "1" : "0") } catch { /* not remembered */ }
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

  // Mount: process OAuth round-trip query params, restore the view and the
  // personal switch, then gate + fetch.
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
    try { setShowPersonal(localStorage.getItem(PERSONAL_KEY) === "1") } catch { /* default off */ }

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
  const now = Date.now()
  const personalCount = events.filter(isPersonal).length
  const shown = showPersonal ? events : events.filter((e) => !isPersonal(e))
  const week = view === "week" && rangeStart && today ? { rangeStart, today } : null
  return (
    <ScheduleCard
      headerRight={
        <>
          {toggle}
          <ScheduleMenu
            email={connection?.connected_email ?? null}
            onRefresh={() => fetchSchedule()}
            onDisconnect={handleDisconnect}
          />
        </>
      }
    >
      {banner}
      {(week || personalCount > 0) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.MUTED }}>
            {week ? `This week, ${weekLabel(week.rangeStart)}` : ""}
          </span>
          {personalCount > 0 && <PersonalSwitch on={showPersonal} count={personalCount} onChange={changePersonal} />}
        </div>
      )}

      {week ? (
        <WeekGrid events={shown} rangeStart={week.rangeStart} today={week.today} now={now} />
      ) : (
        <TodayList
          events={shown}
          now={now}
          emptyText={events.length ? "No client sessions today" : "Nothing on your calendar today"}
        />
      )}
    </ScheduleCard>
  )
}
