/**
 * The nightly pipeline's record: one pipeline_runs row per step per run
 * (20261111_nightly_pipeline.sql).
 *
 * A NIGHT IS A UTC DATE. The ATS sweeps (03:00-03:15, 04:00-04:45), the pipeline ticks
 * (05:00-07:45) and the watchdog (09:00) all fall on the same UTC date, so they
 * share one key without any timezone arithmetic.
 *
 * WHAT RUNS NEXT is decided from the rows alone (nextStep), so a tick that is
 * killed, skipped or late leaves the next tick knowing exactly where to pick up.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export const STEPS = ["ats_grnhse", "ats_smartrecruiters", "google_jobs", "enrich", "match", "queue_release", "link_check"] as const
export type Step = (typeof STEPS)[number]
/** The steps the tick runs, in order. The ATS sweeps keep their own crons and only record here. */
export const TICK_STEPS = ["google_jobs", "enrich", "match", "queue_release", "link_check"] as const
export type TickStep = (typeof TICK_STEPS)[number]
export type StepStatus = "running" | "ok" | "capped" | "error"

/**
 * Why a step stopped with work left. "deadline": it stopped itself before the
 * function's time limit; the next run continues. "killed": the platform killed
 * it at the limit (closeStale found it still running); the next run continues
 * the same way, because every step's work is idempotent and picks up from what
 * is recorded. "cap": the nightly cap is spent; nothing more runs tonight and
 * the cap alert goes out.
 */
export type CapReason = "deadline" | "killed" | "cap"
/** Stopped with work left that the next run picks up. */
export const resumes = (r: Pick<RunRow, "status" | "detail">) =>
  r.status === "capped" && (r.detail?.capReason === "deadline" || r.detail?.capReason === "killed")

export type RunRow = {
  id: string
  night: string
  step: Step
  status: StepStatus
  started_at: string
  finished_at: string | null
  units: number
  cost_usd: number
  searches: number
  detail: Record<string, any>
  error: string | null
}

/** A running row older than this belongs to a function that was killed (the limit is 800s). */
export const STALE_RUNNING_MS = 15 * 60_000
/** Continuations of one step in a night, past the first run. Twelve ticks a night; this leaves room for the rest. */
export const MAX_CONTINUATIONS = 4
/** Retries of a failed step in a night, after the first attempt. Every step is safe to run again. */
export const MAX_RETRIES = 2
/**
 * The ticks run every 15 minutes, 05:00-07:45 UTC (vercel.json). From 07:00 the
 * last four are kept for the queue release and the link check (and a retry of
 * each): searching, enriching and matching stop starting there, and what they
 * left waits for tomorrow night.
 */
export const RESERVED_FROM_MIN = 7 * 60
export const LAST_TICK_MIN = 7 * 60 + 45
export const TICK_EVERY_MIN = 15
const EARLY_STEPS: readonly TickStep[] = ["google_jobs", "enrich", "match"]
const utcMin = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes()
/** Inside the reserved stretch at the end of the night. */
export const reserved = (now: Date) => utcMin(now) >= RESERVED_FROM_MIN
/** Another tick comes tonight after this one. */
export const tickLeftAfter = (now: Date) => utcMin(now) + TICK_EVERY_MIN <= LAST_TICK_MIN

export const nightOf = (d: Date = new Date()) => d.toISOString().slice(0, 10)

export async function nightRows(sb: SupabaseClient, night: string): Promise<RunRow[]> {
  const { data, error } = await sb.from("pipeline_runs").select("*").eq("night", night).order("started_at")
  if (error) throw new Error("pipeline_runs read failed: " + error.message)
  return (data ?? []).map((r: any) => ({ ...r, cost_usd: Number(r.cost_usd) }))
}

export async function startStep(sb: SupabaseClient, step: Step, triggeredBy: string, night = nightOf()): Promise<string> {
  const { data, error } = await sb.from("pipeline_runs").insert({ night, step, triggered_by: triggeredBy }).select("id").single()
  if (error) throw new Error("pipeline_runs insert failed: " + error.message)
  return data.id
}

