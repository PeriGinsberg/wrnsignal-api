"use client"

// components/workbook/Summary.tsx
//
// "Read This 1 Hour Before": phone-first, built from the content file's
// `summary` blocks and the client's answers. Empty answers show a muted
// placeholder rather than disappearing, so a gap is visible before the day.

import React from "react"
import {
  CHECKLIST_PREFIX, answerText,
  type Block, type SummaryBlock, type WorkbookContent,
} from "../../lib/workbook/content"

export type InterviewRow = {
  company_name?: string | null
  job_title?: string | null
  interview_date?: string | null
  interview_at?: string | null
  interviewer_names?: string | null
} | null

type Props = {
  content: WorkbookContent
  answers: Record<string, unknown>
  interview: InterviewRow
  /** When set, the checklist is interactive and persisted through it. */
  onCheck?: (index: number, checked: boolean) => void
}

const EMPTY = "Not filled in yet"

function Answer({ v, italic = true }: { v: unknown; italic?: boolean }) {
  const t = answerText(v)
  return t
    ? <span style={{ fontSize: 16, lineHeight: 1.5 }}>{t}</span>
    : <span className="wb-muted" style={{ fontSize: 16, lineHeight: 1.5, fontStyle: italic ? "italic" : "normal" }}>{EMPTY}</span>
}

function fmtDate(d: string) {
  // A bare date (YYYY-MM-DD) must not shift a day by being read as UTC midnight.
  const [y, m, day] = d.slice(0, 10).split("-").map(Number)
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
}

/** Interview row first, the content file second (decision 5). A session workbook
 *  has no interview at all, in which case there is nothing to show. */
