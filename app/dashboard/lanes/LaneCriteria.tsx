"use client"

// The controls that decide how much a lane finds.
//
// Extracted because they are needed in two places with opposite save semantics.
// The edit screen writes each change straight through to PATCH; the create panel
// holds them as a draft until the lane exists. A component that owned its own
// saving could only serve the first, and a second copy for the create panel is
// how the two screens end up offering different filters.
//
// So these are controlled: they render a value and report a change, and the
// caller decides whether that means a PATCH or a setState.
//
// Why this matters more than it looks. A lane saved wide runs immediately and
// can put several hundred jobs in the review queue on day one, and nothing
// downstream un-does that: years_max and the board filters are applied when a
// run WRITES rows, so tightening them later leaves everything already queued
// exactly where it is. The first run is the one that has to be right, which is
// why the create panel mounts these before it saves rather than after.

import { useState } from "react"
import { T, eyebrow, input } from "../../../lib/dashboard-theme"
import { FilterListEditor } from "./FilterListEditor"
import { BOARD_COMMITMENTS } from "../../../lib/laneCommitment"
import { POSTING_WINDOWS, POSTING_WINDOW_DAYS, postingWindowLabel } from "../../../lib/lanePostingWindow"
import { DEFAULT_SENIORITY_BANDS, SENIORITY_LEVELS, orderSeniority } from "../../../lib/laneSeniority"
import type { LaneFilters } from "./laneApi"

/**
 * The years ceiling.
 *
 * Committed on blur or Enter rather than on every keystroke: saving as you type
 * would send "1" on the way to "12", and a lane briefly filtered at one year is
 * a run that drops most of the board.
 *
 * Empty means no ceiling, which is a real value and the only way to remove one.
 * Anything that is not a whole number of years is refused by putting the caller's
 * own value back, so the box can never disagree with what was saved.
 *
 * Key it on the committed value if that value can change underneath it, as the
 * edit screen does for a save that gets rolled back. The create panel does not
 * need to: nothing there changes the value except this box.
 */
export function YearsMaxField({
  value,
  disabled,
  onCommit,
}: {
  value: number | null
  disabled: boolean
  onCommit: (v: number | null) => void
}) {
  const asText = (v: number | null) => (v == null ? "" : String(v))
  const [draft, setDraft] = useState(asText(value))

  const commit = () => {
    const t = draft.trim()
    if (t === "") {
      if (value !== null) onCommit(null)
      return
    }
    const n = Number(t)
    if (!Number.isInteger(n) || n < 0) {
      setDraft(asText(value))
      return
    }
    if (n !== value) onCommit(n)
  }

  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 4 }}>Years max</div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "Escape") setDraft(asText(value))
        }}
        disabled={disabled}
        inputMode="numeric"
        placeholder="no ceiling"
        aria-label="Years max"
        title="Drop postings asking for more years than this. Empty means no ceiling. Postings that never state a minimum are kept either way, so on a board where few postings state one this filter does very little."
        style={{ ...input, height: 30, width: 104, padding: "0 10px", borderRadius: 9 }}
      />
    </div>
  )
}

/**
 * How far back the lane looks.
 *
 * Saves on change, unlike the years box: there is no half-typed state to guard
 * against when every value is one of five.
 *
 * The null case is a database where the column has not been added yet. It is
 * rendered as the window every lane used to run at rather than as a blank, so
 * the control never claims the lane is set to something it is not.
 */
