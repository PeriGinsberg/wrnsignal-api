"use client"

// Practice, across every client.
//
// GROUPED BY WHOSE TURN IT IS, not by client and not by date. A coach opening
// this wants one question answered: what is waiting on me? "Needs your
// feedback" is that answer and it sits at the top; the other two groups exist
// so the page is a complete picture rather than an inbox that empties into
// nothing.
//
// The per-client Practice tab still exists and is the place to START a round.
// This page deliberately has no "build a round" button: a round is built for
// somebody, and choosing that somebody is what the client record is for.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { practiceGroup, type PracticeGroup } from "@/lib/practice/model"
import { T } from "@/lib/dashboard-theme"
import { TYPE, SPACE } from "@/lib/theme/surfaces"

type Row = {
  id: string
  title: string
  client_name: string
  client_profile_id: string
  status: "sent" | "submitted" | "feedback_sent"
  created_at: string
  submitted_at: string | null
  feedback_sent_at: string | null
  questions: number
  answered: number
}

const GROUPS: { key: PracticeGroup; label: string; blurb: string; accent: string }[] = [
  { key: "needs_feedback", label: "Needs your feedback", blurb: "Recorded and waiting on you.", accent: T.TASK_OVERDUE },
  { key: "waiting", label: "Waiting on client", blurb: "Sent, not recorded yet.", accent: T.TASK_HEADER },
  { key: "done", label: "Done", blurb: "Feedback sent.", accent: T.TASK_DONE },
]

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function when(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export default function CoachPracticePage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")

  const load = useCallback(async () => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    const token = session?.access_token
    const res = await fetch("/api/coach/practice-rounds", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) setErr(j?.error ?? "Could not load practice rounds.")
    else { setRows(j.rounds ?? []); setErr("") }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ margin: "0 0 6px", fontSize: TYPE.title, color: T.TEXT }}>Practice</h1>
      <p style={{ fontSize: TYPE.secondary, lineHeight: "20px", color: T.MUTED, margin: "0 0 22px" }}>
        Recorded answers from every client you work with. Start a round from the client&rsquo;s Practice tab.
      </p>

      {err && <p style={{ fontSize: TYPE.secondary, color: T.ERROR }} role="alert">{err}</p>}
      {loading && <p style={{ fontSize: TYPE.secondary, color: T.MUTED }}>Loading...</p>}

      {!loading && rows.length === 0 && !err && (
        <p style={{ fontSize: TYPE.secondary, color: T.MUTED }}>
          No practice rounds yet. Open a client and use the Practice tab to build one.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {GROUPS.map((g) => {
          const items = rows.filter((r) => practiceGroup(r.status) === g.key)
          // An empty group is dropped entirely rather than rendered with a
          // zero. Three headings over three empty lists is a page that looks
          // broken; one heading over real rows is a worklist.
          if (items.length === 0) return null
          return (
            <section key={g.key}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                <h2 style={{
                  margin: 0, fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.09em",
                  textTransform: "uppercase", color: g.accent,
                }}>
                  {g.label}
                </h2>
                <span style={{ fontSize: TYPE.label, fontWeight: 800, color: T.DIM }}>{items.length}</span>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: TYPE.secondary, color: T.MUTED }}>{g.blurb}</p>

              <div style={{
                background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 14,
                overflow: "hidden", borderTop: `3px solid ${g.accent}`,
              }}>
                {items.map((r, i) => (
                  <button key={r.id} type="button"
                    onClick={() => router.push(`/dashboard/coach/practice/${r.id}`)}
                    style={{
                      width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "center",
                      flexWrap: "wrap", padding: "14px 16px", background: "transparent", cursor: "pointer",
                      fontFamily: "inherit", border: "none", minHeight: SPACE.row,
                      borderTop: i > 0 ? `1px solid ${T.BORDER_SOFT}` : "none",
                    }}>
                    {/* The client's name leads. On this page the round title is
                        the detail and the person is the subject, which is the
                        opposite of the per-client tab. */}
                    <span style={{ flex: "1 1 190px", minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: TYPE.body, fontWeight: 700, color: T.TEXT }}>
                        {r.client_name}
                      </span>
                      <span style={{ display: "block", fontSize: TYPE.secondary, color: T.MUTED, marginTop: 2 }}>
                        {r.title}
                      </span>
                    </span>
                    <span style={{ fontSize: TYPE.secondary, color: T.MUTED, whiteSpace: "nowrap" }}>
                      {r.answered}/{r.questions} answered
                    </span>
                    <span style={{ fontSize: TYPE.secondary, color: T.DIM, whiteSpace: "nowrap" }}>
                      {when(r.feedback_sent_at ?? r.submitted_at ?? r.created_at)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
