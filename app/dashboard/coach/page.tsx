"use client"

// Coach Home / My Clients landing page — redesign 2026-05-08.
// Pulls from /api/coach/home which combines greeting + per-client stats +
// requiresAction items. Top-level metrics are aggregated client-side from
// the per-client stats array (no server-side aggregation needed).
//
// Sections, top to bottom:
//   A. Header strip — date eyebrow + "Welcome back, {firstName}"
//   B. Metrics bar — 8 tiles (4×2 grid). 6 real, 2 placeholders.
//   C. Today's schedule — card with calendar icon, placeholder body.
//   D. Requires action — card with bell icon + count, collapsible (5 → all).
//   E. My clients — card with users icon + count + Create/Invite buttons,
//                   single-row client layout, collapsible (5 → all).
//
// Visual style: dark theme adapted from the locked design. Cards use
// T.CARD bg + T.BORDER_SOFT; avatars use translucent colored bg + brighter
// text (palette of 5, deterministic by hash of client name).

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import CreateClientModal from "./CreateClientModal"
import {
  T, input, textarea, btnPrimary, btnSecondary, card, eyebrow, label,
} from "../../../lib/dashboard-theme"
import { CrossClientActionItemsList } from "./_action-items/CrossClientActionItemsList"
import { LifecycleStatusPill, type LifecycleStatus } from "./LifecycleStatusPill"
import { onCoachRowEnter, onCoachRowLeave, COACH_ROW_DEFAULT_BG, COACH_ROW_TRANSITION } from "./coachRowHover"
import { DismissSignalButton, useDismissSignal } from "./DismissSignalButton"
import { SavingSpinner } from "./SavingSpinner"
import { LoadingShell } from "./LoadingShell"
import { MetricsWindowToggle, useMetricsWindow, windowSubtitle } from "./MetricsWindowToggle"

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

type CoachHome = {
  ok: boolean
  coach: { firstName: string; fullName: string | null }
  // Phase 2 Item 14: 6-tile metric set. activeProspects/Clients are counts
  // of coach_clients by lifecycle_status; total* fields are 30-day windowed
  // counts of signal_applications. avgInterviewRate is null when there
  // are zero applications in the 30-day window.
  metrics: {
    activeProspects: number
    activeClients: number
    totalApplications: number
    totalInterviewing: number
    totalOffers: number
    avgInterviewRate: number | null
  }
  clients: CoachClient[]
  requiresAction: ActionItem[]
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

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

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

// Avatar palette — 5 colors, dark-theme adapted (translucent bg + brighter text).
// Picked by deterministic djb2 hash of client name → mod 5.
const AVATAR_PALETTE = [
  { bg: "rgba(81,173,229,0.18)",  text: "#9FC9EE" },  // blue
  { bg: "rgba(254,176,106,0.18)", text: "#FECDA0" },  // amber
  { bg: "rgba(167,139,250,0.18)", text: "#C8B6F8" },  // purple
  { bg: "rgba(244,114,182,0.18)", text: "#F4ADC9" },  // pink
  { bg: "rgba(74,222,128,0.18)",  text: "#9CE7B5" },  // green
] as const

const COLLAPSED_LIMIT = 5

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

// djb2-style string hash, lightly tweaked. Used to pick a palette index
// deterministically for a given client name (so the same name always gets
// the same color across renders).
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

// ──────────────────────────────────────────────────────────────
// Inline icons (Tabler-style outline, 1.5px stroke, currentColor)
// ──────────────────────────────────────────────────────────────

const IconBell = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 5a2 2 0 1 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />
    <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
  </svg>
)

const IconUsers = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
    <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    <path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />
  </svg>
)

const IconCalendar = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
    <path d="M16 3v4" />
    <path d="M8 3v4" />
    <path d="M4 11h16" />
    <path d="M11 15h1" />
    <path d="M12 15v3" />
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
      color: "#04060F", background: color,
      padding: "2px 8px", borderRadius: 999, marginLeft: 8,
    }}>
      {n}
    </span>
  )
}

function Avatar({ name, email }: { name: string | null; email: string | null }) {
  const seed = (name || email || "?").toLowerCase()
  const palette = AVATAR_PALETTE[hashIndex(seed, AVATAR_PALETTE.length)]
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: palette.bg, color: palette.text,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 900, letterSpacing: 0.3,
      flexShrink: 0,
    }}>
      {initialsOf(name, email)}
    </div>
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
// Section A — Header strip
// ──────────────────────────────────────────────────────────────

