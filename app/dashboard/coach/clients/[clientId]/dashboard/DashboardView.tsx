"use client"

import { useCallback, useEffect, useState } from "react"
import { SinceLastVisitStrip } from "./SinceLastVisitStrip"
import { MetricsTiles, type ClientDashboardMetrics } from "./MetricsTiles"
import { MethodologyPlaceholder } from "./MethodologyPlaceholder"
import { NeedsAttentionSection } from "./NeedsAttentionSection"
import { RecentNotesSection } from "./RecentNotesSection"

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  clientId: string
  notesRefreshKey: number
  needsAttentionRefreshKey: number
  onTileClick: (filterStatus: "all" | "interviewing" | "offer" | "rejected") => void
  onNavigateToNotesTab: () => void
}

// Wraps the four dashboard sections + the conditional since-last-visit
// strip. Header strip + tab bar live in page.tsx (persistent across
// tab switches, not part of the dashboard view itself).
//
// Metric tile values come from /api/coach/clients/[clientId]/metrics
// (Phase 2 Commit 2.4 — server-aggregated to share the status-history-
// or-fallback rule with the Coach Home metrics).
export function DashboardView({
  authFetch,
  clientId,
  notesRefreshKey,
  needsAttentionRefreshKey,
  onTileClick,
  onNavigateToNotesTab,
}: Props) {
  const [metrics, setMetrics] = useState<ClientDashboardMetrics>({
    totalJobs: 0,
    interviews: 0,
    offers: 0,
    rejected: 0,
  })

  const loadMetrics = useCallback(async () => {
    const res = await authFetch(`/api/coach/clients/${clientId}/metrics`)
    if (!res.ok) return
    const j = await res.json()
    if (j?.metrics) setMetrics(j.metrics as ClientDashboardMetrics)
  }, [authFetch, clientId])

  useEffect(() => { loadMetrics() }, [loadMetrics])

  return (
    <div>
      <SinceLastVisitStrip authFetch={authFetch} clientId={clientId} />

      <MetricsTiles metrics={metrics} onTileClick={onTileClick} />

      <MethodologyPlaceholder />

      <NeedsAttentionSection
        authFetch={authFetch}
        clientId={clientId}
        refreshKey={needsAttentionRefreshKey}
      />

      <RecentNotesSection
        authFetch={authFetch}
        clientId={clientId}
        refreshKey={notesRefreshKey}
        onNavigateToNotesTab={onNavigateToNotesTab}
      />
    </div>
  )
}
