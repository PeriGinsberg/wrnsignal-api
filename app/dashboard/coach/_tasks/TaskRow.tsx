"use client"

// One task, as a table row. Used by the full list and, condensed, by the
// Action Items card on the coach dashboard, so the two cannot drift apart.
//
// LAYOUT IS CSS GRID DRIVEN BY CLASSES, NOT INLINE STYLES. Everything else on
// this dashboard styles inline, and inline styles cannot express a media
// query. The rows have to stack into cards below tablet width, so the grid
// lives in TaskRowStyles below and the page renders it once. Four other
// dashboard files already use a <style> tag this way.

import type { CSSProperties } from "react"
import { T } from "../../../../lib/dashboard-theme"
import { isDueToday, isOverdue, type Task } from "../../../../lib/tasks/model"
import { formatDue } from "./taskClient"

export const TASK_GRID_COLUMNS = "28px minmax(0, 1fr) 150px 130px 140px 96px 40px 76px"
// No status column in the condensed form. The card it serves shows only open
// work, so an "Open" pill on every row states a constant, and it was costing
// the title the width it needed: at dashboard column width the titles were
// rendering as "le...", "ge...", "Fi...".
export const TASK_GRID_COLUMNS_CONDENSED = "24px minmax(0, 1fr) 104px 80px"

/** Rendered once per page. Owns the grid and the stack-below-tablet behaviour. */
export function TaskRowStyles() {
  return (
    <style>{`
      .tsk-grid {
        display: grid;
        grid-template-columns: ${TASK_GRID_COLUMNS};
        align-items: center;
        gap: 12px;
      }
      .tsk-grid--condensed { grid-template-columns: ${TASK_GRID_COLUMNS_CONDENSED}; }
      .tsk-head { border-bottom: 1px solid ${T.BORDER_SOFT}; padding: 0 14px 8px 14px; }
      .tsk-row { padding: 12px 14px; border-radius: 10px; background: ${T.CARD}; }
      .tsk-row + .tsk-row { margin-top: 8px; }
      .tsk-cell-label { display: none; }

      /* Below tablet the grid becomes a card: each cell on its own line with
         the column header repeated as a label, because a bare initials avatar
         with no column above it is unreadable. */
      @media (max-width: 760px) {
        .tsk-head { display: none; }
        .tsk-grid, .tsk-grid--condensed {
          grid-template-columns: 28px minmax(0, 1fr);
          row-gap: 8px;
        }
        .tsk-row { padding: 14px; }
        .tsk-cell {
          grid-column: 2;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tsk-cell-label {
          display: inline;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${T.TASK_HEADER};
          min-width: 74px;
        }
        .tsk-actions { justify-content: flex-start; }
      }
    `}</style>
  )
}

const HEADERS = ["", "Task", "Client", "Assignee", "Due", "Status", "Source", ""]
const HEADERS_CONDENSED = ["", "Task", "Client", "Due"]

export function TaskRowHeader({ condensed = false }: { condensed?: boolean }) {
  const labels = condensed ? HEADERS_CONDENSED : HEADERS
  return (
    <div className={`tsk-grid tsk-head${condensed ? " tsk-grid--condensed" : ""}`}>
      {labels.map((h, i) => (
        <div key={i} style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: T.TASK_HEADER,
          fontWeight: 700,
        }}>
          {h}
        </div>
      ))}
    </div>
  )
}

/** Initials for the avatar. Two letters at most, from the first two words. */
function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "?"
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase()
}

// Avatar colours, drawn from the palette and given as rgb triples so the tint
// and the text can share one hue.
//
// ORANGE IS NOT IN HERE. It is reserved for overdue, and an avatar that
// happened to hash orange would read as a warning about a person.
//
// The colour is chosen by hashing the name, so it is stable: the same client is
// the same colour on every row, every visit, with nothing stored. Sorting or
// filtering the list cannot reshuffle the colours, which a rotating index would.
const AVATAR_RGB: Array<[number, number, number]> = [
  [0, 155, 255],    // TASK_HEADER blue
  [0, 179, 179],    // TASK_DONE teal
  [236, 72, 153],   // WRN_PINK
  [212, 164, 68],   // GOLD
  [81, 173, 229],   // WRN_BLUE
  [33, 140, 140],   // WRN_TEAL
  [74, 222, 128],   // SUCCESS green
]
// TASK_OPEN ice (#B6F2F8) was in this list and came out. At avatar size it
// reads as near-white rather than as a colour, and it is already the Open
// pill's outline, so the same hue was doing two unrelated jobs on one row.

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h
}

