"use client"

// My Settings area shell.
//
// The settings DOMAINS (Prospects, Services, Billing) now live in the global
// sidebar's "My Settings" nav group (app/dashboard/layout.tsx) — promoted there
// in the Phase 0.5 IA restructure (spec §4 Move 1). This layout keeps only the
// area chrome: the page title + the content pane rendering the active domain
// sub-page. The former vertical domain sub-nav was removed so the IA stays at
// two nav levels, not three.

import { T } from "../../../../lib/dashboard-theme"
import { BackToDashboard } from "../BackToDashboard"

export default function CoachSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <BackToDashboard />

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          My Settings
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Configure how you work — independent of any one client or prospect.
        </p>
      </div>

      <div>{children}</div>
    </div>
  )
}
