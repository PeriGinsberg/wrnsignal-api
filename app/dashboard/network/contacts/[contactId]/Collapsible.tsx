"use client"

// A disclosure row for the contact record's reference sections.
//
// The summary line is the point, not decoration: a collapsed drawer that only
// says "Notes" forces a click to find out whether there is anything in it, which
// is worse than the wall of open sections it replaced. "3 notes" / "nothing yet"
// means the closed state still answers the question.
//
// `defaultOpen` is read once, at mount. The parent renders these only after the
// contact has loaded, so the auto-expand decision is made against real data; and
// because it is initial state rather than a controlled prop, a later refetch
// cannot slam a drawer shut while someone is reading it.

import { useState } from "react"
import { T } from "../../../../../lib/dashboard-theme"

export function Collapsible({
  title, summary, testId, defaultOpen = false, children,
}: {
  title: string
  summary: string
  testId: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section style={{ borderTop: `1px solid ${T.BORDER_SOFT}` }} data-testid={`drawer-${testId}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid={`drawer-toggle-${testId}`}
        style={{
          display: "flex", alignItems: "baseline", gap: 10, width: "100%", textAlign: "left",
          background: "none", border: "none", padding: "14px 2px", cursor: "pointer", fontFamily: "inherit",
        }}
      >
        <span style={{ color: T.TEXT, fontSize: 12.5, fontWeight: 800, flex: "0 0 auto" }}>{title}</span>
        <span style={{ color: T.DIM, fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          data-testid={`drawer-summary-${testId}`}>
          {summary}
        </span>
        <span aria-hidden style={{ color: T.DIM, fontSize: 11, flex: "0 0 auto", transform: open ? "rotate(90deg)" : "none", transition: "transform 140ms ease" }}>
          ▶
        </span>
      </button>
      {open && <div style={{ padding: "2px 2px 20px" }} data-testid={`drawer-body-${testId}`}>{children}</div>}
    </section>
  )
}
