"use client"

import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"

// Section 2 — Engagement methodology (placeholder).
// Previews the eventual feature shape: phase pills + progress bar +
// current-phase indicator. Real version tracked as Backlog Item 5.
const GHOST_PHASES = [
  { name: "Foundation", weeks: "Wk 1-2" },
  { name: "Application Strategy", weeks: "Wk 3-6" },
  { name: "Networking", weeks: "Wk 7-10" },
  { name: "Interview Prep", weeks: "Wk 11-14" },
  { name: "Offer & Close", weeks: "Wk 15+" },
]

export function MethodologyPlaceholder() {
  return (
    <section style={{ ...card, padding: 22, marginBottom: 24, position: "relative", overflow: "hidden" }}>
      {/* Coming-soon corner badge */}
      <span
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          background: "rgba(254,176,106,0.10)",
          color: T.WRN_ORANGE,
          fontSize: 9,
          fontWeight: 900,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          padding: "3px 9px",
          borderRadius: 999,
          border: "1px solid rgba(254,176,106,0.25)",
        }}
      >
        Coming Soon
      </span>

      <div style={{ ...eyebrow, color: T.DIM, fontSize: 10, marginBottom: 6 }}>
        ENGAGEMENT METHODOLOGY
      </div>
      <div style={{ fontSize: 13, color: T.MUTED, marginBottom: 18, maxWidth: 540, lineHeight: 1.5 }}>
        Methodology tracking coming soon — will display engagement phases and milestone progress.
      </div>

      {/* Ghost progress bar */}
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,0.04)",
          overflow: "hidden",
          marginBottom: 18,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "32%",
            background: "linear-gradient(90deg, rgba(254,176,106,0.25), rgba(81,173,229,0.25))",
            borderRadius: 3,
          }}
        />
      </div>

      {/* Ghost phase pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {GHOST_PHASES.map((p, i) => {
          const isCurrent = i === 1 // Application Strategy as the "current" preview
          const isPast = i === 0
          return (
            <div
              key={p.name}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: 0.4,
                border: isCurrent
                  ? "1px solid rgba(254,176,106,0.35)"
                  : `1px solid ${T.BORDER_SOFT}`,
                background: isCurrent
                  ? "rgba(254,176,106,0.08)"
                  : "rgba(255,255,255,0.025)",
                color: isCurrent
                  ? T.WRN_ORANGE
                  : isPast
                  ? T.DIM
                  : "rgba(255,255,255,0.22)",
                opacity: isPast ? 0.55 : 1,
              }}
            >
              <span>{p.name}</span>
              <span style={{ marginLeft: 8, fontSize: 9, opacity: 0.7 }}>{p.weeks}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
