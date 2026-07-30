"use client"

// Phase 7b — /dashboard/network/profile. The 16 merge variables plus the
// elevator pitch that Phase 8's templates interpolate. Seeded once from what
// SIGNAL already stores, then owned by the client.

import { headline } from "../../../../lib/dashboard-theme"
import { ProfileForm } from "./ProfileForm"

export default function NetworkProfilePage() {
  return (
    <main style={{ padding: "22px 26px 60px" }}>
      <h1 style={headline}>Your networking profile</h1>
      <p style={{ color: "rgba(255,255,255,0.60)", fontSize: 13, margin: "6px 0 18px", maxWidth: 620 }}>
        This is what your messages pull from. Fill it in once, tweak whenever.
      </p>
      <ProfileForm />
    </main>
  )
}
