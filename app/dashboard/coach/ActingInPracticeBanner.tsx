"use client"

// Who owns the clients on screen.
//
// A DELEGATE coach works inside someone else's practice: every client, note and
// workbook she sees belongs to the principal, and everything she writes is
// stamped with her own name. That is easy to forget when the Coaches Center
// looks exactly as it does for the owner, so it is said on every coach page.
//
// Display only: access is decided per request on the server, and this banner
// renders nothing at all for an ordinary coach.

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T } from "../../../lib/dashboard-theme"

export function ActingInPracticeBanner() {
  const [practice, setPractice] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const { data: { session } } = await getSupabaseBrowser().auth.getSession()
        const token = session?.access_token ?? sessionStorage.getItem("signal_handoff_token")
        if (!token) return
        const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
        const j = await res.json().catch(() => ({}))
        if (!live || !res.ok) return
        const acting = j?.profile?.acting_in
        if (acting) setPractice(acting.name || "another coach")
      } catch {
        /* display only: a failed read just means no banner */
      }
    })()
    return () => { live = false }
  }, [])

  if (!practice) return null

  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        background: "rgba(81,173,229,0.12)",
        border: `1px solid ${T.WRN_BLUE}`,
        color: T.TEXT, fontSize: 14, fontWeight: 600,
        padding: "10px 14px", marginBottom: 16, borderRadius: 10,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: T.WRN_BLUE, flexShrink: 0 }} />
      Acting in {practice}&rsquo;s practice. These are {practice}&rsquo;s clients, and everything you do here is recorded under your name.
    </div>
  )
}
