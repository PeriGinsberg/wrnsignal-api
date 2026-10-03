// lib/phases/model.ts
//
// Client phases: the vocabulary, shared by the server and the screens.
//
// A coach defines their phases (Know, Build, Prove, Search, Land by default).
// Each client has a status per phase:
//
//   not_in_plan  none of the client's APPROVED packages has a deliverable in
//                the phase. Worked out, never stored.
//   not_started  in plan, nothing has happened yet (also the default).
//   in_progress  set by the coach, or by SIGNAL when a task in the phase first
//                moves to in progress or complete.
//   complete     coach click only, allowed with tasks still open.
//
// More than one phase can be In progress at once.

export const PHASE_STATUSES = ["not_in_plan", "not_started", "in_progress", "complete"] as const
export type PhaseStatus = (typeof PHASE_STATUSES)[number]

/** The statuses a coach can set; Not in plan only ever comes from the plan. */
export const SETTABLE_PHASE_STATUSES = ["not_started", "in_progress", "complete"] as const
export type SettablePhaseStatus = (typeof SETTABLE_PHASE_STATUSES)[number]

export function isSettablePhaseStatus(v: unknown): v is SettablePhaseStatus {
  return typeof v === "string" && (SETTABLE_PHASE_STATUSES as readonly string[]).includes(v)
}

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  not_in_plan: "Not in plan",
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
}

/** Order for "is this a move back?": Not started < In progress < Complete. */
const RANK: Record<SettablePhaseStatus, number> = { not_started: 0, in_progress: 1, complete: 2 }

export function isMoveBack(from: PhaseStatus, to: SettablePhaseStatus): boolean {
  if (from === "not_in_plan") return false
  return RANK[to] < RANK[from]
}

export const DEFAULT_PHASES: { phase_key: string; label: string }[] = [
  { phase_key: "know", label: "Know" },
  { phase_key: "build", label: "Build" },
  { phase_key: "prove", label: "Prove" },
  { phase_key: "search", label: "Search" },
  { phase_key: "land", label: "Land" },
]

export const PHASE_LABEL_MAX = 60

/** The stepper's colours. Text is always navy. */
export const PHASE_COLORS = {
  text: "#08203F",
  complete: "#00B3B3",
  in_progress: "#009BFF",
  not_started: "#08203F",
  not_in_plan: "#9AA3AE",
} as const

export type Phase = {
  id: string
  phase_key: string
  label: string
  sort_order: number
  active: boolean
  is_custom: boolean
}

/** One phase as a client's stepper shows it. */
export type ClientPhase = {
  phase_id: string
  label: string
  status: PhaseStatus
  tasks_done: number
  tasks_total: number
  /** Every task done and the phase not yet Complete: "ready to mark complete". */
  ready_to_complete: boolean
  updated_at: string | null
}
