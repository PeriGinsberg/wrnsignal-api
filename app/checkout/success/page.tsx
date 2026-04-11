"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

const BG = "#04060F"
const TEXT = "#E8E6E1"
const MUTED = "rgba(255,255,255,0.5)"
const GREEN = "#4ade80"
const ORANGE = "#FEB06A"

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ color: MUTED, fontSize: 13 }}>Loading...</span>
        </div>
      }
    >
      <CheckoutSuccessInner />
    </Suspense>
  )
}

function CheckoutSuccessInner() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("session_id")

  const [status, setStatus] = useState<"polling" | "ready" | "timeout">("polling")
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setStatus("timeout")
      return
    }

    let cancelled = false
    let attempts = 0
    const maxAttempts = 15 // 30 seconds at 2s intervals

    async function poll() {
      while (!cancelled && attempts < maxAttempts) {
        attempts++
        try {
          const res = await fetch(`/api/auth/account-ready?session_id=${sessionId}`)
          const data = await res.json()
          if (data.ready) {
            if (!cancelled) {
              setEmail(data.email || null)
              setStatus("ready")
            }
            return
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 2000))
      }
      if (!cancelled) setStatus("timeout")
    }

    poll()
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 440, padding: 32 }}>
        {status === "polling" && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
            <h1 style={{ color: TEXT, fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
              Setting up your account...
            </h1>
            <p style={{ color: MUTED, fontSize: 14, lineHeight: "20px" }}>
              This usually takes a few seconds. Please don't close this page.
            </p>
          </>
        )}

        {status === "ready" && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✉️</div>
            <h1 style={{ color: GREEN, fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
              Check your email
            </h1>
            <p style={{ color: TEXT, fontSize: 14, lineHeight: "20px" }}>
              Your SIGNAL access link is on its way
              {email ? ` to ${email}` : ""}.
            </p>
            <p style={{ color: MUTED, fontSize: 13, lineHeight: "18px", marginTop: 12 }}>
              Click the link in your email to set up your profile and start
              using SIGNAL.
            </p>
          </>
        )}

        {status === "timeout" && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⏱️</div>
            <h1 style={{ color: ORANGE, fontSize: 22, fontWeight: 900, marginBottom: 8 }}>
              Taking longer than expected
            </h1>
            <p style={{ color: TEXT, fontSize: 14, lineHeight: "20px" }}>
              Your payment was received. Please check your email for your
              access link, or contact support if it doesn't arrive within a
              few minutes.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
