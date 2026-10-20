"use client"

// components/workbook/CoachCommandCenter.tsx
//
// The Coach Command Center at the top of a section on the coach's review
// screen: the client's own case prompt (read from the content's case_prompt
// blocks, never a copy kept separately), then the structured coach guide from
// coach_only blocks: how to open, answers to clarifying questions, Teams
// messages with a Copy button that copies ONLY the `send` text, the private
// working beneath each message, an expandable hint ladder, a checklist, and the
// rubric whose ratings are saved. COACH ONLY: imported by the coach's Workbooks
// tab and nowhere on the client side. coach_only never reaches a client.

import React, { useEffect, useState } from "react"
import {
  casePromptBlocks, sectionRubric,
  type Block, type CoachCalc, type CoachGuide, type CoachStep, type Evaluation, type Section,
} from "../../lib/workbook/content"

/** Copies text, falling back to a hidden selection where the clipboard API is refused. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand("copy") } catch { ok = false }
    ta.remove()
    return ok
  }
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  useEffect(() => {
    if (state === "idle") return
    const t = setTimeout(() => setState("idle"), 1800)
    return () => clearTimeout(t)
  }, [state])
  return (
    <button type="button" className={`wb-btn ${state === "copied" ? "wb-btn-teal" : "wb-btn-solid"}`} aria-live="polite"
      onClick={async () => setState((await copyText(text)) ? "copied" : "failed")}>
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy it by hand" : label}
    </button>
  )
}

function guidesOf(s: Section): { title?: string; body?: string; guide?: CoachGuide }[] {
  return s.blocks.filter((b): b is Extract<Block, { type: "coach_only" }> => b.type === "coach_only")
}

/** True when a section has anything for the Command Center to show. */
export function hasCommandCenter(s: Section): boolean {
  return casePromptBlocks(s).length > 0 || guidesOf(s).length > 0
}

export function CoachCommandCenter({ section, first, evaluation, onSaveEvaluation }: {
  section: Section
  first: string
  evaluation: Evaluation | null
  onSaveEvaluation(e: Evaluation): Promise<boolean>
}) {
  const prompts = casePromptBlocks(section)
  const blocks = guidesOf(section)
  const rubric = sectionRubric(section)
  if (!prompts.length && !blocks.length) return null
  const promptText = prompts.map((b) => b.body).join("\n\n")

  return (
    <section className="wb-cc" aria-label="Coach Command Center">
      <div className="wb-cc-title">
        <h2>Coach Command Center</h2>
        <span className="wb-muted" style={{ fontSize: 13 }}>
          {prompts.length ? `${first} sees only the case prompt. Everything else here is yours.` : `${first} never sees this.`}
        </span>
      </div>

      {prompts.length > 0 && (
        <div className="wb-cc-prompt">
          <div className="wb-cc-row">
            <span className="wb-cc-lbl">Case prompt · what {first} sees</span>
            <CopyButton text={promptText} label="Copy prompt" />
          </div>
          {prompts.map((b, i) => <p key={i}>{b.body}</p>)}
        </div>
      )}

      {blocks.map((b, i) => (
        <React.Fragment key={i}>
          {b.guide ? <Guide guide={b.guide} first={first} /> : null}
          {b.body && (
            <div className="wb-coachonly">
              <span className="wb-eyebrow-ink">{b.title || "Coach only"}. {first} never sees this.</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{b.body}</span>
            </div>
          )}
        </React.Fragment>
      ))}

      {rubric && <EvaluationPanel section={section} first={first} evaluation={evaluation} onSave={onSaveEvaluation} />}
    </section>
  )
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="wb-cc-panel">
      <span className="wb-cc-lbl">{label}</span>
      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  )
}

type Message = NonNullable<CoachGuide["messages"]>[number]

