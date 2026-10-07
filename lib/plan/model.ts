// lib/plan/model.ts
//
// A client's plan: the tasks in their approved packages, and what state each
// one is in. Shared by the server and the screens.
//
//   upcoming           on the client's plan only; nowhere else
//   active             a coach task's turn (or "Release: [task]" for a client
//                      task); on the assignee's dashboard and To-Do
//   waiting_on_client  a client task the coach has released; in the client's
//                      Coaches Hub
//   done, skipped      finished; the next task in the deliverable activates
//   not_needed         greyed, never activates, not counted
//
// Every task is a Coach task or a Client task (the "owner" column).

export const TASK_STATES = ["upcoming", "active", "waiting_on_client", "done", "skipped", "not_needed"] as const
export type TaskState = (typeof TASK_STATES)[number]

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  upcoming: "Upcoming",
  active: "Active",
  waiting_on_client: "Waiting on client",
  done: "Done",
  skipped: "Skipped",
  not_needed: "Not needed",
}

export const TASK_TYPES = ["coach", "client"] as const
export type TaskType = (typeof TASK_TYPES)[number]
export const TASK_TYPE_LABEL: Record<TaskType, string> = { coach: "Coach", client: "Client" }

export function isTaskType(v: unknown): v is TaskType {
  return typeof v === "string" && (TASK_TYPES as readonly string[]).includes(v)
}

/** Finished: counts toward "done", and lets the next task activate. */
/** A task's details: plain text, a checklist one item per line. */
export const DETAILS_MAX = 2000

/**
 * A details value as sent by a form: trimmed, empty is "no details" (null).
 * Returns an error string for a non-string or one over DETAILS_MAX.
 */
export function normalizeDetails(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== "string") return { ok: false, error: "Details must be text." }
  const t = v.replace(/\r\n/g, "\n").trim()
  if (t.length > DETAILS_MAX) return { ok: false, error: `Details can be at most ${DETAILS_MAX} characters.` }
  return { ok: true, value: t || null }
}

export function isFinished(s: TaskState): boolean {
  return s === "done" || s === "skipped"
}

/** Under way: moves the task's phase to In progress. */
export function hasStarted(s: TaskState): boolean {
  return s === "active" || s === "waiting_on_client" || s === "done"
}

/**
 * What a task is called where someone has to act on it. An Active client task
 * is the coach's job to hand over, so it reads "Release: [task]". The client
 * task flagged at Let's Go is handed over with the welcome email, so it reads
 * "Send welcome email (releases: [task])".
 */
export function taskTitle(t: { name: string; owner: string; state: TaskState; welcome_release?: boolean }): string {
  if (t.owner !== "client" || t.state !== "active") return t.name
  return t.welcome_release ? `Send welcome email (releases: ${t.name})` : `Release: ${t.name}`
}

export type PlanTask = {
  id: string
  deliverable_id: string
  name: string
  owner: TaskType
  state: TaskState
  assignee_profile_id: string | null
  due_date: string | null
  released_at: string | null
  sort_order: number
  is_signoff: boolean
  /** Plain text, a checklist one item per line. Client tasks' details show to the client once released. */
  details: string | null
  /** Released with the welcome email; releasing it shares the client's Drive workspace. */
  welcome_release?: boolean
}

export type PlanDeliverable = {
  id: string
  engagement_id: string
  engagement_name: string
  name: string
  phase_id: string | null
  not_needed: boolean
  sort_order: number
  tasks: PlanTask[]
}

/** The coach's actions on one task. */
export const TASK_ACTIONS = ["activate", "release", "done", "skip", "not_needed", "undo"] as const
export type TaskAction = (typeof TASK_ACTIONS)[number]