export type StepResult = {
  status: Exclude<StepStatus, "running">
  units?: number
  costUsd?: number
  searches?: number
  detail?: Record<string, any>
  error?: string
}

export async function finishStep(sb: SupabaseClient, id: string, r: StepResult): Promise<void> {
  const { error } = await sb.from("pipeline_runs").update({
    status: r.status,
    finished_at: new Date().toISOString(),
    units: r.units ?? 0,
    cost_usd: Number((r.costUsd ?? 0).toFixed(6)),
    searches: r.searches ?? 0,
    detail: r.detail ?? {},
    error: r.status === "error" ? (r.error ?? "unknown error").slice(0, 2000) : null,
  }).eq("id", id)
  if (error) throw new Error("pipeline_runs update failed: " + error.message)
}

export type Next =
  | { kind: "run"; step: TickStep; continuation: boolean; retry?: number }
  | { kind: "busy"; step: Step; since: string }
  | { kind: "done" }

const latest = (rows: RunRow[], step: Step) => rows.filter((r) => r.step === step).at(-1)

/**
 * A run that failed: an error, or, for the queue release and the link check
 * (which run once and do not continue), a kill at the time limit.
 */
export const failedRun = (r: Pick<RunRow, "step" | "status" | "detail">) =>
  r.status === "error" || (!(EARLY_STEPS as readonly string[]).includes(r.step) && r.status === "capped" && r.detail?.capReason === "killed")

/**
 * The next tick step for tonight. Stale running rows must already have been
 * closed (closeStale).
 *
 * In order, a step runs when it has no row yet; again when its last run
 * failed, up to MAX_RETRIES retries (failedRun); again when it stopped at the
 * deadline or was killed with work left, up to MAX_CONTINUATIONS (searching,
 * enriching and matching only). Otherwise it is finished: ok, capped at the
 * cap, or out of retries. Google Jobs continues and retries without paying
 * twice: it searches only pairs not searched in the last 20 hours, under what
 * is left of the night's cap (tick.ts).
 *
 * From RESERVED_FROM_MIN only the queue release and the link check run, so
 * a long night cannot crowd them out (Peri, 2026-11-10).
 *
 * Only tick steps make a tick wait. The ATS sweeps run on their own crons
 * beside the ticks and keep their own order (app/api/internal/ingest/run-nightly).
 */
export function nextStep(rows: RunRow[], now: Date = new Date()): Next {
  const running = rows.find((r) => r.status === "running" && (TICK_STEPS as readonly string[]).includes(r.step))
  if (running) return { kind: "busy", step: running.step, since: running.started_at }
  const late = reserved(now)
  for (const step of TICK_STEPS) {
    const early = EARLY_STEPS.includes(step)
    if (late && early) continue
    const mine = rows.filter((r) => r.step === step)
    const last = mine.at(-1)
    if (!last) return { kind: "run", step, continuation: false }
    if (failedRun(last)) {
      const failures = mine.filter(failedRun).length
      if (failures <= MAX_RETRIES) return { kind: "run", step, continuation: true, retry: failures }
      continue
    }
    if (early && resumes(last) && mine.length <= MAX_CONTINUATIONS) return { kind: "run", step, continuation: true }
  }
  return { kind: "done" }
}

/**
 * Closes running rows a killed function left behind, as capped with capReason
 * "killed", so the next run of the step picks up where it stopped. Returns
 * them, so the caller can alert: a kill means a step outran its own deadline,
 * which is a fault to fix even though nothing is lost.
 */
export async function closeStale(sb: SupabaseClient, rows: RunRow[], now = Date.now(), steps: readonly Step[] = STEPS): Promise<RunRow[]> {
  const stale = rows.filter((r) => r.status === "running" && steps.includes(r.step) && now - new Date(r.started_at).getTime() > STALE_RUNNING_MS)
  for (const r of stale) {
    const detail = { ...r.detail, capReason: "killed", killedAfterMin: Math.round((now - new Date(r.started_at).getTime()) / 60_000) }
    await finishStep(sb, r.id, { status: "capped", units: r.units, costUsd: r.cost_usd, searches: r.searches, detail })
    r.status = "capped"
    r.detail = detail
  }
  return stale
}
