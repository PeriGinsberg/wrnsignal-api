"use client"

// The coach's review of a Casing Academy case round.
//
// Everything for Sunday on one page: whether the assignment is done, the
// exports, the coaching guide, the student's self-assessment, then each
// question with its recording, transcript, timing, the guide for that
// question and the coach's notes, then the rubric and the overall review.
//
// THE GUIDE ARRIVES FROM THE COACH API, not from an import of the case
// library: this is a client component, and anything it imports ships to
// every browser that loads the page, students included.
//
// Rubric and review autosave to /review and are never shown to the student.
// The question notes and the overall note are the existing practice feedback
// (What works / What to fix), released with Send feedback as before.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { T } from "@/lib/dashboard-theme"
import { TYPE } from "@/lib/theme/surfaces"
import { AutoGrowTextarea } from "@/components/ui/AutoGrowTextarea"
import { DIMENSIONS, REVIEW_FIELDS, rubricAverage, type CoachReview, type Rubric } from "@/lib/academy/rubric"
import { PerformancePackage } from "@/components/academy/PerformancePackage"

export type CaseAnswer = {
  question_id: string; take_id: string | null; mime: string | null; duration_ms: number | null
  recorded_at: string | null; takes: number; url: string | null; seconds: number
  question_shown_at: string | null; response_started_at: string | null; response_ended_at: string | null
  first_speech_ms: number | null; transcript: string | null
  transcript_status: "pending" | "done" | "failed" | "unavailable" | null; transcript_error: string | null
}
type GuideQ = {
  qkey: string; title: string; text: string; exhibit?: string; answer_seconds: number; prep_seconds?: number
  coach: {
    purpose: string; strong: string[]; example: string; calculation?: string[]; alternatives: string[]
    common_errors: string[]; overanalysis: string[]; poor_prioritization: string[]; interventions: string[]
  }
}
export type Academy = {
  guide: null | {
    id: string; title: string; type: string; difficulty: string; minutes: string
    self_assessment: { key: string; question: string }[]
    questions: GuideQ[]
    coach: { answer_key: string[]; qualifications: string[]; model_reasoning: string; diagnosis: { analytical: string[]; communication: string[] }; coaching_prompts: string[] }
  }
  rubric: Rubric
  review: Partial<CoachReview>
  review_updated_at: string | null
  workbook: { id: string; title: string | null; status: string } | null
  attempts: { id: string; title: string; case_title: string | null; difficulty: string | null; status: string; submitted_at: string | null; rubric_average: number | null; current: boolean }[]
}
type Q = { id: string; position: number; text: string; title?: string | null; exhibit?: string | null; qkey?: string | null }