function Avatar({ name, title }: { name: string; title?: string }) {
  const [r, g, b] = AVATAR_RGB[hashName(name.toLowerCase()) % AVATAR_RGB.length]
  return (
    <span
      title={title ?? name}
      style={{
        flex: "0 0 auto",
        width: 24, height: 24, borderRadius: "50%",
        background: `rgba(${r},${g},${b},0.18)`,
        border: `1px solid rgba(${r},${g},${b},0.55)`,
        color: `rgb(${r},${g},${b})`,
        fontSize: 10, fontWeight: 700,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {initials(name)}
    </span>
  )
}

function Person({ name, label, fullName }: { name: string | null; label: string; fullName?: string | null }) {
  if (!name) {
    return <span style={{ color: T.DIM, fontSize: 12 }}>{label}</span>
  }
  // The avatar hashes the FULL name even when only the first is shown, so a
  // client keeps one colour across the condensed and full rows.
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <Avatar name={fullName || name} title={fullName || name} />
      <span style={{
        color: T.MUTED, fontSize: 12,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {name}
      </span>
    </span>
  )
}

/**
 * The due date, as a chip when it needs attention and as plain muted text when
 * it does not.
 *
 * Overdue is the only orange on the row, and it is a chip and a border, never
 * body text.
 */
function DueCell({ task }: { task: Task }) {
  const late = isOverdue(task)
  const today = isDueToday(task)
  const text = formatDue(task)

  if (!late && !today) {
    return <span style={{ color: T.MUTED, fontSize: 12 }}>{text}</span>
  }
  const color = late ? T.TASK_OVERDUE : T.TASK_HEADER
  const bg = late ? "rgba(255,107,0,0.14)" : "rgba(0,155,255,0.14)"
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 9px", borderRadius: 999,
      background: bg, color, fontSize: 11, fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      {late ? "Overdue" : text}
    </span>
  )
}

function StatusPill({ task }: { task: Task }) {
  const base: CSSProperties = {
    display: "inline-block", padding: "3px 10px", borderRadius: 999,
    fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
  }
  if (task.status === "done") {
    return <span style={{ ...base, background: "rgba(0,179,179,0.18)", color: T.TASK_DONE }}>Done</span>
  }
  if (task.status === "cancelled") {
    return <span style={{ ...base, background: T.GLASS, color: T.DIM }}>Cancelled</span>
  }
  return (
    <span style={{ ...base, background: "transparent", color: T.TASK_OPEN, border: `1px solid ${T.TASK_OPEN}` }}>
      Open
    </span>
  )
}

/**
 * Lightning when a rule made this, nothing when a person did.
 *
 * THERE IS NO MANUAL ICON. A pencil was here, and on a row that also carries a
 * pencil for Edit it read as a second button. Added-by-a-person is the default
 * anyway, so the absence says it: the icon now means "something you did not
 * type", which is the only case worth a glance.
 */
function SourceIcon({ task }: { task: Task }) {
  if (task.source !== "auto") return null
  const title = "Created automatically by a rule"
  return (
    <span title={title} aria-label={title} style={{ display: "inline-flex", color: T.DIM }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />
      </svg>
    </span>
  )
}

function IconButton(props: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: 4,
        display: "inline-flex", color: props.danger ? T.ERROR : T.MUTED,
      }}
    >
      {props.children}
    </button>
  )
}

export type TaskRowProps = {
  task: Task
  clientName?: string | null
  assigneeName?: string | null
  condensed?: boolean
  busy?: boolean
  onToggleDone: (task: Task, next: boolean) => void
  onEdit?: (task: Task) => void
  onDelete?: (task: Task) => void
}

export function TaskRow(props: TaskRowProps) {
  const { task, condensed = false } = props
  const late = isOverdue(task)
  const done = task.status === "done"

  // The first line of the description, as a snippet. Kept to one line by CSS
  // ellipsis rather than by slicing, so a long word cannot break the layout
  // and nothing is lost from the stored text.
  const snippet = (task.description ?? "").split(/\r?\n/).find((l) => l.trim()) ?? ""

  return (
    <div
      className={`tsk-grid tsk-row${condensed ? " tsk-grid--condensed" : ""}`}
      style={{ borderLeft: `3px solid ${late ? T.TASK_OVERDUE : "transparent"}` }}
    >
      {/* Complete. Unticking reopens, which is why it is a real checkbox bound
          to status rather than a one-way "done" button. */}
      <input
        type="checkbox"
        checked={done}
        disabled={props.busy}
        onChange={(e) => props.onToggleDone(task, e.target.checked)}
        aria-label={done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        title={done ? "Reopen this task" : "Mark done"}
        style={{ cursor: "pointer", accentColor: T.TASK_DONE, width: 16, height: 16 }}
      />

      <div className="tsk-cell" style={{ minWidth: 0, display: "block" }}>
        <div style={{
          fontSize: 14,
          color: done ? T.MUTED : T.TEXT,
          textDecoration: done ? "line-through" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {task.title}
        </div>
        {snippet && (
          <div style={{
            fontSize: 12, color: T.DIM, marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {snippet}
          </div>
        )}
      </div>

      {/* Client shows in BOTH forms. On the dashboard card a task without
          one is just a sentence with no owner, and "whose is this" is the
          first thing a coach asks of a list spanning every client. */}
      <div className="tsk-cell" style={{ minWidth: 0 }}>
        <span className="tsk-cell-label">Client</span>
        <Person
          name={condensed
            ? (props.clientName ? props.clientName.split(/\s+/)[0] : null)
            : (props.clientName ?? null)}
          fullName={props.clientName ?? null}
          label="No client"
        />
      </div>

      {!condensed && (
        <div className="tsk-cell" style={{ minWidth: 0 }}>
          <span className="tsk-cell-label">Assignee</span>
          <Person name={props.assigneeName ?? null} label="Unassigned" />
        </div>
      )}

      <div className="tsk-cell">
        <span className="tsk-cell-label">Due</span>
        <DueCell task={task} />
      </div>

      {!condensed && (
        <div className="tsk-cell">
          <span className="tsk-cell-label">Status</span>
          <StatusPill task={task} />
        </div>
      )}

      {!condensed && (
        <div className="tsk-cell">
          <span className="tsk-cell-label">Source</span>
          <SourceIcon task={task} />
        </div>
      )}

      {!condensed && (
        <div className="tsk-cell tsk-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
          {props.onEdit && (
            <IconButton title="Edit task" onClick={() => props.onEdit!(task)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </IconButton>
          )}
          {props.onDelete && (
            <IconButton title="Delete task" danger onClick={() => props.onDelete!(task)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </IconButton>
          )}
        </div>
      )}
    </div>
  )
}
