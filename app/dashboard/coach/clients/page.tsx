"use client"

// My Clients full list (Sprint 3, 2026-05-08).
// Reuses the single-row client layout from the redesigned Coach Home
// Dashboard, but without the top-5 limit. Pulls from /api/coach/home —
// the existing per-client stats including offers/rejected. No new API.

import { useEffect, useMemo, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { T, btnSecondary, card, eyebrow, selectDark, selectDarkOption } from "../../../../lib/dashboard-theme"
import { LifecycleStatusPill, LIFECYCLE_STATUS_VALUES, type LifecycleStatus } from "../LifecycleStatusPill"
import { BackToDashboard } from "../BackToDashboard"
import { LoadingShell } from "../LoadingShell"
import { onCoachRowEnter, onCoachRowLeave, COACH_ROW_DEFAULT_BG, COACH_ROW_TRANSITION } from "../coachRowHover"
import { SPACE, TYPE } from "../../../../lib/theme/surfaces"
import { DEFAULT_SORT, SORT_OPTIONS, applyListControls, type FilterGroup, type SortKey } from "../../../../lib/coach/listControls"

// Phase 2 Item 12 (revised): only lifecycle-status filters route here.
// Application-count filters go to /dashboard/coach/applications-recent
// in Commit 2.3. Must stay in sync with allowlist in /api/coach/home.
const FILTER_LABELS: Record<string, string> = {
  prospect: "Active Prospects",
  active: "Active Clients",
}

// In-page lifecycle filter (segmented control above the roster). "All"
// means every non-Prospect row. The status options are derived from
// LIFECYCLE_STATUS_VALUES (single source of truth) with Prospect dropped —
// Prospect rows are already excluded from this view (see load()).
type LifecycleFilter = LifecycleStatus | "All"
const LIFECYCLE_FILTER_OPTIONS: LifecycleFilter[] = [
  ...LIFECYCLE_STATUS_VALUES.filter((s) => s !== "Prospect"),
  "All",
]

// Seed the in-page selection from the deep-link ?filter= param. Today only
// ?filter=active maps to an in-page selection (Active); every other case —
// no param, an unknown value, or ?filter=prospect — also defaults to Active.
// Written as a map so future param→filter additions slot in cleanly.
const SEED_FILTER_BY_PARAM: Partial<Record<string, LifecycleFilter>> = {
  active: "Active",
}

type CoachClient = {
  id: string
  // Nullable for Active rows that were converted from Prospect but
  // haven't yet been linked to a SIGNAL profile via send-invite.
  // Frontend type was previously `string`; backend always allowed null.
  client_profile_id: string | null
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
  /** When the relationship was created. Drives the newest/oldest sorts. */
  created_at?: string | null
  last_activity: string | null
  last_viewed_at: string | null
  updates_since_visit: number
}

// Static pill colors mirror LifecycleStatusPill's PILL_STYLES — used
// for rows where client_profile_id is null (the interactive pill PATCHes
// /api/coach/clients/[client_profile_id] which would 404; render a
// non-interactive chip instead).
const STATIC_PILL_COLORS: Record<LifecycleStatus, { bg: string; color: string }> = {
  Prospect: { bg: "var(--sig-pill-prospect-bg, #F4A261)", color: "var(--sig-pill-prospect-ink, #FFFFFF)" },
  Active: { bg: "var(--sig-pill-active-bg, #2CA58D)", color: "var(--sig-pill-active-ink, #FFFFFF)" },
  Inactive: { bg: "var(--sig-pill-inactive-bg, #7DD3FC)", color: "var(--sig-pill-inactive-ink, #333333)" },
  Archived: { bg: "var(--sig-pill-archived-bg, #333333)", color: "var(--sig-pill-archived-ink, #FFFFFF)" },
}

// The lookup is Record<LifecycleStatus, ...> and therefore exhaustive over the
// TYPE. The column is nullable, and the type is a promise about the server, not
// the database: one row with a status outside the union takes the whole roster
// down, not just its own pill.
const PILL_FALLBACK = { bg: T.BORDER_SOFT, color: T.MUTED }
const pillColors = (s: LifecycleStatus | null | undefined) =>
  (s && STATIC_PILL_COLORS[s]) || PILL_FALLBACK

const AVATAR_PALETTE = [
  // Variables, because these read on navy and vanish on white. The
  // wash is the dark fallback; lib/theme/coachSurface.ts supplies a
  // solid tint and a dark ink for the light ground.
  { bg: "var(--sig-avatar-0-bg, rgba(81,173,229,0.18))", text: "var(--sig-avatar-0-ink, #9FC9EE)" },
  { bg: "var(--sig-avatar-1-bg, rgba(254,176,106,0.18))", text: "var(--sig-avatar-1-ink, #FECDA0)" },
  { bg: "var(--sig-avatar-2-bg, rgba(167,139,250,0.18))", text: "var(--sig-avatar-2-ink, #C8B6F8)" },
  { bg: "var(--sig-avatar-3-bg, rgba(244,114,182,0.18))", text: "var(--sig-avatar-3-ink, #F4ADC9)" },
  { bg: "var(--sig-avatar-4-bg, rgba(0,179,179,0.18))", text: "var(--sig-avatar-4-ink, #7FE0DE)" },
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
      width: 34, height: 34, borderRadius: "50%",
      background: palette.bg, color: palette.text,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: TYPE.secondary, fontWeight: 900, letterSpacing: 0.3, flexShrink: 0,
    }}>
      {initialsOf(name, email)}
    </div>
  )
}

