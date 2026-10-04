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
import { SPACE, TYPE } from "../../../../lib/theme/surfaces"
import { isDueToday, isOverdue, type Task } from "../../../../lib/tasks/model"
import { formatDue } from "./taskClient"

export const TASK_GRID_COLUMNS = "28px minmax(0, 1fr) 150px 130px 140px 96px 40px 76px"
// No status column in the condensed form. The card it serves shows only open
// work, so an "Open" pill on every row states a constant, and it was costing
// the title the width it needed: at dashboard column width the titles were
// rendering as "le...", "ge...", "Fi...".
// Action is its own column so Go sits on its task's row; as a fifth cell in a
// four-column grid it wrapped onto a line of its own.
export const TASK_GRID_COLUMNS_CONDENSED = "24px minmax(0, 1fr) 160px 110px 76px"

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
      .tsk-head { border-bottom: 1px solid ${T.BORDER_SOFT}; padding: 0 ${SPACE.cell}px 10px ${SPACE.cell}px; }
      /* ~52px, the density GoHighLevel's Tasks table uses. A row a coach reads
         all day needs the height as much as it needs the type size. */
      .tsk-row {
        min-height: ${SPACE.row}px;
        padding: 8px ${SPACE.cell}px;
        border-radius: 10px;
        background: ${T.CARD};
      }
      .tsk-grid--condensed .tsk-row, .tsk-row.tsk-grid--condensed { min-height: ${SPACE.rowCondensed}px; }
      .tsk-row + .tsk-row { margin-top: 8px; }
      .tsk-cell-label { display: none; }
      /* Condensed rows run full page width on Coach Home, so the title and its
         detail line wrap rather than truncate. Below tablet they truncate. */
      .tsk-grid--condensed .tsk-line { white-space: normal !important; overflow-wrap: anywhere; }

      /* Below tablet the grid becomes a card: each cell on its own line with
         the column header repeated as a label, because a bare initials avatar
         with no column above it is unreadable. */
      @media (max-width: 760px) {
        .tsk-head { display: none; }
        .tsk-grid, .tsk-grid--condensed {
          grid-template-columns: 28px minmax(0, 1fr);
          row-gap: 8px;
        }
        .tsk-row { padding: 14px; min-height: 0; }
        .tsk-cell {
          grid-column: 2;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tsk-cell-label {
          display: inline;
          font-size: ${TYPE.label}px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${T.TASK_HEADER};
          min-width: 74px;
        }
        .tsk-actions { justify-content: flex-start; }
        .tsk-grid--condensed .tsk-line { white-space: nowrap !important; }
      }
    `}</style>
  )
}

const HEADERS = ["", "Task", "Client", "Assignee", "Due", "Status", "Source", ""]
const HEADERS_CONDENSED = ["", "Task", "Client", "Due", "Action"]

export function TaskRowHeader({ condensed = false }: { condensed?: boolean }) {
  const labels = condensed ? HEADERS_CONDENSED : HEADERS
  return (
    <div className={`tsk-grid tsk-head${condensed ? " tsk-grid--condensed" : ""}`}>
      {labels.map((h, i) => (
        <div key={i} style={{
          fontSize: TYPE.label,
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
  [45, 212, 191],  // SUCCESS teal, formerly a green and the one member off palette
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
        background: `rgba(${r},${g},${b},var(--sig-avatar-wash, 0.18))`,
        border: `1px solid rgba(${r},${g},${b},0.55)`,
        // THE HUE SURVIVES, THE LIGHTNESS DOES NOT.
        //
        // At 18% over navy these read as a saturated letter on a dark
        // wash. Over white the same wash is nearly white and the same
        // ink measures 1.0 against it: the initials are simply gone.
        // Rather than a second palette to keep in step, the ink is
        // mixed toward navy by an amount the ground sets, which is 0%
        // on dark and enough to clear 4.5:1 on light.
        color: `color-mix(in srgb, rgb(${r},${g},${b}) calc(100% - var(--sig-avatar-darken, 0%)), #13294A)`,
        fontSize: TYPE.micro, fontWeight: 700,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {initials(name)}
    </span>
  )
}

/**
 * A name with its avatar, optionally linked.
 *
 * THE LINK IS ON THE NAME, NOT THE ROW. A whole-row link would swallow the
 * checkbox, the Approve buttons and the edit and delete icons, and a coach
 * aiming at any of those would land on a client page instead. The name is the
 * part that means "this client", so the name is the part that navigates.
 *
 * stopPropagation because the row may gain its own click handler later; a
 * navigation that also fires the row's action would do two things for one
 * click.
 */
