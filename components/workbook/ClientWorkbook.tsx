"use client"

// components/workbook/ClientWorkbook.tsx
//
// The client's workbook (spec "Flow and events: Client"). Autosave per field,
// "Ask your coach" on any field or section plus one general question box, one
// Send button. Coach comments, suggested edits and answers appear in the margin
// once the coach sends the workbook back.

import React, { useCallback, useEffect, useId, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  GENERAL_SECTION_ID, answerText, progress,
  type AnswerValue, type WorkbookContent,
} from "../../lib/workbook/content"
import { SectionBlocks, SectionHeader, type FieldApi } from "./Blocks"
import { useAutosave } from "./useAutosave"
import { wbFetch, fmtWhen, type Comment, type Send } from "./api"
import { WorkbookFrame } from "./WorkbookFrame"

type Loaded = {
  workbook: { id: string; status: string; content: WorkbookContent; interview: any }
  answers: Record<string, { value: unknown; updated_at: string }>
  comments: Comment[]
  sends: Send[]
}

export function ClientWorkbook({ workbookId }: { workbookId: string }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { status, body } = await wbFetch<Loaded>(`/api/me/workbooks/${workbookId}`)
      if (!live) return
      if (status !== 200 || !body.ok) { setError(body.error || "Couldn't load your workbook."); return }
      setData(body)
      void wbFetch(`/api/me/workbooks/${workbookId}/opened`, { method: "POST", body: "{}" })
    })()
    return () => { live = false }
  }, [workbookId])

  if (error) return <WorkbookFrame><div className="wb-main"><p className="wb-p">{error}</p></div></WorkbookFrame>
  if (!data) return <WorkbookFrame><div className="wb-main"><p className="wb-p wb-muted">Loading your workbook</p></div></WorkbookFrame>
  return <Loaded data={data} />
}

