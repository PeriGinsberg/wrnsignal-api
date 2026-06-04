// Services settings domain.
//
// Domain page within the My Settings area. Content is organized into ?tab=-driven
// horizontal tabs (spec §4 Move 2 / §7), matching Prospects. Both tabs —
// Deliverables and Packages — are "Soon" today (future phases), so the island
// renders the tab bar + an empty-state line. The tab bar + URL plumbing live in
// the ServicesTabs client island; this page stays a server component and wraps
// it in Suspense (useSearchParams requirement on an otherwise-static route).

import { Suspense } from "react"
import { T } from "../../../../../lib/dashboard-theme"
import { ServicesTabs } from "./ServicesTabs"

export default function ServicesSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: T.TEXT, margin: 0 }}>
          Services
        </h2>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 6 }}>
          Your deliverables and packages — the catalog you assign to prospects and clients.
        </p>
      </div>

      <Suspense fallback={<p style={{ fontSize: 13, color: T.MUTED }}>Loading…</p>}>
        <ServicesTabs />
      </Suspense>
    </div>
  )
}