function Person({ name, label, fullName, href }: {
  name: string | null; label: string; fullName?: string | null; href?: string | null
}) {
  if (!name) {
    return <span style={{ color: T.DIM, fontSize: 12 }}>{label}</span>
  }
  // The avatar hashes the FULL name even when only the first is shown, so a
  // client keeps one colour across the condensed and full rows.
  const inner = (
    <>
      <Avatar name={fullName || name} title={fullName || name} />
      <span style={{
        color: T.MUTED, fontSize: TYPE.secondary,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {name}
      </span>
    </>
  )
  const shell: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0,
  }
  if (!href) return <span style={shell}>{inner}</span>
  return (
    <a
      href={href}
      title={`Open ${fullName || name}`}
      onClick={(e) => e.stopPropagation()}
      style={{ ...shell, textDecoration: "none", cursor: "pointer" }}
      onMouseEnter={(e) => {
        const label = e.currentTarget.querySelector("span:last-child") as HTMLElement | null
        if (label) label.style.color = T.TEXT
      }}
      onMouseLeave={(e) => {
        const label = e.currentTarget.querySelector("span:last-child") as HTMLElement | null
        if (label) label.style.color = T.MUTED
      }}
    >
      {inner}
    </a>
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
    return <span style={{ color: T.MUTED, fontSize: TYPE.secondary }}>{text}</span>
  }
  // THE FILL IS THE BRAND ORANGE, THE WORD IS NOT.
  //
  // Orange draws the chip and the row border, which is exactly what orange is
  // for. Setting the label in it measured 1.0:1 against its own fill on the
  // light ground: a chip with nothing legible in it. The ink follows the
  // ground through a variable; the fill does not need to, because a 14% wash
  // over navy and a pale tint on white both read as "orange chip".
  const color = late
    ? "var(--sig-chip-overdue-ink, " + T.TASK_OVERDUE + ")"
    : "var(--sig-chip-due-ink, " + T.TASK_HEADER + ")"
  // The fill strength follows the ground too. 14% over navy is a
  // legible chip; 14% over white is not a chip at all, and the ink then
  // sits on the card rather than on a fill.
  const bg = late
    ? "rgba(255,107,0,var(--sig-chip-wash, 0.14))"
    : "rgba(0,155,255,var(--sig-chip-wash, 0.14))"
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 9px", borderRadius: 999,
      background: bg, color, fontSize: TYPE.secondary, fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      {late ? "Overdue" : text}
    </span>
  )
}

