// Services settings domain (Step 1 — placeholder).
//
// Services (Deliverables + Packages) is a first-class settings domain. This is a
// minimal placeholder so the Services nav item resolves to a real route instead
// of 404ing. The Deliverables/Packages tab content lands in Step 3 (spec §4
// Move 2). No tabs / no content here by design.

import { T } from "../../../../../lib/dashboard-theme"

export default function ServicesSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: T.TEXT, margin: 0 }}>
          Services
        </h2>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 6 }}>
          Your deliverables and packages — the catalog you assign to prospects and clients. Coming soon.
        </p>
      </div>
    </div>
  )
}
