"use client"

// First-run welcome for coach-created clients. The create-client intro email's
// magic link redirects here (one-time link → first sign-in only); every later
// magic link routes to the Coaching Hub via /api/auth/send-link. No DB flag —
// the single-use link is the gate. Renders inside app/dashboard/layout.tsx,
// which performs the magic-link ?code= exchange, so the session is live here.

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, card, btnPrimary, headline } from "../../../lib/dashboard-theme"

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

function Signpost({ label, color, text }: { label: string; color: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
      <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.3, color, whiteSpace: "nowrap", minWidth: 110 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, color: T.MUTED, lineHeight: 1.5 }}>{text}</span>
    </div>
  )
}

export default function WelcomePage() {
  const [firstName, setFirstName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const j = await res.json()
        const full = (j.profile?.name || "").trim()
        if (!cancelled && full) setFirstName(full.split(/\s+/)[0])
      } catch {
        /* name is a nicety — silently fall back to the generic heading */
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", paddingTop: 12 }}>
      {/* SIGNAL wordmark — mirrors the dashboard nav lockup */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
        <span style={{ fontSize: 26, fontWeight: 950, fontStyle: "italic", letterSpacing: -0.5, color: "#ffffff" }}>
          SIGNAL
        </span>
        <div style={{ width: 16, height: 4, background: T.WRN_ORANGE, borderRadius: 1, marginLeft: 4 }} />
      </div>

      <div style={{ ...card, padding: 32 }}>
        <div style={{ height: 3, background: T.GRAD_PRIMARY, borderRadius: "16px 16px 0 0", margin: "-32px -32px 24px" }} />

        <h1 style={{ ...headline, marginBottom: 12 }}>
          Welcome to SIGNAL{firstName ? `, ${firstName}` : ""}
        </h1>

        <p style={{ fontSize: 14, color: T.TEXT, lineHeight: 1.6, margin: "0 0 24px" }}>
          This is where you and your coach work together — they send you jobs worth
          a look, leave feedback along the way, and track your progress with you.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
          <Signpost label="Coaching Hub" color={T.WRN_ORANGE} text="Your home base for what to do next." />
          <Signpost label="Job Tracker" color={T.WRN_BLUE} text="Your applications, plus the jobs your coach sends you." />
          <Signpost label="Back to SIGNAL" color={T.SUCCESS} text="Scan any job for fit yourself, anytime." />
        </div>

        <a
          href="/dashboard/coaching-hub"
          style={{ ...btnPrimary, display: "inline-block", textDecoration: "none", textAlign: "center" }}
        >
          Go to my Coaching Hub
        </a>

        <div style={{ marginTop: 16 }}>
          <a href="/dashboard" style={{ fontSize: 13, color: T.MUTED, textDecoration: "none" }}>
            Review my profile first
          </a>
        </div>
      </div>

      <p style={{ fontSize: 12, color: T.DIM, textAlign: "center", marginTop: 20 }}>
        Questions? Your coach is your guide.
      </p>
    </div>
  )
}
