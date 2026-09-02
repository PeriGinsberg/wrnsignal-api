// Filtering the roster by WHEN, which is the one axis the list could not
// express before. The other seven filters all ask what a contact IS; this asks
// when you last did anything about them, which is the question behind "who am I
// letting go cold".
//
// Its own module, not an inline predicate in page.tsx, because a route file
// should export only route members and because a date bucket is exactly the
// kind of thing that is wrong at the boundaries and needs a test to say so.
//
// KEYED ON last_action_at, not next_due_at. Due dates are the engine's opinion
// about the future; last_action_at is a fact about the past, and "nothing for a
// month" is true whether or not a reminder was ever set. `never` is therefore a
// real bucket and not an empty one: a contact you have never actioned is the
// most common thing on a new board.

export type ActivityWindow = "" | "7d" | "30d" | "stale30" | "never"

export const ACTIVITY_LABELS: Record<Exclude<ActivityWindow, "">, string> = {
  "7d": "Active this week",
  "30d": "Active this month",
  stale30: "Nothing in 30 days",
  never: "Never contacted",
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Does `lastActionAt` fall in `window`, as of `now`?
 *
 * An empty window matches everything, so an unset filter costs nothing.
 * An unparseable date is treated as no date: a corrupt value should read as
 * "never actioned", which is visible, rather than silently matching a range.
 */
export function inActivityWindow(
  lastActionAt: string | null | undefined,
  window: ActivityWindow,
  now: Date,
): boolean {
  if (!window) return true

  const t = lastActionAt ? new Date(lastActionAt).getTime() : NaN
  const known = Number.isFinite(t)

  if (window === "never") return !known
  // The three dated buckets all require a date. A contact with no activity is
  // not "active this week" and is not "stale for 30 days" either; it has its
  // own bucket, and letting it fall into stale30 would double-count it.
  if (!known) return false

  const age = now.getTime() - t
  if (window === "7d") return age <= 7 * DAY
  if (window === "30d") return age <= 30 * DAY
  return age > 30 * DAY   // stale30
}
