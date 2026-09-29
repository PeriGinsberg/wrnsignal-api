"use client"

// The coach's side of a practice round: build it, send it, watch it back.
//
// ONE PAGE FOR ALL THREE STATES, because they are the same round and a coach
// arriving from a Required Action should not have to work out which view they
// want. Draft shows the builder. Sent shows what was asked and that nothing
// has come back. Submitted shows the answers.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { questionBank } from "@/lib/practice/questionBank"
import { MAX_QUESTIONS } from "@/lib/practice/model"
import { T } from "@/lib/dashboard-theme"
import { TYPE } from "@/lib/theme/surfaces"
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea"

type Q = {
  id: string; position: number; text: string; source: "bank" | "custom"
  fb_works?: string | null; fb_fix?: string | null
}
type Answer = {
  question_id: string
  take_id: string | null
  mime: string | null
  duration_ms: number | null
  recorded_at: string | null
  takes: number
  url: string | null
}
type Round = {
  id: string
  title: string
  status: "draft" | "sent" | "submitted" | "feedback_sent"
  fb_overall?: string | null
  feedback_sent_at?: string | null
  client_profile_id: string
  sent_at: string | null
  submitted_at: string | null
  questions: Q[]
}

export default function CoachPracticeRoundPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const router = useRouter()
  const bank = useMemo(() => questionBank(), [])

  const [round, setRound] = useState<Round | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [draft, setDraft] = useState<{ text: string; source: "bank" | "custom" }[]>([])
  const [custom, setCustom] = useState("")
  const [busy, setBusy] = useState<null | "save" | "send" | "feedback">(null)
  // Feedback lives here while it is being typed. Keyed by question id, plus
  // the overall note, so a re-render from the autosave never disturbs the box
  // the coach has a cursor in.
  const [fb, setFb] = useState<Record<string, { works: string; fix: string }>>({})
  const [overall, setOverall] = useState("")
  const [savedAt, setSavedAt] = useState<string>("")
  const dirty = useRef(false)
  const [msg, setMsg] = useState("")
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(true)

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
    const res = await authFetch(`/api/coach/practice-rounds/${roundId}`)
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) {
      setErr(res.status === 404 ? "This round no longer exists." : j?.error ?? "Could not load this round.")
    } else {
      setRound(j.round)
      setAnswers(j.answers ?? [])
      setDraft(j.round.questions.map((q: Q) => ({ text: q.text, source: q.source })))
      // Only seed the boxes once. Re-seeding on every reload would throw away
      // whatever the coach has typed since.
      if (!dirty.current) {
        const seeded: Record<string, { works: string; fix: string }> = {}
        for (const q of j.round.questions as Q[]) {
          seeded[q.id] = { works: q.fb_works ?? "", fix: q.fb_fix ?? "" }
        }
        setFb(seeded)
        setOverall(j.round.fb_overall ?? "")
      }
      setErr("")
    }
    setLoading(false)
  }, [authFetch, roundId])

  useEffect(() => { void load() }, [load])

  const editable = round?.status === "draft"

  const move = (i: number, by: number) => {
    setDraft((d) => {
      const j = i + by
      if (j < 0 || j >= d.length) return d
      const next = [...d]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const save = useCallback(async () => {
    setBusy("save"); setMsg(""); setErr("")
    const res = await authFetch(`/api/coach/practice-rounds/${roundId}`, {
      method: "PATCH", body: JSON.stringify({ questions: draft }),
    })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) setErr(j?.error ?? "Could not save.")
    else { setMsg("Saved."); await load() }
    setBusy(null)
  }, [authFetch, draft, load, roundId])

  const send = useCallback(async () => {
    setBusy("send"); setMsg(""); setErr("")
    // Save first, so what is sent is what is on screen.
    const saved = await authFetch(`/api/coach/practice-rounds/${roundId}`, {
      method: "PATCH", body: JSON.stringify({ questions: draft }),
    })
    const sj = await saved.json().catch(() => null)
    if (!saved.ok || !sj?.ok) { setErr(sj?.error ?? "Could not save before sending."); setBusy(null); return }

    const res = await authFetch(`/api/coach/practice-rounds/${roundId}/send`, { method: "POST" })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) setErr(j?.error ?? "Could not send.")
    else {
      setMsg(
        j.emailed
          ? j.redirected
            ? `Sent. Outside production the email went to ${j.to} instead of the client.`
            : `Sent. The email is on its way to ${j.to}.`
          : `The round is now with the client, but the email did not go out: ${j.error ?? "unknown error"}`,
      )
      await load()
    }
    setBusy(null)
  }, [authFetch, draft, load, roundId])

  // ── Autosave ─────────────────────────────────────────────────────
  //
  // Debounced, not per-keystroke: a coach writing a paragraph would otherwise
  // fire a request per character. 1200ms is long enough to be one request per
  // thought and short enough that a closed laptop loses at most a sentence.
  useEffect(() => {
    if (!dirty.current) return
    if (!round || round.feedback_sent_at) return
    const t = setTimeout(() => {
      void (async () => {
        const res = await authFetch(`/api/coach/practice-rounds/${roundId}/feedback`, {
          method: "PATCH",
          body: JSON.stringify({
            overall,
            answers: Object.entries(fb).map(([question_id, v]) => ({ question_id, ...v })),
          }),
        })
        const j = await res.json().catch(() => null)
        if (res.ok && j?.ok) setSavedAt(new Date().toLocaleTimeString())
      })()
    }, 1200)
    return () => clearTimeout(t)
  }, [fb, overall, authFetch, roundId, round])

  const setWorks = (id: string, v: string) => {
    dirty.current = true
    setFb((f) => ({ ...f, [id]: { works: v, fix: f[id]?.fix ?? "" } }))
  }
  const setFix = (id: string, v: string) => {
    dirty.current = true
    setFb((f) => ({ ...f, [id]: { works: f[id]?.works ?? "", fix: v } }))
  }

  const sendFeedback = useCallback(async () => {
    setBusy("feedback"); setMsg(""); setErr("")
    // Flush the draft first, so what is released is what is on screen rather
    // than whatever the debounce last managed to save.
    const saved = await authFetch(`/api/coach/practice-rounds/${roundId}/feedback`, {
      method: "PATCH",
      body: JSON.stringify({
        overall,
        answers: Object.entries(fb).map(([question_id, v]) => ({ question_id, ...v })),
      }),
    })
    const sj = await saved.json().catch(() => null)
    if (!saved.ok || !sj?.ok) { setErr(sj?.error ?? "Could not save the feedback."); setBusy(null); return }

    const res = await authFetch(`/api/coach/practice-rounds/${roundId}/feedback`, { method: "POST" })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) setErr(j?.error ?? "Could not send the feedback.")
    else {
      dirty.current = false
      setMsg(j.emailed
        ? "Feedback sent. They have an email and it is on their Coaching Hub."
        : `Feedback released, but the email did not go out: ${j.error ?? "unknown error"}`)
      await load()
    }
    setBusy(null)
  }, [authFetch, fb, load, overall, roundId])

  if (loading) return <Wrap><p style={pMuted}>Loading...</p></Wrap>
  if (!round) return <Wrap><p style={{ ...pMuted, color: T.ERROR }}>{err}</p></Wrap>

  const byQuestion = new Map(answers.map((a) => [a.question_id, a]))

  return (
    <Wrap>
      <button type="button" onClick={() => router.push(`/dashboard/coach/clients/${round.client_profile_id}`)}
        style={linkBtn}>&larr; Back to the client</button>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "10px 0 20px" }}>
        <span style={{ fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: T.INK_LINK }}>
          PRACTICE ROUND · {round.status.toUpperCase()}
        </span>
        <h1 style={{ margin: 0, fontSize: TYPE.title, color: T.TEXT }}>{round.title}</h1>
      </div>

      {msg && <div style={{ ...banner, borderColor: T.SUCCESS_BORDER, background: T.SUCCESS_BG }}>{msg}</div>}
      {err && <div style={{ ...banner, borderColor: T.ERROR_BORDER, background: T.ERROR_BG, color: T.ERROR }}>{err}</div>}

      {/* ── The questions ─────────────────────────────────────────── */}
      <section style={card}>
        <h2 style={h2}>{editable ? "Questions" : "What you asked"}</h2>
        {draft.length === 0 && <p style={pMuted}>Nothing yet. Add one below.</p>}
        {draft.map((q, i) => {
          const saved = round.questions[i]
          const a = saved ? byQuestion.get(saved.id) : undefined
          return (
            <div key={i} style={row}>
              <span style={numBubble}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editable ? (
                  <textarea
                    value={q.text}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    rows={2}
                    style={{ width: "100%", fontSize: TYPE.body, lineHeight: "22px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                  />
                ) : (
                  <p style={{ margin: 0, fontSize: TYPE.body, lineHeight: "22px", color: T.TEXT }}>{q.text}</p>
                )}

                {a?.url && (
                  <div style={{ marginTop: 10 }}>
                    <video src={a.url} controls playsInline
                      style={{ width: "100%", maxWidth: 480, borderRadius: 10, background: "#0D1829" }} />
                    <div style={{ fontSize: TYPE.secondary, color: T.MUTED, marginTop: 4 }}>
                      {a.duration_ms != null ? `${Math.round(a.duration_ms / 1000)}s` : "recorded"}
                      {a.takes > 1 ? ` · ${a.takes} takes` : ""}
                    </div>
                  </div>
                )}
                {!a?.url && (round.status === "submitted" || round.status === "feedback_sent") && (
                  <p style={{ ...pMuted, marginTop: 6 }}>No recording for this question.</p>
                )}

                {/* ── Feedback, under the answer it is about ───────────── */}
                {saved && (round.status === "submitted" || round.status === "feedback_sent") && (
                  <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                    <FbBox
                      label="What works"
                      placeholder="The part they should keep doing."
                      value={fb[saved.id]?.works ?? ""}
                      readOnly={!!round.feedback_sent_at}
                      onChange={(v) => setWorks(saved.id, v)}
                    />
                    <FbBox
                      label="What to fix"
                      placeholder="The one change that would make the biggest difference."
                      value={fb[saved.id]?.fix ?? ""}
                      readOnly={!!round.feedback_sent_at}
                      onChange={(v) => setFix(saved.id, v)}
                    />
                  </div>
                )}
              </div>
              {editable && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={miniBtn} aria-label="Move up">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} style={miniBtn} aria-label="Move down">↓</button>
                  <button type="button" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} style={miniBtn} aria-label="Remove">✕</button>
                </div>
              )}
            </div>
          )
        })}
      </section>

      {editable && (
        <>
          {/* ── Add your own ───────────────────────────────────────── */}
          <section style={card}>
            <h2 style={h2}>Write your own</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input value={custom} onChange={(e) => setCustom(e.target.value)}
                placeholder="Tell me about a time..."
                style={{ flex: "1 1 320px", minWidth: 0, fontSize: TYPE.body, padding: "10px 12px", borderRadius: 8, border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT, fontFamily: "inherit" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && custom.trim()) {
                    setDraft((d) => [...d, { text: custom.trim(), source: "custom" }]); setCustom("")
                  }
                }} />
              <button type="button" disabled={!custom.trim() || draft.length >= MAX_QUESTIONS}
                onClick={() => { setDraft((d) => [...d, { text: custom.trim(), source: "custom" }]); setCustom("") }}
                style={btn("secondary")}>Add</button>
            </div>
          </section>

          {/* ── The Session 2 bank ─────────────────────────────────── */}
          <section style={card}>
            <h2 style={h2}>Session 2 question bank</h2>
            <p style={{ ...pMuted, marginTop: 0 }}>
              The twenty questions your client matched their stories against. {draft.length} of {MAX_QUESTIONS} picked.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {bank.map((q) => {
                const on = draft.some((d) => d.text.trim().toLowerCase() === q.text.toLowerCase())
                const full = draft.length >= MAX_QUESTIONS
                return (
                  <button key={q.id} type="button" disabled={on || full}
                    onClick={() => setDraft((d) => [...d, { text: q.text, source: "bank" }])}
                    style={{
                      textAlign: "left", display: "flex", gap: 10, alignItems: "baseline",
                      padding: "9px 10px", borderRadius: 8, border: "none", fontFamily: "inherit",
                      background: on ? T.SUCCESS_BG : "transparent",
                      color: on || full ? T.MUTED : T.TEXT,
                      cursor: on || full ? "default" : "pointer", fontSize: TYPE.secondary, lineHeight: "20px",
                    }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{q.text}</span>
                    <span style={{ fontSize: TYPE.label, fontWeight: 800, color: T.INK_LINK, whiteSpace: "nowrap" }}>
                      {on ? "ADDED" : q.trait.toUpperCase()}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void send()} disabled={busy !== null || draft.length === 0}
              style={btn("primary")}>{busy === "send" ? "Sending..." : "Send to the client"}</button>
            <button type="button" onClick={() => void save()} disabled={busy !== null} style={btn("secondary")}>
              {busy === "save" ? "Saving..." : "Save draft"}
            </button>
            <span style={pMuted}>Sending emails them a link into SIGNAL. They record each answer in 90 seconds.</span>
          </div>
        </>
      )}

      {(round.status === "submitted" || round.status === "feedback_sent") && (
        <section style={card}>
          <h2 style={h2}>Overall note</h2>
          <p style={{ ...pMuted, marginTop: 0 }}>Optional. One thing to carry into the next round.</p>
          <FbBox
            label=""
            placeholder="Anything that applies across all of their answers."
            value={overall}
            readOnly={!!round.feedback_sent_at}
            onChange={(v) => { dirty.current = true; setOverall(v) }}
          />

          {round.feedback_sent_at ? (
            <p style={{ ...pMuted, marginTop: 14, marginBottom: 0, color: T.SUCCESS, fontWeight: 700 }}>
              Feedback sent {new Date(round.feedback_sent_at).toLocaleDateString()}. They can read it on their Coaching Hub.
            </p>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
              <button type="button" onClick={() => void sendFeedback()} disabled={busy !== null}
                style={btn("primary")}>
                {busy === "feedback" ? "Sending..." : "Send feedback"}
              </button>
              <span style={pMuted}>
                {savedAt ? `Draft saved at ${savedAt}. ` : "Saves as you type. "}
                Nothing reaches them until you send.
              </span>
            </div>
          )}
        </section>
      )}

      {round.status === "sent" && (
        <div style={{ ...card }}>
          <p style={{ ...pMuted, margin: 0 }}>
            Sent{round.sent_at ? ` on ${new Date(round.sent_at).toLocaleDateString()}` : ""}. Nothing recorded yet.
            You will get a task here when they submit.
          </p>
        </div>
      )}
    </Wrap>
  )
}

/**
 * One feedback box.
 *
 * Its own component so the label, the sizing and the read-only treatment are
 * the same in all three places, and so a released round renders as text rather
 * than as a disabled input: a greyed-out box invites a click that does nothing.
 */
function FbBox({
  label, placeholder, value, readOnly, onChange,
}: {
  label: string
  placeholder: string
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  if (readOnly) {
    return (
      <div>
        {label && <div style={fbLabel}>{label}</div>}
        <p style={{ margin: 0, fontSize: TYPE.secondary, lineHeight: "20px", color: value ? T.TEXT : T.MUTED, whiteSpace: "pre-wrap", fontStyle: value ? "normal" : "italic" }}>
          {value || "Nothing written."}
        </p>
      </div>
    )
  }
  return (
    <div>
      {label && <div style={fbLabel}>{label}</div>}
      {/* AUTO-GROWING, NOT A FIXED BOX. Two rows of feedback behind an inner
          scrollbar is the campaign-brief bug again, and it bites hardest on a
          phone: at 390px "Say I for the part you owned" wraps to four lines and
          the coach proof-reads their own note through a slot. */}
      <AutoGrowTextarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        minRows={2}
        style={{
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
          fontSize: TYPE.secondary, lineHeight: "20px", padding: "9px 11px", borderRadius: 8,
          border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT,
        }}
      />
    </div>
  )
}

const fbLabel: React.CSSProperties = {
  fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.07em",
  textTransform: "uppercase", color: T.MUTED, marginBottom: 4,
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 820 }}>{children}</div>
}

