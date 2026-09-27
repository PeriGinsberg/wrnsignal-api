"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { T, eyebrow } from "@/lib/dashboard-theme"
import { TYPE } from "@/lib/theme/surfaces"
import { Section } from "./Section"

// Dumb, presentational info card: a titled Section containing a responsive grid
// of labeled groups (each a contained block of label/value rows). Holds NO data
// knowledge — the caller pre-formats every value into a ReactNode and decides
// which rows show (show !== false). `editAffordance` is an optional slot
// rendered below the grid (e.g. an Edit button, or an inline edit form). Shared
// by the prospect ("Prospect Information") and client ("Client Information")
// detail pages.
//
// "use client" since 2026-09-27: `clamp` needs a hook to measure whether the
// value actually overflows. Both callers were already client components.

export type InfoRow = {
  label: string
  value: ReactNode
  show?: boolean
  /**
   * Cap the value at this many lines, with a "more" toggle.
   *
   * FOR THE ONE FIELD THAT IS A LIST PRETENDING TO BE A SENTENCE. A client
   * targeting ten role titles turns the header into four lines of prose before
   * the tabs, and the header is meant to be glanceable. Two lines is enough to
   * recognise what somebody is looking for; the rest is on request.
   */
  clamp?: number
}
export type InfoGroup = { title: string; rows: InfoRow[] }

/**
 * A value capped at `lines`, with a toggle only when it is actually cut off.
 *
 * MEASURED, NOT ASSUMED. Showing "more" on a value that already fits is a
 * control that does nothing, and a reader who clicks it once and sees no change
 * stops trusting the rest of the page. scrollHeight against clientHeight is the
 * only honest test, and it has to run after layout and again on resize, because
 * the same ten roles fit on two lines in a wide column and five in a narrow one.
 */
function ClampedValue({ lines, children }: { lines: number; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // Only meaningful while clamped: expanded, scrollHeight equals
      // clientHeight by definition and the toggle would vanish mid-read.
      if (expanded) return
      setOverflows(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [expanded, children])

  return (
    <span style={{ minWidth: 0 }}>
      <span
        ref={ref}
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: expanded ? "unset" : lines,
          overflow: "hidden",
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </span>
      {(overflows || expanded) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "none", border: "none", padding: "2px 0 0 0",
            color: T.WRN_BLUE, fontSize: TYPE.secondary, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {expanded ? "Show less" : "More"}
        </button>
      )}
    </span>
  )
}

export function InfoCard({
  title,
  groups,
  editAffordance,
}: {
  title: string
  groups: InfoGroup[]
  editAffordance?: ReactNode
}) {
  return (
    <Section title={title}>
      {/* Groups flow in a responsive multi-column grid so a populated record
          reads as a dense profile card and a sparse one shows just a couple of
          compact blocks — no acres of empty grid. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, alignItems: "start" }}>
        {groups.map((g) => {
          const shown = g.rows.filter((r) => r.show !== false)
          if (shown.length === 0) return null
          return (
            <div
              key={g.title}
              style={{
                background: T.GLASS,
                border: `1px solid ${T.BORDER_SOFT}`,
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div style={{ ...eyebrow, fontSize: TYPE.label, color: T.WRN_BLUE, marginBottom: 8 }}>{g.title}</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {shown.map((r, i) => (
                  <div
                    key={r.label}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "6px 0",
                      alignItems: "baseline",
                      borderTop: i > 0 ? `1px solid ${T.BORDER_SOFT}` : "none",
                    }}
                  >
                    {/* The label was 10px on T.DIM, which is 2.65:1: a caption
                        nobody could read next to the value it names. */}
                    <span style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: 0.4, color: T.MUTED, textTransform: "uppercase", width: 96, flexShrink: 0, lineHeight: "18px" }}>
                      {r.label}
                    </span>
                    <span style={{ fontSize: TYPE.secondary, color: T.TEXT, minWidth: 0, overflowWrap: "anywhere", lineHeight: "20px" }}>
                      {r.clamp ? <ClampedValue lines={r.clamp}>{r.value}</ClampedValue> : r.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {editAffordance}
    </Section>
  )
}
