"use client"

// A month of due dates, dotted by owner.
//
// IT OPENS ON THE MONTH WITH WORK IN IT, not on today. A client whose next
// deliverable is due in six weeks would otherwise land on an empty grid and
// conclude there is nothing scheduled. Today's month wins when it has anything;
// otherwise the earliest month that does.
//
// Owners are told apart by FORM rather than a second and third hue — see the
// note in tokens.tsx. The legend is always visible because a dot vocabulary
// nobody explains is just decoration.
//
// Read-only: the days are not clickable. There is nothing to do with a click
// here that the plan tree below does not do better, and a hit target that
// responds to nothing is worse than one that is plainly inert.

import { useMemo, useState } from "react"
import { T } from "../../../../lib/dashboard-theme"
import { ACCENT, OWNER_ORDER, OWNER_STYLE, OwnerDot } from "./tokens"
import { localDayKey, monthGrid, parseDateOnly, allActivities, type ProofDeliverable } from "../../../../lib/proofProject"

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DOW = ["S", "M", "T", "W", "T", "F", "S"]

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
        stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

export function DueCalendar({ deliverables, now }: { deliverables: ProofDeliverable[]; now: Date }) {
  // The month to open on, computed once.
  const initial = useMemo(() => {
    const dated = allActivities(deliverables)
      .map((a) => a.due_date)
      .filter((d): d is string => !!d && !!parseDateOnly(d))
      .sort()
    const thisMonth = { y: now.getFullYear(), m: now.getMonth() }
    const hasThisMonth = dated.some((d) => {
      const p = parseDateOnly(d)!
      return p.y === thisMonth.y && p.m - 1 === thisMonth.m
    })
    if (hasThisMonth || dated.length === 0) return thisMonth
    const first = parseDateOnly(dated[0])!
    return { y: first.y, m: first.m - 1 }
  }, [deliverables, now])

  const [view, setView] = useState(initial)
  const cells = useMemo(() => monthGrid(deliverables, view.y, view.m), [deliverables, view])
  const todayKey = localDayKey(now)

  const shift = (by: number) => {
    const d = new Date(view.y, view.m + by, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }

  const navBtn: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 9,
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${T.BORDER_SOFT}`,
    color: T.TEXT, cursor: "pointer",
    display: "grid", placeItems: "center", fontFamily: "inherit",
  }

  return (
    <section
      style={{
        borderRadius: 16,
        padding: "18px 20px",
        background: T.CARD,
        border: `1px solid ${T.BORDER_SOFT}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: T.MUTED, margin: 0 }}>
          Due dates
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" style={navBtn} onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronIcon dir="left" />
          </button>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.TEXT, minWidth: 118, textAlign: "center" }}>
            {MONTHS[view.m]} {view.y}
          </div>
          <button type="button" style={navBtn} onClick={() => shift(1)} aria-label="Next month">
            <ChevronIcon dir="right" />
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 14 }}>
        {DOW.map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 800, color: T.DIM, padding: "2px 0" }}>
            {d}
          </div>
        ))}

        {cells.map((c, i) => {
          const isToday = c.dayKey === todayKey
          return (
            <div
              key={i}
              style={{
                aspectRatio: "1 / 1",
                borderRadius: 9,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                background: c.dayKey ? (isToday ? "rgba(254,176,106,0.12)" : "rgba(255,255,255,0.025)") : "transparent",
                border: isToday ? `1px solid ${ACCENT}` : "1px solid transparent",
                minWidth: 0,
              }}
            >
              {c.dayOfMonth !== null && (
                <>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isToday ? 900 : 600,
                      color: isToday ? ACCENT : c.count > 0 ? T.TEXT : T.DIM,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                    }}
                  >
                    {c.dayOfMonth}
                  </span>
                  {/* One dot per distinct owner, never per task: three client
                      tasks on a Tuesday is one dot, not a smear. */}
                  <span style={{ display: "flex", gap: 3, height: 7, alignItems: "center" }}>
                    {c.owners.map((o) => <OwnerDot key={o} owner={o} size={6} />)}
                  </span>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        {OWNER_ORDER.map((o) => (
          <span key={o} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: T.MUTED }}>
            <OwnerDot owner={o} />
            {OWNER_STYLE[o].label}
          </span>
        ))}
      </div>
    </section>
  )
}
