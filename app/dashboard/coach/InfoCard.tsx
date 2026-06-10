import type { ReactNode } from "react"
import { T, eyebrow } from "@/lib/dashboard-theme"
import { Section } from "./Section"

// Dumb, presentational info card: a titled Section containing a responsive grid
// of labeled groups (each a contained block of label/value rows). Holds NO data
// knowledge — the caller pre-formats every value into a ReactNode and decides
// which rows show (show !== false). `editAffordance` is an optional slot
// rendered below the grid (e.g. an Edit button, or an inline edit form). Shared
// by the prospect ("Prospect Information") and client ("Client Information")
// detail pages.

export type InfoRow = { label: string; value: ReactNode; show?: boolean }
export type InfoGroup = { title: string; rows: InfoRow[] }

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
                background: "rgba(255,255,255,0.02)",
                border: `1px solid ${T.BORDER_SOFT}`,
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div style={{ ...eyebrow, fontSize: 9, color: T.WRN_BLUE, marginBottom: 8 }}>{g.title}</div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {shown.map((r, i) => (
                  <div
                    key={r.label}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "5px 0",
                      alignItems: "baseline",
                      borderTop: i > 0 ? `1px solid ${T.BORDER_SOFT}` : "none",
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.4, color: T.DIM, textTransform: "uppercase", width: 92, flexShrink: 0, lineHeight: "16px" }}>
                      {r.label}
                    </span>
                    <span style={{ fontSize: 13, color: T.TEXT, minWidth: 0, overflowWrap: "anywhere", lineHeight: "18px" }}>
                      {r.value}
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
