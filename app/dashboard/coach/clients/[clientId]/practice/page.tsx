"use client"

// Every practice round for one client, and the way to start another.
//
// The Required Action raised when homework is completed links here, so this is
// usually the first thing a coach sees about practice rounds.

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { questionBank } from "@/lib/practice/questionBank"
import { T } from "@/lib/dashboard-theme"
import { TYPE } from "@/lib/theme/surfaces"

type Row = {
  id: string
  title: string
  status: "draft" | "sent" | "submitted"
  created_at: string
  sent_at: string | null
  submitted_at: string | null
  questions: number
  answered: number
}

const STATUS_LABEL: Record<Row["status"], string> = {
  draft: "Draft",
  sent: "With the client",
  submitted: "Answers in",
}

export default function ClientPracticeListPage() {
  const { clientId } = useParams<{ clientId: string }>()
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

  /**
   * A new round starts with one question already in it.
   *
   * An empty builder is a blank page, and the API needs at least one question
   * anyway. The first from the bank is a reasonable default and the coach
   * replaces or removes it in a click.
   */
  const create = useCallback(async () => {
    setBusy(true); setErr("")
    const seed = questionBank()[0]
    const res = await authFetch(`/api/coach/clients/${clientId}/practice-rounds`, {
      method: "POST",
      body: JSON.stringify({
        questions: seed ? [{ text: seed.text, source: "bank" }] : [{ text: "Tell me about a time you faced a challenge.", source: "custom" }],
      }),
    })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) { setErr(j?.error ?? "Could not start a round."); setBusy(false); return }
    router.push(`/dashboard/coach/practice/${j.round_id}`)
  }, [authFetch, clientId, router])

  return (
    <div style={{ maxWidth: 820 }}>
      <button type="button" onClick={() => router.push(`/dashboard/coach/clients/${clientId}`)}
        style={{ background: "none", border: "none", color: T.INK_LINK, fontWeight: 700, cursor: "pointer", fontSize: TYPE.secondary, padding: 0, fontFamily: "inherit" }}>
        &larr; Back to the client
      </button>

      <h1 style={{ margin: "10px 0 6px", fontSize: TYPE.title, color: T.TEXT }}>Practice rounds</h1>
      <p style={{ fontSize: TYPE.secondary, lineHeight: "20px", color: T.MUTED, marginTop: 0 }}>
        A few interview questions, recorded on video, ninety seconds each.
      </p>

      {err && <p style={{ fontSize: TYPE.secondary, color: T.ERROR }} role="alert">{err}</p>}

      <button type="button" onClick={() => void create()} disabled={busy}
        style={{
          padding: "11px 18px", borderRadius: 9, fontSize: TYPE.control, fontWeight: 800, minHeight: 40,
          border: "none", cursor: "pointer", fontFamily: "inherit", margin: "6px 0 18px",
          background: T.GRAD_PRIMARY, color: "var(--sig-ink-on-primary, #04060F)",
        }}>
        {busy ? "Starting..." : "Build a practice round"}
      </button>

      {loading ? (
        <p style={{ fontSize: TYPE.secondary, color: T.MUTED }}>Loading...</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: TYPE.secondary, color: T.MUTED }}>None yet.</p>
      ) : (
        <div style={{ background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 14, overflow: "hidden" }}>
          {rows.map((r, i) => (
            <button key={r.id} type="button"
              onClick={() => router.push(`/dashboard/coach/practice/${r.id}`)}
              style={{
                width: "100%", textAlign: "left", display: "flex", gap: 14, alignItems: "center",
                padding: "14px 16px", background: "transparent", cursor: "pointer", fontFamily: "inherit",
                border: "none", borderTop: i > 0 ? `1px solid ${T.BORDER_SOFT}` : "none", minHeight: 52,
              }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: TYPE.body, color: T.TEXT, fontWeight: 600 }}>
                {r.title}
              </span>
              <span style={{ fontSize: TYPE.secondary, color: T.MUTED, whiteSpace: "nowrap" }}>
                {r.answered}/{r.questions} answered
              </span>
              <span style={{
                fontSize: TYPE.label, fontWeight: 800, whiteSpace: "nowrap", padding: "4px 10px", borderRadius: 999,
                background: r.status === "submitted" ? T.SUCCESS_BG : r.status === "sent" ? "var(--sig-pill-inactive-bg, rgba(255,255,255,0.08))" : T.BORDER_SOFT,
                color: r.status === "submitted" ? T.SUCCESS : T.MUTED,
              }}>
                {STATUS_LABEL[r.status]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
