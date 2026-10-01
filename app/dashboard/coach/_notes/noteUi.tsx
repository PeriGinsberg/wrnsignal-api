"use client"

// The note pieces the client page (NotesTab, AddNotePanel, EngagementsTab) and
// the prospect page share, so the two cannot drift apart again. The server
// half is lib/notes/model.ts.
//
// A note is a Session Recap or Other, optionally filed under a topic: Phase,
// Deliverable or Milestone. Topic notes also show on the record's tracker
// (TopicNotesBoard), newest first or sorted by topic. Work to do is a task,
// added with the record's Add Task button.

import { useEffect, useState } from "react"
import { T, card, eyebrow, label, selectDark, selectDarkOption } from "../../../../lib/dashboard-theme"
import { TYPE } from "../../../../lib/theme/surfaces"
import type { NoteTaskSummary } from "../../../../lib/notes/actionItems"
import type { NoteTopic, NoteType, StoredNoteType } from "../../../../lib/notes/model"

export type { NoteTaskSummary, NoteTopic, NoteType, StoredNoteType }

/** The types a coach can choose. Action Item is not one of them. */
export const NOTE_TYPE_OPTIONS: { value: NoteType; label: string }[] = [
  { value: "session_recap", label: "Session Recap" },
  { value: "other", label: "Other" },
]

/** Labels for every stored type, the retired one included: old rows still render. */
export const NOTE_TYPE_LABEL: Record<StoredNoteType, string> = {
  session_recap: "Session Recap",
  action_item: "Action Item",
  other: "Other",
}

export const NOTE_TYPE_BADGE: Record<StoredNoteType, { bg: string; color: string }> = {
  session_recap: { bg: "rgba(81,173,229,0.12)", color: T.INK_LINK },
  action_item: { bg: "rgba(254,176,106,0.12)", color: T.INK_EMPHASIS },
  other: { bg: T.BORDER_SOFT, color: T.MUTED },
}

export const NOTE_TOPIC_OPTIONS: { value: NoteTopic; label: string }[] = [
  { value: "phase", label: "Phase" },
  { value: "deliverable", label: "Deliverable" },
  { value: "milestone", label: "Milestone" },
]

export const NOTE_TOPIC_LABEL: Record<NoteTopic, string> = {
  phase: "Phase",
  deliverable: "Deliverable",
  milestone: "Milestone",
}

/**
 * The type chips, in a form or an edit row. An old action item being edited
 * shows no chip selected until the coach picks one.
 */
