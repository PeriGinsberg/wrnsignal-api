"use client"

// The chevron that folds a Coach Home section down to its header. Sections
// open on every load; folding is for the visit, not remembered.

import { T } from "../../../lib/dashboard-theme"

export function CollapseToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      title={open ? "Collapse" : "Expand"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, flexShrink: 0, borderRadius: 999, padding: 0,
        background: "transparent", border: `1px solid ${T.BORDER_SOFT}`,
        color: T.MUTED, cursor: "pointer",
      }}
    >
      <svg
        width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 150ms ease" }}
      >
        <path d="M6 9l6 6l6 -6" />
      </svg>
    </button>
  )
}
