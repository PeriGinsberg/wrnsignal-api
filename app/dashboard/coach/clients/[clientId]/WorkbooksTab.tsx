"use client"

// Workbooks tab on /dashboard/coach/clients/[clientId] (spec decision 6: the
// coach's only entry point). Sits inside the dark coach shell; its content
// area uses the workbook style via WorkbookFrame.
//
// The coach sees the full workbook, live, every time (no diff view in v1).
// Comments, suggested edits and answers are DRAFTS until "Send back", which
// releases them all at once. "Reviewed" is the coach's own marker only.

import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  GENERAL_SECTION_ID, SCENARIO_PARTS, STAR_PARTS, answerText, stripCoachOnly,
  type Block, type Section, type WorkbookContent,
} from "@/lib/workbook/content"
import { WorkbookFrame } from "@/components/workbook/WorkbookFrame"
import { SectionBlocks, SectionHeader, type FieldApi } from "@/components/workbook/Blocks"
import { Summary, type InterviewRow } from "@/components/workbook/Summary"
import { wbFetch, fmtWhen, type Comment, type Send } from "@/components/workbook/api"

type ListRow = {
  id: string; slug: string; status: "draft" | "with_client" | "with_coach"; updated_at: string
  interview: { company: string | null; role: string | null } | null
  last_to_coach: { sent_at: string; item_count: number } | null
  last_to_client: { sent_at: string } | null
}

type Detail = {
  workbook: { id: string; status: ListRow["status"]; content: WorkbookContent; updated_at: string }
  interview: InterviewRow
  answers: Record<string, { value: unknown; updated_at: string }>
  comments: Comment[]
  sends: Send[]
  marks: { section_id: string }[]
}

const STATUS_LABEL: Record<ListRow["status"], string> = {
  draft: "Draft. Not shared yet",
  with_client: "With the client",
  with_coach: "Needs your review",
}

