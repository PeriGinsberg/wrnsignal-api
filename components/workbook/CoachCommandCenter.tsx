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
  type Block, type CoachGuide, type Evaluation, type Section,
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

function Guide({ guide: g, first }: { guide: CoachGuide; first: string }) {
  const [ticked, setTicked] = useState<Set<number>>(new Set())
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

      {g.messages?.length ? (
        <div className="wb-cc-msgs">
          <span className="wb-cc-lbl">Teams messages · send only when {first} asks</span>
          {g.messages.map((m, i) => (
            <article key={i} className="wb-cc-msg" aria-label={`Teams message ${m.label}`}>
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
          ))}
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
