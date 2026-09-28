"use client"

// The client's practice rounds, in the Coaching Hub.
//
// A round is either waiting on them (record it), waiting on the coach (nothing
// to do), or finished — and a finished round is the reason this section exists:
// the answers and the coach's written feedback, the feedback sitting under the
// answer it is about. Flattening the two apart is what makes written feedback
// useless, so they are never rendered apart.
//
// Rounds are collapsed until opened. A video element per answer, mounted for
// every round at once, is a lot of network for a page somebody opens to read
// their plan; the detail fetch happens when a round is expanded.

import { useCallback, useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { LIGHT as S, surfaceCard } from "../../../lib/theme/surfaces"

type Row = {
  id: string
  title: string
  status: "sent" | "submitted" | "feedback_sent"
  sent_at: string | null
  submitted_at: string | null
  feedback_sent_at: string | null
  questions: number
  answered: number
}

type Detail = {
  id: string
  title: string
  status: string
  coach_name: string
  feedback_sent_at: string | null
  overall: string | null
  questions: {
    id: string
    position: number
    text: string
    answered: boolean
    works: string | null
    fix: string | null
    url: string | null
  }[]
}

async function token(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  return session?.access_token ?? null
}

/** What the client should read, which is about whose turn it is. */
function statusLine(r: Row): { text: string; key: "attention" | "progress" | "replied" } {
  if (r.status === "feedback_sent") return { text: "Feedback ready", key: "replied" }
  if (r.status === "submitted") return { text: "Sent to your coach", key: "progress" }
  return { text: r.answered > 0 ? `${r.answered} of ${r.questions} recorded` : "Not started", key: "attention" }
}

export function PracticeEntry() {
  const [rows, setRows] = useState<Row[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, Detail>>({})

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const t = await token()
        if (!t) return
        const res = await fetch("/api/me/practice-rounds", { headers: { Authorization: `Bearer ${t}` } })
        const j = await res.json().catch(() => null)
        if (mounted && res.ok && j?.ok) setRows(j.rounds ?? [])
      } catch {
        /* entry point only: Required Actions above reports a failed load */
      }
    })()
    return () => { mounted = false }
  }, [])

  const open = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (detail[id]) return
    const t = await token()
    if (!t) return
    const res = await fetch(`/api/me/practice-rounds/${id}`, { headers: { Authorization: `Bearer ${t}` } })
    const j = await res.json().catch(() => null)
    if (res.ok && j?.ok) setDetail((d) => ({ ...d, [id]: j.round }))
  }, [openId, detail])

  if (rows.length === 0) return null

  return (
    <section style={{ ...surfaceCard(S), padding: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: S.text.muted, marginBottom: 16 }}>
        Practice rounds
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => {
          const s = statusLine(r)
          const expanded = openId === r.id
          const d = detail[r.id]
          return (
            <div key={r.id} style={{ borderRadius: 12, border: `1px solid ${S.borderSoft}`, overflow: "hidden" }}>
              <button type="button" onClick={() => void open(r.id)}
                style={{
                  width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "center",
                  flexWrap: "wrap", padding: "14px 16px", background: "transparent", border: "none",
                  cursor: "pointer", fontFamily: "inherit", minHeight: 52,
                }}>
                <span style={{ flex: "1 1 180px", minWidth: 0, fontSize: 15.5, fontWeight: 700, color: S.text.primary }}>
                  {r.title}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: S.meaning[s.key].ink, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: S.meaning[s.key].ink }}>{s.text}</span>
                </span>
                <span style={{ fontSize: 13, color: S.text.muted, whiteSpace: "nowrap" }}>
                  {expanded ? "Hide" : "Open"}
                </span>
              </button>

              {expanded && (
                <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${S.borderSoft}` }}>
                  {/* Still theirs to record: the only useful thing here is the way in. */}
                  {r.status === "sent" ? (
                    <p style={{ fontSize: 14, color: S.text.secondary, margin: "14px 0 0" }}>
                      <a href={`/dashboard/practice/${r.id}`} style={{ color: S.action.quietInk, fontWeight: 700 }}>
                        Record your answers &rarr;
                      </a>
                    </p>
                  ) : r.status === "submitted" ? (
                    <p style={{ fontSize: 14, color: S.text.secondary, margin: "14px 0 0" }}>
                      Your coach is watching these back. You will get an email when the feedback is ready.
                    </p>
                  ) : !d ? (
                    <p style={{ fontSize: 14, color: S.text.muted, margin: "14px 0 0" }}>Loading...</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
                      {d.questions.map((q) => (
                        <div key={q.id}>
                          <p style={{ fontSize: 15.5, fontWeight: 700, color: S.text.primary, margin: "0 0 10px" }}>
                            {q.position}. {q.text}
                          </p>
                          {q.url ? (
                            <video controls src={q.url} preload="metadata" playsInline
                              style={{ width: "100%", maxWidth: 520, borderRadius: 10, background: "#08203F", display: "block" }} />
                          ) : (
                            <p style={{ fontSize: 14, color: S.text.muted, margin: 0 }}>No recording.</p>
                          )}
                          <FeedbackBlock label="What works" body={q.works} key_="replied" />
                          <FeedbackBlock label="What to fix" body={q.fix} key_="attention" />
                        </div>
                      ))}

                      {d.overall && (
                        <div>
                          <p style={{ fontSize: 15.5, fontWeight: 700, color: S.text.primary, margin: "0 0 8px" }}>
                            {d.coach_name}&rsquo;s overall note
                          </p>
                          <p style={{ fontSize: 14, lineHeight: "21px", color: S.text.secondary, whiteSpace: "pre-wrap", margin: 0 }}>
                            {d.overall}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * One piece of written feedback, under the answer it is about.
 *
 * A left rail in the meaning's accent rather than a filled box: these two sit
 * directly under a video and a filled pair reads as two buttons.
 */
function FeedbackBlock({ label, body, key_ }: { label: string; body: string | null; key_: "replied" | "attention" }) {
  if (!body?.trim()) return null
  return (
    <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: `3px solid ${S.meaning[key_].accent}` }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: S.meaning[key_].ink }}>
        {label}
      </div>
      <p style={{ fontSize: 14, lineHeight: "21px", color: S.text.secondary, whiteSpace: "pre-wrap", margin: "4px 0 0" }}>
        {body}
      </p>
    </div>
  )
}
