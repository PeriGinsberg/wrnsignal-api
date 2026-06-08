"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
import { T, input, btnPrimary, card, eyebrow } from "../../lib/dashboard-theme"
import { FRAMER_URL } from "../../lib/urls"
import { FeedbackSlideIn } from "../../components/feedback/FeedbackSlideIn"

// Sprint 3 (2026-05-08): conditional nav rendering by is_coach.
//   • D2C: My Account (renamed from Overview), Job Tracker, ResumeRx
//   • Coach: Coaches Center group (Dashboard / Required Actions / My
//     Clients), then My Account, then Back to SIGNAL. Job Tracker +
//     ResumeRx hidden from coach nav.

type NavItem = {
  // Optional: action items (e.g. Feedback) render as a <button> with no href.
  href?: string
  label: string
  external?: boolean
  /** When true, also marks active for descendants (e.g. /clients/[id]) */
  matchPrefix?: boolean
  /** Action items render as a <button> instead of an <a>; no navigation. */
  action?: "feedback" | "logout"
  /** Disabled "Soon" item — greyed, non-clickable, no navigation. */
  disabled?: boolean
}
type NavGroup = { header: string; items: NavItem[] }

const D2C_NAV: NavGroup[] = [
  {
    header: "DASHBOARD",
    items: [
      { href: "/dashboard", label: "My Account" },
      { href: "/dashboard/tracker", label: "Job Tracker" },
    ],
  },
]

const COACH_NAV: NavGroup[] = [
  {
    header: "COACHES CENTER",
    items: [
      { href: "/dashboard/coach", label: "Dashboard" },
      // matchPrefix so /dashboard/coach/clients/[id] highlights "My Clients"
      { href: "/dashboard/coach/clients", label: "My Clients", matchPrefix: true },
      // matchPrefix so /dashboard/coach/prospects/[id] highlights "My Prospects"
      { href: "/dashboard/coach/prospects", label: "My Prospects", matchPrefix: true },
      { href: "/dashboard/coach/required-actions", label: "Required Actions" },
      // Action item: opens the beta-feedback slide-in (Phase 4). Renders as a
      // <button>, not an <a> — no navigation.
      { label: "Feedback", action: "feedback" },
    ],
  },
  {
    header: "MY SETTINGS",
    items: [
      // Domain items are real routes (deep-linkable). matchPrefix keeps the
      // group highlighted on any /settings/<domain> descendant. Billing is a
      // disabled "Soon" domain (no route this phase). Spec §4 Move 1 / §7.
      { href: "/dashboard/coach/settings/prospects", label: "Prospects", matchPrefix: true },
      { href: "/dashboard/coach/settings/services", label: "Services", matchPrefix: true },
      { href: "/dashboard/coach/settings/documents", label: "Documents", matchPrefix: true },
      { label: "Billing", disabled: true },
    ],
  },
  {
    header: "ACCOUNT",
    items: [
      // Coaches operate only as coaches. The D2C "My Account" + external "Back
      // to SIGNAL" links are removed from the coach nav; coach configuration
      // now lives in the My Settings group above. (Spec §0.2.)
      // Sign out. Renders as a <button> (action item); full session teardown
      // in handleLogout below. Coaches otherwise have no way to log out.
      { label: "Log out", action: "logout" },
    ],
  },
]

const EXTERNAL_NAV_ITEM: NavItem = {
  href: `${FRAMER_URL}/signal/jobfit`,
  label: "Back to SIGNAL →",
  external: true,
}

