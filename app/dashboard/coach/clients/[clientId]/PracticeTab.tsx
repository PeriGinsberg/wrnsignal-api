"use client"

// Every practice round for one client, and the way to start another.
//
// This is the same list the standalone page shows, moved into a tab because
// that is where the coach already is. The standalone route still exists and
// still works: the Required Action links to it, and a coach arriving from an
// email should not have to find a tab first.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { questionBank } from "@/lib/practice/questionBank"
import { T } from "@/lib/dashboard-theme"
import { TYPE, SPACE } from "@/lib/theme/surfaces"

type Row = {
  id: string
  title: string
  status: "draft" | "sent" | "submitted" | "feedback_sent"
  created_at: string
  sent_at: string | null
  submitted_at: string | null
  feedback_sent_at: string | null
  questions: number
  answered: number
}

/**
 * The words the coach reads, which are about what THEY have to do next rather
 * than about the row's internal state. "Submitted" would be accurate and
 * useless; the coach needs to know it is their turn.
 */
const STATUS: Record<Row["status"], { label: string; tone: "idle" | "waiting" | "action" | "done" }> = {
  draft: { label: "Draft", tone: "idle" },
  sent: { label: "Sent", tone: "waiting" },
  submitted: { label: "Submitted", tone: "action" },
  feedback_sent: { label: "Feedback sent", tone: "done" },
}

export function PracticeTab({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    const token = session?.access_token
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}), "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }, [])

  const load = useCallback(async () => {
    const res = await authFetch(`/api/coach/clients/${clientId}/practice-rounds`)
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) setErr(j?.error ?? "Could not load practice rounds.")
    else { setRows(j.rounds ?? []); setErr("") }
    setLoading(false)
  }, [authFetch, clientId])

  useEffect(() => { void load() }, [load])

  const create = useCallback(async () => {
    setBusy(true); setErr("")
    const seed = questionBank()[0]
    const res = await authFetch(`/api/coach/clients/${clientId}/practice-rounds`, {
      method: "POST",
      body: JSON.stringify({ questions: [{ text: seed.text, source: "bank" }] }),
    })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) { setErr(j?.error ?? "Could not start a round."); setBusy(false); return }
    router.push(`/dashboard/coach/practice/${j.round_id}`)
  }, [authFetch, clientId, router])

  return (
    <div>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap", marginBottom: 14 }}>
        <p style={{ ...muted, margin: 0, flex: "1 1 260px" }}>
          A few interview questions, recorded on video, ninety seconds each. You write the feedback.
        </p>
        <button type="button" onClick={() => void create()} disabled={busy}
          style={{
            padding: "10px 18px", borderRadius: 9, fontSize: TYPE.control, fontWeight: 800,
            minHeight: SPACE.control, border: "none", cursor: "pointer", fontFamily: "inherit",
            background: T.GRAD_PRIMARY, color: "var(--sig-ink-on-primary, #04060F)",
          }}>
          {busy ? "Starting..." : "Build a practice round"}
        </button>
      </div>

      {err && <p style={{ ...muted, color: T.ERROR }} role="alert">{err}</p>}

      {loading ? (
        <p style={muted}>Loading...</p>
      ) : rows.length === 0 ? (
        <p style={muted}>No practice rounds yet.</p>
      ) : (
        <div style={{ background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 14, overflow: "hidden" }}>
          {rows.map((r, i) => {
            const s = STATUS[r.status]
            return (
              <button key={r.id} type="button"
                onClick={() => router.push(`/dashboard/coach/practice/${r.id}`)}
                style={{
                  width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "center",
                  flexWrap: "wrap", padding: "14px 16px", background: "transparent", cursor: "pointer",
                  fontFamily: "inherit", border: "none",
                  borderTop: i > 0 ? `1px solid ${T.BORDER_SOFT}` : "none", minHeight: SPACE.row,
                }}>
                <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: TYPE.body, color: T.TEXT, fontWeight: 600 }}>
                  {r.title}
                </span>
                <span style={{ fontSize: TYPE.secondary, color: T.MUTED, whiteSpace: "nowrap" }}>
                  {r.answered}/{r.questions} answered
                </span>
                <span style={{
                  fontSize: TYPE.label, fontWeight: 800, whiteSpace: "nowrap",
                  padding: "4px 10px", borderRadius: 999,
                  background: s.tone === "done" ? T.SUCCESS_BG : s.tone === "action" ? T.WARNING_BG : T.BORDER_SOFT,
                  color: s.tone === "done" ? T.SUCCESS : s.tone === "action" ? T.WRN_ORANGE : T.MUTED,
                }}>
                  {s.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const muted: React.CSSProperties = { fontSize: TYPE.secondary, lineHeight: "20px", color: T.MUTED }