function MiniCell({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ minWidth: 56, textAlign: "center" }}>
      <div style={{ fontSize: TYPE.label, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.MUTED }}>{label}</div>
      <div style={{ fontSize: TYPE.subheading, fontWeight: 800, color: color || T.TEXT, marginTop: 2 }}>{value}</div>
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

  // In-page lifecycle filter. Defaults to Active every load (no
  // persistence). Seeded once from ?filter= for deep-link consistency.
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>(
    () => (filter && SEED_FILTER_BY_PARAM[filter]) || "Active",
  )

  // Search and sort. Alphabetical by default: a roster exists so somebody can
  // find a person they are already thinking about, and "where is Marco" has
  // an answer under A to Z and none under "most recently active".
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT)

  // ONE GROUP TODAY, A LIST ON PURPOSE. An engagement-phase filter slots in
  // beside this one without touching the search, the sort or the rendering.
  const filterGroups: FilterGroup[] = useMemo(() => [{
    id: "status",
    label: "Status",
    values: LIFECYCLE_FILTER_OPTIONS.filter((o) => o !== "All") as string[],
    all: "All",
    initial: "Active",
    matches: (row: any, sel: string) => row.lifecycle_status === sel,
  }], [])

  // Per-row invite state keyed on coach_clients.id. Tracks the
  // optimistic UI transition for the "Invite to SIGNAL" button.
  // Absent key = idle. No persistence — page refresh resets, but the
  // underlying row's client_profile_id will be populated server-side
  // after a successful send, so on refetch the button is hidden by
  // the conditional render rather than relying on local state.
  const [inviteStatus, setInviteStatus] = useState<Record<string, "sending" | "sent" | "error">>({})
  const [inviteError, setInviteError] = useState<Record<string, string>>({})

  async function sendInvite(coachClientId: string) {
    if (inviteStatus[coachClientId] === "sending" || inviteStatus[coachClientId] === "sent") return
    setInviteStatus((s) => ({ ...s, [coachClientId]: "sending" }))
    setInviteError((e) => {
      const next = { ...e }
      delete next[coachClientId]
      return next
    })
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/send-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        setInviteStatus((s) => ({ ...s, [coachClientId]: "sent" }))
      } else {
        setInviteStatus((s) => ({ ...s, [coachClientId]: "error" }))
        setInviteError((e) => ({ ...e, [coachClientId]: j?.error || "Couldn't send invite — try again" }))
      }
    } catch {
      setInviteStatus((s) => ({ ...s, [coachClientId]: "error" }))
      setInviteError((e) => ({ ...e, [coachClientId]: "Network error — try again" }))
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    const url = filter
      ? `/api/coach/home?filter=${encodeURIComponent(filter)}`
      : "/api/coach/home"
    const res = await authFetch(url)
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) {
      const j = await res.json()
      // TODO post-v0.1: backend should filter prospects from default
      // /api/coach/home clients response. Current filter is a frontend
      // safety net for the prospect-renders-in-my-clients case. Mirrors
      // the Coach Home MyClientsSection filter from commit 4255f3a4.
      setClients((j.clients || []).filter((c: any) => c.lifecycle_status !== "Prospect"))
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  function clearFilter() {
    router.push("/dashboard/coach/clients")
  }

  // Lifecycle filter first (on the already Prospect-excluded array), then
  // the same default sort as the Dashboard summary — so sorting applies to
  // the visible subset.
  // Search, then the status filter, then the sort. The old order put
  // "unread updates" first, which meant the list reshuffled itself as the
  // coach read it and a name was never twice in the same place.
  const sorted = useMemo(() => {
    if (!clients) return []
    return applyListControls(clients as any, {
      search,
      sort,
      groups: filterGroups,
      selected: { status: lifecycleFilter },
    }) as typeof clients
  }, [clients, lifecycleFilter, search, sort, filterGroups])

  if (loading) return <LoadingShell />


  if (forbidden) {
    return (
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: TYPE.subheading, fontWeight: 800 }}>Coach access required</p>
      </div>
    )
  }

  return (
    <div>
      <BackToDashboard />
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: TYPE.title, fontWeight: 800, letterSpacing: "-0.01em", color: T.TEXT, margin: 0 }}>
          My Clients <span style={{ color: T.MUTED, fontWeight: 600, fontSize: TYPE.subheading }}>({sorted.length})</span>
        </h1>
        <p style={{ fontSize: TYPE.secondary, color: T.MUTED, marginTop: 8 }}>
          Every client, at every status. Open one to reach their tracker, profile and personas.
        </p>
        {filter && (
          <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(254,176,106,0.10)", border: "1px solid rgba(254,176,106,0.30)",
            color: T.INK_EMPHASIS, borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700,
          }}>
            <span>Filtered: {FILTER_LABELS[filter]}</span>
            <button
              onClick={clearFilter}
              aria-label="Clear filter"
              title="Clear filter"
              style={{
                background: "none", border: "none", color: T.INK_EMPHASIS,
                fontSize: 14, fontWeight: 900, cursor: "pointer",
                padding: 0, lineHeight: 1, fontFamily: "inherit",
              }}
            >×</button>
          </div>
        )}
      </div>

      {/* SEARCH AND SORT, above the status filter. Search is first because it
          is what a coach reaches for when they already know who they want;
          the filters are for when they do not. */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search clients by name or email"
          style={{
            flex: "1 1 280px", minWidth: 0,
            height: SPACE.control,
            padding: "0 14px",
            fontSize: TYPE.control,
            fontFamily: "inherit",
            borderRadius: 10,
            border: `1px solid ${T.BORDER}`,
            background: T.GLASS,
            color: T.TEXT,
            outline: "none",
          }}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{
              height: SPACE.control, padding: "0 14px", borderRadius: 10,
              border: `1px solid ${T.BORDER_SOFT}`, background: "transparent",
              color: T.MUTED, fontSize: TYPE.control, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >Clear</button>
        )}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.08em",
            textTransform: "uppercase", color: T.MUTED,
          }}>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{
              ...selectDark,
              height: SPACE.control,
              fontSize: TYPE.control,
              width: "auto",
              minWidth: 160,
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key} style={selectDarkOption}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Status. Defaults to Active: the roster opens on the people being
          worked, and every other status is one click away. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{
          fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.08em",
          textTransform: "uppercase", color: T.MUTED, marginRight: 2,
        }}>Status</span>
        {LIFECYCLE_FILTER_OPTIONS.map((opt) => {
          const selected = opt === lifecycleFilter
          return (
            <button
              key={opt}
              onClick={() => setLifecycleFilter(opt)}
              aria-pressed={selected}
              style={{
                background: selected ? "rgba(254,176,106,0.10)" : T.NAV_DEFAULT_BG,
                border: `1px solid ${selected ? "rgba(254,176,106,0.30)" : T.BORDER_SOFT}`,
                color: selected ? T.INK_EMPHASIS : T.MUTED,
                fontSize: TYPE.control,
                fontWeight: 700,
                minHeight: SPACE.control,
                padding: "0 18px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {opt}
            </button>
          )
        })}
      </div>

      {/* overflow: "visible" overrides the card's default overflow:hidden
          so LifecycleStatusPill dropdowns on bottom-of-roster rows
          aren't clipped at the card boundary. Same pattern as the
          MyClientsSection on Coach Home — v1.1 portal refactor will
          eliminate this need. */}
      <div style={{ ...card, padding: 20, overflow: "visible" }}>
        {sorted.length === 0 ? (
          <p style={{ color: T.MUTED, fontSize: TYPE.body, margin: 0 }}>
            {search.trim()
              ? `No client matches "${search.trim()}"${lifecycleFilter !== "All" ? ` under ${lifecycleFilter}` : ""}.`
              : (clients?.length ?? 0) > 0 && lifecycleFilter !== "All"
              ? `No ${lifecycleFilter} clients.`
              : filter
                ? `No clients match the "${FILTER_LABELS[filter]}" filter. Clear the filter to see your full roster.`
                : "No clients yet. Use Create or Invite from the Dashboard to add one."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.map((c) => {
              const updates = c.updates_since_visit
              // Active rows without a linked SIGNAL profile (converted
              // from Prospect, not yet invited) route to the 4d
              // /coach-clients/[id] surface keyed on coach_clients.id.
              // SIGNAL-linked rows use the existing /clients/[client_profile_id].
              const detailHref = c.client_profile_id
                ? `/dashboard/coach/clients/${c.client_profile_id}`
                : `/dashboard/coach/coach-clients/${c.id}`
              const needsInvite = c.lifecycle_status === "Active" && c.client_profile_id == null
              const ix = inviteStatus[c.id]
              const inviteSending = ix === "sending"
              const inviteSent = ix === "sent"
              const inviteErr = inviteError[c.id]
              return (
                <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    onClick={() => router.push(detailHref)}
                    onMouseEnter={onCoachRowEnter}
                    onMouseLeave={(e) => onCoachRowLeave(e)}
                    style={{
                      display: "flex", alignItems: "center", gap: 14,
                      // ~52px tall, the density GoHighLevel's Contacts table
                      // uses and the reason its rows scan at a glance.
                      minHeight: SPACE.row,
                      padding: `0 ${SPACE.cell}px`,
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
                          fontSize: TYPE.body, fontWeight: 700, color: T.TEXT,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{c.name || "Unnamed"}</span>
                        {c.client_profile_id ? (
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
                        ) : (
                          // Static lifecycle chip for rows without a SIGNAL
                          // profile linked — the interactive pill PATCHes
                          // /api/coach/clients/[client_profile_id] which
                          // doesn't apply here. The Invite to SIGNAL button
                          // (further right) is the canonical action for
                          // these rows.
                          <span
                            style={{
                              background: pillColors(c.lifecycle_status).bg,
                              color: pillColors(c.lifecycle_status).color,
                              fontSize: 11,
                              fontWeight: 900,
                              padding: "4px 10px",
                              borderRadius: 999,
                              whiteSpace: "nowrap",
                              letterSpacing: 0.2,
                            }}
                          >
                            {c.lifecycle_status}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                      <MiniCell label="Apps"  value={c.stats.applications} />
                      <MiniCell label="Intvw" value={c.stats.interviewing} color={c.stats.interviewing > 0 ? T.INK_LINK : undefined} />
                      <MiniCell label="Rate"  value={`${c.stats.interview_rate}%`} />
                      <MiniCell label="Rej"   value={c.stats.rejected} />
                      <MiniCell label="Off"   value={c.stats.offers} color={c.stats.offers > 0 ? T.SUCCESS : undefined} />
                    </div>
                    <div style={{ flexShrink: 0, minWidth: 110, textAlign: "right" }}>
                      {updates > 0 ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.INK_EMPHASIS }}>{updates} new</span>
                      ) : (
                        <span style={{ fontSize: 11, color: T.DIM }}>No changes</span>
                      )}
                    </div>
                    {needsInvite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); sendInvite(c.id) }}
                        disabled={inviteSending || inviteSent}
                        style={{
                          background: inviteSent
                            ? "rgba(0,179,179,0.15)"
                            : "rgba(255,149,0,0.15)",
                          border: `1px solid ${inviteSent ? "rgba(0,179,179,0.3)" : "rgba(255,149,0,0.3)"}`,
                          color: inviteSent ? T.SUCCESS : T.INK_EMPHASIS,
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "6px 12px",
                          borderRadius: 6,
                          cursor: inviteSending || inviteSent ? "default" : "pointer",
                          opacity: inviteSending ? 0.6 : 1,
                          fontFamily: "inherit",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {inviteSending ? "Sending..." : inviteSent ? "✓ Invited" : "Invite to SIGNAL"}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(detailHref) }}
                      style={{
                        ...btnSecondary,
                        fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8,
                        color: T.INK_EMPHASIS, borderColor: "rgba(254,176,106,0.3)",
                        flexShrink: 0,
                      }}
                    >
                      Open →
                    </button>
                  </div>
                  {inviteErr && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "#f87171",
                        fontWeight: 600,
                        paddingLeft: 14,
                        paddingRight: 14,
                      }}
                    >
                      {inviteErr}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
