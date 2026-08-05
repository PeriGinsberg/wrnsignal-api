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

/**
 * Build a real instant from a date field and a time field, both as the browser
 * gave them: "2026-08-07" and "14:00".
 *
 * THE WHOLE POINT IS THE CONSTRUCTOR. `new Date(y, m, d, h, min)` takes LOCAL
 * calendar components and produces the instant they name in the viewer's zone.
 * Neither string form is safe here:
 *
 *   new Date("2026-08-07")        UTC midnight — the off-by-one bug
 *   new Date("2026-08-07T14:00")  implementation-dependent
 *
 * Building from numbers cannot hit either, and it is the only composer in the
 * codebase, so there is still exactly one module that touches dates.
 *
 * RETURNS NULL UNLESS BOTH ARE PRESENT. A date with no time must NOT become
 * midnight: that is a guessed instant asserting a precision nobody supplied,
 * and it is how "9am Friday" turns into "Thursday evening" for a reader in a
 * different zone. Absent is honest; midnight is a lie.
 */
export function composeLocalInstant(
  dateStr: string | null | undefined,
  timeStr: string | null | undefined,
): string | null {
  if (!dateStr || !timeStr) return null
  const d = DATE_ONLY.exec(dateStr)
  // <input type="time"> gives "HH:MM", or "HH:MM:SS" in some browsers.
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr)
  if (!d || !t) return null

  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [hh, mm] = [Number(t[1]), Number(t[2])]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hh > 23 || mm > 59) return null

  const at = new Date(year, month - 1, day, hh, mm, 0, 0)
  if (Number.isNaN(at.getTime())) return null
  // Reject values the Date constructor silently rolled over, e.g. Feb 31.
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) return null
  return at.toISOString()
}

/**
 * The inverse, for populating an edit form: an instant back into the local
 * date and time fields that produced it. Round-trips with composeLocalInstant.
 */
export function splitLocalInstant(
  value: string | null | undefined,
): { date: string; time: string } | null {
  if (!value) return null
  const d = parseLocalDate(value)
  if (!d) return null
  const p = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
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
