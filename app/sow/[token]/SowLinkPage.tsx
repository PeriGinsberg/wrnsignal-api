"use client"

// The client's view of their SOW link: the copy that was sent, or a plain
// "no longer active" for an old or withdrawn link. Let's Go is wired in Step 4;
// until then the button shows but does nothing.

import { useEffect, useState } from "react"
import { SowView } from "../SowView"
import type { SowDocument } from "@/lib/sow/build"

type State = { kind: "loading" } | { kind: "gone"; message: string } | { kind: "ok"; doc: SowDocument }

export function SowLinkPage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" })
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/public/sow/${encodeURIComponent(token)}`)
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) { setState({ kind: "gone", message: j?.error || "This link is no longer active." }); return }
        setState({ kind: "ok", doc: j.sow.document })
      } catch {
        setState({ kind: "gone", message: "Something went wrong. Please try again." })
      }
    })()
  }, [token])

  if (state.kind === "ok") return <SowView doc={state.doc} />
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F4F9FD", color: "#1F3550" }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        {state.kind === "loading" ? (
          <p>Loading your Statement of Work…</p>
        ) : (
          <>
            <h1 style={{ fontSize: 22, color: "#08203F", margin: "0 0 8px" }}>{state.message}</h1>
            <p style={{ margin: 0 }}>If you were expecting your Statement of Work here, reply to the email it came in and we will send you a fresh link.</p>
          </>
        )}
      </div>
    </main>
  )
}
