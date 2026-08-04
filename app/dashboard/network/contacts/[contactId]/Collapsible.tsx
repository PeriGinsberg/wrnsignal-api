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
//
// Redesign step 4: each drawer is its own white card rather than a row divided
// by a hairline, which is what the mockup shows and what stops a stack of
// reference sections reading as one undifferentiated block.

import { useState } from "react"
import { LIGHT as S } from "../../../../../lib/theme/surfaces"

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
    <section
      data-testid={`drawer-${testId}`}
      style={{
        background: S.card,
        border: `1px solid ${S.borderSoft}`,
        borderRadius: 14,
        boxShadow: S.shadow.card,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid={`drawer-toggle-${testId}`}
        style={{
          display: "flex", alignItems: "baseline", gap: 12, width: "100%", textAlign: "left",
          background: "none", border: "none", padding: "16px 20px", cursor: "pointer", fontFamily: "inherit",
        }}
      >
        <span style={{ color: S.text.primary, fontSize: 15, fontWeight: 800, flex: "0 0 auto" }}>{title}</span>
        <span
          style={{
            color: S.text.muted, fontSize: 13.5, flex: 1, minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right",
          }}
          data-testid={`drawer-summary-${testId}`}
        >
          {summary}
        </span>
        <span
          aria-hidden
          style={{
            color: S.text.dim, fontSize: 11, flex: "0 0 auto",
            transform: open ? "rotate(90deg)" : "none", transition: "transform 140ms ease",
          }}
        >
          ▶
        </span>
      </button>
      {open && (
        <div
          style={{ padding: "4px 20px 20px", borderTop: `1px solid ${S.borderSoft}` }}
          data-testid={`drawer-body-${testId}`}
        >
          <div style={{ paddingTop: 16 }}>{children}</div>
        </div>
      )}
    </section>
  )
}
