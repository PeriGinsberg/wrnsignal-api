"use client"

// Client Dashboard metric tiles (Phase 2 Commit 2.4).
//
// 4-tile set per locked spec:
//   - Total Jobs    all-time count of signal_applications for this client
//   - Interviews    apps with current status 'interviewing' OR transitioned
//                   to 'interviewing' in last 30 days
//   - Offers        same logic with 'offer' (last 30 days)
//   - Rejected      same logic with 'rejected' (last 30 days)
//
// Values come pre-computed from /api/coach/clients/[clientId]/metrics
// (the endpoint applies the status-history-or-fallback rule shared
// with the Coach Home aggregator). Tile click still navigates to the
// Job Tracker tab with a status filter pre-applied, same UX as before.

import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"
import { type MetricsWindow, windowSubtitle } from "../../../MetricsWindowToggle"

export type ClientDashboardMetrics = {
  totalJobs: number
  interviews: number
  offers: number
  rejected: number
}

type FilterStatus = "all" | "interviewing" | "offer" | "rejected"

type TileDef = {
  key: keyof ClientDashboardMetrics
  label: string
  color: string
  filterStatus: FilterStatus
  // Phase 5: when `windowed` is true, subtitle reflects the active
  // window. totalJobs is intentionally NOT windowed — its subtitle
  // stays "All-time" regardless of toggle state.
  windowed: boolean
}

const TILE_DEFS: readonly TileDef[] = [
  { key: "totalJobs",  label: "Total Jobs",  color: "rgba(255,255,255,0.85)", filterStatus: "all",          windowed: false },
  { key: "interviews", label: "Interviews",  color: "#a78bfa",                filterStatus: "interviewing", windowed: true },
  { key: "offers",     label: "Offers",      color: "#4ade80",                filterStatus: "offer",        windowed: true },
  { key: "rejected",   label: "Rejected",    color: "#E87070",                filterStatus: "rejected",     windowed: true },
] as const

type Props = {
  metrics: ClientDashboardMetrics
  metricsWindow: MetricsWindow
  onTileClick: (filterStatus: FilterStatus) => void
}

export function MetricsTiles({ metrics, metricsWindow, onTileClick }: Props) {
  const dynamicSubtitle = windowSubtitle(metricsWindow)
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
        const value = metrics[def.key]
        const subtitle = def.windowed ? dynamicSubtitle : "All-time"
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
            aria-label={`${def.label}: ${value} (${subtitle})`}
          >
            <div style={{ ...eyebrow, color: T.DIM, fontSize: 9, marginBottom: 6 }}>
              {def.label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 950, color: def.color, lineHeight: 1.1, letterSpacing: -1 }}>
              {value}
            </div>
            <div style={{ fontSize: 10, color: T.DIM, fontWeight: 600, marginTop: 4 }}>
              {subtitle}
            </div>
          </button>
        )
      })}
    </div>
  )
}
