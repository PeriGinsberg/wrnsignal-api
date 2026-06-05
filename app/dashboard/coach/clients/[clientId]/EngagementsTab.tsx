"use client"

// Engagements tab — the client's attached package snapshots (frozen copies).
// Keyed by coach_clients.id, which this page resolves once on load (the profile
// route returns coach_client_id) and passes in. The engagement API:
//   GET    /api/coach/coach-clients/[ccId]/engagements
//   POST   /api/coach/coach-clients/[ccId]/engagements   { package_id }
//   GET    /api/coach/coach-clients/[ccId]/engagements/[engagement_id]
//   DELETE /api/coach/coach-clients/[ccId]/engagements/[engagement_id]
//
// READ-ONLY this slice: activity status is displayed (a quiet pill) but not
// editable — the interactive control is the next slice. Optimistic on success;
// on any write failure show a banner AND resync. The server (toApiEngagement) is
// the source of truth for ALL pricing — no client-side recompute. Dollars only.
//
// getToken/authFetch inlined per the coach-route client convention (same pair as
// NotesTab / PackagesTab).

import { useCallback, useEffect, useState } from "react"
import { T, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

type EngActivity = { id: string; name: string; owner: string; status: string; sort_order: number }
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
type Engagement = {
  id: string
  name: string
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
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: "Not started", color: T.MUTED, bg: "rgba(255,255,255,0.05)" },
  in_progress: { label: "In progress", color: T.WRN_BLUE, bg: "rgba(81,173,229,0.12)" },
  complete: { label: "Complete", color: T.SUCCESS, bg: "rgba(74,222,128,0.12)" },
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

export function EngagementsTab({ coachClientId, clientName }: { coachClientId: string | null; clientName: string }) {
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
      setItems((prev) => [j.engagement as Engagement, ...prev]) // newest first
      setPickerOpen(false)
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setAttachingId(null)
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
              onToggle={() => setExpandedId((prev) => (prev === e.id ? null : e.id))}
              onDetach={() => void detach(e.id)}
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

// ── One engagement card (collapsed summary + expandable frozen snapshot) ──
function EngagementCard({
  e, expanded, detaching, onToggle, onDetach,
}: {
  e: Engagement
  expanded: boolean
  detaching: boolean
  onToggle: () => void
  onDetach: () => void
}) {
  const count = e.deliverables.length
  const acts = countActivities(e)
  const chips: string[] = [
    `${count} deliverable${count === 1 ? "" : "s"}`,
    `${acts} activit${acts === 1 ? "y" : "ies"}`,
  ]
  if (e.discount != null && e.discount > 0) chips.push(`${fmtMoney(e.discount)} off`)
  if (e.pricing.unpriced_count > 0) chips.push(`${e.pricing.unpriced_count} unpriced`)

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
            <span style={{ fontSize: 15, color: T.TEXT, fontWeight: 700 }}>{e.name}</span>
            <span style={{ fontSize: 14, color: T.TEXT, fontWeight: 800 }}>{fmtMoney(e.pricing.total)}</span>
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

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.BORDER_SOFT}`, display: "flex", flexDirection: "column", gap: 12 }}>
          {e.deliverables.length === 0 ? (
            <p style={{ fontSize: 12, color: T.DIM, margin: 0 }}>This package had no deliverables.</p>
          ) : (
            e.deliverables.map((d) => (
              <div key={d.id}>
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 13, color: T.TEXT, fontWeight: 600 }}>{d.name}</span>
                  <span style={{ fontSize: 12, color: d.fee === null ? T.DIM : T.MUTED, fontWeight: 600 }}>{fmtFee(d.fee)}</span>
                  {d.category && <span style={{ fontSize: 11, color: T.DIM }}>· {d.category}</span>}
                </div>
                {d.activities.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, paddingLeft: 10 }}>
                    {d.activities.map((a) => {
                      const s = STATUS_META[a.status] ?? STATUS_META.not_started
                      return (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ color: T.TEXT }}>{a.name}</span>
                          <span style={{ color: T.DIM }}>· {OWNER_LABEL[a.owner] ?? a.owner}</span>
                          {/* Read-only status pill (interactive control ships next slice). */}
                          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: s.color, background: s.bg, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
                            {s.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
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
