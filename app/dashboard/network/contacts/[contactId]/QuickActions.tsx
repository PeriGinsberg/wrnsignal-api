"use client"

// "Something happened" — the stage moves that do NOT involve sending a message.
//
// Split by likelihood on purpose. "They replied" and "We talked" are the
// frequent forward moves and are prominent; the terminal ones (declined, and
// the outcome that ends the sequence) sit behind Change stage. On a screen built
// for someone with no coach, a rare irreversible-feeling move should not be one
// accidental tap away from the common one.
//
// Plain language, not stage names: the user knows what happened, not which
// stage the engine calls it.

import { useState } from "react"
import { T } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { ChangeStage } from "./ChangeStage"

type Contact = {
  id: string
  stage: string
  outcome_type: string | null
  relationship: string | null
}

const FREQUENT = [
  { stage: "replied", label: "They replied" },
  { stage: "chat_done", label: "We talked" },
] as const

export function QuickActions({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function move(stage: string) {
    setBusy(stage); setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Update failed (${res.status})`)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ color: T.MUTED, fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>
        Something happened?
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {FREQUENT.map((a) => {
          const on = contact.stage === a.stage
          return (
            <button
              key={a.stage}
              onClick={() => void move(a.stage)}
              disabled={busy !== null || on}
              data-testid={`quick-${a.stage}`}
              title={on ? "Already at this stage" : undefined}
              style={{
                background: T.NAV_DEFAULT_BG, color: on ? T.DIM : T.TEXT,
                border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 999,
                padding: "8px 15px", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit",
                cursor: busy !== null || on ? "default" : "pointer",
                opacity: busy === a.stage ? 0.6 : 1,
              }}
            >
              {busy === a.stage ? "Saving…" : a.label}
            </button>
          )
        })}
        <ChangeStage contact={contact} onChanged={onChanged} />
      </div>
      {err && <div style={{ color: T.ERROR, fontSize: 12, marginTop: 8 }} data-testid="quick-error">{err}</div>}
    </div>
  )
}