export function NoteTypeChips(props: { value: StoredNoteType; onChange: (t: NoteType) => void; compact?: boolean }) {
  const { value, onChange, compact } = props
  return (
    <div role="radiogroup" aria-label="Note type" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {NOTE_TYPE_OPTIONS.map((opt) => {
        const on = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(opt.value)}
            style={{
              fontSize: compact ? TYPE.label : TYPE.micro,
              fontWeight: 900,
              padding: compact ? "4px 10px" : "6px 12px",
              borderRadius: compact ? 6 : 8,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: compact ? 0.5 : 0.6,
              border: on ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
              background: on ? "rgba(254,176,106,0.1)" : T.GLASS,
              color: on ? T.INK_EMPHASIS : T.DIM,
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** The topic dropdown. "" is no topic. */
export function NoteTopicSelect(props: { value: NoteTopic | ""; onChange: (t: NoteTopic | "") => void; id: string }) {
  return (
    <label htmlFor={props.id} style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 240 }}>
      <span style={{ ...label, color: T.INK_LINK }}>TOPIC</span>
      <select
        id={props.id}
        style={{ ...selectDark, fontSize: TYPE.secondary }}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as NoteTopic | "")}
      >
        <option value="" style={selectDarkOption}>No topic</option>
        {NOTE_TOPIC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} style={selectDarkOption}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

/** A note's topic, beside its type badge. Nothing when it has none. */
export function NoteTopicChip({ topic }: { topic: NoteTopic | null | undefined }) {
  if (!topic) return null
  return (
    <span
      style={{
        border: `1px solid ${T.BORDER_SOFT}`,
        color: T.MUTED,
        fontSize: TYPE.label,
        fontWeight: 900,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        padding: "2px 9px",
        borderRadius: 999,
      }}
    >
      {NOTE_TOPIC_LABEL[topic]}
    </span>
  )
}

const STATUS_WORD: Record<NoteTaskSummary["status"], string> = {
  open: "open",
  done: "done",
  cancelled: "cancelled",
}

/**
 * Under an old action-item note: what its task is doing. The note is not
 * ticked any more; the task is, on the Tasks list.
 */
export function LegacyTaskLine({ task }: { task: NoteTaskSummary | null | undefined }) {
  if (!task) {
    return <span style={{ fontSize: TYPE.micro, color: T.DIM, fontWeight: 700 }}>Old action item</span>
  }
  const due = task.due_at
    ? ` · Due ${new Date(task.due_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
    : ""
  const who = task.assignee_name?.split(/\s+/)[0] ?? null
  return (
    <span style={{ fontSize: TYPE.micro, color: T.MUTED, fontWeight: 700 }}>
      Now a task, {STATUS_WORD[task.status]}{due}{who ? ` · ${who}` : ""}
    </span>
  )
}

export type TopicNote = {
  id: string
  topic?: NoteTopic | null
  type: StoredNoteType
  body: string
  created_at: string
}

export type TopicNoteSort = "date" | "topic"

/**
 * The order the tracker list shows. "date": newest first. "topic": Phase,
 * Deliverable, Milestone, newest first within each. Notes without a topic are
 * not on the tracker, so they never reach here.
 */
export function sortTopicNotes<N extends TopicNote>(notes: N[], by: TopicNoteSort): N[] {
  const newest = (a: N, b: N) => Date.parse(b.created_at) - Date.parse(a.created_at)
  const rank = (n: N) => NOTE_TOPIC_OPTIONS.findIndex((o) => o.value === n.topic)
  return [...notes].sort(by === "topic" ? (a, b) => rank(a) - rank(b) || newest(a, b) : newest)
}

/**
 * The record's topic notes on its tracker, as one list: newest first, or
 * grouped by topic. Each links to the note in the full list (`noteHref`).
 * Renders nothing when no note has a topic, so a tracker without any stays as
 * it was.
 */
export function TopicNotesBoard(props: { notes: TopicNote[]; noteHref: (id: string) => string }) {
  const [sortBy, setSortBy] = useState<TopicNoteSort>("date")
  const filed = props.notes.filter((n) => n.topic)
  if (!filed.length) return null
  const sorted = sortTopicNotes(filed, sortBy)
  return (
    <section aria-label="Notes by topic" style={{ ...card, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ ...eyebrow, color: T.INK_EMPHASIS }}>TOPIC NOTES</div>
        <div role="radiogroup" aria-label="Sort notes by" style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {(["date", "topic"] as const).map((k) => {
            const on = sortBy === k
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSortBy(k)}
                style={{
                  fontSize: TYPE.label,
                  fontWeight: 900,
                  padding: "4px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  border: on ? "1px solid rgba(254,176,106,0.4)" : `1px solid ${T.BORDER_SOFT}`,
                  background: on ? "rgba(254,176,106,0.1)" : T.GLASS,
                  color: on ? T.INK_EMPHASIS : T.DIM,
                }}
              >
                {k === "date" ? "Date" : "Topic"}
              </button>
            )
          })}
        </div>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {sorted.map((n) => (
          <li key={n.id} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <NoteTopicChip topic={n.topic} />
            <a
              href={props.noteHref(n.id)}
              style={{ color: T.TEXT, textDecoration: "none", fontSize: TYPE.secondary, lineHeight: "18px", flex: "1 1 220px", minWidth: 0 }}
            >
              {firstLine(n.body)}
            </a>
            <span style={{ fontSize: TYPE.micro, color: T.DIM, whiteSpace: "nowrap" }}>
              {NOTE_TYPE_LABEL[n.type]} · {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A note's first line, capped, for the board. */
export function firstLine(body: string, max = 120): string {
  const line = body.split("\n")[0].trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * Scroll to #note-<id> once the notes have rendered. A task's Go button and
 * the topic board both land here; the browser's own anchor jump fires before a
 * client-rendered list exists, so it has to be done again after load.
 */
export function useScrollToNoteHash(ready: boolean) {
  useEffect(() => {
    if (!ready || typeof window === "undefined") return
    const hash = window.location.hash
    if (!hash.startsWith("#note-")) return
    const el = document.getElementById(hash.slice(1))
    if (!el) return
    el.scrollIntoView({ block: "center" })
    el.style.outline = `2px solid ${T.WRN_ORANGE}`
    const t = setTimeout(() => { el.style.outline = "" }, 2400)
    return () => clearTimeout(t)
  }, [ready])
}
