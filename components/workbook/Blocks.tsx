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
  SCENARIO_PARTS, STAR_PARTS, STORY_PARTS, blockFieldKeys, computeCoverage, displayValue, gradeAnswer, gridKeys,
  isFilled, optionsFromAnswers, parseNumber, quoteText, selectValues, sortMatches,
  type AnswerValue, type Block, type PickValue, type Section, type SelectOption,
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
  /**
   * Every answer on the workbook. Needed by blocks that are DERIVED rather than
   * stored: the Section 8 dropdowns are built from the story names in Section 7,
   * and the coverage block reads both. `get` alone cannot serve them because
   * they do not know the keys in advance.
   */
  all(): Record<string, unknown>
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
    const fit = () => {
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    }
    fit()
    // The height is only right for the width it was measured at. A layout that
    // settles after mount (a sidebar, a late font) leaves the text clipped.
    if (typeof ResizeObserver === "undefined") return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit() } })
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.value])
  if (props.readOnly) return <ReadOnlyText id={props.id} value={props.value} label={props.label} />
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

/** A read-only answer as wrapped text. An input or textarea cuts it off at the box. */
function ReadOnlyText(props: { id?: string; value: string; label?: string; cell?: boolean }) {
  return (
    <div id={props.id} className={`wb-input wb-ro${props.cell ? " wb-cell" : ""}`} role="textbox" aria-readonly="true" aria-label={props.label}
      aria-labelledby={!props.label && props.id ? `${props.id}-label` : undefined}>
      {props.value}
    </div>
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
        <label htmlFor={id} id={`${id}-label`} className="wb-field-label">{props.label}</label>
      </div>
      {props.long ? (
        <AutoText id={id} value={value} readOnly={!api.editable} placeholder={props.placeholder}
          onChange={(t) => api.set(k, t)} />
      ) : !api.editable ? (
        <ReadOnlyText id={id} value={value} />
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
      <label htmlFor={id} id={`${id}-label`} className="wb-eyebrow">{b.label}</label>
      <p className="wb-hook-line" aria-live="polite">&ldquo;{b.prefix ?? ""} {shown}.&rdquo;</p>
      {api.editable
        ? <input id={id} type="text" className="wb-input" value={value}
            placeholder={b.placeholder ?? "Finish the sentence"}
            onChange={(e) => api.set(b.key, e.target.value)} />
        : <ReadOnlyText id={id} value={value} />}
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
          {v.choice === "__other__" && (api.editable
            ? <input type="text" className="wb-input" aria-label={`${b.label} in my own words`} value={v.other}
                placeholder="In my own words"
                onChange={(e) => api.set(b.key, { ...v, other: e.target.value })} />
            : <ReadOnlyText value={v.other} label={`${b.label} in my own words`} />
          )}
        </>
      )}
      <ConflictBox api={api} k={b.key} />
      <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
    </fieldset>
  )
}

/**
 * A dropdown, single or multi.
 *
 * Grouped options render as <optgroup>, which is how fifteen traits in four
 * groups stay readable. A multi-select is a checkbox list rather than a
 * <select multiple>, because nobody knows to ctrl-click and on a phone the
 * native multi-select is close to unusable.
 */
