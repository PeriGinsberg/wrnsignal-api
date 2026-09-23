"use client"

// components/workbook/Blocks.tsx
//
// Renders one section of any workbook content file. Used by the client
// workbook (editable) and by the coach's "See it as <client>" preview
// (read-only). Coach notes and review cards sit in the right margin on desktop
// and fall inline under their block on a phone (the margin column collapses
// below the breakpoint in styles.ts).

import React, { useEffect, useRef, type ReactNode } from "react"
import {
  SCENARIO_PARTS, STAR_PARTS, blockFieldKeys, displayValue, quoteText,
  type AnswerValue, type Block, type PickValue, type Section,
} from "../../lib/workbook/content"

const MODE_LABEL: Record<string, string> = { in_session: "In session", homework: "Homework" }

export function ModeTag({ mode }: { mode?: string }) {
  if (!mode || !MODE_LABEL[mode]) return null
  return <span className={`wb-tag ${mode === "homework" ? "review" : "sent"}`}>{MODE_LABEL[mode]}</span>
}

export type SaveState =
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; theirs: unknown }

export type FieldApi = {
  editable: boolean
  get(key: string): unknown
  set(key: string, value: AnswerValue): void
  state(key: string): SaveState | undefined
  /** Conflict: keep the value from the other device, or save mine over it. */
  resolveConflict?(key: string, keep: "theirs" | "mine"): void
  coachName: string
  showCoachOnly: boolean
  /** Under a field's input (client: "Ask your coach" and unsent questions). */
  fieldFoot?(fieldKey: string): ReactNode
  /** In the margin beside a field (client: coach review cards). */
  margin?(fieldKey: string): ReactNode
}

function paragraphs(body: string) {
  return body.split(/\n\n+/).map((p, i) => <p key={i} className="wb-p" style={{ margin: 0 }}>{p}</p>)
}

