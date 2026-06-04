// Prospects settings domain.
//
// Domain page within the My Settings area. Content is organized into ?tab=-driven
// horizontal tabs (spec §4 Move 2 / §5). Today there is one live tab — Pipeline
// (renders the existing MyPipelineSection). The tab bar + active-tab switching
// live in the ProspectsTabs client island (query-param interactivity); this page
// stays a server component and wraps it in Suspense (useSearchParams requirement
// on an otherwise-static route). MyPipelineSection is unchanged.

import { Suspense } from "react"
import { T } from "../../../../../lib/dashboard-theme"
import { ProspectsTabs } from "./ProspectsTabs"

export default function ProspectsSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: T.TEXT, margin: 0 }}>
          Prospects
        </h2>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 6 }}>
          How you track prospects from first contact through to becoming a client.
        </p>
      </div>

      <Suspense fallback={<p style={{ fontSize: 13, color: T.MUTED }}>Loading…</p>}>
        <ProspectsTabs />
      </Suspense>
    </div>
  )
}
