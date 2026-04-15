"use client"

import { useEffect, useState } from "react"

// Stripe redirects here after a mobile checkout. This page's only job is to
// immediately redirect back into the SIGNAL app via the custom scheme. If
// WebBrowser.openAuthSessionAsync is still watching on the mobile side, it
// will close itself as soon as the scheme fires.

const SCHEME_URL = "signalmobile://post-purchase"
const FALLBACK_MS = 2500

export default function MobileCheckoutSuccessPage() {
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    // Fire the scheme redirect on mount.
    window.location.replace(SCHEME_URL)

    // If we're still here after a couple of seconds, the app probably isn't
    // installed (or the OS didn't hand off). Show a manual CTA.
    const t = window.setTimeout(() => setShowFallback(true), FALLBACK_MS)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#040D1A",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>
        Payment received ✓
      </h1>
      <p
        style={{
          fontSize: 15,
          color: "rgba(255,255,255,0.7)",
          marginTop: 12,
          textAlign: "center",
          maxWidth: 360,
          lineHeight: "22px",
        }}
      >
        Returning you to the SIGNAL app…
      </p>

      {showFallback && (
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <a
            href={SCHEME_URL}
            style={{
              display: "inline-block",
              padding: "14px 26px",
              borderRadius: 12,
              background: "linear-gradient(90deg, #FEB06A, #FF6B00)",
              color: "#04060F",
              fontWeight: 900,
              fontSize: 15,
              textDecoration: "none",
            }}
          >
            Open SIGNAL
          </a>
          <p
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.5)",
              marginTop: 16,
              maxWidth: 320,
              lineHeight: "18px",
            }}
          >
            If nothing happens, open the SIGNAL app manually and enter the
            6-digit code we just emailed you.
          </p>
        </div>
      )}
    </div>
  )
}