function AutoText(props: {
  id: string; value: string; onChange(v: string): void; readOnly: boolean
  placeholder?: string; rows?: number; label?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [props.value])
  return (
    <textarea
      ref={ref}
      id={props.id}
      className="wb-input"
      rows={props.rows ?? 2}
      value={props.value}
      readOnly={props.readOnly}
      placeholder={props.readOnly ? "" : props.placeholder ?? "Start typing"}
      aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

function SaveLine({ api, k }: { api: FieldApi; k: string }) {
  const s = api.state(k)
  if (!s || !api.editable) return null
  if (s.kind === "saving") return <span className="wb-saving" role="status">Saving</span>
  if (s.kind === "saved") return <span className="wb-saved" role="status">Saved</span>
  if (s.kind === "error") return <span className="wb-warn" role="alert">{s.message}</span>
  return null
}

function ConflictBox({ api, k }: { api: FieldApi; k: string }) {
  const s = api.state(k)
  if (!s || s.kind !== "conflict" || !api.resolveConflict) return null
  const theirs = typeof s.theirs === "string" ? s.theirs : (s.theirs as PickValue | null)?.choice ?? ""
  return (
    <div className="wb-conflict" role="alert">
      <span><b>This answer was changed on another device or tab.</b> The saved version says:</span>
      <span className="wb-serif" style={{ fontSize: 17 }}>{theirs || "(empty)"}</span>
      <div className="wb-actions">
        <button type="button" className="wb-btn" onClick={() => api.resolveConflict!(k, "theirs")}>Use the saved version</button>
        <button type="button" className="wb-btn wb-btn-solid" onClick={() => api.resolveConflict!(k, "mine")}>Keep what I just wrote</button>
      </div>
    </div>
  )
}

function TextField(props: {
  api: FieldApi; k: string; label: string; long: boolean; number?: number; placeholder?: string; starter?: string
}) {
  const { api, k } = props
  const v = api.get(k)
  // Starter text fills the box until the client saves something of their own.
  // `undefined` means no answer has ever been saved; an empty string means they
  // cleared it, and the starter does not come back to overwrite that.
  const value = displayValue(v, props.starter)
  const untouched = v === undefined && !!props.starter
  const id = `f-${k}`
  return (
    <div className="wb-field">
      <div className="wb-field-head" style={props.number == null ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}>
        {props.number != null && <span className="wb-field-num">{props.number}</span>}
        <label htmlFor={id} className="wb-field-label">{props.label}</label>
      </div>
      {props.long ? (
        <AutoText id={id} value={value} readOnly={!api.editable} placeholder={props.placeholder}
          onChange={(t) => api.set(k, t)} />
      ) : (
        <input id={id} type="text" className="wb-input" value={value} readOnly={!api.editable}
          placeholder={api.editable ? props.placeholder ?? "Start typing" : ""}
          onChange={(e) => api.set(k, e.target.value)} />
      )}
      <ConflictBox api={api} k={k} />
      <div className="wb-field-foot">
        {untouched && api.editable && (
          <span className="wb-muted" style={{ fontSize: 13 }}>A starting point. Edit it into your own words.</span>
        )}
        <SaveLine api={api} k={k} />{api.fieldFoot?.(k)}
      </div>
    </div>
  )
}

function HookField({ api, b }: { api: FieldApi; b: Extract<Block, { type: "field" }> }) {
  const v = api.get(b.key)
  const value = typeof v === "string" ? v : ""
  const id = `f-${b.key}`
  const shown = value.trim() ? value.trim().replace(/[.]+$/, "") : "______"
  return (
    <div className="wb-hook">
      <label htmlFor={id} className="wb-eyebrow">{b.label}</label>
      <p className="wb-hook-line" aria-live="polite">&ldquo;{b.prefix ?? ""} {shown}.&rdquo;</p>
      <input id={id} type="text" className="wb-input" value={value} readOnly={!api.editable}
        placeholder={api.editable ? b.placeholder ?? "Finish the sentence" : ""}
        onChange={(e) => api.set(b.key, e.target.value)} />
      <ConflictBox api={api} k={b.key} />
      <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
    </div>
  )
}

function PickField({ api, b }: { api: FieldApi; b: Extract<Block, { type: "pick" }> }) {
  const raw = api.get(b.key) as PickValue | undefined
  const v: PickValue = raw && typeof raw === "object" ? raw : { choice: null, other: "" }
  const name = `p-${b.key}`
  const choose = (choice: string) => api.set(b.key, { ...v, choice })
  return (
    <fieldset className="wb-pick">
      <legend className="wb-field-label" style={{ marginBottom: 6 }}>{b.label}</legend>
      {b.help && <p className="wb-p wb-muted" style={{ fontSize: 16, marginBottom: 8 }}>{b.help}</p>}
      {b.options.map((o, i) => (
        <label key={i} className={v.choice === o ? "on" : ""}>
          <input type="radio" name={name} checked={v.choice === o} disabled={!api.editable} onChange={() => choose(o)} />
          <span>{o}</span>
        </label>
      ))}
      {b.allow_other && (
        <>
          <label className={v.choice === "__other__" ? "on" : ""}>
            <input type="radio" name={name} checked={v.choice === "__other__"} disabled={!api.editable}
              onChange={() => choose("__other__")} />
            <span>Something else</span>
          </label>
          {v.choice === "__other__" && (
            <input type="text" className="wb-input" aria-label={`${b.label} in my own words`} value={v.other}
              readOnly={!api.editable} placeholder={api.editable ? "In my own words" : ""}
              onChange={(e) => api.set(b.key, { ...v, other: e.target.value })} />
          )}
        </>
      )}
      <ConflictBox api={api} k={b.key} />
      <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
    </fieldset>
  )
}

function Star({ api, b }: { api: FieldApi; b: Extract<Block, { type: "star" }> }) {
  return (
    <div className="wb-block">
      <div className="wb-block-title">{b.number != null && <b>{b.number}</b>}<span>{b.title}</span></div>
      <p className="wb-p" style={{ fontWeight: 600 }}>&ldquo;{b.question}&rdquo;</p>
      {b.skill && <p className="wb-p wb-muted" style={{ fontSize: 16 }}><span className="wb-label" style={{ marginRight: 8 }}>Testing</span>{b.skill}</p>}
      {STAR_PARTS.map((p) => (
        <TextField key={p.part} api={api} k={`${b.key}.${p.part}`} label={p.label}
          long={p.part !== "story" && p.part !== "time"} />
      ))}
    </div>
  )
}

function Scenario({ api, b }: { api: FieldApi; b: Extract<Block, { type: "scenario" }> }) {
  return (
    <div className="wb-block">
      <div className="wb-block-title">{b.number != null && <b>{b.number}</b>}<span>{b.prompt}</span></div>
      {SCENARIO_PARTS.map((p) => (
        <TextField key={p.part} api={api} k={`${b.key}.${p.part}`} label={p.label} long />
      ))}
    </div>
  )
}

function List({ b }: { b: Extract<Block, { type: "list" }> }) {
  return (
    <div className="wb-col" style={{ gap: 14 }}>
      {b.title && <span className="wb-label">{b.title}</span>}
      {b.style === "bullets" && <ul className="wb-ul">{b.items.map((x, i) => <li key={i}><span>{x}</span></li>)}</ul>}
      {b.style === "numbers" && (
        <ol className="wb-ol">{b.items.map((x, i) => <li key={i}><b>{i + 1}</b><span>{x}</span></li>)}</ol>
      )}
      {b.style === "quotes" && <div className="wb-quotes">{b.items.map((x, i) => <div key={i}>{x}</div>)}</div>}
    </div>
  )
}

export function CoachNote({ body, coachName }: { body: string; coachName: string }) {
  return (
    <aside className="wb-note">
      <span className="wb-eyebrow-ink">Coach&rsquo;s note</span>
      <span className="wb-note-body">{body}</span>
      <span className="wb-muted" style={{ fontSize: 14 }}>{coachName}</span>
    </aside>
  )
}

function Main({ api, b }: { api: FieldApi; b: Block }): ReactNode {
  switch (b.type) {
    case "text":
      return (
        <div className="wb-col" style={{ gap: 6 }}>
          {b.label && <span className="wb-label">{b.label}</span>}
          <p className={b.size === "lead" ? "wb-lead" : "wb-p"}>{b.body}</p>
        </div>
      )
    case "heading":
      return <div className="wb-col" style={{ gap: 18 }}><div className="wb-rule" /><h2 className="wb-h2">{b.text}</h2></div>
    case "list":
      return <List b={b} />
    case "callout":
      return (
        <div className={`wb-callout ${b.tone}`}>
          {b.title && <span className="wb-callout-title">{b.title}</span>}
          {paragraphs(b.body)}
        </div>
      )
    case "big_quote":
      return <p className="wb-bigquote">{quoteText(b)}</p>
    case "word_track":
      return (
        <div className="wb-wordtrack">
          {b.label && <span className="wb-eyebrow-ink">{b.label}</span>}
          <p>{b.body}</p>
        </div>
      )
    case "field":
      return b.style === "hook"
        ? <HookField api={api} b={b} />
        : <TextField api={api} k={b.key} label={b.label} long={b.input === "long"} number={b.number}
            placeholder={b.placeholder} starter={b.starter} />
    case "pick":
      return <PickField api={api} b={b} />
    case "star":
      return <Star api={api} b={b} />
    case "scenario":
      return <Scenario api={api} b={b} />
    case "coach_only":
      return api.showCoachOnly ? (
        <div className="wb-coachonly">
          <span className="wb-eyebrow-ink">{b.title || "Coach only"}. The client never sees this.</span>
          <span style={{ whiteSpace: "pre-wrap" }}>{b.body}</span>
        </div>
      ) : null
    case "coach_note":
      return null
  }
}

type Row = { key: string; main: ReactNode; aside: ReactNode[] }

/** Blocks as rows: a coach note joins the margin of the block before it. */
export function SectionBlocks({ api, section }: { api: FieldApi; section: Section }) {
  const rows: Row[] = []
  section.blocks.forEach((b, i) => {
    if (b.type === "coach_note") {
      const note = <CoachNote key={`n${i}`} body={b.body} coachName={api.coachName} />
      const prev = rows[rows.length - 1]
      if (prev) prev.aside.push(note)
      else rows.push({ key: `r${i}`, main: null, aside: [note] })
      return
    }
    if (b.type === "coach_only" && !api.showCoachOnly) return
    const margins = blockFieldKeys(b).map((k) => api.margin?.(k)).filter(Boolean) as ReactNode[]
    rows.push({ key: `r${i}`, main: <Main api={api} b={b} />, aside: margins.map((m, j) => <React.Fragment key={j}>{m}</React.Fragment>) })
  })
  return (
    <>
      {rows.map((r) => (
        <div key={r.key} className="wb-row">
          <div className="wb-col">{r.main}</div>
          <div className="wb-aside">{r.aside}</div>
        </div>
      ))}
    </>
  )
}

export function SectionHeader({ section, total }: { section: Section; total: number }) {
  const n = String(section.number).padStart(2, "0")
  return (
    <div className="wb-row">
      <div className="wb-col" style={{ gap: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, flexWrap: "wrap" }}>
          <span className="wb-secnum" aria-hidden="true">{n}</span>
          <span className="wb-eyebrow">Section {n} of {String(total).padStart(2, "0")}</span>
          <ModeTag mode={section.mode} />
        </div>
        <h1 className="wb-h1">{section.title}</h1>
      </div>
      <div />
    </div>
  )
}
