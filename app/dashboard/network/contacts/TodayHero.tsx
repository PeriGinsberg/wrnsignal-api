"use client"

// TODAY: the headline of the page, not a row treatment.
//
// Capped at HERO_CAP. A hero holding fifteen cards is a list again, and the
// whole point is that this panel answers "what do I do now" in one glance. The
// overflow falls to the grid, where the chip below sends you.

import { LIGHT as S, pill } from "../../../../lib/theme/surfaces"
import { DueCard } from "./DueCard"
import { dueOf, type Contact } from "./contactModel"

export function TodayHero({
  shown, overflow, onChanged, selectMode, selectedIds, onToggle, flashId, onSeeOverflow,
}: {
  /** The capped, urgency-ordered hero set. */
  shown: Contact[]
  /** How many more were due but did not fit. */
  overflow: number
  onChanged: (id: string) => void
  selectMode: boolean
  selectedIds: Set<string>
  onToggle: (id: string) => void
  flashId: string | null
  onSeeOverflow: () => void
}) {
  // Counted from the LIVE due state of the held set, so the headline falls as
  // work gets done even though the partition itself stays frozen.
  const overdue = shown.filter((c) => dueOf(c.next_due_at).kind === "overdue").length
  const today = shown.filter((c) => dueOf(c.next_due_at).kind === "due_today").length
  const need = overdue + today

  return (
    <section data-testid="today-hero" style={{
      marginTop: 16, borderRadius: 18, padding: "16px 18px 18px",
      background: S.gradient.hero, border: `1px solid rgba(255,255,255,0.10)`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{
          color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: 900,
          letterSpacing: 1.2, textTransform: "uppercase",
        }}>
          Today
        </span>
        <span data-testid="hero-headline" style={{ color: "#FFFFFF", fontSize: 15, fontWeight: 900 }}>
          {need > 0
            ? `${need} ${need === 1 ? "person needs" : "people need"} you`
            : "You are all caught up"}
        </span>
        <span style={{ flex: 1 }} />
        {overdue > 0 && (
          <span data-testid="count-overdue" style={{ ...countPill, ...pill(S, "error") }}>
            {overdue} overdue
          </span>
        )}
        {today > 0 && (
          <span data-testid="count-today" style={{ ...countPill, ...pill(S, "attention") }}>
            {today} today
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <div data-testid="hero-empty" style={{
          marginTop: 12, padding: "20px 16px", borderRadius: 12,
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
          color: "rgba(255,255,255,0.75)", fontSize: 12.5, lineHeight: "19px",
        }}>
          Nothing is due today. When a follow-up comes round, the people who need you appear here.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 12, marginTop: 13, flexWrap: "wrap", alignItems: "stretch" }}>
          {shown.map((c) => (
            <DueCard
              key={c.id}
              contact={c}
              onChanged={() => onChanged(c.id)}
              selectMode={selectMode}
              checked={selectedIds.has(c.id)}
              onToggle={() => onToggle(c.id)}
              flash={flashId === c.id}
            />
          ))}
        </div>
      )}

      {overflow > 0 && (
        <button onClick={onSeeOverflow} data-testid="hero-overflow" style={{
          marginTop: 12, background: "rgba(255,255,255,0.10)", color: "#FFFFFF",
          border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999,
          padding: "6px 13px", fontSize: 11.5, fontWeight: 800, cursor: "pointer",
        }}>
          + {overflow} more due →
        </button>
      )}
    </section>
  )
}

const countPill: React.CSSProperties = {
  borderRadius: 999, padding: "3px 10px", fontSize: 10.5, fontWeight: 900, whiteSpace: "nowrap",
}