export function WorkbooksTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [list, setList] = useState<ListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { status, body } = await wbFetch<{ workbooks: ListRow[] }>(`/api/coach/clients/${clientId}/workbooks`)
    if (status !== 200) { setError(body.error || "Couldn't load workbooks."); return }
    setList(body.workbooks)
  }, [clientId])

  useEffect(() => { void load() }, [load])

  if (openId) {
    return <Review clientId={clientId} workbookId={openId} onBack={() => { setOpenId(null); void load() }} />
  }

  return (
    <WorkbookFrame page={false}>
      <div style={{ padding: "36px 40px 48px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="wb-eyebrow">Interview workbooks</span>
          <h2 className="wb-h2">{clientName}</h2>
        </div>
        {error && <p className="wb-warn" role="alert">{error}</p>}
        {!list && !error && <p className="wb-p wb-muted">Loading</p>}
        {list && list.length === 0 && (
          <p className="wb-p wb-muted">No workbooks for {clientName} yet. A workbook is created from its content file, then appears here as a draft for you to share.</p>
        )}
        {list && list.map((w) => (
          <button key={w.id} type="button" onClick={() => setOpenId(w.id)} className="wb-card-soft"
            style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
            <div className="wb-card-head">
              <span className="wb-serif" style={{ fontSize: 22, fontWeight: 600 }}>
                {[w.interview?.company, w.interview?.role].filter(Boolean).join(", ") || w.slug}
              </span>
              <span className={`wb-tag ${w.status === "with_coach" ? "review" : w.status === "draft" ? "draft" : "sent"}`}>{STATUS_LABEL[w.status]}</span>
            </div>
            <span className="wb-muted" style={{ fontSize: 14 }}>
              {w.last_to_coach
                ? `Last sent to you ${fmtWhen(w.last_to_coach.sent_at)}${w.last_to_coach.item_count ? `, ${w.last_to_coach.item_count} open question${w.last_to_coach.item_count === 1 ? "" : "s"}` : ""}`
                : w.last_to_client ? `Shared ${fmtWhen(w.last_to_client.sent_at)}` : `Updated ${fmtWhen(w.updated_at)}`}
            </span>
          </button>
        ))}
      </div>
    </WorkbookFrame>
  )
}

// ---------------------------------------------------------------------------

type Anchor = { sectionId: string; fieldKey: string | null; label: string; kind?: "coach_comment" | "coach_suggestion" }

/** The answer boxes a section shows the coach: one per field, grouped for STAR and scenario. */
function reviewItems(s: Section): { group?: string; key: string; label: string }[] {
  const out: { group?: string; key: string; label: string }[] = []
  for (const b of s.blocks as Block[]) {
    if (b.type === "field") out.push({ key: b.key, label: b.style === "hook" ? `${b.label}: "${b.prefix ?? ""}..."` : b.label })
    if (b.type === "pick") out.push({ key: b.key, label: b.label })
    if (b.type === "star") for (const p of STAR_PARTS) out.push({ group: `${b.number ?? ""} ${b.title}`.trim(), key: `${b.key}.${p.part}`, label: p.label })
    if (b.type === "scenario") for (const p of SCENARIO_PARTS) out.push({ group: `${b.number ?? ""} ${b.prompt}`.trim(), key: `${b.key}.${p.part}`, label: p.label })
  }
  return out
}

function Review({ clientId, workbookId, onBack }: { clientId: string; workbookId: string; onBack(): void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"review" | "as_client" | "summary">("review")
  const [idx, setIdx] = useState(0)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState<string | null>(null)
  const base = `/api/coach/clients/${clientId}/workbooks/${workbookId}`

  const load = useCallback(async () => {
    const { status, body } = await wbFetch<Detail>(base)
    if (status !== 200) { setError(body.error || "Couldn't load the workbook."); return }
    setD(body)
  }, [base])
  useEffect(() => { void load() }, [load])

  const c = d?.workbook.content
  const first = c?.client.first_name ?? "the client"
  const values = useMemo(() => Object.fromEntries(Object.entries(d?.answers ?? {}).map(([k, a]) => [k, a.value])), [d])
  const marked = useMemo(() => new Set((d?.marks ?? []).map((m) => m.section_id)), [d])

  if (error) return <WorkbookFrame page={false}><p className="wb-warn" style={{ margin: 32 }}>{error}</p></WorkbookFrame>
  if (!d || !c) return <WorkbookFrame page={false}><p className="wb-p wb-muted" style={{ padding: 32 }}>Loading</p></WorkbookFrame>

  const comments = d.comments
  const drafts = comments.filter((x) => x.author_role === "coach" && !x.released_at)
  const lastToCoach = d.sends.find((s) => s.direction === "to_coach")
  const isGeneral = idx === c.sections.length
  const section = isGeneral ? null : c.sections[idx]
  const openQuestions = (sectionId: string) =>
    comments.filter((q) => q.kind === "client_question" && q.section_id === sectionId && q.released_at
      && !comments.some((a) => a.parent_id === q.id && a.kind === "coach_answer")).length

  const sectionStatus = (s: Section) => {
    if (marked.has(s.id)) return { label: "Reviewed", cls: "ok" }
    const keys = reviewItems(s).map((r) => r.key)
    const any = keys.some((k) => answerText(values[k]))
    if (d.workbook.status === "with_coach" && (any || openQuestions(s.id))) return { label: "Needs your review", cls: "review" }
    return any ? { label: "In progress", cls: "draft" } : { label: "Not started", cls: "draft" }
  }

  const send = async () => {
    setSending(true); setSendMsg(null)
    const { status, body } = await wbFetch<{ released: number }>(`${base}/send`, { method: "POST", body: "{}" })
    setSending(false)
    if (status !== 200) { setSendMsg(body.error || "Couldn't send. Try again."); return }
    setSendMsg(d.workbook.status === "draft"
      ? `Shared with ${first}. It is in their Coaches Hub.`
      : `Sent back to ${first} with ${body.released} note${body.released === 1 ? "" : "s"}. It is in their Coaches Hub.`)
    await load()
  }

  const toggleMark = async (s: Section) => {
    const reviewed = !marked.has(s.id)
    const { status } = await wbFetch(`${base}/sections/${encodeURIComponent(s.id)}/mark`, { method: "PUT", body: JSON.stringify({ reviewed }) })
    if (status === 200) await load()
  }

  const countFor = (sectionId: string, fieldKey: string | null) => {
    const items = comments.filter((x) => x.section_id === sectionId && x.field_key === fieldKey && !x.parent_id)
    const draftN = comments.filter((x) => x.section_id === sectionId && x.field_key === fieldKey && x.author_role === "coach" && !x.released_at).length
    const qs = items.filter((x) => x.kind === "client_question").length
    const parts = [
      items.filter((x) => x.author_role === "coach").length ? `${items.filter((x) => x.author_role === "coach").length} note${items.filter((x) => x.author_role === "coach").length === 1 ? "" : "s"}` : "",
      qs ? `${qs} question${qs === 1 ? "" : "s"} from ${first}` : "",
      draftN ? `${draftN} unsent` : "",
    ].filter(Boolean)
    return parts.join(" · ")
  }

  const previewApi: FieldApi = {
    editable: false, get: (k) => values[k], set: () => {}, state: () => undefined,
    coachName: c.coach.first_name, showCoachOnly: false,
  }

  const header = (
    <div style={{ background: "var(--navy)", color: "#fff", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" className="wb-btn" style={{ borderColor: "#fff", color: "#fff" }} onClick={onBack}>&larr; Workbooks</button>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{c.client.full_name}</span>
        <span style={{ fontSize: 14, opacity: 0.8 }}>{[c.interview.company, c.interview.role].filter(Boolean).join(", ")}</span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(["review", "as_client", "summary"] as const).map((m) => (
          <button key={m} type="button" className="wb-btn" aria-pressed={mode === m}
            style={{ borderColor: "#fff", color: mode === m ? "var(--navy)" : "#fff", background: mode === m ? "#fff" : "transparent" }}
            onClick={() => setMode(m)}>
            {m === "review" ? "Review" : m === "as_client" ? `See it as ${first}` : "1-hour summary"}
          </button>
        ))}
      </div>
    </div>
  )

  const sendBar = (
    <div className="wb-card" style={{ gap: 12 }}>
      <span className="wb-eyebrow-ink">{d.workbook.status === "draft" ? "Not shared yet" : STATUS_LABEL[d.workbook.status]}</span>
      {lastToCoach && (
        <span style={{ fontSize: 14 }}>
          {first} sent it {fmtWhen(lastToCoach.sent_at)}{lastToCoach.item_count ? ` with ${lastToCoach.item_count} open question${lastToCoach.item_count === 1 ? "" : "s"}` : ""}.
        </span>
      )}
      <span className="wb-muted" style={{ fontSize: 14 }}>
        {drafts.length} unsent note{drafts.length === 1 ? "" : "s"}. {first} sees nothing you write until you send.
      </span>
      <button type="button" className="wb-btn wb-btn-solid" style={{ minHeight: 52 }} disabled={sending} onClick={send}>
        {sending ? "Sending" : d.workbook.status === "draft" ? `Send to ${first}` : `Send back to ${first}`}
      </button>
      {sendMsg && <span className="wb-saved" role="status">{sendMsg}</span>}
    </div>
  )

  if (mode === "summary") {
    return (
      <WorkbookFrame page={false}>
        {header}
        <div style={{ padding: "24px 0" }}><Summary content={c} answers={values} interview={d.interview} /></div>
      </WorkbookFrame>
    )
  }

  if (mode === "as_client") {
    const clientView = stripCoachOnly(c)
    const s = clientView.sections[Math.min(idx, clientView.sections.length - 1)]
    return (
      <WorkbookFrame page={false}>
        {header}
        <div className="wb-shell">
          <SectionNav c={c} idx={idx} setIdx={setIdx} status={(x) => sectionStatus(x)} general={false} />
          <main className="wb-main" style={{ paddingTop: 40 }}>
            <p className="wb-callout paleblue" style={{ margin: 0, padding: "14px 18px", fontSize: 15 }}>
              What {first} sees, read-only. Coach-only notes are hidden. Your unsent notes are not shown.
            </p>
            <SectionHeader section={s} total={clientView.sections.length} />
            <SectionBlocks api={previewApi} section={s} />
          </main>
        </div>
      </WorkbookFrame>
    )
  }

  const general = comments.filter((x) => x.section_id === GENERAL_SECTION_ID)

  return (
    <WorkbookFrame page={false}>
      {header}
      <div className="wb-review">
        <SectionNav c={c} idx={idx} setIdx={(i) => { setIdx(i); setAnchor(null) }} status={sectionStatus}
          general={general.length > 0} generalOpen={openQuestions(GENERAL_SECTION_ID)} />

        <main style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
          {section ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, borderBottom: "2px solid var(--orange)", paddingBottom: 18, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="wb-eyebrow">Section {String(section.number).padStart(2, "0")}</span>
                  <h1 className="wb-serif" style={{ margin: 0, fontSize: 40, fontWeight: 600, lineHeight: 1.08 }}>{section.title}</h1>
                </div>
                <button type="button" className={`wb-btn${marked.has(section.id) ? " wb-btn-teal" : ""}`} aria-pressed={marked.has(section.id)} onClick={() => toggleMark(section)}>
                  {marked.has(section.id) ? "Reviewed" : "Mark as reviewed"}
                </button>
              </div>

              {section.blocks.filter((b) => b.type === "coach_only").map((b, i) => (
                <div key={i} className="wb-coachonly">
                  <span className="wb-eyebrow-ink">Coach only. {first} never sees this.</span>
                  <span>{(b as Extract<Block, { type: "coach_only" }>).body}</span>
                </div>
              ))}

              {reviewItems(section).map((it, i, all) => {
                const selected = anchor?.fieldKey === it.key
                const text = answerText(values[it.key])
                const count = countFor(section.id, it.key)
                return (
                  <React.Fragment key={it.key}>
                    {it.group && it.group !== all[i - 1]?.group && (
                      <h2 className="wb-serif" style={{ margin: "12px 0 0", fontSize: 24, fontWeight: 600 }}>{it.group}</h2>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "20px 24px", background: "#fff", border: selected ? "2px solid var(--blue)" : "1px solid var(--border)" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#2E4260" }}>{it.label}</span>
                      {text
                        ? <p className="wb-serif" style={{ margin: 0, fontSize: 20, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{text}</p>
                        : <p className="wb-muted" style={{ margin: 0, fontStyle: "italic" }}>No answer yet</p>}
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button type="button" className="wb-btn" onClick={() => setAnchor({ sectionId: section.id, fieldKey: it.key, label: it.label, kind: "coach_comment" })}>Comment</button>
                        {!isPickKey(c, it.key) && (
                          <button type="button" className="wb-btn" onClick={() => setAnchor({ sectionId: section.id, fieldKey: it.key, label: it.label, kind: "coach_suggestion" })}>Suggest an edit</button>
                        )}
                        {count && <span style={{ fontSize: 14, color: "var(--teal-ink)", fontWeight: 600 }}>{count}</span>}
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}

              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="wb-btn" onClick={() => setAnchor({ sectionId: section.id, fieldKey: null, label: `Section: ${section.title}` })}>
                  Comment on this whole section
                </button>
                {countFor(section.id, null) && <span style={{ fontSize: 14, color: "var(--teal-ink)", fontWeight: 600 }}>{countFor(section.id, null)}</span>}
              </div>
            </>
          ) : (
            <>
              <div style={{ borderBottom: "2px solid var(--orange)", paddingBottom: 18 }}>
                <span className="wb-eyebrow">From {first}</span>
                <h1 className="wb-serif" style={{ margin: "8px 0 0", fontSize: 40, fontWeight: 600 }}>General questions</h1>
              </div>
              <button type="button" className="wb-btn" style={{ alignSelf: "flex-start" }}
                onClick={() => setAnchor({ sectionId: GENERAL_SECTION_ID, fieldKey: null, label: "General questions" })}>
                Open the general questions
              </button>
            </>
          )}
        </main>

        <aside style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {sendBar}
          {anchor
            ? <FeedbackPanel key={`${anchor.sectionId}:${anchor.fieldKey}:${anchor.kind ?? ""}`} base={base} anchor={anchor} first={first}
                comments={comments} current={anchor.fieldKey ? values[anchor.fieldKey] : undefined}
                isPick={!!anchor.fieldKey && isPickKey(c, anchor.fieldKey)}
                onChange={load} />
            : <div className="wb-card-soft"><span className="wb-muted" style={{ fontSize: 15 }}>Choose Comment or Suggest an edit on an answer to write feedback for {first}.</span></div>}
        </aside>
      </div>
    </WorkbookFrame>
  )
}

function isPickKey(c: WorkbookContent, key: string) {
  return c.sections.some((s) => s.blocks.some((b) => b.type === "pick" && b.key === key))
}

function SectionNav(props: {
  c: WorkbookContent; idx: number; setIdx(i: number): void
  status(s: Section): { label: string; cls: string }; general: boolean; generalOpen?: number
}) {
  const { c } = props
  return (
    <nav aria-label="Sections" className="wb-review-nav">
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
        {c.sections.map((s, i) => {
          const st = props.status(s)
          return (
            <li key={s.id}>
              <button type="button" onClick={() => props.setIdx(i)} aria-current={i === props.idx ? "true" : undefined}
                style={{ width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", border: 0, borderBottom: "1px solid #EEF1F5", background: i === props.idx ? "var(--peach)" : "transparent", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minHeight: 44 }}>
                <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span className="wb-serif" style={{ fontWeight: 700, color: "var(--orange)", width: 22 }}>{String(s.number).padStart(2, "0")}</span>
                  <span style={{ fontSize: 15 }}>{s.title}</span>
                </span>
                <span className={`wb-tag ${st.cls}`} style={{ alignSelf: "flex-start" }}>{st.label}</span>
              </button>
            </li>
          )
        })}
        {props.general && (
          <li>
            <button type="button" onClick={() => props.setIdx(c.sections.length)} aria-current={props.idx === c.sections.length ? "true" : undefined}
              style={{ width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", border: 0, background: props.idx === c.sections.length ? "var(--peach)" : "transparent", padding: "12px 14px", minHeight: 44, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>General questions</span>
              {!!props.generalOpen && <span className="wb-tag review" style={{ alignSelf: "flex-start" }}>{props.generalOpen} to answer</span>}
            </button>
          </li>
        )}
      </ol>
    </nav>
  )
}

function FeedbackPanel(props: {
  base: string; anchor: Anchor; first: string; comments: Comment[]; current: unknown; isPick: boolean; onChange(): Promise<void>
}) {
  const { anchor, first } = props
  const here = props.comments.filter((x) => x.section_id === anchor.sectionId && x.field_key === anchor.fieldKey)
  const top = here.filter((x) => !x.parent_id)
  const currentText = answerText(props.current)
  const [kind, setKind] = useState<"coach_comment" | "coach_suggestion">(props.isPick ? "coach_comment" : anchor.kind ?? "coach_comment")
  const general = anchor.sectionId === GENERAL_SECTION_ID
  const [body, setBody] = useState("")
  const [suggested, setSuggested] = useState(currentText)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [answering, setAnswering] = useState<string | null>(null)
  const [answer, setAnswer] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState("")

  const post = async (payload: object) => {
    setBusy(true); setErr(null)
    const { status, body: r } = await wbFetch(`${props.base}/comments`, { method: "POST", body: JSON.stringify(payload) })
    setBusy(false)
    if (status !== 201) { setErr(r.error || "Couldn't save."); return false }
    await props.onChange()
    return true
  }
  const del = async (id: string) => {
    const { status } = await wbFetch(`${props.base}/comments/${id}`, { method: "DELETE" })
    if (status === 200) await props.onChange()
  }
  const saveEdit = async (id: string) => {
    const { status, body: r } = await wbFetch(`${props.base}/comments/${id}`, { method: "PATCH", body: JSON.stringify({ body: editBody }) })
    if (status !== 200) { setErr(r.error || "Couldn't save."); return }
    setEditingId(null)
    await props.onChange()
  }

  const item = (x: Comment) => {
    const draft = !x.released_at
    const who = x.author_role === "client" ? (x.parent_id ? `${first}'s reply` : `${first}'s question`)
      : x.kind === "coach_suggestion" ? "Your suggested edit" : x.kind === "coach_answer" ? "Your answer" : "Your comment"
    const children = here.filter((y) => y.parent_id === x.id)
    const answered = children.some((y) => y.kind === "coach_answer")
    return (
      <div key={x.id} className="wb-card-soft">
        <div className="wb-card-head">
          <span className="wb-eyebrow-ink" style={{ fontSize: 12 }}>{who}</span>
          <span className={`wb-tag ${draft ? "draft" : x.author_role === "client" ? "review" : "sent"}`}>
            {draft ? "Unsent" : x.author_role === "client" ? "From client" : "Sent"}
          </span>
        </div>
        {x.kind === "coach_suggestion" && (
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55 }}>
            <span className="wb-mark">{answerText(x.suggested_value)}</span>
            {x.suggestion_status && x.suggestion_status !== "pending" && (
              <span className="wb-muted" style={{ display: "block", fontSize: 14, marginTop: 6 }}>
                {x.suggestion_status === "accepted" ? `${first} used this wording` : `${first} kept their own`}
              </span>
            )}
          </p>
        )}
        {editingId === x.id ? (
          <>
            <textarea className="wb-textarea-box" rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} aria-label="Edit note" />
            <div className="wb-actions">
              <button type="button" className="wb-btn wb-btn-solid" onClick={() => saveEdit(x.id)}>Save</button>
              <button type="button" className="wb-btn" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          </>
        ) : (x.body && <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{x.body}</p>)}
        {draft && x.author_role === "coach" && editingId !== x.id && (
          <div className="wb-actions">
            <button type="button" className="wb-link" onClick={() => { setEditingId(x.id); setEditBody(x.body) }}>Edit</button>
            <button type="button" className="wb-link" onClick={() => del(x.id)}>Delete</button>
          </div>
        )}
        {children.map(item)}
        {x.kind === "client_question" && x.released_at && !answered && (
          answering === x.id ? (
            <>
              <label className="wb-eyebrow-ink" htmlFor={`ans-${x.id}`} style={{ fontSize: 12 }}>Your answer</label>
              <textarea id={`ans-${x.id}`} className="wb-textarea-box" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <div className="wb-actions">
                <button type="button" className="wb-btn wb-btn-solid" disabled={busy || !answer.trim()}
                  onClick={async () => { if (await post({ kind: "coach_answer", parent_id: x.id, body: answer })) { setAnswer(""); setAnswering(null) } }}>
                  Add answer
                </button>
                <button type="button" className="wb-btn" onClick={() => setAnswering(null)}>Cancel</button>
              </div>
            </>
          ) : <div><button type="button" className="wb-btn wb-btn-solid" onClick={() => { setAnswering(x.id); setAnswer("") }}>Answer</button></div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="wb-card" style={{ gap: 16 }}>
        <span className="wb-eyebrow-ink">Your feedback on</span>
        <span className="wb-serif" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{anchor.label}</span>

        {general && <span className="wb-muted" style={{ fontSize: 15 }}>Answer each question below. Answers go to {first} when you send the workbook back.</span>}

        {!general && anchor.fieldKey && !props.isPick && (
          <div className="wb-actions" role="radiogroup" aria-label="Feedback type">
            {(["coach_comment", "coach_suggestion"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`wb-btn${kind === k ? " wb-btn-solid" : ""}`} onClick={() => setKind(k)}>
                {k === "coach_comment" ? "Comment" : "Suggest an edit"}
              </button>
            ))}
          </div>
        )}

        {general ? null : kind === "coach_suggestion" && anchor.fieldKey ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="wb-suggest" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "var(--muted)" }}>SUGGESTED EDIT</label>
            <textarea id="wb-suggest" className="wb-textarea-box" rows={4} value={suggested} onChange={(e) => setSuggested(e.target.value)} />
            {suggested.trim() && suggested !== currentText && (
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55 }}>
                {currentText && <><span className="wb-strike">{currentText}</span>{" "}</>}
                <span className="wb-mark">{suggested}</span>
              </p>
            )}
            <label htmlFor="wb-suggest-note" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "var(--muted)" }}>WHY (OPTIONAL)</label>
            <textarea id="wb-suggest-note" className="wb-textarea-box" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
            <span className="wb-muted" style={{ fontSize: 13 }}>{first} can use it or keep their own.</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="wb-comment" style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "var(--muted)" }}>COMMENT</label>
            <textarea id="wb-comment" className="wb-textarea-box" rows={4} placeholder={`Write a note to ${first}`} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        )}
        {err && <span className="wb-warn" role="alert">{err}</span>}
        {!general && (
          <button type="button" className="wb-btn wb-btn-solid" style={{ minHeight: 48 }}
            disabled={busy || (kind === "coach_suggestion" ? !suggested.trim() || suggested === currentText : !body.trim())}
            onClick={async () => {
              const ok = await post(kind === "coach_suggestion"
                ? { kind, section_id: anchor.sectionId, field_key: anchor.fieldKey, suggested_value: suggested, body }
                : { kind, section_id: anchor.sectionId, field_key: anchor.fieldKey, body })
              if (ok) { setBody(""); setSuggested(currentText) }
            }}>
            Add to {first}&rsquo;s workbook
          </button>
        )}
        {!general && <span className="wb-muted" style={{ fontSize: 13 }}>Saved as unsent. {first} sees it when you send the workbook back.</span>}
      </div>
      {top.map(item)}
    </div>
  )
}
