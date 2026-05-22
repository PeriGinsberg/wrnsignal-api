"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"

type Priority = "urgent" | "this_week" | "when_ready"

type ActionItem = {
  note_id: string
  body: string
  priority: Priority
  created_at: string
  completed_at: string | null
}

// EngagementSignal shape mirrors the server's runHeuristics() return —
// keep in sync with app/api/_lib/coachEngagementHeuristics.ts.
type EngagementSignalKind =
  | "no_login"
  | "rec_pending_review"
  | "moved_interviewing"
  | "moved_rejected"
  | "offer_no_followup"
  | "poor_fit_no_rec"

type EngagementSignal = {
  id: string
  kind: EngagementSignalKind
  client_profile_id: string
  client_name: string
  message: string
  days_elapsed: number
}

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  this_week: "This Week",
  when_ready: "When Ready",
}

const PRIORITY_BADGE: Record<Priority, { bg: string; color: string }> = {
  urgent: { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
  this_week: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  when_ready: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
}

// Engagement-signal rule pill — matches the Coach Home Engagement Signals
// row treatment for visual consistency across surfaces.
const RULE_LABEL: Record<EngagementSignalKind, string> = {
  no_login: "Inactive",
  rec_pending_review: "Awaiting review",
  moved_interviewing: "Status change",
  moved_rejected: "Rejection",
  offer_no_followup: "Offer",
  poor_fit_no_rec: "Low-fit app",
}
const RULE_COLOR: Record<EngagementSignalKind, string> = {
  no_login: "#FEB06A",
  rec_pending_review: "#51ADE5",
  moved_interviewing: "#a78bfa",
  moved_rejected: "#E87070",
  offer_no_followup: "#4ade80",
  poor_fit_no_rec: "#FBBF24",
}

const VISIBLE_CAP = 5

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  clientId: string
  // Bumped externally to force a reload (e.g., after Add Note slide-in saves)
  refreshKey: number
}

export function NeedsAttentionSection({ authFetch, clientId, refreshKey }: Props) {
  const router = useRouter()
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [engagementSignals, setEngagementSignals] = useState<EngagementSignal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/needs-attention`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Couldn't load")
        setActionItems([])
        setEngagementSignals([])
      } else {
        // Phase 3 Commit 3.0: response shape is { actionItems, engagementSignals }
        // (was a flat { items } prior — that key no longer returned).
        setActionItems(j.actionItems || [])
        setEngagementSignals(j.engagementSignals || [])
      }
    } catch {
      setError("Network error")
      setActionItems([])
      setEngagementSignals([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, refreshKey])

  async function complete(item: ActionItem) {
    setBusyId(item.note_id)
    try {
      const res = await authFetch(`/api/coach/clients/${clientId}/note-feed/${item.note_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at: new Date().toISOString() }),
      })
      const j = await res.json().catch(() => null)
      if (res.ok && j?.ok) {
        // Optimistic remove from list since the row is now closed.
        setActionItems((prev) => prev.filter((i) => i.note_id !== item.note_id))
      } else {
        setError(j?.error || "Couldn't mark complete")
      }
    } catch {
      setError("Network error")
    }
    setBusyId(null)
  }

  const visibleActions = actionItems.slice(0, VISIBLE_CAP)
  const visibleSignals = engagementSignals.slice(0, VISIBLE_CAP)
  const hasContent = actionItems.length > 0 || engagementSignals.length > 0
  const totalCount = actionItems.length + engagementSignals.length

  return (
    <section style={{ ...card, padding: 22, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 10 }}>
          NEEDS YOUR ATTENTION
        </div>
        {totalCount > 0 && (
          <span style={{ fontSize: 11, color: T.DIM }}>
            {totalCount} {totalCount === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#f87171" }}>Couldn&apos;t load: {error}</span>
        </div>
      )}

      {loading && !hasContent ? (
        <p style={{ color: T.DIM, fontSize: 13 }}>Loading…</p>
      ) : !hasContent ? (
        <p style={{ color: T.MUTED, fontSize: 13, fontStyle: "italic" }}>No items due</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* ── Action Items (coach-authored, top per Q2 design lock) ── */}
          {actionItems.length > 0 && (
            <div>
              <div style={{ ...eyebrow, color: T.DIM, fontSize: 9, marginBottom: 8 }}>
                ACTION ITEMS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {visibleActions.map((item) => {
                  const badge = PRIORITY_BADGE[item.priority]
                  return (
                    <div
                      key={item.note_id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "rgba(255,255,255,0.025)",
                        border: `1px solid ${T.BORDER_SOFT}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={busyId === item.note_id}
                        onChange={() => complete(item)}
                        style={{ accentColor: T.WRN_ORANGE, width: 16, height: 16, marginTop: 2, cursor: "pointer" }}
                        aria-label="Mark complete"
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            fontSize: 9,
                            fontWeight: 900,
                            letterSpacing: 0.8,
                            textTransform: "uppercase",
                            padding: "2px 8px",
                            borderRadius: 999,
                            marginRight: 8,
                          }}
                        >
                          {PRIORITY_LABEL[item.priority]}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            color: T.TEXT,
                            lineHeight: 1.5,
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {item.body}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Engagement Signals (system-detected R1-R6) ── */}
          {engagementSignals.length > 0 && (
            <div>
              <div style={{ ...eyebrow, color: T.DIM, fontSize: 9, marginBottom: 8 }}>
                ENGAGEMENT SIGNALS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {visibleSignals.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => router.push(`/dashboard/coach/clients/${item.client_profile_id}`)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px",
                      background: "rgba(255,255,255,0.025)",
                      border: `1px solid ${T.BORDER_SOFT}`,
                      borderRadius: 10,
                      cursor: "pointer",
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
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
