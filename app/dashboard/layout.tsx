"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
import { T, input, btnPrimary, card, eyebrow } from "../../lib/dashboard-theme"

const BASE_NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/tracker", label: "Job Tracker" },
  { href: "/dashboard/resume-rx", label: "ResumeRx (Coming Soon)" },
]

const COACH_NAV_ITEM = { href: "/dashboard/coach", label: "My Clients" }

const EXTERNAL_NAV_ITEM = { href: "https://wrnsignal.workforcereadynow.com/signal/jobfit", label: "Back to SIGNAL →", external: true }

function Logo() {
  return (
    <div style={{ padding: "28px 20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 26, fontWeight: 950, fontStyle: "italic", letterSpacing: -0.5, color: "#ffffff" }}>
          SIGNAL
        </span>
        <div style={{ width: 16, height: 4, background: T.WRN_ORANGE, borderRadius: 1, marginLeft: 4 }} />
      </div>
      <div style={{ marginTop: 4, display: "flex", gap: 3, alignItems: "center" }}>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 0.8, color: T.DIM, textTransform: "uppercase" }}>by</span>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 0.8, color: T.WRN_ORANGE, textTransform: "uppercase" }}>WORKFORCE</span>
        <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 0.8, color: T.WRN_BLUE, textTransform: "uppercase" }}>READY NOW</span>
      </div>
    </div>
  )
}

