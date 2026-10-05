"use client"

// The client's SOW link: the copy that was sent, and Let's Go. They type their
// full name, then click Let's Go; the thank-you replaces the button. Opening
// an accepted link again shows who accepted and when. An old or withdrawn
// link says it is no longer active.

import { useEffect, useState } from "react"
import { SowView } from "../SowView"
import type { SowDocument } from "@/lib/sow/build"
import { ACCEPT_NAME_MAX, ACCEPT_NAME_MIN } from "@/lib/sow/accept-rules"

const C = { navy: "#08203F", peach: "#FEB06A", ink: "#1F3550", muted: "#5B6B80", line: "#D9E4EF", error: "#C0322F" }

type Accepted = { name: string; at: string; first: string; justNow: boolean; workspaceReady: boolean }
type State = { kind: "loading" } | { kind: "gone"; message: string } | { kind: "ok"; doc: SowDocument; accepted: Accepted | null }

const firstOf = (n: string) => n.trim().split(/\s+/)[0] ?? ""
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

export function thankYou(a: Accepted): string {
  return a.workspaceReady
    ? `Thank you, ${a.first}. You're all set. Your Google Drive workspace is ready, and I'll send your welcome email with your first step shortly. Your invoice will follow separately.`
    : `Thank you, ${a.first}. You're all set. I'll send your welcome email with your first step shortly. Your invoice will follow separately.`
}

export function SowLinkPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" })
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/public/sow/${encodeURIComponent(token)}`)
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) { setState({ kind: "gone", message: j?.error || "This link is no longer active." }); return }
        const s = j.sow
        setState({
          kind: "ok", doc: s.document,
          accepted: s.status === "accepted" && s.accepted_name
            ? { name: s.accepted_name, at: s.accepted_at, first: firstOf(s.accepted_name), justNow: false, workspaceReady: true }
            : null,
        })
      } catch {
        setState({ kind: "gone", message: "Something went wrong. Please try again." })
      }
    })()
  }, [token])

  async function letsGo() {
    if (state.kind !== "ok") return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/sow/${encodeURIComponent(token)}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || "Something went wrong. Please try again."); return }
      const a = j.accepted
      setState({ ...state, accepted: { name: a.accepted_name, at: a.accepted_at, first: a.first_name, justNow: !a.already, workspaceReady: !!a.workspace_ready } })
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (state.kind === "ok") {
    const ready = name.trim().length >= ACCEPT_NAME_MIN && !busy
    const footer = state.accepted ? (
      <div role="status" data-testid="sow-accepted" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: "20px 22px", textAlign: "center" }}>
        {state.accepted.justNow ? (
          <p style={{ margin: 0, fontSize: 16, color: C.navy, lineHeight: 1.6 }}>{thankYou(state.accepted)}</p>
        ) : (
          <p style={{ margin: 0, fontSize: 16, color: C.navy }}>
            Accepted by {state.accepted.name} on {day(state.accepted.at)}. Thank you, you&apos;re all set.
          </p>
        )}
      </div>
    ) : (
      <div style={{ textAlign: "center" }}>
        <label style={{ display: "block", fontWeight: 700, color: C.navy, marginBottom: 8 }} htmlFor="sow-name">
          Type your full name to accept
        </label>
        <input id="sow-name" value={name} maxLength={ACCEPT_NAME_MAX} autoComplete="name"
          onChange={(e) => { setName(e.target.value); setError(null) }}
          style={{ width: "100%", maxWidth: 360, boxSizing: "border-box", padding: "12px 14px", fontSize: 16, border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink, fontFamily: "inherit" }} />
        <div style={{ marginTop: 14 }}>
          <button type="button" disabled={!ready} onClick={() => void letsGo()} style={{
            background: C.navy, color: C.peach, border: "none", borderRadius: 12, padding: "14px 40px",
            fontSize: 17, fontWeight: 800, cursor: ready ? "pointer" : "default", opacity: ready ? 1 : 0.6, fontFamily: "inherit",
          }}>
            {busy ? "One moment…" : "Let's Go"}
          </button>
        </div>
        {error && <p role="alert" style={{ color: C.error, marginTop: 10 }}>{error}</p>}
      </div>
    )
    return <SowView doc={state.doc} footer={footer} />
  }

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F4F9FD", color: C.ink }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        {state.kind === "loading" ? (
          <p>Loading your Statement of Work…</p>
        ) : (
          <>
            <h1 style={{ fontSize: 22, color: C.navy, margin: "0 0 8px" }}>{state.message}</h1>
            <p style={{ margin: 0 }}>If you were expecting your Statement of Work here, reply to the email it came in and we will send you a fresh link.</p>
          </>
        )}
      </div>
    </main>
  )
}
