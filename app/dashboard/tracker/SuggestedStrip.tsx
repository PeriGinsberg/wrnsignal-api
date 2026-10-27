"use client"

// SUGGESTED: jobs a supporter added that are waiting on the client. Each one
// is either added to the tracker (it becomes a saved job, tagged with who
// suggested it) or passed on (the supporter sees "Not added"). Nothing here
// is on the tracker until the client says so.

import { useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../lib/theme/surfaces"
import { authFetch } from "../network/authFetch"

export type Suggestion = {
  id: string
  company_name: string
  job_title: string
  job_url: string
  location: string
  note: string
  added_by_name: string | null
}

export function SuggestedStrip({ suggestions, onHandled }: { suggestions: Suggestion[]; onHandled: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (suggestions.length === 0) return null

  async function act(id: string, action: "accept" | "dismiss") {
    setBusy(id); setErr(null)
    try {
      const res = await authFetch(`/api/me/suggestions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) setErr(j?.error || "That didn't work. Try again.")
      else onHandled()
    } catch {
      setErr("Network error. Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      data-testid="suggested-strip"
      style={{
        marginTop: 18, padding: "14px 18px", borderRadius: 12,
        background: S.meaning.attention.fill, borderLeft: `3px solid ${S.meaning.attention.accent}`,
      }}
    >
      <div style={{ color: S.meaning.attention.ink, fontSize: 14.5, fontWeight: 800 }}>
        Suggested for you · {suggestions.length}
      </div>
      {err && <p style={{ color: S.meaning.error.ink, fontSize: 13.5, fontWeight: 700, margin: "8px 0 0" }}>{err}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {suggestions.map((s) => (
          <div
            key={s.id}
            style={{
              background: S.card, borderRadius: 10, padding: "12px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: S.text.primary }}>
                {s.job_title} <span style={{ color: S.text.muted, fontWeight: 600 }}>· {s.company_name}</span>
              </div>
              <div style={{ fontSize: 13, color: S.text.muted, marginTop: 3 }}>
                Added by {s.added_by_name ?? "a supporter"}
                {s.location ? ` · ${s.location}` : ""}
              </div>
              {s.note && <div style={{ fontSize: 13.5, color: S.text.secondary, marginTop: 6 }}>{s.note}</div>}
              {s.job_url && (
                <a href={s.job_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: S.action.quietInk }}>
                  Job posting
                </a>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                disabled={busy === s.id}
                onClick={() => void act(s.id, "accept")}
                style={{ ...actionStyle(S, "primary"), borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontFamily: "inherit", opacity: busy === s.id ? 0.55 : 1 }}
              >
                Add to tracker
              </button>
              <button
                disabled={busy === s.id}
                onClick={() => void act(s.id, "dismiss")}
                style={{ ...actionStyle(S, "optional"), borderRadius: 10, padding: "8px 14px", fontSize: 13.5, fontFamily: "inherit" }}
              >
                Pass
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
