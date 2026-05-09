"use client"

import { SinceLastVisitStrip } from "./SinceLastVisitStrip"
import { MetricsTiles, type MetricsApp } from "./MetricsTiles"
import { MethodologyPlaceholder } from "./MethodologyPlaceholder"
import { NeedsAttentionSection } from "./NeedsAttentionSection"
import { RecentNotesSection } from "./RecentNotesSection"

type Props = {
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  clientId: string
  apps: MetricsApp[]
  notesRefreshKey: number
  needsAttentionRefreshKey: number
  onTileClick: (filterStatus: "all" | "interviewing" | "offer" | "rejected") => void
  onNavigateToNotesTab: () => void
}

// Wraps the four dashboard sections + the conditional since-last-visit
// strip. Header strip + tab bar live in page.tsx (persistent across
// tab switches, not part of the dashboard view itself).
export function DashboardView({
  authFetch,
  clientId,
  apps,
  notesRefreshKey,
  needsAttentionRefreshKey,
  onTileClick,
  onNavigateToNotesTab,
}: Props) {
  return (
    <div>
      <SinceLastVisitStrip authFetch={authFetch} clientId={clientId} />

      <MetricsTiles apps={apps} onTileClick={onTileClick} />

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
