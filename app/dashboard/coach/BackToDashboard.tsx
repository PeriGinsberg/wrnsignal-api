"use client"

// Shared "← Back to Dashboard" affordance for Coaches Center sub-pages.
// Drops the coach back at /dashboard/coach (Coach Home) from any of the
// child pages they may have drilled into:
//
//   /dashboard/coach/clients               My Clients full roster
//   /dashboard/coach/required-actions      Cross-client Required Actions
//   /dashboard/coach/applications-recent   (Commit 2.3) cross-client apps
//
// Intentionally NOT used on:
//   /dashboard/coach                       — itself the destination
//   /dashboard/coach/clients/[clientId]    — natural parent is /clients,
//                                            not /coach (see the existing
//                                            "Back to My Clients" link
//                                            shipped in Phase 1 b5265aa6)
//
// Style: small text-link in WRN Teal (#2CA58D — brand "direction/positive"
// color), hover underlines. Sits above the page heading with ~18px gap.

import Link from "next/link"
import { useState } from "react"

export function BackToDashboard() {
  const [hovered, setHovered] = useState(false)
  return (
    <Link
      href="/dashboard/coach"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-block",
        fontSize: 13,
        fontWeight: 600,
        color: "#2CA58D",
        textDecoration: hovered ? "underline" : "none",
        marginBottom: 18,
        letterSpacing: 0.2,
      }}
    >
      ← Back to Dashboard
    </Link>
  )
}