function FramerBanner() {
  return (
    <div
      style={{
        width: "100%",
        height: 40,
        background: "rgba(254,176,106,0.10)",
        borderBottom: "1px solid rgba(254,176,106,0.20)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        flexShrink: 0,
      }}
    >
      <button
        onClick={() => {
          try { window.close() } catch {}
          // If close was blocked, the page is still here — go back
          setTimeout(() => window.history.back(), 100)
        }}
        style={{
          background: "none",
          border: "none",
          color: T.WRN_ORANGE,
          fontSize: 13,
          fontWeight: 900,
          cursor: "pointer",
          padding: 0,
        }}
      >
        &larr; Back to SIGNAL
      </button>
      <span style={{ fontSize: 12, color: T.MUTED }}>
        You&apos;re in your SIGNAL Dashboard
      </span>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">("loading")
  const [email, setEmail] = useState("")
  const [linkSent, setLinkSent] = useState(false)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [fromFramer, setFromFramer] = useState(false)
  const [isCoach, setIsCoach] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    async function init() {
      const url = new URL(window.location.href)

      // Handle Supabase magic-link PKCE code exchange. This MUST happen
      // before getSession() or the session will not initialize.
      const code = url.searchParams.get("code")
      if (code) {
        const { error: codeErr } = await supabase.auth.exchangeCodeForSession(code)
        if (codeErr) {
          console.warn("[dashboard] code exchange failed:", codeErr.message)
        }
        url.searchParams.delete("code")
        window.history.replaceState({}, "", url.pathname + url.search + url.hash)
        const { data } = await supabase.auth.getSession()
        setStatus(data.session ? "authed" : "unauthed")
        return
      }

      // Check for token handoff from Framer
      const handoffToken = url.searchParams.get("token")

      if (handoffToken) {
        // Flag as coming from Framer
        sessionStorage.setItem("signal_from_framer", "1")
        sessionStorage.setItem("signal_handoff_token", handoffToken)
        setFromFramer(true)

        // Strip token from URL immediately
        url.searchParams.delete("token")
        window.history.replaceState({}, "", url.pathname + url.search + url.hash)

        // Attempt to set session with the handoff token
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: handoffToken,
          refresh_token: handoffToken,
        })

        if (!sessionError) {
          setStatus("authed")
          return
        }
        // setSession failed (access token isn't a valid refresh token),
        // but we stored the handoff token — use it directly for API calls
        console.warn("[dashboard] token handoff failed, using direct token:", sessionError.message)
        setStatus("authed")
        return
      }

      // Check for existing Framer flag
      if (sessionStorage.getItem("signal_from_framer") === "1") {
        setFromFramer(true)
      }

      // Also detect Framer referrer
      if (document.referrer.includes("framer.app")) {
        sessionStorage.setItem("signal_from_framer", "1")
        setFromFramer(true)
      }

      // Normal session check
      const { data } = await supabase.auth.getSession()
      setStatus(data.session ? "authed" : "unauthed")
    }

    init()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? "authed" : "unauthed")
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // Check coach status once authed
  useEffect(() => {
    if (status !== "authed") return
    async function checkCoach() {
      try {
        const supabase = getSupabaseBrowser()
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
        if (!token) return
        const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const j = await res.json()
        setIsCoach(!!j.profile?.is_coach)
      } catch {}
    }
    checkCoach()
  }, [status])

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    setSending(true)
    setError("")
    try {
      const res = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || data.error || "Failed to send link.")
      } else {
        setLinkSent(true)
      }
    } catch {
      setError("Network error — please try again.")
    }
    setSending(false)
  }

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: T.BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: T.MUTED, fontSize: 13 }}>Loading...</span>
      </div>
    )
  }

  if (status === "unauthed") {
    return (
      <div style={{ minHeight: "100vh", background: T.BG, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 360 }}>
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 950, fontStyle: "italic", letterSpacing: -0.5, color: "#ffffff" }}>SIGNAL</span>
            <div style={{ width: 16, height: 4, background: T.WRN_ORANGE, borderRadius: 1, margin: "6px auto 0" }} />
          </div>

          {linkSent ? (
            <div style={{ ...card, padding: 28, textAlign: "center", marginTop: 24 }}>
              <div style={{ ...eyebrow, color: T.SUCCESS }}>LINK SENT</div>
              <p style={{ fontSize: 14, color: T.TEXT, marginTop: 12, fontWeight: 950, letterSpacing: -0.3 }}>Check your email</p>
              <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, lineHeight: "20px" }}>
                We sent a sign-in link to <span style={{ color: T.WRN_BLUE }}>{email}</span>
              </p>
              <button
                onClick={() => { setLinkSent(false); setEmail("") }}
                style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, cursor: "pointer", marginTop: 16 }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={sendMagicLink} style={{ ...card, padding: 28, marginTop: 24 }}>
              <div style={{ height: 3, background: T.GRAD_PRIMARY, borderRadius: "18px 18px 0 0", margin: "-28px -28px 24px" }} />
              <label style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.5, color: T.WRN_BLUE }}>EMAIL ADDRESS</label>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ ...input, marginTop: 8 }}
              />
              {error && <p style={{ fontSize: 12, color: T.ERROR, marginTop: 8 }}>{error}</p>}
              <button type="submit" disabled={sending} style={{ ...btnPrimary, width: "100%", marginTop: 16, opacity: sending ? 0.5 : 1 }}>
                {sending ? "Sending..." : "Send magic link"}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: T.BG, display: "flex", flexDirection: "column" }}>
      {fromFramer && <FramerBanner />}
      <div style={{ display: "flex", flex: 1 }}>
        <nav style={{ width: 220, background: T.NAV_BG, borderRight: `1px solid ${T.BORDER_SOFT}`, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Logo />
          <div style={{ padding: "0 12px" }}>
            <div style={{ ...eyebrow, fontSize: 11, letterSpacing: 1.2, color: "rgba(255,255,255,0.42)", padding: "0 8px", marginBottom: 8 }}>
              DASHBOARD
            </div>
            {[...BASE_NAV_ITEMS, ...(isCoach ? [COACH_NAV_ITEM] : []), EXTERNAL_NAV_ITEM].map((item) => {
              const isExternal = (item as any).external === true
              const active = !isExternal && pathname === item.href
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={isExternal ? async (e) => {
                    e.preventDefault()
                    const supabase = getSupabaseBrowser()
                    const { data } = await supabase.auth.getSession()
                    const token = data.session?.access_token
                    const refreshToken = data.session?.refresh_token
                    const params = new URLSearchParams()
                    if (token) params.set("access_token", token)
                    if (refreshToken) params.set("refresh_token", refreshToken)
                    window.location.replace(item.href + "#" + params.toString())
                  } : undefined}
                  style={{
                    display: "block",
                    padding: "10px 12px",
                    marginBottom: 4,
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 900,
                    textDecoration: "none",
                    border: isExternal
                      ? `1px solid rgba(74,222,128,0.3)`
                      : active ? `1px solid ${T.NAV_ACTIVE_BORDER}` : `1px solid ${T.BORDER_SOFT}`,
                    background: isExternal
                      ? "rgba(74,222,128,0.06)"
                      : active ? T.NAV_ACTIVE_BG : T.NAV_DEFAULT_BG,
                    color: isExternal ? "#4ade80" : active ? T.WRN_ORANGE : T.TEXT,
                  }}
                >
                  {item.label}
                </a>
              )
            })}
          </div>
        </nav>
        <main style={{ flex: 1, padding: "32px 40px 60px 36px", overflowY: "auto" }}>
          {children}
        </main>
      </div>
    </div>
  )
}
