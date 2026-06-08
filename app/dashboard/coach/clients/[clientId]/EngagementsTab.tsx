"use client"

// Engagements — a client/prospect's attached package snapshots (frozen copies).
// Shared by the linked-client page (tab) and the prospect detail page (section);
// both pass coach_clients.id directly. The engagement API:
//   GET    /api/coach/coach-clients/[ccId]/engagements
//   POST   /api/coach/coach-clients/[ccId]/engagements   { package_id }   (mints draft)
//   GET    /api/coach/coach-clients/[ccId]/engagements/[engagement_id]
//   PATCH  /api/coach/coach-clients/[ccId]/engagements/[engagement_id]  { proposal_status }
//   DELETE /api/coach/coach-clients/[ccId]/engagements/[engagement_id]
//
// Two editable status systems, kept distinct by palette AND placement: the
// proposal lifecycle (draft/sent/approved/declined) is a colored control at the
// engagement-card header; activity completion (not_started/in_progress/complete)
// is a colored 3-way control on each activity row inside a deliverable. On any
// write failure show a banner AND resync. The server (toApiEngagement) is the
// source of truth for pricing + status — no client-side recompute. Dollars only.
//
// getToken/authFetch inlined per the coach-route client convention (same pair as
// NotesTab / PackagesTab).

import { useCallback, useEffect, useState } from "react"
import { T, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

type EngActivity = { id: string; name: string; owner: string; status: string; due_date: string | null; sort_order: number }
type EngDeliverable = {
  id: string
  name: string
  category: string | null
  time_estimate_days: number | null
  fee: number | null // DOLLARS; null = unpriced
  sort_order: number
  activities: EngActivity[]
}
type EngPricing = {
  subtotal: number
  unpriced_count: number
  effective_discount: number
  total: number
  discount_clamped: boolean
}
type ProposalStatus = "draft" | "sent" | "approved" | "declined"
type Engagement = {
  id: string
  name: string
  proposal_status: string
  attached_at: string
  discount: number | null // DOLLARS; null = no discount
  deliverables: EngDeliverable[]
  pricing: EngPricing
}

// Catalog package, as the attach picker needs it (GET /api/coach/packages).
type CatalogPackage = {
  id: string
  name: string
  deliverables: { id: string }[]
  pricing: { total: number }
}

// ── Display helpers (dollars only; $0 → "Free" for a deliverable fee) ──
function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}
function fmtFee(fee: number | null): string {
  if (fee === null) return "Unpriced"
  if (fee === 0) return "Free"
  return fmtMoney(fee)
}
function fmtDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
const OWNER_LABEL: Record<string, string> = { coach: "Coach", client: "Client", both: "Both" }

// Proposal lifecycle — the ONLY colored status here (app tokens). draft neutral,
// sent info, approved success, declined danger.
const PROPOSAL_ORDER: ProposalStatus[] = ["draft", "sent", "approved", "declined"]
const PROPOSAL_META: Record<ProposalStatus, { label: string; color: string; bg: string; border: string }> = {
  draft: { label: "Draft", color: T.MUTED, bg: T.NAV_DEFAULT_BG, border: T.BORDER_SOFT },
  sent: { label: "Sent", color: T.WRN_BLUE, bg: "rgba(81,173,229,0.12)", border: "rgba(81,173,229,0.30)" },
  approved: { label: "Approved", color: T.SUCCESS, bg: T.SUCCESS_BG, border: "rgba(74,222,128,0.30)" },
  declined: { label: "Declined", color: T.ERROR, bg: T.ERROR_BG, border: "rgba(255,120,120,0.30)" },
}

// Activity completion status — now an interactive colored 3-way control on each
// activity row. Its OWN palette (muted → amber → green) keeps it distinct from
// the proposal control's blue/green/red, and it lives at a different level
// (nested inside a deliverable, not the card header). App tokens, no new colors.
const ACTIVITY_STATUS_ORDER = ["not_started", "in_progress", "complete"] as const
const ACTIVITY_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  not_started: { label: "Not started", color: T.MUTED, bg: T.NAV_DEFAULT_BG, border: T.BORDER_SOFT },
  in_progress: { label: "In progress", color: T.WRN_ORANGE, bg: "rgba(254,176,106,0.14)", border: T.NAV_ACTIVE_BORDER },
  complete: { label: "Complete", color: T.SUCCESS, bg: T.SUCCESS_BG, border: "rgba(74,222,128,0.30)" },
}

function countActivities(e: Engagement): number {
  return e.deliverables.reduce((sum, d) => sum + d.activities.length, 0)
}

