"use client"

// The supporter invite, from the link in the email.
//
//   Not signed in: show who invited you, and email a sign-in link to the
//   invited address. That link returns here signed in.
//   Signed in: accept, then go to the supporter area.
//
// Signing in through the invited address is the proof of ownership, so the
// server also refuses an accept from any other login.

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { LIGHT as S, action } from "../../../../lib/theme/surfaces"
import { supporterFetch, supporterToken } from "../supporterFetch"

export default function AcceptPage() {
  return (
    <Suspense fallback={null}>
      <Accept />
    </Suspense>
  )
}

type Invite = { email: string; display_name: string; client_first_name: string }

function Accept() {
  const token = useSearchParams().get("token") ?? ""
  const [phase, setPhase] = useState<"loading" | "invite" | "sent" | "accepting" | "error">("loading")
  const [invite, setInvite] = useState<Invite | null>(null)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      if (!token) {
        setError("This link is missing its invite code. Open it again from the email.")
        setPhase("error")
        return
      }
      // The layout finishes any magic-link sign-in before rendering this page,
      // so a session here means the supporter came back through the email.
      if (await supporterToken()) {
        setPhase("accepting")
        const j = await supporterFetch("/api/supporter/accept", { method: "POST", body: JSON.stringify({ token }) })
        if (!live) return
        if (j.ok) {
          window.location.replace(`/dashboard/supporter?client=${encodeURIComponent(j.client_profile_id)}`)
          return
        }
        setError(j.error)
        setPhase("error")
        return
      }
      const j = await supporterFetch(`/api/supporter/invite?token=${encodeURIComponent(token)}`)
      if (!live) return
      if (j.ok) {
        setInvite(j.invite)
        setPhase("invite")
      } else {
        setError(j.error)
        setPhase("error")
      }
    })()
    return () => { live = false }
  }, [token])

  async function sendLink() {
    setSending(true)
    const j = await supporterFetch("/api/supporter/invite", { method: "POST", body: JSON.stringify({ token }) })
    setSending(false)
    if (j.ok) setPhase("sent")
    else setError(j.error)
  }

  const card: React.CSSProperties = {
    background: S.card, border: `1px solid ${S.borderSoft}`, borderRadius: 16,
    boxShadow: S.shadow.raised, padding: 28, maxWidth: 440, margin: "40px auto 0",
  }
  const p: React.CSSProperties = { fontSize: 15, color: S.text.secondary, lineHeight: "23px", margin: "12px 0 0" }

  if (phase === "loading" || phase === "accepting") {
    return <p style={{ ...p, textAlign: "center", marginTop: 60 }}>{phase === "accepting" ? "Accepting your invite…" : "Loading…"}</p>
  }

  if (phase === "error") {
    return (
      <div style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>This invite cannot be used</h1>
        <p style={p}>{error}</p>
      </div>
    )
  }

  if (phase === "sent") {
    return (
      <div style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Check your email</h1>
        <p style={p}>
          We sent a sign-in link to <strong style={{ color: S.text.primary }}>{invite?.email}</strong>. Open it on this
          device to finish accepting.
        </p>
      </div>
    )
  }

  return (
    <div style={card}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
        {invite?.client_first_name} invited you to be a supporter
      </h1>
      <p style={p}>
        Hi {invite?.display_name}. As a supporter you can see {invite?.client_first_name}&apos;s job tracker, the jobs SIGNAL
        has scored for them, their cover letters and their resume, and you can suggest jobs for them to look at.
      </p>
      <p style={p}>
        To accept, sign in as <strong style={{ color: S.text.primary }}>{invite?.email}</strong>. We will email you a link.
        No password needed.
      </p>
      {error && <p style={{ ...p, color: S.meaning.error.ink, fontWeight: 700 }}>{error}</p>}
      <button
        onClick={() => void sendLink()}
        disabled={sending}
        style={{
          ...action(S, "primary"), width: "100%", marginTop: 20, padding: "13px 20px", borderRadius: 10,
          fontSize: 15, fontFamily: "inherit", opacity: sending ? 0.55 : 1,
        }}
      >
        {sending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </div>
  )
}
