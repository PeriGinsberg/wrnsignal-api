// lib/tasks/model.ts
//
// What a coaching task is, and the handful of questions the app keeps asking
// about one. Pure, so the routes, the dashboard card, the full list, the
// overdue digest and the automation runner all answer them the same way.
//
// The single most important thing in this file is that "overdue" and "due this
// week" are defined ONCE. The dashboard card, the list's view tabs and the
// nightly digest email are three surfaces that must agree about whether a task
// is late, and the cost of them disagreeing is a coach seeing "2 overdue" on
// one screen and three rows on another.

export const TASK_STATUSES = ["open", "done", "cancelled"] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_SOURCES = ["manual", "auto"] as const
export type TaskSource = (typeof TASK_SOURCES)[number]

export const TASK_EVENT_KINDS = [
  "created", "assigned", "reassigned", "completed", "reopened", "cancelled", "commented",
] as const
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number]

export type Task = {
  id: string
  title: string
  description: string | null
  client_profile_id: string | null
  coach_client_id: string | null
  assignee_profile_id: string
  created_by_profile_id: string | null
  due_at: string | null
  due_has_time: boolean
  status: TaskStatus
  completed_at: string | null
  source: TaskSource
  template_id: string | null
  chain_id: string | null
  legacy_note_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** The view tabs on the full list. `all` excludes nothing but deleted rows. */
export const TASK_VIEWS = ["all", "due_today", "overdue", "upcoming"] as const
export type TaskView = (typeof TASK_VIEWS)[number]

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v)
}

export function isTaskView(v: unknown): v is TaskView {
  return typeof v === "string" && (TASK_VIEWS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
//
// A task with no due date is never overdue and never due today. It is work
// somebody wrote down, not work that is late, and treating an absent date as
// "due now" would bury every coach in false urgency on day one. The backfilled
// action items all arrive this way.
//
// DAY BOUNDARIES ARE THE SERVER'S. due_has_time = false means the coach picked
// a day, not a moment, so such a task is late only once that whole day is over.
// Comparing it against `now` directly would mark a task due today as overdue at
// one minute past midnight.

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

/** The moment a task actually becomes late. */
function dueDeadline(t: Pick<Task, "due_at" | "due_has_time">): Date | null {
  if (!t.due_at) return null
  const due = new Date(t.due_at)
  if (Number.isNaN(due.getTime())) return null
  return t.due_has_time ? due : endOfDay(due)
}

export function isOverdue(t: Pick<Task, "due_at" | "due_has_time" | "status">, now = new Date()): boolean {
  if (t.status !== "open") return false
  const deadline = dueDeadline(t)
  return deadline !== null && deadline.getTime() < now.getTime()
}

export function isDueToday(t: Pick<Task, "due_at" | "due_has_time" | "status">, now = new Date()): boolean {
  if (t.status !== "open" || !t.due_at) return false
  const due = new Date(t.due_at)
  if (Number.isNaN(due.getTime())) return false
  return due >= startOfDay(now) && due <= endOfDay(now)
}

/**
 * Due within the next seven days, today included, and not already late.
 *
 * Seven rolling days rather than "this calendar week" on purpose: a card read
 * on Friday that only looked to Sunday would show almost nothing, which is
 * exactly when a coach most wants to see what is coming.
 */
export function isDueThisWeek(t: Pick<Task, "due_at" | "due_has_time" | "status">, now = new Date()): boolean {
  if (t.status !== "open" || !t.due_at) return false
  if (isOverdue(t, now)) return false
  const due = new Date(t.due_at)
  if (Number.isNaN(due.getTime())) return false
  const horizon = endOfDay(new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000))
  return due <= horizon
}

export function matchesView(t: Task, view: TaskView, now = new Date()): boolean {
  switch (view) {
    case "overdue":   return isOverdue(t, now)
    case "due_today": return isDueToday(t, now)
    case "upcoming":  return isDueThisWeek(t, now)
    case "all":       return true
  }
}

/**
 * What the dashboard card shows: my overdue first, then what is coming.
 *
 * Overdue before upcoming, each oldest-first, because the question the card
 * answers is "what have I let slip", and the oldest slip is the worst one. A
 * plain due_at sort would bury a three-week-old task under today's.
 */
export function compareForCard(a: Task, b: Task, now = new Date()): number {
  const ao = isOverdue(a, now) ? 0 : 1
  const bo = isOverdue(b, now) ? 0 : 1
  if (ao !== bo) return ao - bo
  const at = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER
  const bt = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER
  if (at !== bt) return at - bt
  return a.created_at < b.created_at ? -1 : 1
}

/** The card shows at most this many, with a "View all" link for the rest. */
export const CARD_LIMIT = 5

export function cardTasks(tasks: Task[], now = new Date()): { shown: Task[]; total: number } {
  const mine = tasks.filter((t) => !t.deleted_at && (isOverdue(t, now) || isDueThisWeek(t, now)))
  mine.sort((a, b) => compareForCard(a, b, now))
  return { shown: mine.slice(0, CARD_LIMIT), total: mine.length }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type TaskWriteErrors = string[]

/**
 * Checks on what a person may send. Deliberately does NOT check that the
 * assignee is a coach: that needs the database, and lives in service.ts.
 */
export function validateTaskWrite(input: {
  title?: unknown
  status?: unknown
  due_at?: unknown
  due_has_time?: unknown
  assignee_profile_id?: unknown
}, opts: { partial?: boolean } = {}): TaskWriteErrors {
  const errors: TaskWriteErrors = []
  const present = (k: string) => Object.prototype.hasOwnProperty.call(input, k)

  if (!opts.partial || present("title")) {
    const t = typeof input.title === "string" ? input.title.trim() : ""
    if (!t) errors.push("A task needs a title.")
    else if (t.length > 500) errors.push("That title is too long (500 characters max).")
  }

  if (!opts.partial || present("assignee_profile_id")) {
    if (typeof input.assignee_profile_id !== "string" || !input.assignee_profile_id.trim()) {
      errors.push("A task needs an assignee.")
    }
  }

  if (present("status") && !isTaskStatus(input.status)) {
    errors.push(`Status must be one of: ${TASK_STATUSES.join(", ")}.`)
  }

  if (present("due_at") && input.due_at != null) {
    if (typeof input.due_at !== "string" || Number.isNaN(new Date(input.due_at).getTime())) {
      errors.push("That due date is not a date.")
    }
  }

  if (present("due_has_time") && typeof input.due_has_time !== "boolean") {
    errors.push("due_has_time must be true or false.")
  }

  return errors
}

/**
 * Keep status and completed_at in step, which the table's CHECK constraint also
 * enforces. Done here too so the API returns a sentence rather than a 500
 * carrying a constraint name.
 */
export function completionPatch(status: TaskStatus, now = new Date()): {
  status: TaskStatus
  completed_at: string | null
} {
  return { status, completed_at: status === "done" ? now.toISOString() : null }
}
