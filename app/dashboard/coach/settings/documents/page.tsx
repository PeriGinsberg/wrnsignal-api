// Documents settings domain.
//
// Domain page within the My Settings area — peer to Prospects and Services
// (promoted from a Services sub-tab). Structured like the other domains: a
// server component with a title block that wraps the client island in Suspense
// (useSearchParams requirement on an otherwise-static route). The island
// (DocumentsTabs) is tab-capable but renders a single view today — the document
// category management UI — with no visible sub-tab bar yet.

import { Suspense } from "react"
import { T } from "../../../../../lib/dashboard-theme"
import { DocumentsTabs } from "./DocumentsTabs"

export default function DocumentsSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: T.TEXT, margin: 0 }}>
          Documents
        </h2>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 6 }}>
          Your master list of document categories — used to organize links in every client’s Library.
        </p>
      </div>

      <Suspense fallback={<p style={{ fontSize: 13, color: T.MUTED }}>Loading…</p>}>
        <DocumentsTabs />
      </Suspense>
    </div>
  )
}