export function CaseReview({
  roundId, clientId, status, questions, answers, academy, selfAssessment, authFetch, notes, onReload,
}: {
  roundId: string; clientId: string; status: string; questions: Q[]; answers: CaseAnswer[]; academy: Academy
  selfAssessment: Record<string, string> | null
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  /** The parent's What works / What to fix boxes for one question. */
  notes: (questionId: string) => ReactNode
  onReload: () => Promise<void>
}) {
  const guide = academy.guide
  const byQ = new Map(answers.map((a) => [a.question_id, a]))
  const submitted = status === "submitted" || status === "feedback_sent"
  const saDone = !!guide && guide.self_assessment.every((q) => (selfAssessment?.[q.key] ?? "").trim())
  const wbBack = academy.workbook?.status === "with_coach"

  // ── Rubric + review autosave ───────────────────────────────────────
  const [rubric, setRubric] = useState<Rubric>(academy.rubric ?? {})
  const [review, setReview] = useState<CoachReview>({ strengths: "", priorities: "", drills: "", summary: "", ...academy.review })
  const [savedAt, setSavedAt] = useState(academy.review_updated_at ? new Date(academy.review_updated_at).toLocaleTimeString() : "")
  const [saveErr, setSaveErr] = useState("")
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => {
      void (async () => {
        const res = await authFetch(`/api/coach/practice-rounds/${roundId}/review`, { method: "PATCH", body: JSON.stringify({ rubric, review }) })
        const j = await res.json().catch(() => null)
        if (res.ok && j?.ok) { setSavedAt(new Date().toLocaleTimeString()); setSaveErr("") }
        else setSaveErr(j?.error ?? "Could not save the rubric")
      })()
    }, 1000)
    return () => clearTimeout(t)
  }, [rubric, review, authFetch, roundId])
  const setScore = (k: string, score: number | null) => { dirty.current = true; setRubric((r) => ({ ...r, [k]: { score, note: r[k as keyof Rubric]?.note ?? "" } })) }
  const setNote = (k: string, note: string) => { dirty.current = true; setRubric((r) => ({ ...r, [k]: { score: r[k as keyof Rubric]?.score ?? null, note } })) }
  const avg = rubricAverage(rubric)

  const [retrying, setRetrying] = useState<string | null>(null)
  const retry = useCallback(async (takeId: string) => {
    setRetrying(takeId)
    await authFetch(`/api/coach/practice-rounds/${roundId}/review`, { method: "POST", body: JSON.stringify({ action: "transcribe", take_id: takeId }) })
    await onReload()
    setRetrying(null)
  }, [authFetch, onReload, roundId])

  // Transcripts land a few seconds after each answer: poll while any is pending.
  const pending = answers.some((a) => a.transcript_status === "pending")
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => { void onReload() }, 8000)
    return () => clearInterval(t)
  }, [pending, onReload])

  return (
    <>
      {/* ── Assignment status and exports ─────────────────────────────── */}
      <section style={card}>
        <h2 style={h2}>Assignment</h2>
        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <StatusRow ok={!academy.workbook || wbBack} label={academy.workbook
            ? `Workbook: ${academy.workbook.title ?? "linked workbook"} (${wbBack ? "sent back by the student" : academy.workbook.status === "with_client" ? "with the student" : academy.workbook.status})`
            : "No workbook linked to this round"} />
          <StatusRow ok={answers.filter((a) => a.take_id).length === questions.length} label={`Case: ${answers.filter((a) => a.take_id).length} of ${questions.length} answers recorded`} />
          <StatusRow ok={saDone} label={`Self-assessment: ${saDone ? "done" : "not finished"}`} />
          <StatusRow ok={submitted} label={submitted ? "Submitted" : "Not submitted yet"} />
          {submitted && (!academy.workbook || wbBack) && (
            <span style={{ fontSize: TYPE.secondary, fontWeight: 800, color: T.SUCCESS }}>Assignment complete.</span>
          )}
        </div>
        {academy.workbook && (
          <p style={{ ...pMuted, marginTop: 0 }}>
            Workbook answers are on the client&rsquo;s{" "}
            <a href={`/dashboard/coach/clients/${clientId}?tab=workbooks`} style={{ color: T.INK_LINK, fontWeight: 700 }}>Workbooks tab</a>.
          </p>
        )}
        <PerformancePackage clientId={clientId} roundId={roundId} />
      </section>

      {/* ── Attempts ──────────────────────────────────────────────────── */}
      {academy.attempts.length > 0 && (
        <section style={card}>
          <h2 style={h2}>Case attempts</h2>
          <p style={{ ...pMuted, marginTop: 0 }}>Cases of different difficulty are not directly comparable. Compare like with like.</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: TYPE.secondary, color: T.TEXT }}>
              <thead><tr>{["Round", "Case", "Difficulty", "Status", "Rubric avg"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {academy.attempts.map((a) => (
                  <tr key={a.id}>
                    <td style={td}>{a.current ? <strong>{a.title} (this one)</strong> : <a href={`/dashboard/coach/practice/${a.id}`} style={{ color: T.INK_LINK }}>{a.title}</a>}</td>
                    <td style={td}>{a.case_title ?? "Unknown case"}</td>
                    <td style={td}>{a.difficulty ?? ""}</td>
                    <td style={td}>{a.status}{a.submitted_at ? `, ${new Date(a.submitted_at).toLocaleDateString()}` : ""}</td>
                    <td style={td}>{a.rubric_average ?? "not scored"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Sunday guide ─────────────────────────────────────────────── */}
      {guide && (
        <section style={card}>
          <h2 style={h2}>Coaching guide: {guide.title}</h2>
          <p style={{ ...pMuted, marginTop: 0 }}>Coach only. The student never sees this page.</p>
          <Fold title="Answer key" open>
            <List items={guide.coach.answer_key} />
            <div style={sub}>What strong candidates qualify</div>
            <List items={guide.coach.qualifications} />
          </Fold>
          <Fold title="How the case should flow">
            <p style={pBody}>{guide.coach.model_reasoning}</p>
          </Fold>
          <Fold title="Analytical problem or communication problem?">
            <div style={sub}>Signs it is analytical</div>
            <List items={guide.coach.diagnosis.analytical} />
            <div style={sub}>Signs it is communication</div>
            <List items={guide.coach.diagnosis.communication} />
          </Fold>
          <Fold title="Coaching prompts for Sunday" open>
            <List items={guide.coach.coaching_prompts.map((p) => `"${p}"`)} />
          </Fold>
        </section>
      )}

      {/* ── Self-assessment ──────────────────────────────────────────── */}
      {guide && (
        <section style={card}>
          <h2 style={h2}>Self-assessment</h2>
          {guide.self_assessment.map((q, i) => (
            <div key={q.key} style={{ padding: "10px 0", borderTop: i ? `1px solid ${T.BORDER_SOFT}` : "none" }}>
              <div style={{ fontSize: TYPE.secondary, fontWeight: 800, color: T.TEXT }}>{i + 1}. {q.question}</div>
              <p style={{ ...pBody, margin: "4px 0 0", whiteSpace: "pre-wrap", color: (selfAssessment?.[q.key] ?? "").trim() ? T.TEXT : T.MUTED, fontStyle: (selfAssessment?.[q.key] ?? "").trim() ? "normal" : "italic" }}>
                {(selfAssessment?.[q.key] ?? "").trim() || "Not answered yet."}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* ── The questions ────────────────────────────────────────────── */}
      {questions.map((q, i) => {
        const a = byQ.get(q.id)
        const g = guide?.questions.find((x) => x.qkey === q.qkey) ?? guide?.questions[i]
        const think = a?.question_shown_at && a.response_started_at ? new Date(a.response_started_at).getTime() - new Date(a.question_shown_at).getTime() : null
        const isAudio = (a?.mime ?? "").startsWith("audio")
        return (
          <section key={q.id} style={card}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={numBubble}>{i + 1}</span>
              <h2 style={{ ...h2, margin: 0 }}>{q.title ?? `Question ${i + 1}`}</h2>
            </div>
            <p style={{ ...pBody, color: T.TEXT, fontWeight: 600, marginTop: 10 }}>{q.text}</p>
            {q.exhibit && <pre style={exhibit}>{q.exhibit}</pre>}

            {a?.url ? (
              isAudio
                ? <audio src={a.url} controls style={{ width: "100%", maxWidth: 480 }} />
                : <video src={a.url} controls playsInline style={{ width: "100%", maxWidth: 520, borderRadius: 10, background: "#0D1829" }} />
            ) : (
              <p style={pMuted}>{a?.take_id ? "The recording link could not be created. Reload the page." : "No answer recorded yet."}</p>
            )}

            {a?.take_id && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
                <Chip label="Think time" value={think != null ? `${Math.round(think / 1000)}s` : "not recorded"} />
                <Chip label="Answer" value={a.duration_ms != null ? `${Math.round(a.duration_ms / 1000)}s of ${a.seconds}s` : "not recorded"}
                  warn={a.duration_ms != null && a.duration_ms / 1000 >= a.seconds - 1} />
                <Chip label="First words" value={a.first_speech_ms != null ? `${(a.first_speech_ms / 1000).toFixed(1)}s in` : "needs transcript"} />
                {a.takes > 1 && <Chip label="Takes" value={String(a.takes)} />}
              </div>
            )}
            {a?.take_id && a.duration_ms != null && a.duration_ms / 1000 >= a.seconds - 1 && (
              <p style={{ ...pMuted, marginTop: 0 }}>Ran to the time limit: the answer was cut off by the clock.</p>
            )}

            {a?.take_id && (
              <div style={{ marginTop: 6 }}>
                <div style={sub}>Transcript (verbatim, machine-made)</div>
                {a.transcript_status === "done" && (a.transcript ?? "").trim()
                  ? <p style={{ ...pBody, whiteSpace: "pre-wrap", color: T.TEXT, margin: "4px 0 0" }}>{a.transcript}</p>
                  : <p style={{ ...pMuted, margin: "4px 0 0" }}>
                      {a.transcript_status === "pending" ? "Being transcribed. This page checks again every few seconds."
                        : a.transcript_status === "done" ? `Empty: ${a.transcript_error ?? "no speech detected"}.`
                        : a.transcript_status === "failed" ? `Transcription failed: ${a.transcript_error ?? "unknown error"}.`
                        : a.transcript_status === "unavailable" ? `Unavailable: ${a.transcript_error ?? ""}`
                        : "No transcript."}
                    </p>}
                {a.transcript_status !== "done" && a.transcript_status !== "pending" && (
                  <button type="button" onClick={() => void retry(a.take_id!)} disabled={retrying === a.take_id} style={{ ...smallBtn, marginTop: 8 }}>
                    {retrying === a.take_id ? "Transcribing..." : "Try the transcript again"}
                  </button>
                )}
              </div>
            )}

            {g && (
              <Fold title="Guide for this question">
                <p style={pBody}><strong>Purpose.</strong> {g.coach.purpose}</p>
                <div style={sub}>A strong answer</div><List items={g.coach.strong} />
                <div style={sub}>Example</div><p style={{ ...pBody, fontStyle: "italic" }}>&ldquo;{g.coach.example}&rdquo;</p>
                {g.coach.calculation && <><div style={sub}>Calculation</div><List items={g.coach.calculation} /></>}
                <div style={sub}>Also acceptable</div><List items={g.coach.alternatives} />
                <div style={sub}>Common errors</div><List items={g.coach.common_errors} />
                <div style={sub}>Signs of overanalysis</div><List items={g.coach.overanalysis} />
                <div style={sub}>Signs of poor prioritization</div><List items={g.coach.poor_prioritization} />
                <div style={sub}>Live interventions</div><List items={g.coach.interventions.map((x) => `"${x}"`)} />
              </Fold>
            )}

            {submitted && <div style={{ marginTop: 14 }}>{notes(q.id)}</div>}
          </section>
        )
      })}

      {/* ── Rubric ───────────────────────────────────────────────────── */}
      <section style={card}>
        <h2 style={h2}>Rubric{avg != null ? `: average ${avg}` : ""}</h2>
        <p style={{ ...pMuted, marginTop: 0 }}>
          Private to you: the rubric and the review below are never shown to the student. {savedAt ? `Saved at ${savedAt}.` : "Saves as you go."}
          {saveErr && <span style={{ color: T.ERROR }}> {saveErr}</span>}
        </p>
        {DIMENSIONS.map((d) => {
          const e = rubric[d.key]
          return (
            <div key={d.key} style={{ padding: "12px 0", borderTop: `1px solid ${T.BORDER_SOFT}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: TYPE.body, fontWeight: 800, color: T.TEXT }}>{d.label}</span>
                <div style={{ display: "flex", gap: 6 }} role="radiogroup" aria-label={d.label}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={e?.score === n}
                      onClick={() => setScore(d.key, e?.score === n ? null : n)}
                      style={{
                        width: 36, height: 36, borderRadius: 8, fontWeight: 800, fontFamily: "inherit", cursor: "pointer", fontSize: 15,
                        border: `1px solid ${e?.score === n ? "transparent" : T.BORDER}`,
                        background: e?.score === n ? T.GRAD_PRIMARY : "transparent",
                        color: e?.score === n ? "var(--sig-ink-on-primary, #04060F)" : T.TEXT,
                      }}>{n}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, margin: "8px 0" }}>
                {([1, 3, 5] as const).map((n) => (
                  <div key={n} style={{ fontSize: TYPE.label + 1, lineHeight: "17px", color: T.MUTED }}><strong style={{ color: T.TEXT }}>{n}:</strong> {d.anchors[n]}</div>
                ))}
              </div>
              <AutoGrowTextarea value={e?.note ?? ""} placeholder="Evidence: quote or timestamp." minRows={1}
                onChange={(ev) => setNote(d.key, ev.target.value)} style={textarea} />
            </div>
          )
        })}
      </section>

      <section style={card}>
        <h2 style={h2}>Overall review</h2>
        {REVIEW_FIELDS.map((f) => (
          <div key={f.key} style={{ marginBottom: 12 }}>
            <div style={sub}>{f.label}</div>
            <AutoGrowTextarea value={review[f.key]} placeholder={f.placeholder} minRows={2}
              onChange={(ev) => { dirty.current = true; setReview((r) => ({ ...r, [f.key]: ev.target.value })) }} style={textarea} />
          </div>
        ))}
      </section>
    </>
  )
}

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: TYPE.secondary, color: T.TEXT }}>
      <span aria-hidden style={{ fontWeight: 900, color: ok ? T.SUCCESS : T.MUTED }}>{ok ? "✓" : "○"}</span>
      <span>{label}</span>
    </div>
  )
}
function Chip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span style={{ fontSize: TYPE.label + 1, padding: "4px 10px", borderRadius: 999, border: `1px solid ${warn ? T.ORANGE_BORDER : T.BORDER}`, color: T.TEXT }}>
      <span style={{ color: T.MUTED }}>{label}: </span><strong>{value}</strong>
    </span>
  )
}
function Fold({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} style={{ marginTop: 10, borderTop: `1px solid ${T.BORDER_SOFT}`, paddingTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: TYPE.secondary, fontWeight: 800, color: T.INK_LINK }}>{title}</summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  )
}
function List({ items }: { items: string[] }) {
  return <ul style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{items.map((x, i) => <li key={i} style={{ ...pBody, margin: "3px 0" }}>{x}</li>)}</ul>
}

const card: React.CSSProperties = { background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 14, padding: 18, marginBottom: 16 }
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: TYPE.subheading, color: T.TEXT }
const pMuted: React.CSSProperties = { fontSize: TYPE.secondary, lineHeight: "20px", color: T.MUTED }
const pBody: React.CSSProperties = { fontSize: TYPE.secondary, lineHeight: "21px", color: T.TEXT, margin: "4px 0" }
const sub: React.CSSProperties = { fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: T.MUTED, margin: "10px 0 4px" }
const exhibit: React.CSSProperties = { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: TYPE.secondary, lineHeight: "21px", color: T.TEXT, background: T.SUCCESS_BG, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 10, padding: "10px 12px", margin: "0 0 12px" }
const numBubble: React.CSSProperties = { flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: T.SUCCESS_BG, color: T.SUCCESS, display: "grid", placeItems: "center", fontWeight: 900, fontSize: TYPE.label }
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${T.BORDER}`, color: T.MUTED, fontWeight: 800, fontSize: TYPE.label }
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${T.BORDER_SOFT}`, verticalAlign: "top" }
const textarea: React.CSSProperties = { width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: TYPE.secondary, lineHeight: "20px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT }
const smallBtn: React.CSSProperties = { padding: "6px 12px", borderRadius: 8, border: `1px solid ${T.BORDER}`, background: "transparent", color: T.TEXT, cursor: "pointer", fontFamily: "inherit", fontSize: TYPE.secondary, fontWeight: 700 }