// ── Auth (same inline pattern as NotesTab) ──
async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
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

export function EngagementsTab({
  coachClientId,
  clientName,
  showConvertNudge = false,
}: {
  coachClientId: string | null
  clientName: string
  // Prospect page only: when an engagement is approved, show a quiet nudge toward
  // the Pipeline's Convert action. Informational — it does NOT trigger convert.
  showConvertNudge?: boolean
}) {
  const [items, setItems] = useState<Engagement[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Attach picker.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [catalog, setCatalog] = useState<CatalogPackage[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [attachingId, setAttachingId] = useState<string | null>(null) // package_id in flight

  const [detachingId, setDetachingId] = useState<string | null>(null)
  const [settingStatusId, setSettingStatusId] = useState<string | null>(null) // engagement (proposal) in flight
  const [settingActivityId, setSettingActivityId] = useState<string | null>(null) // activity status in flight

  const base = coachClientId ? `/api/coach/coach-clients/${coachClientId}/engagements` : null

  const load = useCallback(async () => {
    if (!base) { setLoading(false); setItems([]); return } // no relationship → benign empty
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch(base)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load engagements (${res.status})`)
        return
      }
      setItems(j.engagements || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { void load() }, [load])

  const resync = useCallback(async () => {
    if (!base) return
    try {
      const res = await authFetch(base)
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setItems(j.engagements || [])
    } catch {
      /* leave the action banner as the surfaced error */
    }
  }, [base])

  async function openPicker() {
    setActionError(null)
    setPickerOpen(true)
    setCatalogLoading(true)
    try {
      const res = await authFetch("/api/coach/packages")
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setCatalog(j.packages || [])
      else setActionError(j?.error || "Couldn't load your packages")
    } catch {
      setActionError("Network error loading packages")
    } finally {
      setCatalogLoading(false)
    }
  }

  async function attach(packageId: string) {
    if (!base || attachingId) return
    setAttachingId(packageId)
    setActionError(null)
    try {
      const res = await authFetch(base, { method: "POST", body: JSON.stringify({ package_id: packageId }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Attach failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => [j.engagement as Engagement, ...prev]) // newest first (mints draft)
      setPickerOpen(false)
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setAttachingId(null)
    }
  }

  async function setStatus(id: string, status: ProposalStatus) {
    if (!base || settingStatusId) return
    setSettingStatusId(id)
    setActionError(null)
    try {
      const res = await authFetch(`${base}/${id}`, { method: "PATCH", body: JSON.stringify({ proposal_status: status }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't update status (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.map((e) => (e.id === id ? (j.engagement as Engagement) : e)))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSettingStatusId(null)
    }
  }

  // Set one activity's completion status. The route returns the fresh engagement;
  // reconcile local state from it. Banner + resync on failure.
  async function setActivityStatus(engagementId: string, activityId: string, status: string) {
    if (!base || settingActivityId) return
    setSettingActivityId(activityId)
    setActionError(null)
    try {
      const res = await authFetch(`${base}/${engagementId}/activities/${activityId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't update activity (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.map((e) => (e.id === engagementId ? (j.engagement as Engagement) : e)))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSettingActivityId(null)
    }
  }

  // Set one activity's due date (YYYY-MM-DD, or null to clear). Same route + return
  // shape as the status write; reconcile from the fresh engagement, banner + resync
  // on failure. Shares the settingActivityId in-flight lock with the status control.
  async function setActivityDueDate(engagementId: string, activityId: string, dueDate: string | null) {
    if (!base || settingActivityId) return
    setSettingActivityId(activityId)
    setActionError(null)
    try {
      const res = await authFetch(`${base}/${engagementId}/activities/${activityId}`, {
        method: "PATCH",
        body: JSON.stringify({ due_date: dueDate }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't update due date (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.map((e) => (e.id === engagementId ? (j.engagement as Engagement) : e)))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSettingActivityId(null)
    }
  }

  async function detach(id: string) {
    if (!base || detachingId) return
    // High-stakes (deletes the client's copy) — explicit confirm, unlike a catalog row.
    if (!confirm(`Remove this engagement from ${clientName}? This deletes their copy.`)) return
    setDetachingId(id)
    setActionError(null)
    try {
      const res = await authFetch(`${base}/${id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Remove failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.filter((e) => e.id !== id))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setDetachingId(null)
    }
  }

  // Guard: no relationship resolved → benign empty, not an error.
  if (!coachClientId) {
    return <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>No engagement workspace for this client yet.</p>
  }
  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading engagements…</p>
  }
  if (loadError) {
    return (
      <div>
        <Banner kind="error">{loadError}</Banner>
        <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 16px" }}>
        Packages attached to {clientName}. Each is a frozen copy — editing your catalog won&apos;t
        change what&apos;s here.
      </p>

      {actionError && <div style={{ marginBottom: 16 }}><Banner kind="error">{actionError}</Banner></div>}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: "0 0 16px" }}>
          No packages attached yet — attach one below to set up this client&apos;s deliverables.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {items.map((e) => (
            <EngagementCard
              key={e.id}
              e={e}
              expanded={expandedId === e.id}
              detaching={detachingId === e.id}
              proposalBusy={settingStatusId === e.id}
              settingActivityId={settingActivityId}
              showConvertNudge={showConvertNudge}
              onToggle={() => setExpandedId((prev) => (prev === e.id ? null : e.id))}
              onDetach={() => void detach(e.id)}
              onSetStatus={(s) => void setStatus(e.id, s)}
              onSetActivityStatus={(activityId, status) => void setActivityStatus(e.id, activityId, status)}
              onSetActivityDueDate={(activityId, dueDate) => void setActivityDueDate(e.id, activityId, dueDate)}
            />
          ))}
        </div>
      )}

      {/* Attach control */}
      <div style={{ paddingTop: 16, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        {!pickerOpen ? (
          <button style={btnPrimary} onClick={() => void openPicker()}>+ Attach a package</button>
        ) : (
          <div style={{ borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>
                Choose a package to attach
              </div>
              <button style={smallBtn} onClick={() => setPickerOpen(false)}>Cancel</button>
            </div>
            {catalogLoading ? (
              <p style={{ fontSize: 12, color: T.MUTED, margin: 0 }}>Loading your packages…</p>
            ) : catalog.length === 0 ? (
              <p style={{ fontSize: 12, color: T.DIM, margin: 0 }}>
                No packages yet — build one in Services → Packages first.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {catalog.map((p) => {
                  const count = p.deliverables?.length ?? 0
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "8px 10px",
                        borderRadius: 10, border: `1px solid ${T.BORDER_SOFT}`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: T.TEXT, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: T.MUTED, marginLeft: 8 }}>
                          {count} deliverable{count === 1 ? "" : "s"} · {fmtMoney(p.pricing?.total ?? 0)}
                        </span>
                      </div>
                      <button
                        style={{ ...btnPrimary, padding: "7px 14px", fontSize: 12, opacity: attachingId ? 0.6 : 1 }}
                        disabled={!!attachingId}
                        onClick={() => void attach(p.id)}
                      >
                        {attachingId === p.id ? "Attaching…" : "Attach"}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── One engagement card (collapsed summary + proposal control + frozen snapshot) ──
function EngagementCard({
  e, expanded, detaching, proposalBusy, settingActivityId, showConvertNudge,
  onToggle, onDetach, onSetStatus, onSetActivityStatus, onSetActivityDueDate,
}: {
  e: Engagement
  expanded: boolean
  detaching: boolean
  proposalBusy: boolean
  settingActivityId: string | null
  showConvertNudge: boolean
  onToggle: () => void
  onDetach: () => void
  onSetStatus: (s: ProposalStatus) => void
  onSetActivityStatus: (activityId: string, status: string) => void
  onSetActivityDueDate: (activityId: string, dueDate: string | null) => void
}) {
  // Hover affordance for the proposal control (same pattern as the prospect
  // status / pipeline controls). Hover is neutral + transient, never the active
  // status color, so a hovered stage can't be mistaken for the selected one.
  const [hoveredStatus, setHoveredStatus] = useState<ProposalStatus | null>(null)
  const count = e.deliverables.length
  const acts = countActivities(e)
  const chips: string[] = [
    `${count} deliverable${count === 1 ? "" : "s"}`,
    `${acts} activit${acts === 1 ? "y" : "ies"}`,
  ]
  if (e.discount != null && e.discount > 0) chips.push(`${fmtMoney(e.discount)} off`)
  if (e.pricing.unpriced_count > 0) chips.push(`${e.pricing.unpriced_count} unpriced`)

  const pm = PROPOSAL_META[(e.proposal_status as ProposalStatus)] ?? PROPOSAL_META.draft

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 15, color: T.TEXT, fontWeight: 700 }}>{e.name}</span>
            <span style={{ fontSize: 14, color: T.TEXT, fontWeight: 800 }}>{fmtMoney(e.pricing.total)}</span>
            {/* Colored proposal-status pill — the at-a-glance lifecycle state. */}
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: pm.color, background: pm.bg, border: `1px solid ${pm.border}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
              {pm.label}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 5, fontSize: 12, color: T.MUTED }}>
            {chips.map((c, i) => <span key={i}>{c}</span>)}
          </div>
          {/* Frozen-copy affordance + attached date, one quiet line. */}
          <div style={{ fontSize: 11, color: T.DIM, marginTop: 6 }}>Snapshot taken {fmtDate(e.attached_at)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button style={smallBtn} onClick={onToggle}>{expanded ? "Hide" : "View"}</button>
          <button
            style={{ ...smallBtn, color: T.ERROR, opacity: detaching ? 0.6 : 1 }}
            disabled={detaching}
            onClick={onDetach}
          >
            {detaching ? "Removing…" : "Detach"}
          </button>
        </div>
      </div>

      {/* Proposal-status control — free-set any of the four. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.DIM }}>Proposal</span>
        <div style={{ display: "inline-flex", borderRadius: 8, border: `1px solid ${T.BORDER_SOFT}`, overflow: "hidden", opacity: proposalBusy ? 0.6 : 1 }}>
          {PROPOSAL_ORDER.map((st, i) => {
            const active = e.proposal_status === st
            const m = PROPOSAL_META[st]
            // Hover only on a non-active, non-busy stage. Neutral lift (white
            // fill + brighter text/divider), distinct from the active fill.
            const isHover = hoveredStatus === st && !active && !proposalBusy
            return (
              <button
                key={st}
                type="button"
                disabled={proposalBusy || active}
                onClick={() => onSetStatus(st)}
                onMouseEnter={() => { if (!active && !proposalBusy) setHoveredStatus(st) }}
                onMouseLeave={() => setHoveredStatus((h) => (h === st ? null : h))}
                aria-pressed={active}
                style={{
                  background: active ? m.bg : isHover ? "rgba(255,255,255,0.06)" : "transparent",
                  color: active ? m.color : isHover ? T.TEXT : T.MUTED,
                  border: "none",
                  borderLeft: i === 0 ? "none" : `1px solid ${isHover ? T.BORDER : T.BORDER_SOFT}`,
                  padding: "6px 12px",
                  fontSize: 11, fontWeight: 800,
                  // Pointer on every stage (active too) so the control reads as
                  // interactive; default only while a PATCH is in flight.
                  cursor: proposalBusy ? "default" : "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 130ms ease, color 130ms ease, border-color 130ms ease",
                }}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Prospect-page nudge near an approved proposal — informational, NOT a convert trigger. */}
      {showConvertNudge && e.proposal_status === "approved" && (
        <div style={{ fontSize: 11, color: T.DIM, marginTop: 8, fontStyle: "italic" }}>
          Approved — convert this prospect from the Pipeline above when you&apos;re ready.
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.BORDER_SOFT}`, display: "flex", flexDirection: "column", gap: 10 }}>
          {e.deliverables.length === 0 ? (
            <p style={{ fontSize: 12, color: T.DIM, margin: 0 }}>This package had no deliverables.</p>
          ) : (
            e.deliverables.map((d) => (
              <DeliverableBlock
                key={d.id}
                d={d}
                settingActivityId={settingActivityId}
                onSetActivityStatus={onSetActivityStatus}
                onSetActivityDueDate={onSetActivityDueDate}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── Deliverable sub-block: inset surface + coral left accent + nested activities ──
function DeliverableBlock({
  d, settingActivityId, onSetActivityStatus, onSetActivityDueDate,
}: {
  d: EngDeliverable
  settingActivityId: string | null
  onSetActivityStatus: (activityId: string, status: string) => void
  onSetActivityDueDate: (activityId: string, dueDate: string | null) => void
}) {
  return (
    <div style={{ display: "flex", borderRadius: 10, border: `1px solid ${T.BORDER_SOFT}`, background: T.NAV_DEFAULT_BG, overflow: "hidden" }}>
      {/* Thin coral left-accent bar (inner element → block keeps rounded corners). */}
      <div aria-hidden style={{ width: 3, alignSelf: "stretch", background: T.WRN_ORANGE, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {/* Deliverable name = primary/bright tier. */}
          <span style={{ fontSize: 13, color: T.TEXT, fontWeight: 700 }}>{d.name}</span>
          <span style={{ fontSize: 12, color: d.fee === null ? T.DIM : T.MUTED, fontWeight: 600 }}>{fmtFee(d.fee)}</span>
          {d.category && (
            <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.WRN_ORANGE, background: "rgba(254,176,106,0.10)", border: `1px solid ${T.NAV_ACTIVE_BORDER}`, borderRadius: 6, padding: "1px 6px" }}>
              {d.category}
            </span>
          )}
        </div>

        {d.activities.length > 0 && (
          <div style={{ marginTop: 6, paddingLeft: 10 }}>
            {d.activities.map((a, i) => (
              <div
                key={a.id}
                style={{
                  display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 12,
                  padding: "6px 0",
                  borderTop: i === 0 ? "none" : `1px solid ${T.BORDER_SOFT}`, // hairline dividers
                }}
              >
                {/* Activity name = secondary/muted tier (a step below the deliverable). */}
                <span style={{ color: T.MUTED }}>{a.name}</span>
                <span style={{ color: T.DIM }}>· {OWNER_LABEL[a.owner] ?? a.owner}</span>
                {/* Optional due date — native picker, set/clear writes due_date. */}
                <ActivityDueDateControl
                  value={a.due_date}
                  busy={settingActivityId === a.id}
                  onSet={(due) => onSetActivityDueDate(a.id, due)}
                />
                {/* Interactive colored completion control (compact; sits to the right). */}
                <ActivityStatusControl
                  value={a.status}
                  busy={settingActivityId === a.id}
                  onSet={(s) => onSetActivityStatus(a.id, s)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Optional per-activity due date — native date picker, app tokens. Empty =
//    no date (muted); set = blue. Clearing (native ✕) sends "" → null. The input
//    is both the display and the control; shares the row's in-flight lock. ──
function ActivityDueDateControl({
  value, busy, onSet,
}: {
  value: string | null
  busy: boolean
  onSet: (dueDate: string | null) => void
}) {
  return (
    <input
      type="date"
      aria-label="Activity due date"
      value={value ?? ""}
      disabled={busy}
      onChange={(ev) => onSet(ev.target.value === "" ? null : ev.target.value)}
      style={{
        background: T.NAV_DEFAULT_BG,
        color: value ? T.WRN_BLUE : T.MUTED,
        border: `1px solid ${T.BORDER_SOFT}`,
        borderRadius: 7,
        padding: "3px 7px",
        fontSize: 11,
        fontWeight: 700,
        colorScheme: "dark", // dark native calendar/spinners on the dark surface
        opacity: busy ? 0.6 : 1,
        cursor: busy ? "default" : "pointer",
      }}
    />
  )
}

// ── Compact 3-way activity status control (mirrors the proposal control's
//    hover / active / in-flight interaction; smaller, on the activity row) ──
function ActivityStatusControl({
  value, busy, onSet,
}: {
  value: string
  busy: boolean
  onSet: (status: string) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div
      role="group"
      aria-label="Activity status"
      style={{ marginLeft: "auto", display: "inline-flex", flexShrink: 0, borderRadius: 7, border: `1px solid ${T.BORDER_SOFT}`, overflow: "hidden", opacity: busy ? 0.6 : 1 }}
    >
      {ACTIVITY_STATUS_ORDER.map((st, i) => {
        const active = value === st
        const m = ACTIVITY_STATUS_META[st]
        const isHover = hovered === st && !active && !busy
        return (
          <button
            key={st}
            type="button"
            disabled={busy || active}
            onClick={() => onSet(st)}
            onMouseEnter={() => { if (!active && !busy) setHovered(st) }}
            onMouseLeave={() => setHovered((h) => (h === st ? null : h))}
            aria-pressed={active}
            style={{
              background: active ? m.bg : isHover ? "rgba(255,255,255,0.06)" : "transparent",
              color: active ? m.color : isHover ? T.TEXT : T.MUTED,
              border: "none",
              borderLeft: i === 0 ? "none" : `1px solid ${isHover ? T.BORDER : T.BORDER_SOFT}`,
              padding: "4px 9px",
              fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
              cursor: busy ? "default" : "pointer",
              whiteSpace: "nowrap",
              transition: "background 130ms ease, color 130ms ease, border-color 130ms ease",
            }}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

const smallBtn: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${T.BORDER_SOFT}`,
  color: T.MUTED,
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  padding: "6px 10px",
}

function Banner({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) {
  const palette =
    kind === "error"
      ? { color: T.ERROR, bg: T.ERROR_BG, border: "rgba(255,120,120,0.30)" }
      : kind === "success"
      ? { color: T.SUCCESS, bg: T.SUCCESS_BG, border: "rgba(74,222,128,0.30)" }
      : { color: T.WRN_BLUE, bg: "rgba(81,173,229,0.10)", border: "rgba(81,173,229,0.30)" }
  return (
    <div style={{ fontSize: 12, color: palette.color, background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 10, padding: "10px 12px" }}>
      {children}
    </div>
  )
}
