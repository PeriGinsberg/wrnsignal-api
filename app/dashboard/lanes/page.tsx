"use client"

// Lane review, all clients.
//
// Every lane the caller may see: their own, plus every client they actively
// coach. A single client's lanes live on that client's record instead, under the
// Lanes tab — same components, narrower scope.

import { LanesPanel } from "./LanesPanel"
import { T } from "../../../lib/dashboard-theme"

export default function LaneReviewPage() {
  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          Lane Review
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Every job your lanes found that nobody has decided on yet, across you and the clients you coach.
        </p>
      </div>
      <LanesPanel emptyHint="No lanes on this account or any client you coach. Create one and run it to fill this queue." />
    </div>
  )
}