function SelectField({ api, b }: { api: FieldApi; b: Extract<Block, { type: "select" }> }) {
  const literal = b.options ?? []
  const derived = b.options_from ? optionsFromAnswers(b.options_from, api.all()) : []
  const grouped: SelectOption[] = literal.length ? literal : derived
  const flat = selectValues(grouped)
  const id = `f-${b.key}`
  const raw = api.get(b.key)

  if (b.multi) {
    const chosen = Array.isArray(raw) ? (raw as string[]) : []
    const toggle = (o: string) =>
      api.set(b.key, chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o])
    return (
      <fieldset className="wb-pick">
        <legend className="wb-field-label" style={{ marginBottom: 6 }}>{b.label}</legend>
        {b.help && <p className="wb-p wb-muted" style={{ fontSize: 16, marginBottom: 8 }}>{b.help}</p>}
        {grouped.map((o, i) =>
          typeof o === "string" ? (
            <label key={i} className={chosen.includes(o) ? "on" : ""}>
              <input type="checkbox" checked={chosen.includes(o)} disabled={!api.editable} onChange={() => toggle(o)} />
              <span>{o}</span>
            </label>
          ) : (
            <div key={i} style={{ width: "100%" }}>
              <span className="wb-eyebrow-ink" style={{ display: "block", margin: "10px 0 4px" }}>{o.group}</span>
              {o.items.map((it, j) => (
                <label key={j} className={chosen.includes(it) ? "on" : ""}>
                  <input type="checkbox" checked={chosen.includes(it)} disabled={!api.editable} onChange={() => toggle(it)} />
                  <span>{it}</span>
                </label>
              ))}
            </div>
          ),
        )}
        <ConflictBox api={api} k={b.key} />
        <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
      </fieldset>
    )
  }

  const value = typeof raw === "string" ? raw : ""
  // A stored answer whose option has since disappeared still shows, rather than
  // silently resetting to blank: renaming a story in Section 7 must not wipe the
  // Section 8 answers that pointed at it.
  const orphan = value && !flat.includes(value)
  return (
    <div className="wb-field">
      <div className="wb-field-head" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        <label htmlFor={id} className="wb-field-label">{b.label}</label>
      </div>
      {b.help && <p className="wb-p wb-muted" style={{ fontSize: 16, marginBottom: 6 }}>{b.help}</p>}
      <select id={id} className="wb-input" value={value} disabled={!api.editable}
        onChange={(e) => api.set(b.key, e.target.value)}>
        <option value="">{b.placeholder ?? (flat.length ? "Choose one" : "Nothing to choose yet")}</option>
        {orphan && <option value={value}>{value}</option>}
        {grouped.map((o, i) =>
          typeof o === "string"
            ? <option key={i} value={o}>{o}</option>
            : (
              <optgroup key={i} label={o.group}>
                {o.items.map((it, j) => <option key={j} value={it}>{it}</option>)}
              </optgroup>
            ),
        )}
      </select>
      <ConflictBox api={api} k={b.key} />
      <div className="wb-field-foot">
        {!flat.length && b.options_from && api.editable && (
          <span className="wb-muted" style={{ fontSize: 13 }}>Name a story in Section 7 and it will appear here.</span>
        )}
        <SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}
      </div>
    </div>
  )
}

/** One STAR + E story: the trait, where it came from, and the six parts. */
function StoryBlock({ api, b }: { api: FieldApi; b: Extract<Block, { type: "story" }> }) {
  // Prefill: while THIS slot is untouched, the source story shows as starter
  // text. Read per part so a client who has edited one part keeps their edit
  // and still sees the copy in the parts they have not reached.
  const starter = (part: string): string | undefined => {
    if (!b.copy_from) return undefined
    const v = api.get(`${b.copy_from}.${part}`)
    const t = typeof v === "string" ? v : ""
    return t.trim() ? t : undefined
  }
  return (
    <div className="wb-block">
      {(b.number != null || b.title) && (
        <div className="wb-block-title">{b.number != null && <b>{b.number}</b>}<span>{b.title}</span></div>
      )}
      {b.question && <p className="wb-p" style={{ fontWeight: 600 }}>&ldquo;{b.question}&rdquo;</p>}
      {b.named && (
        <TextField api={api} k={`${b.key}.name`} label="Story name (a few words you'll remember it by)"
          long={false} placeholder="The torn Achilles" />
      )}
      <SelectField api={api} b={{ type: "select", key: `${b.key}.trait`, label: "What it proves", options: b.traits, placeholder: "Choose a trait" }} />
      <SelectField api={api} b={{ type: "select", key: `${b.key}.life_area`, label: "Where it came from", options: b.life_areas, placeholder: "Choose a part of your life" }} />
      {STORY_PARTS.map((p) => (
        <TextField key={p.part} api={api} k={`${b.key}.${p.part}`} label={p.label} long
          starter={starter(p.part)} />
      ))}
      {b.other_questions && (
        <TextField api={api} k={`${b.key}.other_questions`} label="Other questions it answers" long />
      )}
      {b.timed && (
        <TextField api={api} k={`${b.key}.seconds`} label="Time when you said it out loud (seconds)" long={false}
          placeholder="Under 90" />
      )}
    </div>
  )
}

/**
 * What the client has NOT covered yet, recomputed from what is on screen.
 *
 * Derived and never stored: it owns no field keys, so it cannot be answered,
 * cannot be half-finished, and does not move the progress bar. It reads the
 * story slots and the match answers straight out of the live answer map, which
 * is why it updates as they type in Sections 7 and 8.
 *
 * Silence is the success state. A flag with nothing under it is not rendered at
 * all, so a client who has covered everything sees an empty panel saying so
 * rather than five reassuring headings they have to read past.
 */