function isItemActive(item: NavItem, pathname: string): boolean {
  if (!item.href) return false
  if (pathname === item.href) return true
  if (item.matchPrefix && pathname.startsWith(item.href + "/")) return true
  return false
}

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((it) => isItemActive(it, pathname))
}

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
  // True when this D2C account has an ACTIVE coach (from /api/profile's `coached`
  // gate). Gates the coached-only "Coaching Tools" nav item.
  const [coached, setCoached] = useState(false)
  // Beta-feedback slide-in (Phase 3). Mounted at layout level so it's
  // reachable from any coach page; nav trigger wired in Phase 4.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [authToken, setAuthToken] = useState<string | null>(null)
  // Dev-only password sign-in. Gated on NEXT_PUBLIC_DEV_AUTH=true (set in
  // .env.development.local; absent in prod .env.local). Without that env
  // var, the password field doesn't render and this state is unused.
  const [password, setPassword] = useState("")
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const showDevAuth = process.env.NEXT_PUBLIC_DEV_AUTH === "true"
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

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setStatus("authed")
      } else if (event === "SIGNED_OUT") {
        setStatus("unauthed")
      }
      // Ignore transient refresh failures — Supabase auto-retries
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
        setAuthToken(token)
        const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const j = await res.json()
        setIsCoach(!!j.profile?.is_coach)
        setCoached(!!j.profile?.coached)
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

  // Dev-only password sign-in. Mirrors the server-side redirect logic in
  // /api/auth/send-link so coaches land on /dashboard/coach regardless of
  // profile_complete. Hidden behind NEXT_PUBLIC_DEV_AUTH=true.
  async function signInWithPassword() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !password) {
      setError("Email and password are required.")
      return
    }
    setPasswordSubmitting(true)
    setError("")
    try {
      const supabase = getSupabaseBrowser()
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      })
      if (authErr || !data.session) {
        setError(authErr?.message || "Sign-in failed.")
        return
      }
      const token = data.session.access_token
      // Determine redirect using same logic as the server-side magic-link
      // sender (is_coach checked BEFORE profile_complete).
      let target = "/dashboard"
      try {
        const profRes = await fetch("/api/profile", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (profRes.ok) {
          const { profile } = await profRes.json()
          if (profile?.is_coach) target = "/dashboard/coach"
          else if (profile?.profile_complete) target = "/dashboard/tracker"
        }
      } catch {
        // Profile lookup failed — fall through to /dashboard
      }
      window.location.replace(target)
    } catch (e: any) {
      setError(e?.message || "Sign-in failed.")
    } finally {
      setPasswordSubmitting(false)
    }
  }

  // Full sign-out teardown. The session lives in two places (no @supabase/ssr):
  //   1. Supabase session in localStorage (sb-<ref>-auth-token) — cleared by
  //      auth.signOut().
  //   2. signal_handoff_token in sessionStorage — the Framer-handoff fallback
  //      bearer (used by getToken across pages and the coach check above).
  // Both must be cleared or the next load auto-restores the session. We also
  // drop the signal_from_framer UI flag so the login screen is clean. A full
  // navigation (window.location) — not router.push — guarantees the layout
  // re-initializes from scratch in the unauthenticated state.
  async function handleLogout() {
    try {
      await getSupabaseBrowser().auth.signOut()
    } catch {
      // ignore — we redirect regardless; the storage clears below still run
    }
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("signal_handoff_token")
      sessionStorage.removeItem("signal_from_framer")
      window.location.href = "/dashboard"
    }
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
              {showDevAuth && (
                <>
                  <label style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.5, color: T.WRN_BLUE, marginTop: 16, display: "block" }}>
                    PASSWORD <span style={{ color: T.DIM, fontWeight: 400 }}>(dev only — leave blank for magic link)</span>
                  </label>
                  <input
                    type="password"
                    placeholder="dev-test-1234"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        signInWithPassword()
                      }
                    }}
                    style={{ ...input, marginTop: 8 }}
                  />
                </>
              )}
              {error && <p style={{ fontSize: 12, color: T.ERROR, marginTop: 8 }}>{error}</p>}
              <button type="submit" disabled={sending || passwordSubmitting} style={{ ...btnPrimary, width: "100%", marginTop: 16, opacity: sending || passwordSubmitting ? 0.5 : 1 }}>
                {sending ? "Sending..." : "Send magic link"}
              </button>
              {showDevAuth && (
                <button
                  type="button"
                  onClick={signInWithPassword}
                  disabled={sending || passwordSubmitting || !email.trim() || !password}
                  style={{
                    ...btnPrimary,
                    width: "100%",
                    marginTop: 10,
                    background: "rgba(255,255,255,0.06)",
                    border: `1px solid ${T.BORDER_SOFT}`,
                    color: T.TEXT,
                    opacity: (sending || passwordSubmitting || !email.trim() || !password) ? 0.5 : 1,
                  }}
                >
                  {passwordSubmitting ? "Signing in..." : "Sign in with password"}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    )
  }

  // D2C nav, with the coached-only "Coaching Hub" item injected into the
  // DASHBOARD group when this account has an active coach. Non-coached D2C users
  // never see it. (is_coach users render COACH_NAV, so the item is D2C-only.)
  const d2cNav: NavGroup[] = coached
    ? D2C_NAV.map((g) =>
        g.header === "DASHBOARD"
          ? { ...g, items: [...g.items, { href: "/dashboard/coaching-hub", label: "Coaching Hub", matchPrefix: true }] }
          : g,
      )
    : D2C_NAV
  const navGroups = isCoach ? COACH_NAV : d2cNav

  return (
    <div style={{ minHeight: "100vh", background: T.BG, display: "flex", flexDirection: "column" }}>
      {fromFramer && <FramerBanner />}
      <div style={{ display: "flex", flex: 1 }}>
        <nav style={{ width: 220, background: T.NAV_BG, borderRight: `1px solid ${T.BORDER_SOFT}`, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <Logo />
          <div style={{ padding: "0 12px" }}>
            {navGroups.map((group, gi) => {
              const groupHot = isGroupActive(group, pathname)
              return (
                <div key={group.header} style={{ marginBottom: gi === navGroups.length - 1 ? 12 : 16 }}>
                  <div style={{
                    ...eyebrow, fontSize: 11, letterSpacing: 1.2,
                    color: groupHot ? T.WRN_ORANGE : "rgba(255,255,255,0.42)",
                    padding: "0 8px", marginBottom: 8,
                  }}>
                    {group.header}
                  </div>
                  {group.items.map((item) => {
                    const active = isItemActive(item, pathname)
                    const itemStyle: React.CSSProperties = {
                      display: "block",
                      padding: "10px 12px",
                      marginBottom: 4,
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 900,
                      textDecoration: "none",
                      border: active ? `1px solid ${T.NAV_ACTIVE_BORDER}` : `1px solid ${T.BORDER_SOFT}`,
                      background: active ? T.NAV_ACTIVE_BG : T.NAV_DEFAULT_BG,
                      color: active ? T.WRN_ORANGE : T.TEXT,
                    }
                    // Disabled "Soon" domain — greyed, non-clickable, no nav.
                    // Mirrors the disabled-item treatment formerly in the
                    // settings sub-nav.
                    if (item.disabled) {
                      return (
                        <div
                          key={item.label}
                          style={{
                            ...itemStyle,
                            border: `1px solid ${T.BORDER_SOFT}`,
                            background: "transparent",
                            color: T.DIM,
                            cursor: "default",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>{item.label}</span>
                          <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.DIM }}>
                            Soon
                          </span>
                        </div>
                      )
                    }
                    // Action items render as a <button> instead of navigating —
                    // Feedback opens the slide-in, Log out tears down the
                    // session. Same nav-item style as links, button defaults
                    // reset to match an <a>.
                    if (item.action) {
                      const onClick = item.action === "feedback" ? () => setFeedbackOpen(true) : handleLogout
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={onClick}
                          style={{
                            ...itemStyle,
                            width: "100%",
                            textAlign: "left",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                          }}
                        >
                          {item.label}
                        </button>
                      )
                    }
                    return (
                      <a key={item.href} href={item.href} style={itemStyle}>
                        {item.label}
                      </a>
                    )
                  })}
                </div>
              )
            })}

            {/* Back to SIGNAL — external job-seeker product. D2C only:
                coaches operate strictly as coaches (separate account for
                job-seeking), so this context switch is hidden in coach nav.
                Spec §0.2. */}
            {!isCoach && (
            <a
              key={EXTERNAL_NAV_ITEM.href}
              href={EXTERNAL_NAV_ITEM.href}
              onClick={async (e) => {
                e.preventDefault()
                const supabase = getSupabaseBrowser()
                const { data } = await supabase.auth.getSession()
                const token = data.session?.access_token
                const refreshToken = data.session?.refresh_token
                const params = new URLSearchParams()
                if (token) params.set("access_token", token)
                if (refreshToken) params.set("refresh_token", refreshToken)
                window.location.replace(EXTERNAL_NAV_ITEM.href + "#" + params.toString())
              }}
              style={{
                display: "block",
                padding: "10px 12px",
                marginBottom: 4,
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 900,
                textDecoration: "none",
                border: "1px solid rgba(74,222,128,0.3)",
                background: "rgba(74,222,128,0.06)",
                color: "#4ade80",
              }}
            >
              {EXTERNAL_NAV_ITEM.label}
            </a>
            )}
          </div>
        </nav>
        <main style={{ flex: 1, padding: "32px 40px 60px 36px", overflowY: "auto" }}>
          {children}
        </main>
      </div>
      {/* Beta-feedback slide-in — coaches only. Trigger wired into the nav
          in Phase 4; mounted here so it's reachable from any coach page. */}
      {isCoach && (
        <FeedbackSlideIn
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          authToken={authToken ?? ""}
        />
      )}
    </div>
  )
}
