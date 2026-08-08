// lib/proofProject.ts
//
// The Proof Project's derivations, in one place because the server and the page
// each need some of them and they MUST agree. The unlock rule in particular runs
// server-side (it decides whether the speaking point is sent at all) and is
// re-read client-side (it decides whether the card flips), so a second
// implementation would eventually let a card claim to be locked while the text
// sat in the network payload.
//
// Everything here is pure and date-safe. No Date.now() is read inside these
// functions — "now" is always a parameter, so the countdown and the streak are
// testable without freezing the clock.

export type Owner = "coach" | "client" | "both"
export type ActivityStatus = "not_started" | "in_progress" | "complete"

export type ProofActivity = {
  id: string
  name: string
  owner: Owner
  status: ActivityStatus
  /** date-only "YYYY-MM-DD", or null. Most activities carry no date. */
  due_date: string | null
  sort_order: number
  created_at: string
  /** The activity whose completion releases this deliverable's reward. At most
   *  one per deliverable, enforced by a partial unique index. */
  is_signoff: boolean
}

export type ProofDeliverable = {
  id: string
  name: string
  sort_order: number
  created_at: string
  activities: ProofActivity[]
  /**
   * Present ONLY when unlocked. The server withholds the text until the
   * sign-off lands, so a locked reward cannot be read out of the payload —
   * which is the entire point of making it a reward.
   */
  speaking_point: string | null
  /** Whether a speaking point EXISTS, sent even while locked, so the page can
   *  render a locked card rather than nothing. */
  has_speaking_point: boolean
  /**
   * The coach's framing of why the speaking point counts. Shown beneath it once
   * unlocked, and withheld while locked for the same reason the point itself is
   * — it is part of the same reveal.
   */
  why_this_matters: string | null
}

// ── The unlock rule ────────────────────────────────────────────────────────
//
// A deliverable is signed off when its is_signoff activity is complete.
//
// THIS USED TO BE POSITIONAL — "the final coach-owned activity" — and that broke
// the moment coaches could reorder. Dragging a coach task to the end silently
// changed which task released the client's reward, with nothing on screen
// saying so. The flag makes the trigger a property of the task, so reordering,
// inserting and deleting other activities cannot move it.
//
// FALLBACK, still a real case: a deliverable with NO sign-off activity has no
// trigger to wait for — a package attached before a coach marked one, or one
// whose sign-off was deleted. Requiring a flagged row would leave those
// permanently locked with no way for anyone to unlock them, so they fall back to
// "every activity complete". A deliverable with no activities at all is NOT
// signed off; an empty deliverable has proved nothing.
//
// The migration backfilled is_signoff using the old positional rule, so every
// deliverable's lock state survived the change unchanged.

/** The activity whose completion unlocks this deliverable, or null when none is
 *  marked (see the fallback above). */
export function signOffActivity(activities: ProofActivity[]): ProofActivity | null {
  return activities.find((a) => a.is_signoff) ?? null
}

export function isSignedOff(activities: ProofActivity[]): boolean {
  if (activities.length === 0) return false
  const signOff = signOffActivity(activities)
  if (signOff) return signOff.status === "complete"
  return activities.every((a) => a.status === "complete")
}

export function byOrder(a: { sort_order: number; created_at: string }, b: { sort_order: number; created_at: string }): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
}

/**
 * Would this edit take a reward the client has ALREADY SEEN back off them?
 *
 * The coach-side confirms are built on this. Deleting the sign-off task, moving
 * the flag to an unfinished task, or reopening a completed sign-off all put a
 * deliverable from signed-off back to locked — and the client may have been
 * reading that speaking point for weeks. The write is still allowed (the coach
 * is right about their own engagement more often than we are), but it must never
 * be silent.
 *
 * `next` is the activity list as it would be AFTER the edit.
 */
export function wouldRelock(before: ProofActivity[], next: ProofActivity[]): boolean {
  return isSignedOff(before) && !isSignedOff(next)
}

// ── Progress ───────────────────────────────────────────────────────────────

export type Progress = { completed: number; total: number; percent: number }

/** Percent is floored, and deliberately never rounds UP to 100: a project with
 *  199 of 200 tasks done reads 99%, not "100%" beside an unfinished node. */
export function progressOf(activities: ProofActivity[]): Progress {
  const total = activities.length
  const completed = activities.filter((a) => a.status === "complete").length
  if (total === 0) return { completed: 0, total: 0, percent: 0 }
  const raw = (completed / total) * 100
  const percent = completed === total ? 100 : Math.min(99, Math.floor(raw))
  return { completed, total, percent }
}

export function allActivities(deliverables: ProofDeliverable[]): ProofActivity[] {
  return deliverables.flatMap((d) => d.activities)
}

// ── Journey node state ─────────────────────────────────────────────────────

export type NodeState = "complete" | "current" | "future"