export function PostedWithinField({
  value,
  disabled,
  onChange,
}: {
  value: number | null
  disabled: boolean
  onChange: (days: number) => void
}) {
  const known = value != null && POSTING_WINDOW_DAYS.has(value)
  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 4 }}>Posted within</div>
      <select
        value={known ? String(value) : ""}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (POSTING_WINDOW_DAYS.has(n)) onChange(n)
        }}
        disabled={disabled}
        aria-label="Posted within"
        title="Only jobs posted inside this window. It is sent to the board, so anything older never reaches the queue. The strongest lever on how big the queue gets."
        style={
          {
            ...input,
            height: 30,
            width: "auto",
            padding: "0 8px",
            borderRadius: 9,
            cursor: "pointer",
            colorScheme: "dark",
          } as React.CSSProperties
        }
      >
        {!known && <option value="">{postingWindowLabel(value)}</option>}
        {POSTING_WINDOWS.map((w) => (
          <option key={w.days} value={w.days}>
            {w.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The board-side filters, as one object.
 *
 * Reported as a whole object rather than per list, because the column is one
 * jsonb and PATCH replaces it wholesale: a per-list write would have the last
 * one silently erase the others.
 *
 * Renders its own heading and hint but no card, so each screen can wrap it in
 * whatever chrome it already uses.
 */
export function BoardFiltersEditor({
  filters,
  seniority,
  disabled = false,
  saving = false,
  onChange,
  onSeniorityChange,
}: {
  filters: LaneFilters
  /** Its own column, not a key in filters. See the seniority migration for why. */
  seniority: string[] | null
  disabled?: boolean
  saving?: boolean
  onChange: (next: LaneFilters) => void
  onSeniorityChange: (next: string[]) => void
}) {
  const bands = seniority?.length ? seniority : [...DEFAULT_SENIORITY_BANDS]
  return (
    <>
      <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 6 }}>
        Board filters {saving && <span style={{ color: T.DIM, fontWeight: 500 }}>· saving…</span>}
      </div>
      <p style={{ fontSize: 12, color: T.MUTED, margin: "0 0 14px" }}>
        These narrow the search itself, so filtered jobs never reach the queue. A single word matches any
        industry containing a word starting with it: &ldquo;education&rdquo; covers Higher Education, Vocational
        Education and the rest, so one term is usually enough. Two or more words must match a whole industry
        name exactly. &ldquo;Higher Education&rdquo; works, &ldquo;Higher Ed&rdquo; matches nothing.
      </p>

      {/* First, because it is the widest lever in this section and the one that
          was not a setting at all until now. */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 4 }}>Seniority</div>
        <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 8px" }}>
          Which bands the board is asked for. Every lane used to search the first three whatever the client&apos;s
          level, which is why queues fill with work beneath them. At least one is required.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SENIORITY_LEVELS.map((level) => {
            const on = bands.includes(level)
            // The last band standing cannot be switched off: an empty list is
            // refused by the column and would reach the board as a filter
            // matching nothing.
            const isLast = on && bands.length === 1
            return (
              <button
                key={level}
                type="button"
                disabled={disabled || isLast}
                title={isLast ? "A lane has to search at least one band" : undefined}
                onClick={() =>
                  onSeniorityChange(
                    orderSeniority(on ? bands.filter((b) => b !== level) : [...bands, level])
                  )
                }
                style={{
                  fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 12px",
                  cursor: disabled || isLast ? "not-allowed" : "pointer",
                  background: on ? T.GLASS : "transparent",
                  border: `1px solid ${on ? T.ORANGE_BORDER : T.BORDER_SOFT}`,
                  color: on ? T.TEXT : T.MUTED,
                  opacity: isLast ? 0.7 : 1,
                }}
              >
                {level}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 4 }}>Commitment</div>
        <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 8px" }}>
          Inherited from the client&apos;s job type. Select none to accept every kind of posting, including
          internships and seasonal work.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {BOARD_COMMITMENTS.map((c) => {
            const on = (filters.commitment_types ?? []).includes(c)
            return (
              <button
                key={c}
                type="button"
                disabled={disabled}
                onClick={() => {
                  const cur = filters.commitment_types ?? []
                  const next = on ? cur.filter((x) => x !== c) : [...cur, c]
                  onChange({ ...filters, commitment_types: next })
                }}
                style={{
                  fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 12px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  background: on ? T.GLASS : "transparent",
                  border: `1px solid ${on ? T.ORANGE_BORDER : T.BORDER_SOFT}`,
                  color: on ? T.TEXT : T.MUTED,
                }}
              >
                {c}
              </button>
            )
          })}
        </div>
      </div>

      <FilterListEditor
        label="Industries"
        hint="Only these industries. Empty means no restriction."
        values={filters.industries ?? []}
        placeholder="Sports"
        disabled={disabled}
        onChange={(v) => onChange({ ...filters, industries: v })}
      />
      <FilterListEditor
        label="Excluded industries"
        hint="Never these. Usually inherited from the client's profile."
        values={filters.excluded_industries ?? []}
        placeholder="Higher Education"
        tone="negative"
        disabled={disabled}
        onChange={(v) => onChange({ ...filters, excluded_industries: v })}
      />
      <FilterListEditor
        label="Company keywords"
        hint="Matched against the employer, not the job title. A way to say “sports organisations” rather than “jobs with sports in the name”."
        values={filters.company_keywords ?? []}
        placeholder="sports"
        disabled={disabled}
        onChange={(v) => onChange({ ...filters, company_keywords: v })}
      />
      <FilterListEditor
        label="Excluded company keywords"
        hint="Never employers matching these."
        values={filters.excluded_company_keywords ?? []}
        placeholder="university"
        tone="negative"
        disabled={disabled}
        onChange={(v) => onChange({ ...filters, excluded_company_keywords: v })}
      />
    </>
  )
}
