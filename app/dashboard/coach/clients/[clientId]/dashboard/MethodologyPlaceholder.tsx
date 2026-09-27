"use client"

import { T, card, eyebrow } from "../../../../../../lib/dashboard-theme"
import { SPACE, TYPE } from "../../../../../../lib/theme/surfaces"

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
          color: T.INK_EMPHASIS,
          fontSize: TYPE.micro,
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

      <div style={{ ...eyebrow, color: T.DIM, fontSize: TYPE.label, marginBottom: 6 }}>
        ENGAGEMENT METHODOLOGY
      </div>
      <div style={{ fontSize: TYPE.secondary, color: T.MUTED, marginBottom: 18, maxWidth: 540, lineHeight: 1.5 }}>
        Methodology tracking coming soon — will display engagement phases and milestone progress.
      </div>

      {/* Ghost progress bar */}
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: T.GLASS,
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
                fontSize: TYPE.micro,
                fontWeight: 900,
                letterSpacing: 0.4,
                border: isCurrent
                  ? "1px solid rgba(254,176,106,0.35)"
                  : `1px solid ${T.BORDER_SOFT}`,
                background: isCurrent
                  ? "rgba(254,176,106,0.08)"
                  : T.GLASS,
                // A FUTURE PHASE IS QUIET, NOT INVISIBLE. T.BORDER is a
                // hairline colour and was being used as ink here: on the
                // light ground it measured 1.18:1, which is a label nobody
                // can read at all rather than one that recedes.
                color: isCurrent
                  ? T.INK_EMPHASIS
                  : isPast
                  ? T.DIM
                  : T.MUTED,
                opacity: isPast ? 0.55 : 1,
              }}
            >
              <span>{p.name}</span>
              <span style={{ marginLeft: 8, fontSize: TYPE.micro, opacity: 0.7 }}>{p.weeks}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