/**
 * "complete" is the TRUTH about each deliverable, not its position.
 *
 * An earlier draft forced the sequence — everything after the first unfinished
 * deliverable rendered as future, even when it was genuinely signed off — on the
 * theory that a lit node above a dark one looks like a rendering bug. That was
 * wrong twice over: it contradicts the percentage (which counts every completed
 * task wherever it sits) and it would show a locked-looking node beside an
 * unlocked speaking point, since the reward is released by the sign-off and not
 * by the running order. Coaches do sign work off out of order.
 *
 * So: complete when signed off, wherever it falls. Exactly one node is
 * "current" — the FIRST not-signed-off one, which is the thing to work on next.
 * Everything else unfinished is "future". When all are signed off there is no
 * current node.
 */
export function nodeStates(deliverables: ProofDeliverable[]): NodeState[] {
  const signedOff = deliverables.map((d) => isSignedOff(d.activities))
  const currentIndex = signedOff.findIndex((s) => !s)
  return deliverables.map((_, i) => {
    if (signedOff[i]) return "complete"
    return i === currentIndex ? "current" : "future"
  })
}

// ── Dates ──────────────────────────────────────────────────────────────────
//
// due_date is a DATE ("2026-09-01"). Parsing it with new Date(str) treats it as
// UTC midnight and then renders it in local time, which shows the previous day
// for anyone west of Greenwich. Every date here is parsed from its parts.

export function parseDateOnly(d: string | null): { y: number; m: number; day: number } | null {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), day: Number(m[3]) }
}

/** Local-midnight Date for a date-only string. Null for null/garbage. */
export function dateOnlyToLocal(d: string | null): Date | null {
  const p = parseDateOnly(d)
  return p ? new Date(p.y, p.m - 1, p.day) : null
}

/** "YYYY-MM-DD" for a Date, in LOCAL time — the key both the calendar and the
 *  streak group by, so both agree on where a day boundary falls. */
export function localDayKey(dt: Date): string {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, "0")
  const d = String(dt.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * The project's final date: the LATEST due date on any activity. Null when the
 * coach has set no dates at all, which is common — the page then shows no
 * countdown rather than a countdown to nothing.
 */
export function finalDueDate(deliverables: ProofDeliverable[]): string | null {
  const dates = allActivities(deliverables)
    .map((a) => a.due_date)
    .filter((d): d is string => !!d && !!parseDateOnly(d))
  if (dates.length === 0) return null
  return dates.sort().at(-1) ?? null // ISO date strings sort lexicographically
}

/** Whole days from `now` to a date-only value. Negative once it is past.
 *  Both sides are floored to local midnight so the answer changes at midnight,
 *  not at the time of day the page happened to load. */
export function daysUntil(dueDate: string | null, now: Date): number | null {
  const due = dateOnlyToLocal(dueDate)
  if (!due) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

// ── Streak ─────────────────────────────────────────────────────────────────

/**
 * Consecutive days, ending today or yesterday, on which at least one task was
 * completed.
 *
 * YESTERDAY COUNTS AS ALIVE. Anchoring strictly to today would show every
 * streak as 0 all morning until the first completion lands, which reads as
 * "you lost it" to someone who worked yesterday evening. The streak breaks only
 * once a full day has passed with nothing in it.
 *
 * `completions` are ISO timestamps of activity_completed events; they are
 * grouped by LOCAL day, so a task finished at 11pm counts for that evening
 * rather than for tomorrow in UTC.
 */
export function computeStreak(completions: string[], now: Date): number {
  const days = new Set<string>()
  for (const iso of completions) {
    const dt = new Date(iso)
    if (!Number.isNaN(dt.getTime())) days.add(localDayKey(dt))
  }
  if (days.size === 0) return 0

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cursor = new Date(today)
  // Anchor on today if it has activity, else yesterday, else the streak is over.
  if (!days.has(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
    if (!days.has(localDayKey(cursor))) return 0
  }
  let streak = 0
  while (days.has(localDayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

// ── Calendar ───────────────────────────────────────────────────────────────

export type CalendarCell = {
  /** null for the leading/trailing blanks that pad the grid to whole weeks. */
  dayKey: string | null
  dayOfMonth: number | null
  owners: Owner[]
  count: number
}

/**
 * A month grid, Sunday-first, padded to whole weeks. `owners` is the DISTINCT
 * set of owners with a task due that day, in a stable order, so a day with
 * three client tasks shows one dot rather than three identical ones.
 */
export function monthGrid(deliverables: ProofDeliverable[], year: number, month0: number): CalendarCell[] {
  const byDay = new Map<string, ProofActivity[]>()
  for (const a of allActivities(deliverables)) {
    if (!a.due_date || !parseDateOnly(a.due_date)) continue
    const list = byDay.get(a.due_date) ?? []
    list.push(a)
    byDay.set(a.due_date, list)
  }

  const first = new Date(year, month0, 1)
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()
  const lead = first.getDay()

  const cells: CalendarCell[] = []
  for (let i = 0; i < lead; i++) cells.push({ dayKey: null, dayOfMonth: null, owners: [], count: 0 })
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    const acts = byDay.get(key) ?? []
    const owners: Owner[] = (["client", "both", "coach"] as Owner[]).filter((o) => acts.some((a) => a.owner === o))
    cells.push({ dayKey: key, dayOfMonth: d, owners, count: acts.length })
  }
  while (cells.length % 7 !== 0) cells.push({ dayKey: null, dayOfMonth: null, owners: [], count: 0 })
  return cells
}
