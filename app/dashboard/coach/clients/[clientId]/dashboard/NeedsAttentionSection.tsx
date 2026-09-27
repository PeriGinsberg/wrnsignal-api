"use client"

import { useEffect, useState } from "react"
import { SPACE, TYPE } from "../../../../../../lib/theme/surfaces"
import { useRouter } from "next/navigation"
import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"
import { DismissSignalButton, useDismissSignal } from "../../../DismissSignalButton"

// A COACHING TASK HAS NO PRIORITY. This section used to list
// coach_client_notes, which carried one; it now lists coach_tasks, which do
// not, and the API sends "" for every row. The empty string is part of the
// shape, so it is in the type: leaving it out is what let PRIORITY_BADGE[""]
// be written and typecheck.
type Priority = "urgent" | "this_week" | "when_ready" | ""

type ActionItem = {
  note_id: string
  body: string
  priority: Priority
  /** The task's due date. What replaced priority as this list's urgency. */
  due_at?: string | null
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

// Exhaustive over Priority, INCLUDING "". A Record<Priority, …> that covers
// every value the type allows cannot be indexed into undefined, and adding a
// value to Priority without adding it here fails the typecheck rather than
// crashing a page.
const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  this_week: "This Week",
  when_ready: "When Ready",
  "": "",
}

const PRIORITY_BADGE: Record<Priority, { bg: string; color: string }> = {
  urgent: { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
  this_week: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  when_ready: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
  // Never rendered: a row with no priority shows no badge. Present so the
  // lookup cannot return undefined even if a future caller forgets the guard.
  "": { bg: "transparent", color: T.DIM },
}

/**
 * The style for a priority, whatever arrives.
 *
 * BELT AND BRACES, DELIBERATELY. The map above is exhaustive over the type, so
 * this should be unreachable. It exists because the type is a promise about
 * what the SERVER sends, and the server is a different deploy: a value added
 * there reaches this component before the type here knows about it, and the
 * cost of being wrong was a client page that went white.
 */
function badgeFor(priority: string): { bg: string; color: string } {
  return PRIORITY_BADGE[priority as Priority] ?? PRIORITY_BADGE[""]
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

  // Phase 3 Commit 3.2 — dismiss wiring for the engagement signal
  // subsection. Action items don't get dismiss (only checkbox-complete).
  const { dismiss, toastNode } = useDismissSignal<EngagementSignal>({
    authFetch,
    onLocalRemove: (id) =>
      setEngagementSignals((prev) => prev.filter((x) => x.id !== id)),
    onLocalRestore: (s) =>
      setEngagementSignals((prev) => [...prev, s]),
  })

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
        <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: TYPE.label }}>
          NEEDS YOUR ATTENTION
        </div>
        {totalCount > 0 && (
          <span style={{ fontSize: TYPE.micro, color: T.DIM }}>
            {totalCount} {totalCount === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontSize: TYPE.secondary, color: "#f87171" }}>Couldn&apos;t load: {error}</span>
        </div>
      )}

      {loading && !hasContent ? (
        <p style={{ color: T.DIM, fontSize: TYPE.secondary }}>Loading…</p>
      ) : !hasContent ? (
        <p style={{ color: T.MUTED, fontSize: TYPE.secondary, fontStyle: "italic" }}>No open tasks.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* ── Tasks (top per Q2 design lock). The data has been coach_tasks
              since 2026-09-26; the label caught up on 2026-09-25. ── */}
          {actionItems.length > 0 && (
            <div>
              <div style={{ ...eyebrow, color: T.DIM, fontSize: TYPE.micro, marginBottom: 8 }}>
                TASKS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {visibleActions.map((item) => {
                  const badge = badgeFor(item.priority)
                  const label = PRIORITY_LABEL[item.priority as Priority] ?? ""
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
                        {/* NO BADGE WHEN THERE IS NO PRIORITY. A task genuinely
                            has none, and an empty pill is worse than no pill:
                            it reads as a label that failed to load. */}
                        {label && (
                        <span
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            fontSize: TYPE.micro,
                            fontWeight: 900,
                            letterSpacing: 0.8,
                            textTransform: "uppercase",
                            padding: "2px 8px",
                            borderRadius: 999,
                            marginRight: 8,
                          }}
                        >
                          {label}
                        </span>
                        )}
                        <span
                          style={{
                            fontSize: TYPE.secondary,
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
              <div style={{ ...eyebrow, color: T.DIM, fontSize: TYPE.micro, marginBottom: 8 }}>
                ENGAGEMENT SIGNALS
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {visibleSignals.map((item) => (
                  <NeedsAttentionSignalRow
                    key={item.id}
                    item={item}
                    onClick={() => router.push(`/dashboard/coach/clients/${item.client_profile_id}`)}
                    onDismiss={dismiss}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {toastNode}
    </section>
  )
}

// Inline row for engagement signals inside NeedsAttentionSection.
// Hover state drives the dismiss button visibility — same pattern as
// ActionRow on Coach Home and EngagementSignalFullRow on the
// Required Actions page.
function NeedsAttentionSignalRow({
  item,
  onClick,
  onDismiss,
}: {
  item: EngagementSignal
  onClick: () => void
  onDismiss: (item: EngagementSignal) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px",
        background: hovered ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${T.BORDER_SOFT}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: "background 120ms ease",
      }}
    >
      <span style={{
        fontSize: TYPE.micro, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase",
        color: RULE_COLOR[item.kind], background: `${RULE_COLOR[item.kind]}1f`,
        padding: "3px 8px", borderRadius: 6, flexShrink: 0,
      }}>
        {RULE_LABEL[item.kind]}
      </span>
      <span style={{ fontSize: TYPE.secondary, color: T.TEXT, flex: 1 }}>{item.message}</span>
      <span style={{ fontSize: TYPE.micro, color: T.DIM, flexShrink: 0 }}>{item.days_elapsed}d</span>
      <DismissSignalButton
        onClick={() => onDismiss(item)}
        visible={hovered}
      />
    </div>
  )
}
