// Parsing a date that has no time on it.
//
// THE BUG THIS EXISTS TO KILL. `applied_date` and `interview_date` are Postgres
// `date` columns, so they arrive as bare "2026-08-07". Handed to `new Date()`,
// the ECMAScript spec parses a date-only ISO string as UTC midnight; rendering
// that with toLocaleDateString in any zone west of UTC shows the DAY BEFORE.
// Seeded an interview for Aug 7, the tracker displayed "Thu, Aug 6" and counted
// down "in 2 days" instead of 3. Every date in the old tracker was one day
// early for every user in the Americas, which is most of them.
//
// A date with no time means a day in the reader's own calendar, so it has to be
// parsed as LOCAL midnight. Timestamps (anything carrying a T or a zone) are
// genuine instants and are left to the normal parser.
//
// This also matters for arithmetic, not just display: the follow-up threshold
// and "is this interview still ahead" both bucket by day, and a day of drift
// flips them at the boundary.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Parse a date string that may or may not carry a time. Returns null for empty
 * or unparseable input, so callers branch once instead of checking for NaN.
 */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = DATE_ONLY.exec(value)
  if (m) {
    // Month is 0-based. This constructor builds LOCAL midnight, which is the
    // whole point.
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Local midnight of whatever day this instant falls on. */
export function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Whole calendar days from `value` to `now`. Positive means in the past.
 * Null when the input will not parse.
 */
export function daysSince(value: string | null | undefined, now: Date = new Date()): number | null {
  const d = parseLocalDate(value)
  if (!d) return null
  return Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
}

/** Whole calendar days from `now` to `value`. Positive means ahead. */
export function daysUntil(value: string | null | undefined, now: Date = new Date()): number | null {
  const days = daysSince(value, now)
  return days === null ? null : -days
}

export function formatShort(value: string | null | undefined): string {
  const d = parseLocalDate(value)
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""
}

export function formatLong(value: string | null | undefined): string {
  const d = parseLocalDate(value)
  return d ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : ""
}

export function formatMedium(value: string | null | undefined): string {
  const d = parseLocalDate(value)
  return d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""
}
