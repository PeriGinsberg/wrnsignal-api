// app/positioning/layout.tsx
//
// Auth gate for the Phase 2 frontend prototype. Mirrors the auth logic
// from app/dashboard/layout.tsx but without the sidebar nav — this is a
// workflow surface, not a dashboard.
//
// Style: utilitarian Tailwind classes (light theme, no theme object).
// Sign-in path: magic link only. If you need dev password sign-in,
// sign in at /dashboard first then navigate back.
//
// Phase 2 prototype context — see app/positioning/phase2/[id]/page.tsx
// for entry. Final UI ships in Framer in a separate later session.

"use client"

import { useEffect, useState } from "react"
import { getSupabaseBrowser } from "@/lib/supabase-browser"

export default function PositioningLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [status, setStatus] = useState<"loading" | "authed" | "unauthed">(
    "loading",
  )
  const [email, setEmail] = useState("")
  const [linkSent, setLinkSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const supabase = getSupabaseBrowser()

    async function init() {
      const url = new URL(window.location.href)

      // PKCE code exchange (Supabase magic-link callback)
      const code = url.searchParams.get("code")
      if (code) {
        const { error: codeErr } = await supabase.auth.exchangeCodeForSession(code)
        if (codeErr) {
          console.warn("[positioning] code exchange failed:", codeErr.message)
        }
        url.searchParams.delete("code")
        window.history.replaceState({}, "", url.pathname + url.search + url.hash)
        const { data } = await supabase.auth.getSession()
        setStatus(data.session ? "authed" : "unauthed")
        return
      }

      // Framer handoff token (in case user lands here via direct redirect)
      const handoffToken = url.searchParams.get("token")
      if (handoffToken) {
        sessionStorage.setItem("signal_handoff_token", handoffToken)
        url.searchParams.delete("token")
        window.history.replaceState({}, "", url.pathname + url.search + url.hash)
        await supabase.auth
          .setSession({
            access_token: handoffToken,
            refresh_token: handoffToken,
          })
          .catch(() => {
            // setSession failure is OK — token still stored in sessionStorage
            // and apiCall() will pick it up via getToken()'s fallback
          })
        setStatus("authed")
        return
      }

      // Normal session check
      const { data } = await supabase.auth.getSession()
      setStatus(data.session ? "authed" : "unauthed")
    }

    init()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session) setStatus("authed")
        else if (event === "SIGNED_OUT") setStatus("unauthed")
      },
    )
    return () => listener.subscription.unsubscribe()
  }, [])

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
      <div className="min-h-screen flex items-center justify-center text-neutral-500 text-sm">
        Loading…
      </div>
    )
  }

  if (status === "unauthed") {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border border-neutral-200 rounded-lg p-6">
          <h1 className="text-lg font-semibold text-neutral-900">
            Sign in to continue
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Phase 2 prototype requires authentication.
          </p>

          {linkSent ? (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
              Magic link sent to <strong>{email}</strong>. Check your inbox.
            </div>
          ) : (
            <form onSubmit={sendMagicLink} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-neutral-500"
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={sending}
                className="w-full px-3 py-2 bg-neutral-900 text-white text-sm font-medium rounded hover:bg-neutral-800 disabled:opacity-50"
              >
                {sending ? "Sending…" : "Send magic link"}
              </button>
              <p className="text-xs text-neutral-400 text-center">
                Or sign in at{" "}
                <a href="/dashboard" className="underline">
                  /dashboard
                </a>{" "}
                (supports dev password)
              </p>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-neutral-900 font-sans antialiased">
      {children}
    </div>
  )
}
