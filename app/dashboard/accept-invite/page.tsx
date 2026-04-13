"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, card, eyebrow, btnPrimary } from "../../../lib/dashboard-theme"

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

function AcceptInviteContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")
  const [coachName, setCoachName] = useState("")

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setMessage("No invite token found. Check your email link and try again.")
      return
    }

    async function accept() {
      const authToken = await getToken()
      const res = await fetch("/api/coach/accept-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ token }),
      })
      const j = await res.json().catch(() => null)
      if (res.ok) {
        setCoachName(j?.coach_name || "")
        setStatus("success")
      } else {
        setMessage(j?.error || "Failed to accept invite. The link may have expired.")
        setStatus("error")
      }
    }

    accept()
  }, [token])

  return (
    <div style={{
      minHeight: "100vh",
      background: T.BG,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{ width: 400, maxWidth: "90vw" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <span style={{ fontSize: 28, fontWeight: 950, fontStyle: "italic", letterSpacing: -0.5, color: "#ffffff" }}>
            SIGNAL
          </span>
          <div style={{ width: 16, height: 4, background: T.WRN_ORANGE, borderRadius: 1, margin: "6px auto 0" }} />
        </div>

        {status === "loading" && (
          <div style={{ ...card, padding: 36, textAlign: "center" }}>
            <div style={{ ...eyebrow, color: T.DIM, marginBottom: 16 }}>PROCESSING</div>
            <p style={{ color: T.MUTED, fontSize: 14 }}>Accepting your coaching invite...</p>
            <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                border: `3px solid rgba(254,176,106,0.2)`,
                borderTopColor: T.WRN_ORANGE,
                animation: "spin 0.8s linear infinite",
              }} />
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {status === "success" && (
          <div style={{ ...card, padding: 36, textAlign: "center" }}>
            <div style={{ height: 3, background: "linear-gradient(90deg,#4ade80,#22c55e)", margin: "-36px -36px 28px", borderRadius: "18px 18px 0 0" }} />
            <div style={{ ...eyebrow, color: T.SUCCESS, marginBottom: 12 }}>CONNECTED</div>
            <p style={{ fontSize: 18, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>
              You're now connected!
            </p>
            <p style={{ fontSize: 13, color: T.MUTED, marginTop: 10, lineHeight: "20px" }}>
              {coachName
                ? <>Your coach <span style={{ color: T.WRN_ORANGE }}>{coachName}</span> can now view your profile and send you job recommendations.</>
                : "Your coach can now view your profile and send you job recommendations."
              }
            </p>
            <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, lineHeight: "20px" }}>
              Check the <span style={{ color: T.WRN_BLUE, fontWeight: 700 }}>Job Tracker</span> tab in your dashboard for any recommendations from your coach.
            </p>
            <a
              href="/dashboard"
              style={{
                display: "block",
                ...btnPrimary,
                background: "#FEB06A",
                color: "#04060F",
                fontWeight: 900,
                textDecoration: "none",
                textAlign: "center",
                marginTop: 28,
              }}
            >
              Go to My Dashboard
            </a>
          </div>
        )}

        {status === "error" && (
          <div style={{ ...card, padding: 36, textAlign: "center" }}>
            <div style={{ height: 3, background: "linear-gradient(90deg,#f87171,#ef4444)", margin: "-36px -36px 28px", borderRadius: "18px 18px 0 0" }} />
            <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ERROR</div>
            <p style={{ fontSize: 16, fontWeight: 950, color: T.TEXT }}>Invite failed</p>
            <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, lineHeight: "20px" }}>{message}</p>
            <a
              href="/dashboard"
              style={{
                display: "block",
                ...btnPrimary,
                textDecoration: "none",
                textAlign: "center",
                marginTop: 24,
                background: "rgba(255,255,255,0.08)",
                color: T.TEXT,
              }}
            >
              Back to Dashboard
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: T.BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: T.MUTED, fontSize: 13 }}>Loading...</span>
      </div>
    }>
      <AcceptInviteContent />
    </Suspense>
  )
}
