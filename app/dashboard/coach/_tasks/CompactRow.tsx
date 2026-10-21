"use client"

// One line per item, for Coach Home's My active tasks and Follow-ups due, to
// match the compact Schedule. The full Tasks page keeps TaskRow.
//
// The line: an optional checkbox, the title in navy, the description as short
// gray text cut off with "..." (full text on hover), the client's initials and
// name straight after the text, the due state as small colored text, and an
// arrow that shows on hover. The whole row opens `href`; the checkbox does not.
// When `fullDetail` holds more than the line shows, a More toggle opens it
// under the row.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { DetailsText } from "@/app/components/TaskDetails"
import { T } from "../../../../lib/dashboard-theme"
import { Avatar } from "./TaskRow"

export type CompactTone = "late" | "today" | "plain"

// Orange ink on white is 2.9:1, too faint for 12px text; this burnt orange
// clears 5:1. Today takes the due-chip blue, which already clears it.
const TONE_INK: Record<CompactTone, string> = {
  late: "#C2410C",
  today: "var(--sig-chip-due-ink, #009BFF)",
  plain: T.MUTED,
}

/** Rendered once per list. Hover and narrow-screen rules need CSS. */
export function CompactRowStyles() {
  return (
    <style>{`
      .cr-row {
        display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 14px;
        align-items: center; gap: 10px; min-height: 30px; padding: 3px 8px; border-radius: 8px;
      }
      .cr-row--nocheck { grid-template-columns: minmax(0, 1fr) auto 14px; }
      .cr-row[data-href] { cursor: pointer; }
      .cr-row[data-href]:hover, .cr-row[data-href]:focus-visible { background: ${T.ROW_HOVER}; outline: none; }
      .cr-arrow { opacity: 0; transition: opacity 120ms ease; color: ${T.MUTED}; display: inline-flex; }
      .cr-row[data-href]:hover .cr-arrow, .cr-row[data-href]:focus-visible .cr-arrow { opacity: 1; }
      .cr-main { display: flex; align-items: center; gap: 8px; min-width: 0; white-space: nowrap; }
      /* The title wraps rather than truncates; the detail line gives way first. */
      .cr-title { flex: 0 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
      .cr-detail { flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .cr-who { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; }
      .cr-more { flex: 0 0 auto; background: none; border: none; padding: 0; cursor: pointer;
        font-family: inherit; font-size: 12px; font-weight: 700; color: ${T.INK_LINK}; }
      .cr-full { grid-column: 1 / -1; padding: 0 0 6px 28px; cursor: default; white-space: normal; }
      .cr-row--nocheck .cr-full { padding-left: 0; }
      @media (max-width: 560px) {
        .cr-detail { display: none; }
        .cr-who-name { display: none; }
      }
    `}</style>
  )
}

export function CompactRow(props: {
  title: string
  detail?: string | null
  /** The whole description, opened by the More toggle. */
  fullDetail?: string | null
  who?: string | null
  /** Shown after the name, e.g. a Prospect tag. */
  whoExtra?: React.ReactNode
  meta: string
  tone: CompactTone
  href?: string | null
  checkbox?: React.ReactNode
  testId?: string
}) {
  const router = useRouter()
  const { href } = props
  function open() {
    if (!href) return
    if (/^https?:\/\//i.test(href)) window.location.assign(href)
    else router.push(href)
  }
  const hover = [props.title, props.detail].filter(Boolean).join("\n")
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const detailRef = useRef<HTMLSpanElement>(null)
  const full = (props.fullDetail ?? "").trim()
  const detail = (props.detail ?? "").trim()

  useEffect(() => {
    const el = detailRef.current
    if (!el) return
    // Below 560px the detail line is hidden (scrollWidth 0), so any
    // description counts as hidden there.
    const check = () => setOverflows(
      window.innerWidth <= 560 || el.scrollWidth > el.clientWidth + 1)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [detail])

  const canExpand = !!full && (full !== detail || overflows)
  return (
    <div
      className={`cr-row${props.checkbox ? "" : " cr-row--nocheck"}`}
      data-href={href || undefined}
      data-testid={props.testId}
      role={href ? "link" : undefined}
      tabIndex={href ? 0 : undefined}
      title={hover}
      onClick={open}
      onKeyDown={(e) => { if (href && e.key === "Enter") open() }}
    >
      {props.checkbox && (
        // The checkbox is its own control: ticking it must not also open the row.
        <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>{props.checkbox}</span>
      )}
      <span className="cr-main">
        <span className="cr-title" style={{ fontSize: 14, fontWeight: 600, color: T.INK_EMPHASIS }}>{props.title}</span>
        {props.detail && (
          <span ref={detailRef} className="cr-detail" style={{ fontSize: 12, color: T.DIM }}>{props.detail}</span>
        )}
        {canExpand && (
          <button
            type="button"
            className="cr-more"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} the full description of "${props.title}"`}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {expanded ? "Less" : "More"}
          </button>
        )}
        {props.who && (
          <span className="cr-who">
            <Avatar name={props.who} />
            <span className="cr-who-name" style={{ fontSize: 12, color: T.MUTED }}>{props.who}</span>
            {props.whoExtra}
          </span>
        )}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: TONE_INK[props.tone], whiteSpace: "nowrap" }}>{props.meta}</span>
      <span className="cr-arrow" aria-hidden="true">
        {href && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        )}
      </span>
      {expanded && (
        // Reading the text must not also open the row.
        <div className="cr-full" onClick={(e) => e.stopPropagation()}>
          <DetailsText text={full} ink={T.MUTED} />
        </div>
      )}
    </div>
  )
}