export function interviewDetails(content: WorkbookContent, row: InterviewRow) {
  const c = content.interview ?? { company: null, role: null, date: null, time: null, interviewer_name: null, interviewer_title: null, location: null }
  let when: string | null = null
  if (row?.interview_at) {
    const d = new Date(row.interview_at)
    when = `${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
  } else if (row?.interview_date || c.date) {
    when = [fmtDate((row?.interview_date || c.date) as string), c.time].filter(Boolean).join(", ")
  } else if (c.time) {
    when = c.time
  }
  const withWho = (row?.interviewer_names || "").trim()
    || [c.interviewer_name, c.interviewer_title].filter(Boolean).join(", ")
    || null
  const role = [row?.job_title || c.role, row?.company_name || c.company].filter(Boolean).join(", ") || null
  return { when, with: withWho, role, where: c.location }
}

function Head({ n, title }: { n: number; title: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {n > 1 && <div className="wb-rule" style={{ width: 48 }} />}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="wb-serif" style={{ fontSize: 30, fontWeight: 700, color: "var(--orange)" }}>{n}</span>
        <h2 className="wb-serif" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{title}</h2>
      </div>
    </div>
  )
}

const rowLine: React.CSSProperties = { padding: "12px 0", borderBottom: "1px solid var(--border)" }
const tagLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: ".12em", color: "var(--teal-ink)" }

export function Summary({ content, answers, interview, onCheck }: Props) {
  const starTitles = new Map<string, string>()
  for (const s of content.sections) for (const b of s.blocks as Block[]) if (b.type === "star") starTitles.set(b.key, b.title)

  const details = interviewDetails(content, interview)
  const numbered: SummaryBlock[] = content.summary.blocks.filter((b) => b.type !== "interview_details" && b.type !== "signoff")
  const num = (b: SummaryBlock) => numbered.indexOf(b) + 1

  const section = (b: SummaryBlock, i: number) => {
    switch (b.type) {
      case "interview_details":
      case "signoff":
        return null
      case "hook": {
        const t = answerText(answers[b.field])
        return (
          <section key={i} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Head n={num(b)} title="Your hook" />
            <div style={{ background: "var(--peach)", padding: "24px 20px" }}>
              <p className="wb-serif" style={{ margin: 0, fontSize: 25, fontWeight: 600, lineHeight: 1.25 }}>
                &ldquo;{b.prefix}{" "}
                {t ? t.replace(/[.]+$/, "") : <span className="wb-muted" style={{ fontStyle: "italic", fontWeight: 400 }}>your hook</span>}.&rdquo;
              </p>
            </div>
            {b.note && <p style={{ margin: 0, fontSize: 15 }}>{b.note}</p>}
          </section>
        )
      }
      case "tmay":
        return (
          <section key={i} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Head n={num(b)} title="Tell me about yourself" />
            <div>
              {([["PRESENT", b.present], ["PAST", b.past], ["FUTURE", b.future]] as const).map(([label, key]) => (
                <div key={label} style={{ ...rowLine, display: "grid", gridTemplateColumns: "84px minmax(0,1fr)", columnGap: 10 }}>
                  <span style={{ ...tagLabel, paddingTop: 3 }}>{label}</span>
                  <Answer v={answers[key]} />
                </div>
              ))}
            </div>
            {b.close && (
              <div style={{ background: "var(--pale)", padding: 18 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 700, letterSpacing: ".12em", marginBottom: 8 }}>THEN CLOSE WITH</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>{b.close}</p>
              </div>
            )}
            {b.note && <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{b.note}</p>}
          </section>
        )
      case "story_map":
        return (
          <section key={i} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Head n={num(b)} title={b.title} />
            {b.note && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>{b.note}</p>}
            <div>
              {b.stars.map((k) => (
                <div key={k} style={{ ...rowLine, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", columnGap: 12, fontSize: 15 }}>
                  <span style={{ fontWeight: 600, lineHeight: 1.4 }}>{starTitles.get(k) ?? k}</span>
                  <Answer v={answers[`${k}.story`]} />
                </div>
              ))}
            </div>
          </section>
        )
      case "quick_answers":
        return (
          <section key={i} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Head n={num(b)} title="Quick answers" />
            <div>
              {b.items.map((it, j) => (
                <div key={j} style={{ ...rowLine, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={tagLabel}>{it.label}</span>
                  {"static" in it
                    ? <span style={{ fontSize: 16, lineHeight: 1.5 }}>{it.static}</span>
                    : <Answer v={answers[it.field]} />}
                </div>
              ))}
            </div>
          </section>
        )
      case "questions":
        return (
          <section key={i} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Head n={num(b)} title="Your questions" />
            <div style={{ background: "var(--peach)", padding: 18 }}>
              <span style={{ display: "block", fontSize: 12, fontWeight: 700, letterSpacing: ".12em", marginBottom: 8 }}>ALWAYS FIRST</span>
              <p className="wb-serif" style={{ margin: 0, fontSize: 19, lineHeight: 1.35 }}>{b.first}</p>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {b.fields.map((k, j) => (
                <li key={k} style={{ ...rowLine, display: "flex", gap: 12, fontSize: 16 }}>
                  <span className="wb-serif" style={{ fontWeight: 700, color: "var(--orange)" }}>{j + 2}</span>
                  <Answer v={answers[k]} />
                </li>
              ))}
            </ol>
            {b.note && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>{b.note}</p>}
          </section>
        )
      case "checklist":
        return (
          <section key={i} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Head n={num(b)} title="Last checks" />
            <div>
              {b.items.map((text, j) => {
                const checked = answers[`${CHECKLIST_PREFIX}${j}`] === "1"
                const id = `check-${j}`
                return (
                  <label key={j} htmlFor={id} style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 52, borderBottom: "1px solid var(--border)", fontSize: 16, lineHeight: 1.4, cursor: onCheck ? "pointer" : "default" }}>
                    <input id={id} type="checkbox" checked={checked} disabled={!onCheck}
                      onChange={(e) => onCheck?.(j, e.target.checked)}
                      style={{ width: 22, height: 22, accentColor: "var(--teal)", flexShrink: 0, margin: 0 }} />
                    <span style={checked ? { color: "var(--muted)", textDecoration: "line-through" } : undefined}>{text}</span>
                  </label>
                )
              })}
            </div>
          </section>
        )
    }
  }

  const signoff = content.summary.blocks.find((b) => b.type === "signoff") as Extract<SummaryBlock, { type: "signoff" }> | undefined
  const showDetails = content.summary.blocks.some((b) => b.type === "interview_details")

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", background: "var(--bg)", minHeight: "100vh" }}>
      <header style={{ background: "var(--navy)", color: "#fff", padding: "28px 22px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i style={{ width: 8, height: 8, background: "var(--orange)", display: "inline-block" }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".16em" }}>WRN</span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".16em", color: "var(--orange)" }}>{content.summary.eyebrow}</span>
        </div>
        <h1 className="wb-serif" style={{ margin: 0, fontSize: 36, fontWeight: 600, lineHeight: 1.08 }}>{content.summary.title}</h1>
        {showDetails && (
          <div style={{ display: "grid", rowGap: 10, borderTop: "1px solid rgba(255,255,255,0.25)", paddingTop: 16 }}>
            {([["When", details.when], ["With", details.with], ["Role", details.role], ["Where", details.where]] as const).map(([k, v]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", fontSize: 15 }}>
                <span style={{ color: "var(--pale)", fontWeight: 600 }}>{k}</span>
                <span style={v ? undefined : { fontStyle: "italic", opacity: 0.7 }}>{v || "Not set yet"}</span>
              </div>
            ))}
          </div>
        )}
      </header>
      <main style={{ padding: "36px 22px 56px", display: "flex", flexDirection: "column", gap: 44 }}>
        {content.summary.blocks.map(section)}
        {signoff && (
          <div style={{ paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <p className="wb-serif" style={{ margin: 0, fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>{signoff.text}</p>
            {signoff.from && <span className="wb-muted" style={{ fontSize: 14 }}>{signoff.from}</span>}
          </div>
        )}
      </main>
    </div>
  )
}
