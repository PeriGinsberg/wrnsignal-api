"use client"

// Required Actions full list.
// Two sections (post-2026-05-09 Phase 4 + Item 7 build):
//   1. Action Items — coach-authored action item notes across all
//      clients (urgent → this_week → when_ready). Built on the new
//      /api/coach/action-items endpoint.
//   2. From Activity — Sprint 2 heuristic outputs from /api/coach/home
//      (no_login, rec_pending_review, status changes, offers, low-fit
//      apps). Preserved as-is from the v1 page.
//
// Pilot scope keeps these as separate sections (per SIGNAL PM scope
// correction 2026-05-09). Unification deferred to Item 8.

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { T, card, eyebrow } from "../../../../lib/dashboard-theme"
import { CrossClientActionItemsList } from "../_action-items/CrossClientActionItemsList"
import { BackToDashboard } from "../BackToDashboard"
import { DismissSignalButton, useDismissSignal } from "../DismissSignalButton"
import { LoadingShell } from "../LoadingShell"

// Feature flag — set to true to restore the Engagement Signals section
// below Action Items. When false, only Action Items renders. All data
// fetch, dismiss wiring, EngagementSignalFullRow component, RULE_LABEL/
// RULE_COLOR maps, and useDismissSignal hook stay in place; only the
// render is gated. Restore is a one-line flip.
const SHOW_ENGAGEMENT_SIGNALS = false

type HeuristicItem = {
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

const RULE_LABEL: Record<HeuristicItem["kind"], string> = {
  no_login: "Inactive",
  rec_pending_review: "Awaiting review",
  moved_interviewing: "Status change",
  moved_rejected: "Rejection",
  offer_no_followup: "Offer",
  poor_fit_no_rec: "Low-fit app",
}
const RULE_COLOR: Record<HeuristicItem["kind"], string> = {
  no_login: "#FEB06A",
  rec_pending_review: "#51ADE5",
  moved_interviewing: "#a78bfa",
  moved_rejected: "#E87070",
  offer_no_followup: "#4ade80",
  poor_fit_no_rec: "#FBBF24",
}

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

export default function RequiredActionsPage() {
  const router = useRouter()
  const [heuristics, setHeuristics] = useState<HeuristicItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch("/api/coach/home")
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) {
      const j = await res.json()
      setHeuristics(j.requiresAction || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Phase 3 Commit 3.2 — dismiss + undo wiring for the engagement
  // signal rows below. Hook owns toast state; setHeuristics is the
  // local-state mutator for optimistic remove + restore.
  const { dismiss, toastNode } = useDismissSignal<HeuristicItem>({
    authFetch,
    onLocalRemove: (id) =>
      setHeuristics((prev) => (prev ? prev.filter((x) => x.id !== id) : prev)),
    onLocalRestore: (s) =>
      setHeuristics((prev) => (prev ? [...prev, s] : [s])),
  })

  if (loading) return <LoadingShell />


  if (forbidden) {
    return (
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
      </div>
    )
  }

  const heuristicList = heuristics || []

  return (
    <div>
      <BackToDashboard />
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          Required Actions
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Action Items from your notes{SHOW_ENGAGEMENT_SIGNALS && " · Engagement Signals from client activity"}
        </p>
      </div>

      {/* Section 1: Action Items (coach-authored). 2px orange top accent
          mirrors the Coach Home pair treatment so the visual language
          matches across surfaces. */}
      <section style={{ ...card, padding: 22, marginBottom: 20, position: "relative" }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2,
            background: T.WRN_ORANGE, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          }}
        />
        <CrossClientActionItemsList
          authFetch={authFetch}
          sectionTitle="Action Items"
          emptyText="No items due"
          bodyLineClamp={3}
        />
      </section>

      {/* Section 2: Engagement Signals (heuristic — preserved v1
          content, renamed from "From Activity" 2026-05-09). 2px blue
          top accent matches the Coach Home pair treatment. */}
      {SHOW_ENGAGEMENT_SIGNALS && (
        <section style={{ ...card, padding: 22, position: "relative" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 2,
              background: T.WRN_BLUE, borderTopLeftRadius: 18, borderTopRightRadius: 18,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: T.WRN_BLUE,
              }}
            >
              Engagement Signals
            </div>
            {heuristicList.length > 0 && (
              <span style={{ fontSize: 11, color: T.DIM }}>{heuristicList.length}</span>
            )}
          </div>

          {heuristicList.length === 0 ? (
            <p style={{ color: T.MUTED, fontSize: 13, fontStyle: "italic", margin: 0 }}>
              Nothing flagged from activity right now.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {heuristicList.map((item) => (
                <EngagementSignalFullRow
                  key={item.id}
                  item={item}
                  onClick={() => router.push(`/dashboard/coach/clients/${item.client_profile_id}`)}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          )}
        </section>
      )}
      {toastNode}
    </div>
  )
}

// Inline row component for the Required Actions full page. Mirrors
// ActionRow on Coach Home but lives here to avoid cross-file imports
// of a private component. Tracks its own hover state so the dismiss
// button only appears on row hover (Phase 3 Commit 3.2).
function EngagementSignalFullRow({
  item,
  onClick,
  onDismiss,
}: {
  item: HeuristicItem
  onClick: () => void
  onDismiss: (item: HeuristicItem) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px",
        background: hovered ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)",
        border: `1px solid ${T.BORDER_SOFT}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: "background 120ms ease",
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
      <DismissSignalButton
        onClick={() => onDismiss(item)}
        visible={hovered}
      />
    </div>
  )
}
