"use client"

// Standalone lane edit screen.
//
// Thin wrapper: the setup panel is the same component the review panel embeds,
// so the two cannot drift. This route exists for a direct link to one lane's
// configuration without the queue underneath it.

import { use } from "react"
import Link from "next/link"
import { LaneTitleEditor } from "../../LaneTitleEditor"
import { T } from "../../../../../lib/dashboard-theme"

export default function LaneEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <Link href="/dashboard/lanes" style={{ color: T.WRN_BLUE, fontSize: 12, textDecoration: "none" }}>
          ← Lane Review
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: "10px 0 0" }}>
          Lane setup
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Every title is one search per run, inside the years ceiling and posting window above them. Discovery
          below shows what the board actually titles the work.
        </p>
      </div>
      <LaneTitleEditor laneId={id} />
    </div>
  )
}
