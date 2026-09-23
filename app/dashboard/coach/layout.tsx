// app/dashboard/coach/layout.tsx
//
// Nested route layout for every Coaches Center page. Renders a persistent
// "Coaches Center — Beta" banner above the page content, signaling pilot
// status to coaches (and prospective Beta Coaches viewing a demo) and
// framing expectations on polish.
//
// Wraps every route under /dashboard/coach/* automatically via Next.js
// App Router nested-layout inheritance — no per-page wiring needed. The
// parent app/dashboard/layout.tsx still provides the global sidebar nav.
//
// Also replaces the previous orange "COACHES CENTER" eyebrow that was
// rendered inline on /clients and /required-actions — those eyebrows
// were removed in the same commit. The Beta banner does the same
// "this-is-the-coaches-center" job with the addition of pilot framing.
//
// Color: WRN Bright Blue #51ADE5 (matches lib/dashboard-theme.ts
// `T.WRN_BLUE`, the brand bright-blue used in dashboard gradients).
// Brand "Authority" Navy #1F3A5F was the original spec but fails
// WCAG large-text contrast at 1.27:1 against the dark theme
// background T.BG #13294A. #51ADE5 tests at 5.86:1 — passes
// WCAG AA normal-text (4.5:1) and AAA large-text (4.5:1).
// See TC-617 for the contrast assertion.

import type { ReactNode } from "react"

export default function CoachLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <div
        style={{
          color: "#51ADE5",
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: -0.3,
          marginBottom: 24,
          lineHeight: 1.2,
        }}
      >
        Coaches Center — Beta
      </div>
      {children}
    </div>
  )
}