function HeaderStrip({ firstName }: { firstName: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 4 }}>{todayLabel().toUpperCase()}</div>
      <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
        Welcome back, <span style={{ color: T.WRN_ORANGE, fontWeight: 700 }}>{firstName}</span>
      </h1>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Section B — Metrics bar (8 tiles, 4×2 grid)
// ──────────────────────────────────────────────────────────────

type Tile = {
  label: string
  value: string | number
  color?: string
  subtitle?: string
  muted?: boolean
  // Phase 2 Item 12 (revised): client-count tiles (Active Prospects /
  // Active Clients) drive a filtered My Clients roster. When `href` is
  // set, tile becomes a clickable button. Application-count tiles
  // (Apps/Interviewing/Offers) route to /dashboard/coach/applications-recent
  // in Commit 2.3 — they stay non-clickable in this commit. Avg Interview
  // Rate is never clickable per locked spec.
  href?: string
}

function MetricTile({ tile }: { tile: Tile }) {
  const router = useRouter()
  const [hovered, setHovered] = useState(false)
  const clickable = !!tile.href
  const baseStyle: React.CSSProperties = {
    background: clickable && hovered ? "rgba(254,176,106,0.06)" : T.CARD,
    border: `1px solid ${clickable && hovered ? "rgba(254,176,106,0.35)" : T.BORDER_SOFT}`,
    borderRadius: 12,
    padding: "14px 16px",
    opacity: tile.muted ? 0.55 : 1,
    cursor: clickable ? "pointer" : "default",
    transition: "background 0.12s, border-color 0.12s",
    textAlign: "left" as const,
    fontFamily: "inherit",
    width: "100%",
  }
  const body = (
    <>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", color: T.MUTED }}>
        {tile.label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 500, color: tile.color || T.TEXT, marginTop: 6, lineHeight: 1.2 }}>
        {tile.value}
      </div>
      {tile.subtitle && (
        <div style={{
          fontSize: 10, color: T.DIM, marginTop: 4,
          fontStyle: tile.muted ? "italic" : "normal",
        }}>
          {tile.subtitle}
        </div>
      )}
    </>
  )
  if (!clickable) {
    return <div style={baseStyle}>{body}</div>
  }
  return (
    <button
      type="button"
      onClick={() => router.push(tile.href!)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={baseStyle}
    >
      {body}
    </button>
  )
}

function MetricsBar({ tiles }: { tiles: Tile[] }) {
  // 3 × 2 grid for the Phase 2 6-tile metric set. Row 1: Active Prospects /
  // Active Clients / Total Applications. Row 2: Total Interviewing /
  // Total Offers / Avg Interview Rate.
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 10,
      marginBottom: 24,
    }}>
      {tiles.map((t) => <MetricTile key={t.label} tile={t} />)}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────
// Section C — Today's schedule (placeholder)
// ──────────────────────────────────────────────────────────────

function TodaysScheduleSection() {
  return (
    <Section icon={<IconCalendar />} title="Today's schedule">
      <div style={{
        padding: 20,
        background: "rgba(255,255,255,0.03)",
        border: `1px dashed ${T.BORDER_SOFT}`,
        borderRadius: 10,
        textAlign: "center",
      }}>
        <p style={{ fontSize: 13, color: T.MUTED, fontStyle: "italic", margin: 0 }}>
          Calendar integration coming soon
        </p>
        <p style={{ fontSize: 12, color: T.DIM, marginTop: 6, marginBottom: 0 }}>
          Sessions, prep blocks, and mock interviews will appear here
        </p>
      </div>
    </Section>
  )
}

// ──────────────────────────────────────────────────────────────
// Section D — Requires action (collapsible)
// ──────────────────────────────────────────────────────────────