function Coverage({ api, b }: { api: FieldApi; b: Extract<Block, { type: "coverage" }> }) {
  const rows = computeCoverage(b, api.all())
  return (
    <div className="wb-callout paleblue">
      <span className="wb-callout-title">{b.title ?? "Your coverage"}</span>
      {rows.length === 0 ? (
        <p className="wb-p">Nothing missing. Every question has a story, every trait group is covered, and no story is doing too much work.</p>
      ) : (
        rows.map((r) => (
          <div key={r.label} style={{ marginTop: 10 }}>
            <span className="wb-eyebrow-ink">{r.label}</span>
            <p className="wb-p" style={{ margin: "2px 0 0" }}>{r.items.join(" · ")}</p>
          </div>
        ))
      )}
    </div>
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

function Table({ b }: { b: Extract<Block, { type: "table" }> }) {
  const terms = !b.columns
  return (
    <div className="wb-col" style={{ gap: 14 }}>
      {b.title && <span className="wb-label">{b.title}</span>}
      <div className="wb-table-wrap">
        <table className="wb-table">
          {b.columns && <thead><tr>{b.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>}
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>{r.map((x, j) => <td key={j} style={terms && j === 0 ? { fontWeight: 700 } : undefined}>{x}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** One short answer per cell. Save state is reported once for the whole grid, not under sixty boxes. */
function Grid({ api, b }: { api: FieldApi; b: Extract<Block, { type: "grid" }> }) {
  const keys = gridKeys(b)
  const states = keys.map((k) => api.state(k))
  const error = states.find((s) => s?.kind === "error") as { kind: "error"; message: string } | undefined
  const status = !api.editable ? null
    : error ? <span className="wb-warn" role="alert">{error.message}</span>
    : states.some((s) => s?.kind === "saving") ? <span className="wb-saving" role="status">Saving</span>
    : states.some((s) => s?.kind === "saved") ? <span className="wb-saved" role="status">Saved</span>
    : null
  const rows = Array.from({ length: b.rows }, (_, i) => i + 1)
  return (
    <div className="wb-col" style={{ gap: 14 }}>
      {b.title && <span className="wb-label">{b.title}</span>}
      <div className="wb-table-wrap">
        <table className="wb-table wb-grid">
          <thead><tr><th style={{ width: 36 }}>#</th>{b.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {b.guide && (
              <tr className="wb-grid-guide"><td />{b.guide.map((g, i) => <td key={i}>{g}</td>)}</tr>
            )}
            {rows.map((r) => (
              <tr key={r}>
                <td className="wb-grid-num">{r}</td>
                {b.columns.map((c) => {
                  const k = `${b.key}.${r}.${c.key}`
                  const v = api.get(k)
                  return (
                    <td key={c.key}>
                      {api.editable
                        ? <input type="text" className="wb-input wb-cell" aria-label={`${c.label} ${r}`}
                            value={typeof v === "string" ? v : ""}
                            onChange={(e) => api.set(k, e.target.value)} />
                        : <ReadOnlyText cell value={typeof v === "string" ? v : ""} label={`${c.label} ${r}`} />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {keys.map((k) => <ConflictBox key={k} api={api} k={k} />)}
      {status && <div className="wb-field-foot">{status}</div>}
    </div>
  )
}

/** A YouTube watch or youtu.be link as an embed URL; null for anything else. */
export function youtubeEmbed(url: string): string | null {
  const m = url.match(/^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` : null
}

const KIND_LABEL = { video: "Video", article: "Article", tool: "Practice tool", practice: "Practice round" } as const

function Video({ api, b }: { api: FieldApi; b: Extract<Block, { type: "video" }> }) {
  const embed = youtubeEmbed(b.url)
  const watched = api.get(b.key) === "1"
  return (
    <div className="wb-resource">
      <div className="wb-card-head" style={{ flexWrap: "wrap" }}>
        <span className="wb-tag sent">Video{b.length ? `, ${b.length}` : ""}</span>
        {watched && <span className="wb-tag ok">Watched</span>}
      </div>
      <span className="wb-serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25 }}>{b.title}</span>
      {b.source && <span className="wb-muted" style={{ fontSize: 15 }}>{b.source}</span>}
      {b.body && paragraphs(b.body)}
      {embed && (
        <div className="wb-video">
          <iframe src={embed} title={b.title} loading="lazy" allowFullScreen
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      )}
      <div className="wb-actions" style={{ alignItems: "center" }}>
        <a className="wb-btn wb-btn-solid" href={b.url} target="_blank" rel="noopener noreferrer">Watch on YouTube</a>
        <span className="wb-muted" style={{ fontSize: 14 }}>Opens in a new tab. Your answers here stay saved.</span>
      </div>
      <label className={`wb-checkrow${watched ? " on" : ""}`}>
        <input type="checkbox" checked={watched} disabled={!api.editable}
          onChange={(e) => api.set(b.key, e.target.checked ? "1" : "")} />
        <span>I watched this video</span>
      </label>
      <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
    </div>
  )
}

function LinkCard({ b }: { b: Extract<Block, { type: "link" }> }) {
  return (
    <div className="wb-resource">
      <div className="wb-card-head" style={{ flexWrap: "wrap" }}>
        <span className="wb-tag sent">{KIND_LABEL[b.kind]}</span>
        {b.optional && <span className="wb-tag draft">Optional</span>}
      </div>
      <span className="wb-serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.25 }}>{b.title}</span>
      {b.body && paragraphs(b.body)}
      <div>
        {b.kind === "practice" ? (
          <a className="wb-btn wb-btn-solid" href={b.url}>Start the practice case</a>
        ) : (
          <a className="wb-btn" href={b.url} target="_blank" rel="noopener noreferrer">
            {b.kind === "tool" ? "Open the tool" : b.kind === "video" ? "Watch" : "Read it"}
          </a>
        )}
      </div>
    </div>
  )
}

function Verdict({ grade, right, wrong }: { grade: "correct" | "wrong"; right: string; wrong: string }) {
  return <span className={`wb-verdict ${grade}`} role="status">{grade === "correct" ? right : wrong}</span>
}

function Quiz({ api, b }: { api: FieldApi; b: Extract<Block, { type: "quiz" }> }) {
  const saved = api.get(b.key)
  const locked = saved !== undefined && saved !== "" && !(Array.isArray(saved) && saved.length === 0)
  const [draft, setDraft] = React.useState<string[]>([])
  const chosen = locked ? (Array.isArray(saved) ? (saved as string[]) : [String(saved)]) : draft
  const grade = locked ? gradeAnswer(b, saved) : null
  const name = `q-${b.key}`
  const toggle = (o: string) => setDraft((p) => (b.multi ? (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]) : [o]))
  return (
    <fieldset className="wb-pick wb-quiz">
      <legend className="wb-field-head" style={{ marginBottom: 6, gridTemplateColumns: b.number == null ? "minmax(0,1fr)" : undefined }}>
        {b.number != null && <span className="wb-field-num">{b.number}</span>}
        <span className="wb-field-label">{b.question}</span>
      </legend>
      <span className="wb-muted" style={{ fontSize: 14 }}>{b.multi ? "Choose every answer that fits, then press Check." : "Choose one answer, then press Check."}</span>
      {b.options.map((o) => {
        const isOn = chosen.includes(o)
        const mark = locked ? (b.correct.includes(o) ? " right" : isOn ? " wrong" : "") : ""
        return (
          <label key={o} className={`${isOn ? "on" : ""}${mark}`}>
            <input type={b.multi ? "checkbox" : "radio"} name={name} checked={isOn}
              disabled={!api.editable || locked} onChange={() => toggle(o)} />
            <span style={{ flex: 1 }}>{o}</span>
            {locked && b.correct.includes(o) && <span className="wb-optmark">{b.multi ? "Fits" : "Best answer"}</span>}
          </label>
        )
      })}
      {!locked && api.editable && (
        <div className="wb-actions">
          <button type="button" className="wb-btn wb-btn-solid" disabled={!draft.length}
            onClick={() => api.set(b.key, b.multi ? draft : draft[0])}>Check my answer</button>
        </div>
      )}
      {locked && grade && (
        <div className="wb-feedback">
          <Verdict grade={grade} right="You got it." wrong={b.multi ? "Not quite. Here is the full picture." : "Not quite. Here is why."} />
          {paragraphs(b.explanation)}
        </div>
      )}
      <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
    </fieldset>
  )
}

function Numeric({ api, b }: { api: FieldApi; b: Extract<Block, { type: "numeric" }> }) {
  const saved = api.get(b.key)
  const locked = typeof saved === "string" && saved.trim().length > 0
  const [draft, setDraft] = React.useState("")
  const value = locked ? (saved as string) : draft
  const grade = locked ? gradeAnswer(b, saved) : null
  const unreadable = !locked && draft.trim() !== "" && parseNumber(draft) === null
  const id = `f-${b.key}`
  return (
    <div className="wb-field wb-quiz">
      <div className="wb-field-head" style={b.number == null ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}>
        {b.number != null && <span className="wb-field-num">{b.number}</span>}
        <label htmlFor={id} className="wb-field-label">{b.question}</label>
      </div>
      {b.hint && <p className="wb-p wb-muted" style={{ fontSize: 16 }}>{b.hint}</p>}
      <div className="wb-numrow">
        {b.prefix && <span className="wb-numaff">{b.prefix}</span>}
        <input id={id} type="text" inputMode="decimal" className="wb-input" value={value}
          readOnly={!api.editable || locked} placeholder={api.editable && !locked ? "Your answer" : ""}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim() && !unreadable) api.set(b.key, draft.trim()) }} />
        {b.suffix && <span className="wb-numaff">{b.suffix}</span>}
      </div>
      {unreadable && <span className="wb-muted" style={{ fontSize: 14 }}>Type just the number, for example 2,000 or 12M or 33.3.</span>}
      {!locked && api.editable && (
        <div className="wb-actions">
          <button type="button" className="wb-btn wb-btn-solid" disabled={!draft.trim() || unreadable}
            onClick={() => api.set(b.key, draft.trim())}>Check my answer</button>
        </div>
      )}
      {locked && grade && (
        <div className="wb-feedback">
          <Verdict grade={grade} right="That's right." wrong="Not quite. Here is how it works." />
          {paragraphs(b.explanation)}
        </div>
      )}
      <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
    </div>
  )
}

function Sort({ api, b }: { api: FieldApi; b: Extract<Block, { type: "sort" }> }) {
  const all = api.all()
  const { matched, total, done } = sortMatches(b, all)
  const checked = api.get(`${b.key}.checked`) === "1"
  return (
    <div className="wb-col" style={{ gap: 14 }}>
      {b.title && <span className="wb-label">{b.title}</span>}
      {b.prompt && <p className="wb-p">{b.prompt}</p>}
      <div className="wb-sort">
        {b.items.map((it, i) => {
          const k = `${b.key}.${i + 1}`
          const v = typeof all[k] === "string" ? (all[k] as string) : ""
          return (
            <div key={k} className="wb-sort-item">
              <label htmlFor={`f-${k}`} style={{ fontSize: 17, fontWeight: 600 }}>{it.text}</label>
              <select id={`f-${k}`} className="wb-input" value={v} disabled={!api.editable || checked}
                onChange={(e) => api.set(k, e.target.value)}>
                <option value="">Choose a group</option>
                {b.categories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              {checked && (
                <span className={`wb-sort-note${v === it.category ? " same" : ""}`}>
                  {v === it.category ? `Same as our sample: ${it.category}` : `Our sample puts this under ${it.category}`}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {!checked && api.editable && (
        <div className="wb-actions" style={{ alignItems: "center" }}>
          <button type="button" className="wb-btn wb-btn-solid" disabled={!done}
            onClick={() => api.set(`${b.key}.checked`, "1")}>Compare with the sample</button>
          {!done && <span className="wb-muted" style={{ fontSize: 14 }}>Choose a group for every item first.</span>}
        </div>
      )}
      {checked && (
        <div className="wb-feedback">
          <span className="wb-verdict correct" role="status">You matched our sample on {matched} of {total}.</span>
          {b.explanation && paragraphs(b.explanation)}
        </div>
      )}
      <div className="wb-field-foot"><SaveLine api={api} k={`${b.key}.checked`} /></div>
    </div>
  )
}

function clock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}

/**
 * A timed speaking drill. Think, speak against the clock, write it down,
 * submit, compare. What they write is saved only on Submit and then locked,
 * the same as a knowledge check, so the coach sees the answer they gave
 * before they read the model one. The timer can be skipped: writing still
 * counts, and `<key>.secs` simply stays empty.
 */
function Drill({ api, b }: { api: FieldApi; b: Extract<Block, { type: "drill" }> }) {
  const saved = api.get(b.key)
  const locked = typeof saved === "string" && saved.trim().length > 0
  const [draft, setDraft] = React.useState("")
  const [phase, setPhase] = React.useState<"ready" | "think" | "speak" | "write">("ready")
  const [left, setLeft] = React.useState(0)
  const t0 = React.useRef(0)
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  const run = (which: "think" | "speak") => {
    if (timer.current) clearInterval(timer.current)
    const limit = (which === "think" ? b.prep_seconds : b.speak_seconds) * 1000
    t0.current = Date.now()
    setPhase(which)
    setLeft(limit)
    timer.current = setInterval(() => {
      const l = limit - (Date.now() - t0.current)
      setLeft(l)
      if (l <= 0) {
        if (which === "think") run("speak")
        else stopSpeaking()
      }
    }, 200)
  }
  const stopSpeaking = () => {
    if (timer.current) clearInterval(timer.current)
    const secs = Math.round((Date.now() - t0.current) / 1000)
    if (api.editable) api.set(`${b.key}.secs`, String(Math.min(secs, b.speak_seconds)))
    setPhase("write")
  }
  const start = () => (b.prep_seconds > 0 ? run("think") : run("speak"))

  const secs = api.get(`${b.key}.secs`)
  const check = typeof api.get(`${b.key}.check`) === "string" ? (api.get(`${b.key}.check`) as string) : ""
  const id = `f-${b.key}`
  const showWrite = locked || phase === "write" || !api.editable
  const value = locked ? (saved as string) : draft

  return (
    <div className="wb-field wb-drill">
      <div className="wb-field-head" style={b.number == null ? { gridTemplateColumns: "minmax(0,1fr)" } : undefined}>
        {b.number != null && <span className="wb-field-num">{b.number}</span>}
        <div className="wb-col" style={{ gap: 4 }}>
          {b.title && <span className="wb-label">{b.title}</span>}
          <span className="wb-field-label">{b.question}</span>
        </div>
      </div>
      <span className="wb-muted" style={{ fontSize: 14 }}>
        {b.prep_seconds > 0 ? `${b.prep_seconds} seconds to think, then ` : ""}{clock(b.speak_seconds * 1000)} to say your answer out loud.
      </span>

      {!locked && api.editable && phase === "ready" && (
        <div className="wb-actions" style={{ alignItems: "center" }}>
          <button type="button" className="wb-btn wb-btn-solid" onClick={start}>Start the timer</button>
          <button type="button" className="wb-linkbtn" onClick={() => setPhase("write")}>Skip the timer</button>
        </div>
      )}
      {(phase === "think" || phase === "speak") && (
        <div className={`wb-timer ${phase}`} aria-live="polite">
          <span className="wb-timer-clock">{clock(left)}</span>
          <span className="wb-timer-say">{phase === "think" ? "Think. Plan your headline." : "Speak. Say your answer out loud now."}</span>
          <div className="wb-timer-bar"><div style={{ width: `${Math.max(0, Math.min(100, (left / ((phase === "think" ? b.prep_seconds : b.speak_seconds) * 1000)) * 100))}%` }} /></div>
          <div className="wb-actions">
            {phase === "think"
              ? <button type="button" className="wb-btn wb-btn-solid" onClick={() => run("speak")}>I&rsquo;m ready to speak</button>
              : <button type="button" className="wb-btn wb-btn-solid" onClick={stopSpeaking}>Done speaking</button>}
          </div>
        </div>
      )}

      {showWrite && (
        <div className="wb-col" style={{ gap: 8 }}>
          <label htmlFor={id} id={`${id}-label`} className="wb-label">{b.write_label}</label>
          {b.input === "long"
            ? <AutoText id={id} value={value} readOnly={!api.editable || locked} onChange={setDraft} placeholder="Write what you said" />
            : !api.editable || locked
              ? <ReadOnlyText id={id} value={value} />
              : <input id={id} type="text" className="wb-input" value={value}
                  placeholder="Write what you said" onChange={(e) => setDraft(e.target.value)} />}
          {typeof secs === "string" && secs && <span className="wb-muted" style={{ fontSize: 14 }}>You spoke for {secs} seconds.</span>}
          {!locked && api.editable && (
            <div className="wb-actions">
              <button type="button" className="wb-btn wb-btn-solid" disabled={!draft.trim()}
                onClick={() => api.set(b.key, draft.trim())}>Submit and compare</button>
            </div>
          )}
        </div>
      )}

      {(locked || !api.editable) && (
        <div className="wb-feedback">
          <span className="wb-callout-title">{b.model_title ?? "One strong answer"}</span>
          {paragraphs(b.model)}
          <span className="wb-muted" style={{ fontSize: 14 }}>Other answers can be just as good. Compare the shape, not the words.</span>
        </div>
      )}
      {(locked || !api.editable) && b.check && (
        <fieldset className="wb-pick">
          <legend className="wb-field-label" style={{ marginBottom: 6 }}>{b.check.question}</legend>
          {b.check.options.map((o) => (
            <label key={o} className={check === o ? "on" : ""}>
              <input type="radio" name={`chk-${b.key}`} checked={check === o} disabled={!api.editable}
                onChange={() => api.set(`${b.key}.check`, o)} />
              <span style={{ flex: 1 }}>{o}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="wb-field-foot"><SaveLine api={api} k={b.key} />{api.fieldFoot?.(b.key)}</div>
    </div>
  )
}

function Reveal({ api, b }: { api: FieldApi; b: Extract<Block, { type: "reveal" }> }) {
  const [open, setOpen] = React.useState(false)
  const all = api.all()
  const ready = b.after.every((k) => isFilled(all[k]))
  // The coach's read-only preview shows it open: there is nothing to earn.
  const shown = open || !api.editable
  if (shown) {
    return (
      <div className="wb-callout peach">
        <span className="wb-callout-title">{b.title}</span>
        {paragraphs(b.body)}
      </div>
    )
  }
  return (
    <div className="wb-reveal">
      <span className="wb-callout-title">{b.title}</span>
      {ready
        ? <span className="wb-p" style={{ fontSize: 16 }}>You have written your own answer. Open the example when you are ready to compare.</span>
        : <span className="wb-p" style={{ fontSize: 16 }}>This unlocks once you have answered the questions above. Try first: comparing is much more useful after you have had a go.</span>}
      <div>
        <button type="button" className="wb-btn wb-btn-solid" disabled={!ready} onClick={() => setOpen(true)}>
          {b.button ?? "Show the example answer"}
        </button>
      </div>
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
    case "select":
      return <SelectField api={api} b={b} />
    case "story":
      return <StoryBlock api={api} b={b} />
    case "coverage":
      return <Coverage api={api} b={b} />
    case "star":
      return <Star api={api} b={b} />
    case "scenario":
      return <Scenario api={api} b={b} />
    case "table":
      return <Table b={b} />
    case "grid":
      return <Grid api={api} b={b} />
    case "video":
      return <Video api={api} b={b} />
    case "link":
      return <LinkCard b={b} />
    case "quiz":
      return <Quiz api={api} b={b} />
    case "numeric":
      return <Numeric api={api} b={b} />
    case "sort":
      return <Sort api={api} b={b} />
    case "reveal":
      return <Reveal api={api} b={b} />
    case "drill":
      return <Drill api={api} b={b} />
    case "coach_only":
      return api.showCoachOnly ? (
        <div className="wb-coachonly">
          <span className="wb-eyebrow-ink">{b.title || "Coach only"}. The client never sees this.</span>
          <span style={{ whiteSpace: "pre-wrap" }}>{b.body ?? (b.guide ? "Structured coach guide. It opens in the Coach Command Center on the Review screen." : "")}</span>
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

export function SectionHeader({ section, total, word = "Section" }: { section: Section; total: number; word?: string }) {
  const n = String(section.number).padStart(2, "0")
  return (
    <div className="wb-row">
      <div className="wb-col" style={{ gap: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, flexWrap: "wrap" }}>
          <span className="wb-secnum" aria-hidden="true">{n}</span>
          <span className="wb-eyebrow">{section.day ? `${section.day}, ` : ""}{word} {n} of {String(total).padStart(2, "0")}</span>
          <ModeTag mode={section.mode} />
        </div>
        <h1 className="wb-h1">{section.title}</h1>
        {section.minutes && <span className="wb-muted" style={{ fontSize: 16, fontWeight: 600 }}>{section.minutes}</span>}
      </div>
      <div />
    </div>
  )
}
