"use client"

import { useEffect, useState } from "react"
import { T, eyebrow } from "../../../../../../lib/dashboard-theme"

type ActivityItem = {
  kind: "application_added" | "status_change" | "rec_response"
  text: string
  occurred_at: string
}

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  clientId: string
}

// Loads /since-last-visit. Renders only when there's activity.
// Dismiss hides for the rest of this session (component lifetime).
export function SinceLastVisitStrip({ authFetch, clientId }: Props) {
  const [baseline, setBaseline] = useState<string | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await authFetch(`/api/coach/clients/${clientId}/since-last-visit`)
        const j = await res.json().catch(() => null)
        if (!alive) return
        if (res.ok && j?.ok) {
          setBaseline(j.baseline ?? null)
          setActivity(j.activity ?? [])
          setTotalCount(j.total_count ?? 0)
        }
      } catch {
        // Silent — strip just doesn't render
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [authFetch, clientId])

  if (!loaded || dismissed || activity.length === 0) return null

  const baselineDate = baseline
    ? new Date(baseline).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: new Date(baseline).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      })
    : null

  const hidden = totalCount > activity.length ? totalCount - activity.length : 0

  return (
    <div
      style={{
        background: "rgba(81,173,229,0.06)",
        border: "1px solid rgba(81,173,229,0.22)",
        borderRadius: 14,
        padding: "14px 18px 14px 20px",
        marginBottom: 24,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ ...eyebrow, color: T.WRN_BLUE, fontSize: 9 }}>
          {baselineDate ? `Since your last visit on ${baselineDate}` : "Since your last visit"}
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            background: "none",
            border: "none",
            color: T.DIM,
            fontSize: 16,
            cursor: "pointer",
            padding: 2,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {activity.map((a, i) => (
          <li key={i} style={{ fontSize: 13, color: T.TEXT, lineHeight: 1.5, paddingLeft: 16, position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 9,
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: T.WRN_BLUE,
              }}
            />
            {a.text}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <div style={{ fontSize: 11, color: T.DIM, marginTop: 6, paddingLeft: 16 }}>
          + {hidden} more {hidden === 1 ? "update" : "updates"}
        </div>
      )}
    </div>
  )
}
