"use client"

// Consecutive days with a task completed.
//
// A STREAK MUST NEVER SHAME. The zero state says "start one today", not "0 days"
// beside a dead flame — a counter that reads as a loss is a reason to close the
// page, and this is a coaching product, not a habit game with a punishment loop.
// The flame only lights once there is a streak to light it for.
//
// The number counts up like the hero percentage, so the two read as one system.

import { T } from "../../../../lib/dashboard-theme"
import { ACCENT, ACCENT_EDGE, ACCENT_FAINT } from "./tokens"
import { useCountUp } from "./motion"

function FlameIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3s5 4.2 5 8.4a5 5 0 0 1-10 0C7 9.6 8.4 8 9.4 7c.2 1.3.9 2.2 1.8 2.2 1 0 1.4-.9 1.1-2.3-.2-1.1-.3-2.4-.3-3.9z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
      />
    </svg>
  )
}

export function Streak({ days }: { days: number }) {
  const shown = useCountUp(days, 900)
  const alive = days > 0

  return (
    <section
      style={{
        borderRadius: 16,
        padding: "18px 20px",
        background: alive ? ACCENT_FAINT : "rgba(255,255,255,0.03)",
        border: `1px solid ${alive ? ACCENT_EDGE : T.BORDER_SOFT}`,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <span
        style={{
          width: 42, height: 42, borderRadius: 999, flexShrink: 0,
          display: "grid", placeItems: "center",
          background: alive ? "rgba(254,176,106,0.18)" : "rgba(255,255,255,0.04)",
          color: alive ? ACCENT : T.DIM,
        }}
      >
        <FlameIcon size={22} />
      </span>

      <div style={{ minWidth: 0 }}>
        {alive ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span style={{ fontSize: 27, fontWeight: 900, lineHeight: 1, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>
                {shown}
              </span>
              <span style={{ fontSize: 14, fontWeight: 800, color: T.TEXT }}>
                {days === 1 ? "day streak" : "day streak"}
              </span>
            </div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: T.MUTED }}>
              Consecutive days you finished something.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.TEXT }}>Start a streak today</div>
            <div style={{ marginTop: 4, fontSize: 12.5, color: T.MUTED }}>
              Finish one task to begin counting.
            </div>
          </>
        )}
      </div>
    </section>
  )
}
