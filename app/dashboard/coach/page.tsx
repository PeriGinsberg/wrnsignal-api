"use client"

// Coach Home. Redesigned 2026-10-13 to four blocks under the header:
//
//   Top ribbon (client search, Add Client, Add Prospect), then the date
//   eyebrow and "Welcome back, {firstName}", then
//   1. Today's schedule: Outlook events with a Today / Week toggle.
//   2. Clients by phase.
//   3. My active tasks.
//   4. Follow-ups due.
//
// The metric tiles and the My clients / My prospects lists came off this page
// in that redesign. Their own pages (Clients, Prospects, Applications) are
// unchanged, and /api/coach/home still returns their data.

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import CreateClientModal from "./CreateClientModal"
import AddProspectModal from "./prospects/AddProspectModal"
import { CoachTopRibbon } from "./CoachTopRibbon"
import { T, card, eyebrow } from "../../../lib/dashboard-theme"
import { TaskCard } from "./_tasks/TaskCard"
import { ClientsByPhaseBlock, FollowUpsBlock, usePlanBlocks } from "./_plan/HomeBlocks"
import { LoadingShell } from "./LoadingShell"
import { TodaysSchedule } from "./_TodaysSchedule/TodaysSchedule"

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

// The part of the /api/coach/home response this page reads.
type CoachHome = {
  ok: boolean
  coach: { firstName: string; fullName: string | null }
  // Phase 1e (Coach Calendar Integration): server-derived beta gate. Coach Home
  // is client-rendered, so CALENDAR_BETA_PROFILE_IDS is parsed in the route and
  // surfaced as this boolean for the TodaysSchedule component.
  calendar_beta_enabled: boolean
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

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

function todayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

// ──────────────────────────────────────────────────────────────
// Inline icons (Tabler-style outline, 1.5px stroke, currentColor)
// ──────────────────────────────────────────────────────────────

const IconBell = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 5a2 2 0 1 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />
    <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
  </svg>
)

const IconClipboardCheck = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5H7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2V7a2 2 0 0 0 -2 -2h-2" />
    <path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" />
    <path d="M9 14l2 2l4 -4" />
  </svg>
)

// ──────────────────────────────────────────────────────────────
// Reusable atoms
// ──────────────────────────────────────────────────────────────

function CountPill({ n, color = T.WRN_ORANGE }: { n: number; color?: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 900, letterSpacing: 0.4,
      color: "var(--sig-ink-on-bright, #04060F)", background: color,
      padding: "2px 8px", borderRadius: 999, marginLeft: 8,
    }}>
      {n}
    </span>
  )
}

