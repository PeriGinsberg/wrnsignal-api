// Relative time, in the student register.
//
// "3 days ago", not "3d ago". The coach surfaces carry their own compact
// timeAgo (five near-identical copies, one per coach page) because a dense
// roster table needs the short form. The student app is calm and roomy and
// reads in plain English, so the wording genuinely differs rather than this
// being duplication for its own sake. If the coach copies are ever
// consolidated, this is the place to consolidate them INTO, with the compact
// form as an option.
//
// Returns null rather than "" for no timestamp, so a caller has to decide what
// absence means instead of rendering an empty element by accident.

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Whole days between two instants, measured from the start of each day, so
 *  something logged last night is "yesterday" at 9am rather than "today". */
function calendarDaysBetween(from: Date, to: Date): number {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((startOf(to) - startOf(from)) / DAY)
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null

  const ms = now.getTime() - then.getTime()
  // A clock skew or a backdated-to-the-future row should not read "-2 days ago".
  if (ms < MINUTE) return "just now"

  const days = calendarDaysBetween(then, now)
  if (days <= 0) {
    // Same calendar day. Hours are more useful than "today" for something that
    // happened this morning, but only up to a point.
    const hours = Math.floor(ms / HOUR)
    if (hours < 1) return "just now"
    return hours === 1 ? "an hour ago" : `${hours} hours ago`
  }
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} days ago`

  const weeks = Math.floor(days / 7)
  if (weeks === 1) return "a week ago"
  if (days < 30) return `${weeks} weeks ago`

  const months = Math.floor(days / 30)
  if (months === 1) return "a month ago"
  if (months < 12) return `${months} months ago`

  const years = Math.floor(days / 365)
  return years === 1 ? "a year ago" : `${years} years ago`
}
