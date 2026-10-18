"use client"

// components/workbook/PracticeResults.tsx
//
// The coach's Results view for a practice workbook: day completion, videos,
// knowledge checks, math, sorting, the client's own words on confidence and
// confusion, and a Sunday prep summary. COACH ONLY: imported by the coach's
// Workbooks tab and nowhere on the client side.
//
// Every line is computed from saved answers. Nothing is inferred beyond what
// the answers show; an unanswered question is reported as unanswered.

import React from "react"
import {
  answerText, gradedItems, progress, sectionDays, sectionRubric, sortMatches,
  type Block, type Evaluation, type GradedItem, type WorkbookContent,
} from "../../lib/workbook/content"

export type SundaySummary = {
  understands: string[]
  needsExplaining: string[]
  struggled: string[]
  focus: string[]
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s)

/** The four-part Sunday summary. Pure, so it is tested without a browser. */
export function sundaySummary(c: WorkbookContent, answers: Record<string, unknown>): SundaySummary {
  const who = c.client.first_name
  const graded = gradedItems(c, answers)
  const answered = graded.filter((g) => g.grade)
  const bySkill = new Map<string, GradedItem[]>()
  for (const g of answered) {
    const k = g.skill ?? "General"
    bySkill.set(k, [...(bySkill.get(k) ?? []), g])
  }
  const wrongCount = (k: string) => (bySkill.get(k) ?? []).filter((g) => g.grade === "wrong").length

  const understands: string[] = []
  const needsExplaining: string[] = []
  for (const [skill, items] of bySkill) {
    const right = items.filter((g) => g.grade === "correct").length
    if (right === items.length) understands.push(`${skill}: ${right} of ${items.length} checks right.`)
    else needsExplaining.push(`${skill}: ${right} of ${items.length} checks right. Missed: ${items.filter((g) => g.grade === "wrong").map((g) => `"${short(g.question, 70)}"`).join("; ")}`)
  }
  for (const s of c.sections) {
    for (const b of s.blocks) {
      if (b.type !== "sort") continue
      const m = sortMatches(b, answers)
      if (!m.done) continue
      const line = `${b.title ?? "Sorting"}: matched the sample on ${m.matched} of ${m.total}.`
      ;(m.matched / m.total >= 0.75 ? understands : needsExplaining).push(line)
    }
  }
  const confusing = (c.results?.confusing ?? []).map((k) => answerText(answers[k])).filter(Boolean)
  for (const t of confusing) needsExplaining.push(`In ${who}'s words: "${t}"`)

  const struggled: string[] = []
  for (const g of answered.filter((x) => x.grade === "wrong")) {
    struggled.push(`${g.kind === "numeric" ? "Math" : "Reasoning"}: "${short(g.question)}" ${who} answered ${g.answer}; expected ${g.expected}.`)
  }
  const mathAnswered = answered.filter((g) => g.kind === "numeric")
  if (!struggled.some((x) => x.startsWith("Math")) && mathAnswered.length) {
    struggled.push(`No math misses on the ${mathAnswered.length} math question${mathAnswered.length === 1 ? "" : "s"} ${who} answered.`)
  }

  const focus: string[] = []
  const ranked = [...bySkill.keys()].filter((k) => wrongCount(k) > 0).sort((a, b) => wrongCount(b) - wrongCount(a))
  for (const k of ranked) focus.push(`${k} (${wrongCount(k)} missed)`)
  for (const k of c.results?.practice ?? []) {
    const t = answerText(answers[k])
    if (t) focus.push(`${who} asked to practice: "${t}"`)
  }
  const conf = c.results?.confidence ? answerText(answers[c.results.confidence]) : ""
  if (conf) focus.push(`${who}'s confidence rating: ${conf}`)
  const prog = progress(c, answers)
  const unfinished = c.sections.filter((s) => !prog.sectionsDone.has(s.id))
  if (unfinished.length) focus.push(`Not finished yet: ${unfinished.map((s) => `${String(s.number).padStart(2, "0")} ${s.title}`).join(", ")}`)

  const none = "Not enough answers yet to say."
  return {
    understands: understands.length ? understands : [none],
    needsExplaining: needsExplaining.length ? needsExplaining : [answered.length ? `Nothing flagged by ${who}'s answers so far.` : none],
    struggled: struggled.length ? struggled : [none],
    focus: focus.length ? focus : [none],
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="wb-card-soft" style={{ gap: 12, padding: 22 }}>
      <h2 className="wb-serif" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: string[] }) {
  return <ul className="wb-ul">{items.map((x, i) => <li key={i}><span style={{ fontSize: 16 }}>{x}</span></li>)}</ul>
}