// Section wrapper: card + header (icon + title + optional count + slot for actions).
// `accentColor` controls the icon color and a 2px top-edge accent strip
// — used by the Action Items / Engagement Signals pair on Coach Home to
// reinforce the column distinction. Other sections (Today's Schedule,
// My Clients) omit the prop and render with the default orange icon and
// no top strip.
// Phase 2 Commit 2.5 — Section title is clickable when `titleHref` is
// provided. Hover affordance: underline appears on the title text only,
// no color shift, no row-level change. Today's Schedule (a placeholder
// section) intentionally omits titleHref → renders plain text.
function Section({
  icon, title, titleHref, count, headerRight, children, accentColor, noBottomMargin, allowOverflow,
}: {
  icon: React.ReactNode
  title: string
  titleHref?: string
  count?: number
  headerRight?: React.ReactNode
  children: React.ReactNode
  accentColor?: string
  noBottomMargin?: boolean
  // Set true ONLY on sections that host dropdowns/popovers — bypasses
  // the overflow:hidden on `card` so the menu can extend past the
  // section's bottom edge without being clipped. Surfaced by 6.1
  // testing: viewport-collision-aware placement isn't enough on its
  // own when an ancestor card clips the dropdown before it hits the
  // viewport edge. Future v1.1 portal refactor will eliminate this
  // need by mounting dropdowns at document.body, escaping every
  // overflow:hidden ancestor.
  allowOverflow?: boolean
}) {
  const iconColor = accentColor ?? T.WRN_ORANGE
  const [titleHovered, setTitleHovered] = useState(false)
  const titleSpan = (
    <span
      style={{
        fontSize: 16,
        fontWeight: 600,
        color: T.TEXT,
        letterSpacing: -0.2,
        textDecoration: titleHref && titleHovered ? "underline" : "none",
        cursor: titleHref ? "pointer" : "default",
      }}
    >
      {title}
    </span>
  )
  return (
    <div
      style={{
        ...card,
        padding: 20,
        marginBottom: noBottomMargin ? 0 : 20,
        position: "relative",
        ...(allowOverflow ? { overflow: "visible" } : {}),
      }}
    >
      {accentColor && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: accentColor,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ display: "inline-flex", color: iconColor }}>{icon}</span>
        {titleHref ? (
          <Link
            href={titleHref}
            onMouseEnter={() => setTitleHovered(true)}
            onMouseLeave={() => setTitleHovered(false)}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            {titleSpan}
          </Link>
        ) : (
          titleSpan
        )}
        {typeof count === "number" && count > 0 && <CountPill n={count} color={iconColor} />}
        {headerRight && <span style={{ marginLeft: "auto" }}>{headerRight}</span>}
      </div>
      {children}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Header strip
// ──────────────────────────────────────────────────────────────

function HeaderStrip({ firstName }: { firstName: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...eyebrow, color: T.INK_EMPHASIS, marginBottom: 4 }}>{todayLabel().toUpperCase()}</div>
      <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
        Welcome back, <span style={{ color: T.INK_EMPHASIS, fontWeight: 700 }}>{firstName}</span>
      </h1>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────

export default function CoachHomePage() {
  const [data, setData] = useState<CoachHome | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessForbidden, setAccessForbidden] = useState(false)

  // Modal state
  const [showCreateClient, setShowCreateClient] = useState(false)
  const [showAddProspect, setShowAddProspect] = useState(false)

  // Coach Home's plan blocks (follow-ups due, clients by phase).
  const planBlocks = usePlanBlocks()

  const load = useCallback(async () => {
    const res = await authFetch("/api/coach/home")
    if (res.status === 403) {
      setAccessForbidden(true)
      setLoading(false)
      return
    }
    if (res.ok) setData((await res.json()) as CoachHome)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingShell />

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

  if (!data) return null

  return (
    <div>
      {/* Top ribbon: find a client, add a client, add a prospect. */}
      <CoachTopRibbon onAddClient={() => setShowCreateClient(true)} onAddProspect={() => setShowAddProspect(true)} />

      <HeaderStrip firstName={data.coach.firstName} />

      <TodaysSchedule isCalendarBetaEnabled={data.calendar_beta_enabled} />

      <Section
        icon={<IconClipboardCheck />}
        title="Clients by phase"
        accentColor={T.SECTION_CLIENTS}
      >
        <ClientsByPhaseBlock buckets={planBlocks.data?.clients_by_phase ?? null} error={planBlocks.error} />
      </Section>

      {/* Every open To-Do item assigned to me, plan tasks included, by due date. */}
      <Section
        icon={<IconClipboardCheck />}
        title="My active tasks"
        titleHref="/dashboard/coach/tasks"
        accentColor={T.SECTION_ACTION_ITEMS}
      >
        <TaskCard order="due" />
      </Section>

      <Section
        icon={<IconBell />}
        title="Follow-ups due"
        count={planBlocks.data?.follow_ups.length}
        accentColor={T.SECTION_SCHEDULE}
      >
        <FollowUpsBlock items={planBlocks.data?.follow_ups ?? null} error={planBlocks.error} />
      </Section>

      {showAddProspect && (
        <AddProspectModal
          onClose={() => setShowAddProspect(false)}
          onSuccess={() => {
            setShowAddProspect(false)
            load()
          }}
        />
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
