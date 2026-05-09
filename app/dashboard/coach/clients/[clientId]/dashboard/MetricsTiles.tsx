"use client"

import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"

export type MetricsApp = {
  id: string
  application_status: string
  created_at: string | null
}

const TILE_DEFS = [
  { key: "applications", label: "Applications", color: "rgba(255,255,255,0.85)", filterStatus: "all" as const },
  { key: "interviews",   label: "Interviews",   color: "#a78bfa",                filterStatus: "interviewing" as const },
  { key: "offers",       label: "Offers",       color: "#4ade80",                filterStatus: "offer" as const },
  { key: "rejections",   label: "Rejections",   color: "#E87070",                filterStatus: "rejected" as const },
] as const

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type Counts = { lifetime: number; thisWeek: number }

function countsForBucket(apps: MetricsApp[], statusFilter: "all" | string, weekAgoIso: string): Counts {
  let lifetime = 0
  let thisWeek = 0
  for (const a of apps) {
    if (statusFilter !== "all" && a.application_status !== statusFilter) continue
    lifetime++
    if (a.created_at && a.created_at > weekAgoIso) thisWeek++
  }
  return { lifetime, thisWeek }
}

type Props = {
  apps: MetricsApp[]
  // Click handler navigates to Job Tracker with status filter pre-applied.
  onTileClick: (filterStatus: "all" | "interviewing" | "offer" | "rejected") => void
}

export function MetricsTiles({ apps, onTileClick }: Props) {
  const weekAgoIso = new Date(Date.now() - WEEK_MS).toISOString()

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        marginBottom: 24,
      }}
    >
      {TILE_DEFS.map((def) => {
        const c = countsForBucket(apps, def.filterStatus, weekAgoIso)
        return (
          <button
            key={def.key}
            onClick={() => onTileClick(def.filterStatus)}
            style={{
              ...card,
              padding: "16px 18px",
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color 0.12s, background 0.12s",
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget.style as any).borderColor = "rgba(254,176,106,0.28)"
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget.style as any).borderColor = T.BORDER_SOFT
            }}
            aria-label={`${def.label}: ${c.lifetime} total${c.thisWeek > 0 ? `, ${c.thisWeek} this week` : ""}`}
          >
            <div style={{ ...eyebrow, color: T.DIM, fontSize: 9, marginBottom: 6 }}>
              {def.label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 950, color: def.color, lineHeight: 1.1, letterSpacing: -1 }}>
              {c.lifetime}
            </div>
            {c.thisWeek > 0 && (
              <div style={{ fontSize: 11, color: T.WRN_ORANGE, fontWeight: 700, marginTop: 4 }}>
                +{c.thisWeek} this week
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
