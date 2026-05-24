"use client"

// Shared list component for the cross-client Action Items surfaces:
//   - Coach Home (urgent + this_week, capped at 5–7, "+ N more" footer)
//   - Required Actions tab (all priorities, no cap)
//
// Hits /api/coach/action-items. Each row is a button that navigates to
// that client's dashboard on click; the inline completion checkbox calls
// Phase 1's PUT note to mark complete and optimistically removes the row.
//
// Underscore-prefixed parent dir keeps this out of Next.js routing.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { T } from "../../../../lib/dashboard-theme"
import { onCoachRowEnter, onCoachRowLeave, COACH_ROW_DEFAULT_BG, COACH_ROW_TRANSITION } from "../coachRowHover"

export type Priority = "urgent" | "this_week" | "when_ready"

export type CrossClientActionItem = {
  note_id: string
  body: string
  priority: Priority
  created_at: string
  // Nullable for prospect-attached notes (lifecycle='Prospect' or
  // post-conversion-pre-invite). Prospects v0.1 Commit 3 added
  // coach_client_id to the response so consumers can route via it
  // when client_id is null.
  client_id: string | null
  coach_client_id: string
  client_name: string | null
  client_email: string | null
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

// Avatar palette mirrors Coach Home / Client Dashboard so a given client
// gets a consistent color across surfaces.
const AVATAR_PALETTE = [
  { bg: "rgba(81,173,229,0.18)",  text: "#9FC9EE" },
  { bg: "rgba(254,176,106,0.18)", text: "#FECDA0" },
  { bg: "rgba(167,139,250,0.18)", text: "#C8B6F8" },
  { bg: "rgba(244,114,182,0.18)", text: "#F4ADC9" },
  { bg: "rgba(74,222,128,0.18)",  text: "#9CE7B5" },
] as const

function hashSlot(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i)
  return Math.abs(h) % AVATAR_PALETTE.length
}

function initialsOf(name: string | null, email: string | null): string {
  const src = (name && name.trim()) || (email && email.trim()) || "?"
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  // Bumped externally to force a reload (e.g., after AddNote save elsewhere).
  refreshKey?: number
  // Comma-joined priority filter for the endpoint, e.g. "urgent,this_week".
  // Omit to fetch all three priorities.
  priorities?: string
  // Cap visible items. Anything beyond the cap is replaced by a single
  // "+ N more in Required Actions" footer link.
  cap?: number
  // Footer href for the "+ N more" link. Omit if cap is undefined.
  moreHref?: string
  // Empty-state copy.
  emptyText: string
  // Body truncation: 2 lines on Coach Home (compact), 3 on Required
  // Actions tab (more room).
  bodyLineClamp?: number
  // Section title eyebrow shown above the list. Omit if the consumer
  // renders its own section wrapper (e.g., Coach Home's Section).
  sectionTitle?: string
  // Loading / error renderers — minimal defaults provided.
}

export function CrossClientActionItemsList({
  authFetch,
  refreshKey = 0,
  priorities,
  cap,
  moreHref,
  emptyText,
  bodyLineClamp = 3,
  sectionTitle,
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState<CrossClientActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const qs = priorities ? `?priorities=${encodeURIComponent(priorities)}` : ""
    try {
      const res = await authFetch(`/api/coach/action-items${qs}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setError(j?.error || "Couldn't load")
        setItems([])
      } else {
        setItems(j.items || [])
      }
    } catch {
      setError("Network error")
      setItems([])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, priorities])

  async function complete(item: CrossClientActionItem) {
    setBusyId(item.note_id)
    // Prospect notes (client_id null) live at a different URL than
    // client-keyed notes. Route accordingly.
    const url = item.client_id
      ? `/api/coach/clients/${item.client_id}/note-feed/${item.note_id}`
      : `/api/coach/prospects/${item.coach_client_id}/notes/${item.note_id}`
    try {
      const res = await authFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at: new Date().toISOString() }),
      })
      const j = await res.json().catch(() => null)
      if (res.ok && j?.ok) {
        // Optimistic remove — completed action items shouldn't appear here.
        setItems((prev) => prev.filter((i) => i.note_id !== item.note_id))
      } else {
        setError(j?.error || "Couldn't mark complete")
      }
    } catch {
      setError("Network error")
    }
    setBusyId(null)
  }

  const visible = typeof cap === "number" ? items.slice(0, cap) : items
  const overflow = typeof cap === "number" && items.length > cap ? items.length - cap : 0

  return (
    <div>
      {sectionTitle && (
        <div
          style={{
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: T.WRN_ORANGE,
            marginBottom: 12,
          }}
        >
          {sectionTitle}
        </div>
      )}

      {error && (
        <div style={{ padding: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#f87171" }}>Couldn&apos;t load: {error}</span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <p style={{ color: T.DIM, fontSize: 13 }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, fontStyle: "italic", margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((item) => {
            const badge = PRIORITY_BADGE[item.priority]
            const slot = AVATAR_PALETTE[hashSlot((item.client_name || item.client_email || "?").toLowerCase())]
            return (
              <div
                key={item.note_id}
                onClick={() => {
                  const href = item.client_id
                    ? `/dashboard/coach/clients/${item.client_id}`
                    : `/dashboard/coach/prospects/${item.coach_client_id}`
                  router.push(href)
                }}
                onMouseEnter={onCoachRowEnter}
                onMouseLeave={(e) => onCoachRowLeave(e)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: COACH_ROW_DEFAULT_BG,
                  border: `1px solid ${T.BORDER_SOFT}`,
                  cursor: "pointer",
                  transition: COACH_ROW_TRANSITION,
                }}
              >
                <input
                  type="checkbox"
                  disabled={busyId === item.note_id}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation()
                    complete(item)
                  }}
                  style={{ accentColor: T.WRN_ORANGE, width: 16, height: 16, marginTop: 4, cursor: "pointer" }}
                  aria-label="Mark complete"
                />

                {/* Mini avatar for cross-client visual scan */}
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: slot.bg,
                    color: slot.text,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 950,
                    letterSpacing: 0.3,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {initialsOf(item.client_name, item.client_email)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
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
                      }}
                    >
                      {PRIORITY_LABEL[item.priority]}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: T.TEXT,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 220,
                      }}
                    >
                      {item.client_name || item.client_email || "Unknown client"}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: T.MUTED,
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: bodyLineClamp,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.body}
                  </div>
                </div>
              </div>
            )
          })}

          {overflow > 0 && moreHref && (
            <button
              onClick={() => router.push(moreHref)}
              style={{
                background: "none",
                border: "none",
                color: T.WRN_ORANGE,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                padding: "8px 0 0",
                textAlign: "left",
                marginTop: 4,
              }}
            >
              + {overflow} more in Required Actions →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