function StatusPill({ task }: { task: Task }) {
  const base: CSSProperties = {
    display: "inline-block", padding: "4px 11px", borderRadius: 999,
    fontSize: TYPE.micro, fontWeight: 700, whiteSpace: "nowrap",
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

/**
 * Where the work is done.
 *
 * Renders nothing without a link, which is the whole distinction the `link`
 * column exists to draw: a system task always has one, a hand-written task has
 * one only if its author added it. An always-present button that sometimes did
 * nothing would erase that.
 */
function GoButton({ task }: { task: Task }) {
  if (!task.link) return null
  return (
    <a
      href={task.link}
      title={`Open where "${task.title}" is done`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        minHeight: SPACE.control, padding: "0 14px", borderRadius: 8,
        fontSize: TYPE.control, fontWeight: 800, textDecoration: "none",
        border: `1px solid ${T.BORDER_SOFT}`, background: "transparent",
        color: T.INK_LINK, marginRight: 8, whiteSpace: "nowrap",
      }}
    >
      Go
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14" />
        <path d="M13 6l6 6-6 6" />
      </svg>
    </a>
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

/** Marks a task about a prospect rather than a client. */
function ProspectBadge() {
  return (
    <span
      title="This task is about a prospect"
      style={{
        flexShrink: 0, fontSize: 10, fontWeight: 900, letterSpacing: 0.4,
        padding: "1px 7px", borderRadius: 999,
        background: "rgba(167,139,250,0.18)", color: "var(--sig-avatar-2-ink, #C8B6F8)",
        border: "1px solid rgba(167,139,250,0.40)",
      }}
    >
      Prospect
    </span>
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
  /**
   * The decisions this task is closed with, from its template.
   *
   * A REVIEW TASK HAS NO CHECKBOX. "Review Networking Campaign" is finished by
   * approving it or sending it back, and those do different things: one
   * creates the next task, the other reopens the previous one with a note. A
   * tick cannot say which, so the row shows the two buttons instead.
   */
  decisionOptions?: string[] | null
  onDecide?: (task: Task, decision: string) => void
}

export function TaskRow(props: TaskRowProps) {
  const { task, condensed = false } = props
  // A client's name comes from their profile; a prospect has none, so the list
  // route sends the relationship's own name instead (task.record).
  const whoName = props.clientName ?? task.record?.name ?? null
  const late = isOverdue(task)
  const done = task.status === "done"
  const decides = !done && !!props.onDecide && !!props.decisionOptions?.length

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
          to status rather than a one-way "done" button.

          A decision task gets a marker in its place rather than a disabled
          checkbox: a greyed tick promises that some permission would unlock it,
          and none would. The buttons at the end of the row are the way. */}
      {decides ? (
        <span
          title="This task is closed by approving it or sending it back"
          aria-hidden="true"
          style={{
            width: 10, height: 10, borderRadius: "50%", display: "inline-block",
            border: `2px solid ${T.WRN_ORANGE}`, margin: "0 3px",
          }}
        />
      ) : (
      <input
        type="checkbox"
        checked={done}
        disabled={props.busy}
        onChange={(e) => props.onToggleDone(task, e.target.checked)}
        aria-label={done ? `Reopen "${task.title}"` : `Mark "${task.title}" done`}
        title={done ? "Reopen this task" : "Mark done"}
        style={{ cursor: "pointer", accentColor: T.TASK_DONE, width: 18, height: 18 }}
      />
      )}

      <div className="tsk-cell" style={{ minWidth: 0, display: "block" }}>
        <div className="tsk-line" style={{
          fontSize: TYPE.body,
          color: done ? T.MUTED : T.TEXT,
          textDecoration: done ? "line-through" : "none",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {task.title}
        </div>
        {snippet && (
          <div className="tsk-line" style={{
            fontSize: TYPE.secondary, color: T.MUTED, marginTop: 3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {snippet}
          </div>
        )}
      </div>

      {/* Client shows in BOTH forms. On the dashboard card a task without
          one is just a sentence with no owner, and "whose is this" is the
          first thing a coach asks of a list spanning every client. */}
      <div className="tsk-cell" style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <span className="tsk-cell-label">Client</span>
        <Person
          name={whoName}
          fullName={whoName}
          label="No client"
          href={task.client_profile_id ? `/dashboard/coach/clients/${task.client_profile_id}` : task.record?.href ?? null}
        />
        {task.record?.kind === "prospect" && <ProspectBadge />}
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

      {/* ON THE CONDENSED CARD TOO. The dashboard's five-task list is the one
          most coaches read first, and it is the surface where "which screen
          does this mean" costs the most, because there is no room for the
          description that used to carry the hint. Go only; edit and delete
          stay on the full list. */}
      {condensed && (
        <div className="tsk-cell tsk-actions" style={{ display: "flex", justifyContent: "flex-end" }}>
          {task.link && <span className="tsk-cell-label">Action</span>}
          <GoButton task={task} />
        </div>
      )}

      {!condensed && (
        <div className="tsk-cell tsk-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 2, alignItems: "center" }}>
          {/* GO, BEFORE THE DECISION BUTTONS. Approve and Request changes are
              answers; Go is how you get to the thing you are answering about.
              A real <a>, not a router push, so middle-click and open-in-new-tab
              behave: a coach working a list wants the task to still be there
              when they come back. */}
          <GoButton task={task} />
          {decides && props.decisionOptions!.includes("approve") && (
            <button
              onClick={() => props.onDecide!(task, "approve")}
              disabled={props.busy}
              style={{
                minHeight: SPACE.control, padding: "0 16px", borderRadius: 8,
                fontSize: TYPE.control, fontWeight: 800, cursor: "pointer",
                border: "none", background: T.TASK_DONE, color: T.INK_ON_ACCENT, marginRight: 6,
                opacity: props.busy ? 0.6 : 1,
              }}
            >Approve</button>
          )}
          {decides && props.decisionOptions!.includes("request_changes") && (
            <button
              onClick={() => props.onDecide!(task, "request_changes")}
              disabled={props.busy}
              style={{
                minHeight: SPACE.control, padding: "0 16px", borderRadius: 8,
                fontSize: TYPE.control, fontWeight: 800, cursor: "pointer",
                border: `1px solid ${T.BORDER_SOFT}`, background: "transparent", color: T.MUTED,
                marginRight: 8, opacity: props.busy ? 0.6 : 1,
              }}
            >Request changes</button>
          )}
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