function GradeTag({ g }: { g: GradedItem["grade"] }) {
  if (!g) return <span className="wb-tag draft">Not answered</span>
  return g === "correct" ? <span className="wb-tag ok">Right</span> : <span className="wb-tag review">Missed</span>
}

function GradedTable({ items, first }: { items: GradedItem[]; first: string }) {
  if (!items.length) return <span className="wb-muted">None in this workbook.</span>
  return (
    <div className="wb-table-wrap">
      <table className="wb-table">
        <thead><tr><th>Module</th><th>Question</th><th>{first}&rsquo;s answer</th><th>Result</th><th>Expected</th></tr></thead>
        <tbody>
          {items.map((g, i) => (
            <tr key={i}>
              <td>{g.sectionTitle}</td>
              <td>{g.question}</td>
              <td>{g.answer || <span className="wb-muted">-</span>}</td>
              <td><GradeTag g={g.grade} /></td>
              <td>{g.expected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PracticeResults({ content: c, answers, evaluations = [] }: {
  content: WorkbookContent; answers: Record<string, unknown>; evaluations?: Evaluation[]
}) {
  const first = c.client.first_name
  const prog = progress(c, answers)
  const graded = gradedItems(c, answers)
  const blocks = c.sections.flatMap((s) => s.blocks.map((b) => ({ s, b })))
  const videos = blocks.filter((x): x is { s: typeof x.s; b: Extract<Block, { type: "video" }> } => x.b.type === "video")
  const sorts = blocks.filter((x): x is { s: typeof x.s; b: Extract<Block, { type: "sort" }> } => x.b.type === "sort")
  const summary = sundaySummary(c, answers)
  const words = (keys: string[] | undefined) => (keys ?? []).map((k) => answerText(answers[k])).filter(Boolean)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100, margin: "0 auto", padding: "24px 28px 64px" }}>
      <p className="wb-callout paleblue" style={{ margin: 0, padding: "14px 18px", fontSize: 16 }}>
        Coach only. Built from {first}&rsquo;s saved answers. Knowledge checks and math lock on the first answer, so these are first attempts.
      </p>

      {c.sections.map((s) => {
        const r = sectionRubric(s)
        if (!r) return null
        const ev = evaluations.find((e) => e.section_id === s.id)
        const label = (k: string | null | undefined) => r.scale.find((x) => x.key === k)?.label ?? "Not rated"
        return (
          <Panel key={s.id} title={`Coach evaluation: ${s.title}`}>
            {!ev && <p className="wb-p wb-muted" style={{ margin: 0 }}>Not rated yet. Rate it from the Review screen.</p>}
            {ev && (
              <>
                <table className="wb-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th scope="col" style={{ textAlign: "left" }}>Skill</th><th scope="col" style={{ textAlign: "left" }}>Rating</th><th scope="col" style={{ textAlign: "left" }}>Note</th></tr></thead>
                  <tbody>
                    {r.items.map((it) => (
                      <tr key={it.key}>
                        <td>{it.label}</td>
                        <td style={{ fontWeight: 600 }}>{label(ev.ratings[it.key]?.rating)}</td>
                        <td>{ev.ratings[it.key]?.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ev.note && <p className="wb-p" style={{ margin: 0, whiteSpace: "pre-wrap" }}><strong>Overall:</strong> {ev.note}</p>}
                {ev.updated_at && <span className="wb-muted" style={{ fontSize: 13 }}>Last saved {new Date(ev.updated_at).toLocaleString()}</span>}
              </>
            )}
          </Panel>
        )
      })}

      <Panel title="Sunday prep summary">
        <span className="wb-eyebrow-ink">1. What {first} appears to understand</span>
        <Bullets items={summary.understands} />
        <span className="wb-eyebrow-ink">2. Where {first} may need more explanation</span>
        <Bullets items={summary.needsExplaining} />
        <span className="wb-eyebrow-ink">3. Where {first} struggled with math or reasoning</span>
        <Bullets items={summary.struggled} />
        <span className="wb-eyebrow-ink">4. What to spend Sunday on</span>
        <Bullets items={summary.focus} />
      </Panel>

      <Panel title="Completion">
        {sectionDays(c).map((d) => {
          const done = d.sections.filter((s) => prog.sectionsDone.has(s.id)).length
          return (
            <div key={d.day || "_"} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>
                {d.day || "Sections"}: {done === d.sections.length ? "Complete" : done ? "In progress" : "Not started"} ({done} of {d.sections.length})
              </span>
              <span className="wb-muted" style={{ fontSize: 15 }}>
                {d.sections.map((s) => `${String(s.number).padStart(2, "0")} ${s.title}${prog.sectionsDone.has(s.id) ? " (done)" : ""}`).join(" · ")}
              </span>
            </div>
          )
        })}
      </Panel>

      <Panel title="Videos">
        {videos.length ? videos.map(({ b }) => (
          <div key={b.key} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {answers[b.key] === "1" ? <span className="wb-tag ok">Watched</span> : <span className="wb-tag draft">Not yet</span>}
            <span>{b.title}</span>
          </div>
        )) : <span className="wb-muted">None in this workbook.</span>}
      </Panel>

      <Panel title={`${first}'s confidence and questions`}>
        <span className="wb-eyebrow-ink">Confidence</span>
        <span>{(c.results?.confidence && answerText(answers[c.results.confidence])) || <span className="wb-muted">Not answered yet</span>}</span>
        <span className="wb-eyebrow-ink">What is confusing</span>
        {words(c.results?.confusing).length ? <Bullets items={words(c.results?.confusing)} /> : <span className="wb-muted">Not answered yet</span>}
        <span className="wb-eyebrow-ink">What {first} wants to practice on Sunday</span>
        {words(c.results?.practice).length ? <Bullets items={words(c.results?.practice)} /> : <span className="wb-muted">Not answered yet</span>}
      </Panel>

      <Panel title="Knowledge checks">
        <GradedTable first={first} items={graded.filter((g) => g.kind === "quiz")} />
      </Panel>

      <Panel title="Math">
        <GradedTable first={first} items={graded.filter((g) => g.kind === "numeric")} />
      </Panel>

      {sorts.length > 0 && (
        <Panel title="Sorting">
          {sorts.map(({ b }) => {
            const m = sortMatches(b, answers)
            return (
              <div key={b.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontWeight: 700 }}>{b.title ?? "Sorting"}: {m.done ? `matched the sample on ${m.matched} of ${m.total}` : "not finished"}</span>
                {b.items.map((it, i) => {
                  const v = answerText(answers[`${b.key}.${i + 1}`])
                  return (
                    <span key={i} style={{ fontSize: 15 }}>
                      {it.text}: <b>{v || "-"}</b>{v && v !== it.category ? ` (sample: ${it.category})` : ""}
                    </span>
                  )
                })}
              </div>
            )
          })}
        </Panel>
      )}
      <p className="wb-muted" style={{ margin: 0, fontSize: 15 }}>Written answers are in Review, section by section, where you can comment on them.</p>
    </div>
  )
}
