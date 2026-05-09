"use client"

import { useEffect, useState } from "react"
import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"

type Priority = "urgent" | "this_week" | "when_ready"

type Item = {
  note_id: string
  body: string
  priority: Priority
  created_at: string
  completed_at: string | null
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

const VISIBLE_CAP = 5

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  clientId: string
  // Bumped externally to force a reload (e.g., after Add Note slide-in saves)
  refreshKey: number
}

export function NeedsAttentionSection({ authFetch, clientId, refreshKey }: Props) {
  const [items, setItems] = useState<Item[]>([])
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
  }, [clientId, refreshKey])

  async function complete(item: Item) {
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
        setItems((prev) => prev.filter((i) => i.note_id !== item.note_id))
      } else {
        setError(j?.error || "Couldn't mark complete")
      }
    } catch {
      setError("Network error")
    }
    setBusyId(null)
  }

  const visible = items.slice(0, VISIBLE_CAP)

  return (
    <section style={{ ...card, padding: 22, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 10 }}>
          NEEDS YOUR ATTENTION
        </div>
        {items.length > 0 && (
          <span style={{ fontSize: 11, color: T.DIM }}>
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#f87171" }}>Couldn&apos;t load: {error}</span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <p style={{ color: T.DIM, fontSize: 13 }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, fontStyle: "italic" }}>No items due</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((item) => {
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
      )}
    </section>
  )
}