function Composer(props: { label: string; initial?: string; onSave(body: string): Promise<string | null>; onCancel(): void; cta: string }) {
  const [body, setBody] = useState(props.initial ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const id = useId()
  return (
    <div className="wb-card-soft">
      <label htmlFor={id} className="wb-eyebrow-ink" style={{ fontSize: 12 }}>{props.label}</label>
      <textarea id={id} className="wb-textarea-box" rows={3} value={body} autoFocus onChange={(e) => setBody(e.target.value)} />
      {err && <span className="wb-warn" role="alert">{err}</span>}
      <div className="wb-actions">
        <button type="button" className="wb-btn wb-btn-solid" disabled={busy || !body.trim()}
          onClick={async () => { setBusy(true); const e = await props.onSave(body); setBusy(false); if (e) setErr(e) }}>
          {props.cta}
        </button>
        <button type="button" className="wb-btn" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function Loaded({ data }: { data: Loaded }) {
  const wb = data.workbook
  const c = wb.content
  const coach = c.coach.first_name
  const auto = useAutosave(wb.id, data.answers)
  const [comments, setComments] = useState<Comment[]>(data.comments)
  const [sends, setSends] = useState<Send[]>(data.sends)
  const [status, setStatus] = useState(wb.status)
  const [idx, setIdx] = useState(() => {
    if (typeof window === "undefined") return 0
    const s = new URLSearchParams(window.location.search).get("s")
    const i = c.sections.findIndex((x) => x.id === s)
    return i >= 0 ? i : 0
  })
  const [composing, setComposing] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [sendOpen, setSendOpen] = useState(false)

  const section = c.sections[idx]
  const prog = progress(c, auto.values)
  const lastBack = sends.find((s) => s.direction === "to_client")?.sent_at ?? null
  const lastToCoach = sends.find((s) => s.direction === "to_coach")?.sent_at ?? null
  const drafts = comments.filter((x) => x.author_role === "client" && !x.released_at)

  const go = useCallback((i: number) => {
    setIdx(i)
    setComposing(null)
    const url = new URL(window.location.href)
    url.searchParams.set("s", c.sections[i].id)
    window.history.replaceState({}, "", url.toString())
    window.scrollTo({ top: 0 })
  }, [c.sections])

  // ---- questions (drafts until "Send to your coach") ----
  const ask = async (sectionId: string, fieldKey: string | null, body: string, parentId?: string) => {
    const { status: st, body: r } = await wbFetch<{ comment: Comment }>(`/api/me/workbooks/${wb.id}/questions`, {
      method: "POST", body: JSON.stringify({ section_id: sectionId, field_key: fieldKey, body, parent_id: parentId }),
    })
    if (st !== 201 || !r.comment) return r.error || "Couldn't save your question."
    setComments((p) => [...p, r.comment])
    setComposing(null)
    return null
  }
  const editQuestion = async (id: string, body: string) => {
    const { status: st, body: r } = await wbFetch<{ comment: Comment }>(`/api/me/workbooks/${wb.id}/questions/${id}`, {
      method: "PATCH", body: JSON.stringify({ body }),
    })
    if (st !== 200 || !r.comment) return r.error || "Couldn't save your question."
    setComments((p) => p.map((x) => (x.id === id ? r.comment : x)))
    setEditing(null)
    return null
  }
  const deleteQuestion = async (id: string) => {
    const { status: st } = await wbFetch(`/api/me/workbooks/${wb.id}/questions/${id}`, { method: "DELETE" })
    if (st === 200) setComments((p) => p.filter((x) => x.id !== id))
  }
  const resolve = async (cm: Comment, action: "accept" | "keep_own") => {
    const { status: st, body: r } = await wbFetch<{ status: Comment["suggestion_status"]; answer: any }>(
      `/api/me/workbooks/${wb.id}/suggestions/${cm.id}`, { method: "POST", body: JSON.stringify({ action }) })
    if (st !== 200) return
    setComments((p) => p.map((x) => (x.id === cm.id ? { ...x, suggestion_status: r.status } : x)))
    if (r.answer && cm.field_key) auto.applyServer(cm.field_key, r.answer.value, r.answer.updated_at)
  }

  const questionCard = (q: Comment): ReactNode => {
    const answers = comments.filter((x) => x.parent_id === q.id && x.kind === "coach_answer")
    if (editing === q.id) {
      return <Composer key={q.id} label="Your question" initial={q.body} cta="Save" onSave={(b) => editQuestion(q.id, b)} onCancel={() => setEditing(null)} />
    }
    return (
      <div key={q.id} className="wb-card-soft">
        <div className="wb-card-head">
          <span className="wb-eyebrow-ink" style={{ fontSize: 12 }}>{q.parent_id ? "Your reply" : "Your question"}</span>
          <span className={`wb-tag ${q.released_at ? "sent" : "draft"}`}>{q.released_at ? "Sent" : "Not sent yet"}</span>
        </div>
        <p className="wb-p" style={{ fontSize: 16 }}>{q.body}</p>
        {!q.released_at && (
          <div className="wb-actions">
            <button type="button" className="wb-link" onClick={() => setEditing(q.id)}>Edit</button>
            <button type="button" className="wb-link" onClick={() => deleteQuestion(q.id)}>Delete</button>
          </div>
        )}
        {answers.map((a) => (
          <div key={a.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <span className="wb-eyebrow-ink" style={{ fontSize: 12 }}>{coach}&rsquo;s answer</span>
            <p className="wb-p" style={{ fontSize: 16 }}>{a.body}</p>
          </div>
        ))}
      </div>
    )
  }

  const coachCard = (cm: Comment): ReactNode => {
    // NEW = came back in the latest Send back.
    const isNew = !!(lastBack && cm.released_at && cm.released_at >= lastBack)
    const replies = comments.filter((x) => x.parent_id === cm.id && x.kind === "client_question")
    const replyKey = `reply:${cm.id}`
    return (
      <div key={cm.id} className="wb-card">
        <div className="wb-card-head">
          <span className="wb-eyebrow-ink" style={{ fontSize: 12 }}>{cm.kind === "coach_suggestion" ? "Suggested edit" : "Coach review"}</span>
          {isNew && <span className="wb-tag new">NEW</span>}
        </div>
        {cm.kind === "coach_suggestion" && (
          <>
            <p className="wb-p" style={{ fontSize: 16 }}>
              {answerText(auto.values[cm.field_key!]) && cm.suggestion_status === "pending" && (
                <><span className="wb-strike">{answerText(auto.values[cm.field_key!])}</span>{" "}</>
              )}
              <span className="wb-mark">{answerText(cm.suggested_value)}</span>
            </p>
            {cm.body && <p className="wb-p" style={{ fontSize: 16 }}>{cm.body}</p>}
            {cm.suggestion_status === "pending" ? (
              <div className="wb-actions">
                <button type="button" className="wb-btn wb-btn-solid" onClick={() => resolve(cm, "accept")}>Use this wording</button>
                <button type="button" className="wb-btn" onClick={() => resolve(cm, "keep_own")}>Keep mine</button>
              </div>
            ) : (
              <span className="wb-saved">{cm.suggestion_status === "accepted" ? "You used this wording" : "You kept your own"}</span>
            )}
          </>
        )}
        {cm.kind === "coach_comment" && <p className="wb-p" style={{ fontSize: 16 }}>{cm.body}</p>}
        <span className="wb-muted" style={{ fontSize: 14 }}>{coach}</span>
        {replies.map(questionCard)}
        {composing === replyKey
          ? <Composer label={`Reply to ${coach}`} cta="Save reply" onSave={(b) => ask(cm.section_id, cm.field_key, b, cm.id)} onCancel={() => setComposing(null)} />
          : <div className="wb-actions"><button type="button" className="wb-btn wb-btn-solid" onClick={() => setComposing(replyKey)}>Reply</button></div>}
      </div>
    )
  }

  const anchored = (sectionId: string, fieldKey: string | null) =>
    comments.filter((x) => x.section_id === sectionId && x.field_key === fieldKey && x.parent_id === null)

  const marginFor = (sectionId: string, fieldKey: string | null): ReactNode => {
    const items = anchored(sectionId, fieldKey)
    const coachItems = items.filter((x) => x.author_role === "coach" && x.kind !== "coach_answer")
    const mine = items.filter((x) => x.kind === "client_question")
    if (!coachItems.length && !mine.length) return null
    return (
      <>
        {coachItems.map(coachCard)}
        {mine.map(questionCard)}
      </>
    )
  }

  const api: FieldApi = {
    editable: true,
    get: (k) => auto.values[k],
    set: (k, v: AnswerValue) => auto.set(k, v),
    state: (k) => auto.states[k],
    resolveConflict: auto.resolveConflict,
    coachName: coach,
    showCoachOnly: false,
    margin: (k) => marginFor(section.id, k),
    fieldFoot: (k) => {
      const key = `field:${k}`
      return composing === key ? (
        <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
          <Composer label={`Your question for ${coach}`} cta="Save question"
            onSave={(b) => ask(section.id, k, b)} onCancel={() => setComposing(null)} />
          <span className="wb-muted" style={{ fontSize: 14 }}>Questions go to {coach} when you press Send to {coach}.</span>
        </div>
      ) : (
        <button type="button" className="wb-link" onClick={() => setComposing(key)}>Ask {coach}</button>
      )
    },
  }

  const nav = (
    <nav className="wb-nav" aria-label="Workbook sections">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="wb-eyebrow">Interview workbook</span>
        <span className="wb-serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{c.client.full_name}</span>
        {c.interview.role && <span style={{ fontSize: 15, lineHeight: 1.45 }}>{c.interview.role}</span>}
        {c.interview.company && <span style={{ fontSize: 15, fontWeight: 600 }}>{c.interview.company}</span>}
      </div>
      <ol className="wb-nav-list">
        {c.sections.map((s, i) => (
          <li key={s.id}>
            <button type="button" className="wb-nav-item" aria-current={i === idx ? "true" : undefined} onClick={() => go(i)}>
              <span className={`wb-nav-num${prog.sectionsDone.has(s.id) ? " done" : ""}`}>{String(s.number).padStart(2, "0")}</span>
              <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="wb-muted" style={{ fontSize: 14 }}>{prog.filled} of {prog.total} answers filled in</span>
        <div className="wb-progress"><i style={{ width: `${prog.total ? (prog.filled / prog.total) * 100 : 0}%` }} /></div>
      </div>
    </nav>
  )

  const saveLabel = auto.failed
    ? <span className="wb-warn">Some answers need attention</span>
    : auto.busy
      ? <span className="wb-saving" role="status">Saving</span>
      : <span className="wb-saved" role="status"><Check />All changes saved</span>

  return (
    <WorkbookFrame>
      <header className="wb-header">
        <div className="wb-brand"><i />WORKFORCE READY NOW</div>
        <div className="wb-header-actions">
          <span className="wb-hide-phone">{saveLabel}</span>
          <Link href={`/dashboard/workbooks/${wb.id}/summary`} className="wb-btn wb-hide-phone">Read This 1 Hour Before</Link>
          <button type="button" className="wb-btn wb-btn-solid" onClick={() => setSendOpen(true)}>Send to {coach}</button>
        </div>
      </header>
      {status === "with_coach" && (
        <div style={{ background: "var(--pale)", padding: "12px 20px", fontSize: 15, textAlign: "center" }}>
          With {coach} for review{lastToCoach ? ` since ${fmtWhen(lastToCoach)}` : ""}. You can keep working.
        </div>
      )}
      <div className="wb-show-phone" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "#fff", display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="wb-serif" style={{ fontSize: 22, fontWeight: 600 }}>{c.client.full_name}</span>
        <span style={{ fontSize: 14 }}>{[c.interview.company, c.interview.role].filter(Boolean).join(" · ")}</span>
        <span>{saveLabel}</span>
        <Link href={`/dashboard/workbooks/${wb.id}/summary`} className="wb-link" style={{ alignSelf: "flex-start" }}>Read This 1 Hour Before</Link>
      </div>

      <div className="wb-shell">
        {nav}
        <main className="wb-main">
          <SectionHeader section={section} total={c.sections.length} />
          <SectionBlocks api={api} section={section} />

          <div className="wb-row">
            <div className="wb-col" style={{ gap: 12 }}>
              <div className="wb-rule" />
              <span className="wb-h2" style={{ fontSize: 26 }}>Anything about this section?</span>
              {composing === `section:${section.id}` ? (
                <Composer label={`Your question for ${coach}`} cta="Save question"
                  onSave={(b) => ask(section.id, null, b)} onCancel={() => setComposing(null)} />
              ) : (
                <div><button type="button" className="wb-btn" onClick={() => setComposing(`section:${section.id}`)}>Ask {coach} about this section</button></div>
              )}
            </div>
            <div className="wb-aside">{marginFor(section.id, null)}</div>
          </div>

          <div className="wb-row">
            <div className="wb-pager">
              {idx > 0
                ? <button type="button" className="wb-link" onClick={() => go(idx - 1)}>&larr; {String(c.sections[idx - 1].number).padStart(2, "0")} {c.sections[idx - 1].title}</button>
                : <span />}
              {idx < c.sections.length - 1
                ? <button type="button" className="wb-btn wb-btn-solid" style={{ minHeight: 52 }} onClick={() => go(idx + 1)}>Next: {c.sections[idx + 1].title} &rarr;</button>
                : <button type="button" className="wb-btn wb-btn-solid" style={{ minHeight: 52 }} onClick={() => setSendOpen(true)}>Send to {coach}</button>}
            </div>
            <div />
          </div>
        </main>
      </div>

      <div className="wb-bottombar">
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{String(idx + 1).padStart(2, "0")} of {String(c.sections.length).padStart(2, "0")}</span>
          <div className="wb-progress"><i style={{ width: `${((idx + 1) / c.sections.length) * 100}%` }} /></div>
        </div>
        {idx > 0 && <button type="button" className="wb-btn" onClick={() => go(idx - 1)} aria-label="Previous section">&larr;</button>}
        {idx < c.sections.length - 1
          ? <button type="button" className="wb-btn wb-btn-solid" onClick={() => go(idx + 1)}>Next &rarr;</button>
          : <button type="button" className="wb-btn wb-btn-solid" onClick={() => setSendOpen(true)}>Send</button>}
      </div>

      {sendOpen && (
        <SendPanel
          coach={coach}
          filled={prog.filled}
          total={prog.total}
          drafts={drafts}
          general={comments.filter((x) => x.section_id === GENERAL_SECTION_ID && x.parent_id === null)}
          lastToCoach={lastToCoach}
          onAskGeneral={(b) => ask(GENERAL_SECTION_ID, null, b)}
          onDelete={deleteQuestion}
          onClose={() => setSendOpen(false)}
          onSend={async () => {
            const { status: st, body: r } = await wbFetch(`/api/me/workbooks/${wb.id}/send`, { method: "POST", body: "{}" })
            if (st !== 200) return r.error || "Couldn't send. Try again."
            const now = new Date().toISOString()
            setComments((p) => p.map((x) => (x.author_role === "client" && !x.released_at ? { ...x, released_at: now } : x)))
            setSends((p) => [{ id: r.send_id, direction: "to_coach", sent_at: now, item_count: r.open_questions ?? 0, opened_at: null }, ...p])
            setStatus("with_coach")
            return null
          }}
        />
      )}
    </WorkbookFrame>
  )
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#00B3B3" strokeWidth="2" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  )
}

function SendPanel(props: {
  coach: string; filled: number; total: number; drafts: Comment[]; general: Comment[]; lastToCoach: string | null
  onAskGeneral(body: string): Promise<string | null>; onDelete(id: string): void
  onSend(): Promise<string | null>; onClose(): void
}) {
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [props])

  return (
    <div className="wb-panel-back" onClick={props.onClose}>
      <div className="wb-panel" role="dialog" aria-modal="true" aria-labelledby="send-title" onClick={(e) => e.stopPropagation()}>
        <span className="wb-eyebrow">Send to your coach</span>
        <h2 id="send-title" className="wb-h2" style={{ fontSize: 30 }}>
          {sent ? `Sent to ${props.coach}.` : `Ready to send to ${props.coach}?`}
        </h2>
        {sent ? (
          <>
            <p className="wb-p">{props.coach} can see everything you have filled in so far, plus your questions. You can keep working and send again any time.</p>
            <div><button type="button" className="wb-btn wb-btn-solid" onClick={props.onClose}>Back to my workbook</button></div>
          </>
        ) : (
          <>
            <p className="wb-p">
              You have filled in {props.filled} of {props.total} answers. Partial is fine. {props.coach} sees everything you have written so far.
              {props.lastToCoach ? ` You last sent it ${fmtWhen(props.lastToCoach)}.` : ""}
            </p>

            <div className="wb-col" style={{ gap: 10 }}>
              <span className="wb-eyebrow-ink">Questions going with it ({props.drafts.length})</span>
              {props.drafts.length === 0 && <span className="wb-muted" style={{ fontSize: 15 }}>No new questions.</span>}
              {props.drafts.map((d) => (
                <div key={d.id} className="wb-card-soft">
                  <p className="wb-p" style={{ fontSize: 16 }}>{d.body}</p>
                  <div><button type="button" className="wb-link" onClick={() => props.onDelete(d.id)}>Remove</button></div>
                </div>
              ))}
            </div>

            <div className="wb-col" style={{ gap: 10 }}>
              <span className="wb-eyebrow-ink">A general question</span>
              {props.general.filter((g) => g.released_at).map((g) => (
                <div key={g.id} className="wb-card-soft"><span className="wb-tag sent" style={{ alignSelf: "flex-start" }}>Sent</span><p className="wb-p" style={{ fontSize: 16 }}>{g.body}</p></div>
              ))}
              {asking
                ? <Composer label={`Anything else for ${props.coach}`} cta="Add question"
                    onSave={async (b) => { const e = await props.onAskGeneral(b); if (!e) setAsking(false); return e }}
                    onCancel={() => setAsking(false)} />
                : <div><button type="button" className="wb-btn" onClick={() => setAsking(true)}>Ask {props.coach} something general</button></div>}
            </div>

            {err && <span className="wb-warn" role="alert">{err}</span>}
            <div className="wb-actions">
              <button type="button" className="wb-btn wb-btn-solid" style={{ minHeight: 52 }} disabled={busy}
                onClick={async () => { setBusy(true); const e = await props.onSend(); setBusy(false); if (e) setErr(e); else setSent(true) }}>
                {busy ? "Sending" : `Send to ${props.coach}`}
              </button>
              <button type="button" className="wb-btn" onClick={props.onClose}>Not yet</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