function ActionRow({
  item,
  onClick,
  onDismiss,
}: {
  item: ActionItem
  onClick: () => void
  onDismiss?: (item: ActionItem) => void
}) {
  // Local hover state drives the dismiss button visibility (Phase 3.2).
  // Imperative bg mutation via onCoachRowEnter/Leave still runs alongside
  // for the row-level bg color shift — the two are independent.
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => { onCoachRowEnter(e); setHovered(true) }}
      onMouseLeave={(e) => { onCoachRowLeave(e); setHovered(false) }}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px",
        background: COACH_ROW_DEFAULT_BG,
        border: `1px solid ${T.BORDER_SOFT}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: COACH_ROW_TRANSITION,
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
      {onDismiss && (
        <DismissSignalButton
          onClick={() => onDismiss(item)}
          visible={hovered}
        />
      )}
    </div>
  )
}

function EngagementSignalsSection({ items, onItemClick, onShowAll, noBottomMargin }: {
  items: ActionItem[]
  onItemClick: (clientId: string) => void
  onShowAll: () => void
  noBottomMargin?: boolean
}) {
  // Local copy of items so optimistic dismissal can remove rows without
  // round-tripping through the parent state. Resyncs when parent refetches
  // (items prop reference changes).
  const [localItems, setLocalItems] = useState<ActionItem[]>(items)
  useEffect(() => { setLocalItems(items) }, [items])

  const { dismiss, toastNode } = useDismissSignal<ActionItem>({
    authFetch,
    onLocalRemove: (id) => setLocalItems((prev) => prev.filter((x) => x.id !== id)),
    onLocalRestore: (s) => setLocalItems((prev) => [...prev, s]),
  })

  const visible = localItems.slice(0, COLLAPSED_LIMIT)
  const hasMore = localItems.length > COLLAPSED_LIMIT

  return (
    <Section
      icon={<IconBell />}
      title="Engagement Signals"
      titleHref="/dashboard/coach/required-actions"
      count={localItems.length}
      accentColor={T.WRN_BLUE}
      noBottomMargin={noBottomMargin}
    >
      {localItems.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>Nothing flagged from activity right now.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((item) => (
            <ActionRow
              key={item.id}
              item={item}
              onClick={() => onItemClick(item.client_profile_id)}
              onDismiss={dismiss}
            />
          ))}
          {hasMore && (
            <button
              onClick={onShowAll}
              style={{
                background: "none", border: "none", color: T.WRN_ORANGE,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                padding: "8px 0 0", textAlign: "left", marginTop: 4,
              }}
            >
              Show all {localItems.length} →
            </button>
          )}
        </div>
      )}
      {toastNode}
    </Section>
  )
}

// ──────────────────────────────────────────────────────────────
// Section E — My clients (collapsible single-row layout)
// ──────────────────────────────────────────────────────────────

function MiniCell({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ minWidth: 48, textAlign: "center" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || T.TEXT, marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

function ClientRow({
  client,
  onOpen,
  onLifecycleStatusChange,
}: {
  client: CoachClient
  onOpen: () => void
  onLifecycleStatusChange: (next: LifecycleStatus) => void
}) {
  const updates = client.updates_since_visit
  return (
    <div
      onClick={onOpen}
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
      <Avatar name={client.name} email={client.email} />

      <div style={{ minWidth: 0, flex: "1 1 180px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.TEXT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {client.name || "Unnamed"}
          </span>
          <LifecycleStatusPill
            value={client.lifecycle_status}
            getToken={getToken}
            clientProfileId={client.client_profile_id}
            onChange={onLifecycleStatusChange}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
        <MiniCell label="Apps"  value={client.stats.applications} />
        <MiniCell label="Intvw" value={client.stats.interviewing} color={client.stats.interviewing > 0 ? T.WRN_BLUE : undefined} />
        <MiniCell label="Rate"  value={`${client.stats.interview_rate}%`} />
        <MiniCell label="Rej"   value={client.stats.rejected} />
        <MiniCell label="Off"   value={client.stats.offers} color={client.stats.offers > 0 ? T.SUCCESS : undefined} />
      </div>

      <div style={{ flexShrink: 0, minWidth: 110, textAlign: "right" }}>
        {updates > 0 ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: T.WRN_ORANGE }}>{updates} new</span>
        ) : (
          <span style={{ fontSize: 11, color: T.DIM }}>No changes</span>
        )}
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onOpen() }}
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
}

function MyClientsSection({
  clients, onOpen, onCreate, onInvite, onShowAll, onLifecycleStatusChange,
}: {
  clients: CoachClient[]
  onOpen: (clientId: string) => void
  onCreate: () => void
  onInvite: () => void
  onShowAll: () => void
  onLifecycleStatusChange: (clientProfileId: string, next: LifecycleStatus) => void
}) {
  const visible = clients.slice(0, COLLAPSED_LIMIT)
  const hasMore = clients.length > COLLAPSED_LIMIT

  const headerRight = (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        onClick={onCreate}
        style={{
          border: `1px solid ${T.BORDER_SOFT}`, color: T.TEXT, background: T.NAV_DEFAULT_BG,
          borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        + Create
      </button>
      <button
        onClick={onInvite}
        style={{
          background: T.WRN_ORANGE, color: "#04060F",
          borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 800,
          cursor: "pointer", border: "none", fontFamily: "inherit",
        }}
      >
        + Invite
      </button>
    </div>
  )

  return (
    <Section
      icon={<IconUsers />}
      title="My clients"
      titleHref="/dashboard/coach/clients"
      count={clients.length}
      headerRight={headerRight}
      allowOverflow
    >
      {clients.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>No clients yet. Use Create or Invite above to add one.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((c) => (
            <ClientRow
              key={c.client_profile_id}
              client={c}
              onOpen={() => onOpen(c.client_profile_id)}
              onLifecycleStatusChange={(next) => onLifecycleStatusChange(c.client_profile_id, next)}
            />
          ))}
          {hasMore && (
            <button
              onClick={onShowAll}
              style={{
                background: "none", border: "none", color: T.WRN_ORANGE,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                padding: "8px 0 0", textAlign: "left", marginTop: 4,
              }}
            >
              Show all {clients.length} →
            </button>
          )}
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────────────────────────────────────────
// Page component
// ──────────────────────────────────────────────────────────────

export default function CoachHomePage() {
  const router = useRouter()
  const [data, setData] = useState<CoachHome | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessForbidden, setAccessForbidden] = useState(false)

  // Modal state
  const [showCreateClient, setShowCreateClient] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteAccess, setInviteAccess] = useState("full")
  const [inviteNote, setInviteNote] = useState("")
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<any>(null)

  // Phase 5 — metrics time-window toggle. Hook reads localStorage on
  // mount + writes on change. Shared key across Coach Home + Client
  // Dashboard so the coach's preference is global.
  const [metricsWindow, setMetricsWindow] = useMetricsWindow()

  // Phase 5 amendment — gates setLoading so that only the GENUINE
  // first-mount fetch renders the LoadingShell. Subsequent refetches
  // (toggle change, hook's localStorage sync on mount) refresh data
  // in place. Without this, every toggle click flashed a LoadingShell
  // for ~200ms before the new tile values rendered (same flash class
  // as the 4.3 post-save bug, different trigger). Set to true at the
  // START of the function so a re-entrant call during a pending
  // fetch also skips the loading flip.
  const hasLoadedOnceRef = useRef(false)

  const load = useCallback(async () => {
    const silent = hasLoadedOnceRef.current
    hasLoadedOnceRef.current = true
    if (!silent) setLoading(true)
    const res = await authFetch(`/api/coach/home?window=${metricsWindow}`)
    if (res.status === 403) {
      setAccessForbidden(true)
      if (!silent) setLoading(false)
      return
    }
    if (res.ok) setData((await res.json()) as CoachHome)
    if (!silent) setLoading(false)
  }, [metricsWindow])

  useEffect(() => { load() }, [load])

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    const res = await authFetch("/api/coach/invite", {
      method: "POST",
      body: JSON.stringify({ email: inviteEmail.trim(), access_level: inviteAccess, note: inviteNote }),
    })
    setInviteResult(await res.json())
    setInviting(false)
  }

  // Phase 2 Item 14 — 6-tile metric set. Grid is 3 × 2.
  //   Row 1: Active Prospects | Active Clients     | Total Applications
  //   Row 2: Total Interviewing | Total Offers     | Avg Interview Rate
  //
  // Phase 2 Item 12 (revised) — click destinations:
  //   - Client-count tiles (Prospects/Clients) → filtered My Clients roster
  //   - Application-count tiles (Apps/Interviewing/Offers) → cross-client
  //     applications-recent surface (different mental model: apps, not
  //     clients)
  //   - Avg Interview Rate is never clickable per locked spec.
  const tiles: Tile[] = useMemo(() => {
    if (!data) return []
    const m = data.metrics
    // Phase 5: subtitle text on the 4 windowed tiles tracks the active
    // window. Active Prospects + Active Clients stay point-in-time (no
    // subtitle change — they have no time concept).
    const sub = windowSubtitle(metricsWindow)
    return [
      { label: "Active prospects", value: m.activeProspects, color: "#F4A261",
        href: "/dashboard/coach/clients?filter=prospect" },
      { label: "Active clients", value: m.activeClients, color: "#2CA58D",
        href: "/dashboard/coach/clients?filter=active" },
      { label: "Total applications", value: m.totalApplications, subtitle: sub,
        href: "/dashboard/coach/applications-recent?status=all" },
      { label: "Total interviewing", value: m.totalInterviewing, color: T.WRN_BLUE, subtitle: sub,
        href: "/dashboard/coach/applications-recent?status=interviewing" },
      { label: "Total offers", value: m.totalOffers, color: T.SUCCESS, subtitle: sub,
        href: "/dashboard/coach/applications-recent?status=offer" },
      {
        label: "Avg interview rate",
        value: m.avgInterviewRate === null ? "—" : `${m.avgInterviewRate}%`,
        subtitle: sub,
      },
    ]
  }, [data, metricsWindow])

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

  const goToClient = (id: string) => router.push(`/dashboard/coach/clients/${id}`)

  return (
    <div>
      <HeaderStrip firstName={data.coach.firstName} />

      {/* Phase 5 — segmented time-window toggle, right-aligned above
          the metrics bar. Controls the four windowed tiles (Total
          Applications / Interviewing / Offers / Avg Interview Rate);
          Active Prospects + Active Clients are point-in-time and
          ignore the toggle. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <MetricsWindowToggle value={metricsWindow} onChange={setMetricsWindow} />
      </div>

      <MetricsBar tiles={tiles} />

      {/* Action Items + Engagement Signals — paired side-by-side. Each
          column is its own section with its own accent color (orange =
          coach-authored work, blue = system signal). Equal width at
          desktop via repeat(auto-fit, minmax(360px, 1fr)); collapses to
          a single stacked column when the viewport can't fit two 360px
          columns. align-items: start keeps column heights independent
          (taller column extends below shorter without padding the short
          one). noBottomMargin on the inner sections so the grid's gap
          handles spacing instead of compounding with the section's own
          marginBottom. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: 20,
          alignItems: "start",
          marginBottom: 20,
        }}
      >
        <Section
          icon={<IconClipboardCheck />}
          title="Action Items"
          titleHref="/dashboard/coach/required-actions"
          accentColor={T.WRN_ORANGE}
          noBottomMargin
        >
          <CrossClientActionItemsList
            authFetch={authFetch}
            priorities="urgent,this_week"
            cap={5}
            moreHref="/dashboard/coach/required-actions"
            emptyText="No urgent items"
            bodyLineClamp={2}
          />
        </Section>

        <EngagementSignalsSection
          items={data.requiresAction}
          onItemClick={goToClient}
          onShowAll={() => router.push("/dashboard/coach/required-actions")}
          noBottomMargin
        />
      </div>

      <TodaysScheduleSection />
      <MyClientsSection
        clients={data.clients}
        onOpen={goToClient}
        onCreate={() => setShowCreateClient(true)}
        onInvite={() => { setInviteOpen(true); setInviteResult(null) }}
        onShowAll={() => router.push("/dashboard/coach/clients")}
        onLifecycleStatusChange={(clientProfileId, next) => {
          // Optimistic local update — PATCH already succeeded inside the pill.
          setData((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              clients: prev.clients.map((c) =>
                c.client_profile_id === clientProfileId
                  ? { ...c, lifecycle_status: next }
                  : c,
              ),
            }
          })
        }}
      />

      {/* Invite modal — preserved from previous build */}
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
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    opacity: inviting ? 0.5 : 1,
                    pointerEvents: inviting ? "none" : "auto",
                    transition: "opacity 120ms ease",
                  }}
                >
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
                    style={{ ...btnPrimary, background: "#FEB06A", color: "#04060F", fontWeight: 900, flex: 1, opacity: inviting || !inviteEmail.trim() ? 0.5 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  >
                    {inviting && <SavingSpinner />}
                    {inviting ? "Sending..." : "Send Invite →"}
                  </button>
                  <button
                    onClick={() => { setInviteOpen(false); setInviteEmail(""); setInviteNote(""); setInviteResult(null) }}
                    disabled={inviting}
                    style={{ ...btnSecondary, fontSize: 13, opacity: inviting ? 0.5 : 1 }}
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