function MessageCard({ m, first }: { m: Message; first: string }) {
  return (
    <article className="wb-cc-msg" aria-label={`Teams message ${m.label}`}>
      <div className="wb-cc-msg-h">
        <div className="t">
          <span className="wb-cc-letter">{m.label}</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span className="wb-cc-lbl">Teams message {m.label}</span>
            {m.title && <span style={{ fontWeight: 600 }}>{m.title}</span>}
          </div>
        </div>
        {m.send && <CopyButton text={m.send} label={`Copy message ${m.label}`} />}
      </div>
      {m.send
        ? <div className="wb-cc-send"><span className="wb-cc-lbl" style={{ color: "var(--teal-ink)" }}>Sends to {first}</span><p>{m.send}</p></div>
        : <div className="wb-cc-nosend">Nothing to send. Coaching move only.</div>}
      {m.private && (
        <div className="wb-cc-private">
          <span className="wb-cc-lbl">Private · never send</span>
          <p>{m.private}</p>
        </div>
      )}
    </article>
  )
}

function Calcs({ title, calcs }: { title: string; calcs: CoachCalc[] }) {
  return (
    <div className="wb-cc-calcs">
      <span className="wb-cc-lbl">{title}</span>
      <div className="wb-table-wrap">
        <table className="wb-table">
          <thead><tr><th scope="col">Calculation</th><th scope="col">Setup</th><th scope="col">Answer</th><th scope="col">What it means</th></tr></thead>
          <tbody>{calcs.map((c, i) => (
            <tr key={i}><td>{c.label}</td><td className="wb-cc-work">{c.work}</td><td style={{ fontWeight: 700 }}>{c.answer}</td><td>{c.meaning ?? ""}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

/** The facilitation script: numbered steps, one open at a time. */
function Steps({ steps, messages, first }: { steps: CoachStep[]; messages: Message[]; first: string }) {
  const [open, setOpen] = useState(0)
  return (
    <div className="wb-cc-steps" aria-label="Facilitation script">
      <span className="wb-cc-lbl">Facilitation script · {steps.length} steps</span>
      {steps.map((st, i) => {
        const isOpen = open === i
        const msg = st.send ? messages.find((m) => m.label === st.send!.message) : undefined
        return (
          <section key={i} className={`wb-cc-step${isOpen ? " open" : ""}`}>
            <button type="button" className="wb-cc-step-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
              <b>{i + 1}</b>
              <span className="t">{st.title}</span>
              {st.send && <span className="wb-tag sent">Teams {st.send.message}</span>}
              {st.minutes && <span className="m">{st.minutes}</span>}
            </button>
            {isOpen && (
              <div className="wb-cc-step-b">
                <div className="wb-cc-ask">
                  <span className="wb-cc-lbl">Ask</span>
                  {st.ask.map((q, j) => <p key={j}>{q}</p>)}
                </div>
                {st.strong?.length ? <List label="A strong answer" items={st.strong} /> : null}
                {st.answers?.length ? (
                  <div className="wb-cc-panel">
                    <span className="wb-cc-lbl">If {first} asks</span>
                    {st.answers.map((c, j) => <div key={j} className="wb-cc-qa">{c.ask && <i>{c.ask}</i>}<span>{c.answer}</span></div>)}
                  </div>
                ) : null}
                {st.teach && <div className="wb-cc-panel"><span className="wb-cc-lbl">Teaching move</span><span>{st.teach}</span></div>}
                {st.essential?.length ? <Calcs title="Essential math" calcs={st.essential} /> : null}
                {st.stretch?.length ? (
                  <details className="wb-cc-stretch">
                    <summary>Stretch math (optional, if time and confidence allow)</summary>
                    <Calcs title="Stretch math" calcs={st.stretch} />
                  </details>
                ) : null}
                {st.interpretation && <div className="wb-cc-private"><span className="wb-cc-lbl">What she should conclude</span><p>{st.interpretation}</p></div>}
                {st.errors?.length ? <List label="Common errors and how to correct them" items={st.errors} /> : null}
                {st.follow_ups?.length ? (
                  <div className="wb-cc-panel">
                    <span className="wb-cc-lbl">Follow-ups</span>
                    {st.follow_ups.map((f, j) => <div key={j} className="wb-cc-qa"><span>“{f.ask}”</span>{f.answer && <i>{f.answer}</i>}</div>)}
                  </div>
                ) : null}
                {st.hints?.length ? (
                  <div className="wb-cc-hints">
                    <span className="wb-cc-lbl">Hints · open one at a time</span>
                    {st.hints.map((h, j) => (
                      <details key={j}><summary><b>{j + 1}</b><span>Hint {j + 1}</span></summary><p>“{h}”</p></details>
                    ))}
                  </div>
                ) : null}
                {st.rescue?.length ? <List label="Rescue prompts · only if she stalls" items={st.rescue.map((r) => `“${r}”`)} /> : null}
                {st.checkpoint && <div className="wb-cc-check"><span className="wb-cc-lbl">Checkpoint</span><span>{st.checkpoint}</span></div>}
                {st.send && (
                  <div className="wb-cc-sendstep">
                    <span className="wb-cc-lbl">Send Teams message {st.send.message} when</span>
                    <span>{st.send.when}</span>
                    {st.send.rescue && <span className="wb-cc-note">If it never comes: “{st.send.rescue}”</span>}
                    {msg && <MessageCard m={msg} first={first} />}
                  </div>
                )}
                {(st.advance || st.assess?.length) ? (
                  <div className="wb-cc-row" style={{ alignItems: "flex-start" }}>
                    {st.advance && <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 320px" }}><span className="wb-cc-lbl">Advance when</span><span>{st.advance}</span></div>}
                    {st.assess?.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{st.assess.map((a) => <span key={a} className="wb-tag draft">Assess: {a}</span>)}</div> : null}
                  </div>
                ) : null}
                {i < steps.length - 1 && (
                  <div><button type="button" className="wb-btn" onClick={() => setOpen(i + 1)}>Next: Step {i + 2}</button></div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Guide({ guide: g, first }: { guide: CoachGuide; first: string }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  // A message a step sends is shown inside that step, not repeated below.
  const sent = new Set((g.steps ?? []).map((st) => st.send?.message).filter(Boolean))
  const loose = (g.messages ?? []).filter((m) => !sent.has(m.label))
  return (
    <>
      {g.agenda?.length ? <List label="Run of show" items={g.agenda} /> : null}

      {(g.opening?.length || g.clarify?.length) ? (
        <div className="wb-cc-two">
          {g.opening?.length ? <List label="How to open" items={g.opening} /> : null}
          {g.clarify?.length ? (
            <div className="wb-cc-panel">
              <span className="wb-cc-lbl">If {first} asks</span>
              {g.clarify.map((c, i) => (
                <div key={i} className="wb-cc-qa">{c.ask && <i>{c.ask}</i>}<span>{c.answer}</span></div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {g.steps?.length ? <Steps steps={g.steps} messages={g.messages ?? []} first={first} /> : null}

      {loose.length ? (
        <div className="wb-cc-msgs">
          <span className="wb-cc-lbl">Teams messages · send only when {first} asks</span>
          {loose.map((m, i) => <MessageCard key={i} m={m} first={first} />)}
        </div>
      ) : null}

      {g.hints?.length ? (
        <div className="wb-cc-hints">
          <span className="wb-cc-lbl">Hint ladder · open one at a time</span>
          {g.hints.map((h, i) => (
            <details key={i}>
              <summary><b>{i + 1}</b><span>Hint {i + 1}</span></summary>
              <p>“{h}”</p>
            </details>
          ))}
          {g.hint_note && <p className="wb-cc-note">{g.hint_note}</p>}
        </div>
      ) : null}

      {g.checklist?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="wb-cc-lbl">{g.checklist_title ?? "What to watch for"}</span>
          <div className="wb-cc-checks">
            {g.checklist.map((x, i) => (
              <label key={i} className="wb-cc-ck">
                <input type="checkbox" checked={ticked.has(i)}
                  onChange={() => setTicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n })} />
                <span>{x}</span>
              </label>
            ))}
          </div>
          {g.checklist_note && <p className="wb-cc-note">{g.checklist_note}</p>}
        </div>
      ) : null}

      {g.notes?.length ? <List label="Coach notes" items={g.notes} /> : null}
    </>
  )
}

function EvaluationPanel({ section, first, evaluation, onSave }: {
  section: Section; first: string; evaluation: Evaluation | null; onSave(e: Evaluation): Promise<boolean>
}) {
  const rubric = sectionRubric(section)!
  const [ratings, setRatings] = useState<Evaluation["ratings"]>(evaluation?.ratings ?? {})
  const [note, setNote] = useState(evaluation?.note ?? "")
  const [open, setOpen] = useState<Set<string>>(new Set(Object.keys(evaluation?.ratings ?? {}).filter((k) => evaluation?.ratings[k]?.note)))
  const [status, setStatus] = useState<string>(evaluation?.updated_at ? `Saved ${new Date(evaluation.updated_at).toLocaleString()}` : "Not saved yet")

  const save = async (r = ratings, n = note) => {
    setStatus("Saving")
    const ok = await onSave({ section_id: section.id, ratings: r, note: n.trim() ? n : null })
    setStatus(ok ? `Saved ${new Date().toLocaleTimeString()}` : "Couldn't save. Try again.")
  }
  const rate = (key: string, rating: string) => {
    const cur = ratings[key]?.rating ?? null
    const next = { ...ratings, [key]: { ...ratings[key], rating: cur === rating ? null : rating } }
    setRatings(next)
    void save(next)
  }

  return (
    <div className="wb-cc-rub" aria-label="Evaluation">
      <div className="wb-cc-row">
        <span className="wb-cc-lbl">Evaluation · {rubric.scale.map((s) => s.label).join(" / ")}</span>
        <span className="wb-muted" role="status" style={{ fontSize: 13 }}>{status}</span>
      </div>
      {rubric.items.map((it) => (
        <div key={it.key} className="wb-cc-rrow">
          <div className="wb-cc-rrow-h">
            <span style={{ fontWeight: 600 }}>{it.label}</span>
            <div className="wb-cc-seg" role="group" aria-label={it.label}>
              {rubric.scale.map((sc) => (
                <button key={sc.key} type="button" aria-pressed={ratings[it.key]?.rating === sc.key} onClick={() => rate(it.key, sc.key)}>{sc.label}</button>
              ))}
            </div>
          </div>
          {open.has(it.key) ? (
            <textarea aria-label={`Note on ${it.label}`} placeholder="The exact prompt you used, or what you saw"
              value={ratings[it.key]?.note ?? ""}
              onChange={(e) => setRatings((p) => ({ ...p, [it.key]: { rating: p[it.key]?.rating ?? null, note: e.target.value } }))}
              onBlur={() => void save()} />
          ) : (
            <button type="button" className="wb-cc-linkbtn" onClick={() => setOpen((p) => new Set(p).add(it.key))}>Add a note</button>
          )}
        </div>
      ))}
      {rubric.note && <p className="wb-cc-note">{rubric.note}</p>}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="wb-cc-lbl">Overall note (optional)</span>
        <textarea placeholder={`One strength, one priority improvement, and ${first}'s next practice`} value={note}
          onChange={(e) => setNote(e.target.value)} onBlur={() => void save()} style={{ minHeight: 88 }} />
      </label>
      <span className="wb-muted" style={{ fontSize: 13 }}>Saved for you only. {first} never sees this evaluation.</span>
    </div>
  )
}
