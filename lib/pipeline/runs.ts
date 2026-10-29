/**
 * The nightly pipeline's record: one pipeline_runs row per step per run
 * (20261111_nightly_pipeline.sql).
 *
 * A NIGHT IS A UTC DATE. The ATS sweeps (03:00, 04:30), the pipeline ticks
 * (05:00-07:45) and the watchdog (09:00) all fall on the same UTC date, so they
 * share one key without any timezone arithmetic.
 *
 * WHAT RUNS NEXT is decided from the rows alone (nextStep), so a tick that is
 * killed, skipped or late leaves the next tick knowing exactly where to pick up.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export const STEPS = ["ats_grnhse", "ats_smartrecruiters", "google_jobs", "enrich", "match", "link_check"] as const
export type Step = (typeof STEPS)[number]
/** The steps the tick runs, in order. The ATS sweeps keep their own crons and only record here. */
export const TICK_STEPS = ["google_jobs", "enrich", "match", "link_check"] as const
export type TickStep = (typeof TICK_STEPS)[number]
export type StepStatus = "running" | "ok" | "capped" | "error"

/**
 * Why a step stopped with work left. "deadline": the function's time ran out;
 * the next tick continues. "cap": the nightly cap is spent; nothing more runs
 * tonight and the cap alert goes out.
 */
export type CapReason = "deadline" | "cap"

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
  | { kind: "run"; step: TickStep; continuation: boolean }
  | { kind: "busy"; step: Step; since: string }
  | { kind: "done" }

const latest = (rows: RunRow[], step: Step) => rows.filter((r) => r.step === step).at(-1)

/**
 * The next tick step for tonight. Stale running rows must already have been
 * closed (closeStale). A step is finished when its latest row is ok, error or
 * capped at the cap; capped at the deadline means run it again, up to
 * MAX_CONTINUATIONS. Google Jobs and the link check run once a night: a second
 * Google Jobs run would spend a second night's searches.
 */
export function nextStep(rows: RunRow[]): Next {
  const running = rows.find((r) => r.status === "running")
  if (running) return { kind: "busy", step: running.step, since: running.started_at }
  for (const step of TICK_STEPS) {
    const last = latest(rows, step)
    if (!last) return { kind: "run", step, continuation: false }
    const resumable = step === "enrich" || step === "match"
    const runs = rows.filter((r) => r.step === step).length
    if (resumable && last.status === "capped" && last.detail?.capReason === "deadline" && runs <= MAX_CONTINUATIONS) {
      return { kind: "run", step, continuation: true }
    }
  }
  return { kind: "done" }
}

/** Closes running rows a killed function left behind. Returns them, so the caller can alert. */
export async function closeStale(sb: SupabaseClient, rows: RunRow[], now = Date.now()): Promise<RunRow[]> {
  const stale = rows.filter((r) => r.status === "running" && now - new Date(r.started_at).getTime() > STALE_RUNNING_MS)
  for (const r of stale) {
    await finishStep(sb, r.id, { status: "error", error: `did not finish: still running ${Math.round((now - new Date(r.started_at).getTime()) / 60_000)} min after it started (function killed or timed out)` })
    r.status = "error"
  }
  return stale
}