const card: React.CSSProperties = {
  background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 14, padding: 18, marginBottom: 16,
}
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: TYPE.subheading, color: T.TEXT }
const pMuted: React.CSSProperties = { fontSize: TYPE.secondary, lineHeight: "20px", color: T.MUTED }
const row: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0",
  borderTop: `1px solid ${T.BORDER_SOFT}`,
}
const numBubble: React.CSSProperties = {
  flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: T.SUCCESS_BG, color: T.SUCCESS,
  display: "grid", placeItems: "center", fontWeight: 900, fontSize: TYPE.label,
}
const miniBtn: React.CSSProperties = {
  width: 30, height: 26, borderRadius: 6, border: `1px solid ${T.BORDER}`, background: "transparent",
  color: T.TEXT, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
}
const banner: React.CSSProperties = {
  border: "1px solid", borderRadius: 10, padding: "10px 14px", marginBottom: 14,
  fontSize: TYPE.secondary, lineHeight: "20px", color: T.TEXT,
}
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: T.INK_LINK, fontWeight: 700, cursor: "pointer",
  fontSize: TYPE.secondary, padding: 0, fontFamily: "inherit",
}
function btn(kind: "primary" | "secondary"): React.CSSProperties {
  return {
    padding: "10px 18px", borderRadius: 9, fontSize: TYPE.control, fontWeight: 800, minHeight: 40,
    cursor: "pointer", fontFamily: "inherit",
    border: kind === "primary" ? "none" : `1px solid ${T.BORDER}`,
    background: kind === "primary" ? T.GRAD_PRIMARY : "transparent",
    color: kind === "primary" ? "var(--sig-ink-on-primary, #04060F)" : T.TEXT,
  }
}
