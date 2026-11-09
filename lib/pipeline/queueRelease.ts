/**
 * The nightly Job Queue release (Peri, 2026-11-09): after matching, each client
 * gets at most PIPELINE_QUEUE_LIMIT new jobs in their queue, the best first.
 *
 *   PIPELINE_QUEUE_FLOOR          60  a match under this never enters the queue
 *   PIPELINE_QUEUE_LIMIT           8  released per client per night
 *   PIPELINE_QUEUE_EXPIRE_NIGHTS   7  a match not released within this many
 *                                     nights (its arrival night the first) expires
 *   PIPELINE_QUEUE_DEADLINE_MIN   50  a match at this score or more with a stated
 *                                     deadline within 7 days enters even under the
 *                                     floor and goes first; it counts against the limit
 *
 * Nothing is capped upstream: every search result is stored, enriched and
 * judged as before. The release only decides what a coach sees, and when.
 * The work is release_queue() (20261127_queue_release.sql); this step records
 * its per-client counts in pipeline_runs.detail, which the Monday email sums.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { StepResult } from "./runs"

const int = (v: string | undefined, d: number) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d)

export type QueueSettings = { floor: number; limit: number; expireNights: number; deadlineMin: number }

export function queueSettings(env: Record<string, string | undefined> = process.env): QueueSettings {
  return {
    floor: int(env.PIPELINE_QUEUE_FLOOR, 60),
    limit: int(env.PIPELINE_QUEUE_LIMIT, 8),
    expireNights: int(env.PIPELINE_QUEUE_EXPIRE_NIGHTS, 7),
    deadlineMin: int(env.PIPELINE_QUEUE_DEADLINE_MIN, 50),
  }
}

export type ClientRelease = { released: number; deadline: number; expired: number; belowFloor: number }

/** release_queue()'s result, one entry per client that had anything. Pure. */
export function byClient(r: any): Record<string, ClientRelease> {
  const out: Record<string, ClientRelease> = {}
  const at = (id: string) => (out[id] ??= { released: 0, deadline: 0, expired: 0, belowFloor: 0 })
  for (const [id, v] of Object.entries<any>(r?.released ?? {})) { at(id).released = Number(v.released ?? 0); at(id).deadline = Number(v.deadline ?? 0) }
  for (const [id, n] of Object.entries<any>(r?.expired ?? {})) at(id).expired = Number(n)
  for (const [id, n] of Object.entries<any>(r?.below_floor ?? {})) at(id).belowFloor = Number(n)
  return out
}

export async function queueReleaseStep(sb: SupabaseClient, settings = queueSettings()): Promise<StepResult> {
  // Below-floor counts what arrived since the last release; the first ever counts the last day.
  const { data: prev, error: pErr } = await sb.from("pipeline_runs").select("started_at").eq("step", "queue_release").eq("status", "ok")
    .order("started_at", { ascending: false }).limit(1)
  if (pErr) throw new Error("pipeline_runs read failed: " + pErr.message)
  const since = prev?.[0]?.started_at ?? new Date(Date.now() - 86400e3).toISOString()
  const { data, error } = await sb.rpc("release_queue", {
    p_floor: settings.floor, p_limit: settings.limit, p_expire_nights: settings.expireNights, p_deadline_min: settings.deadlineMin, p_since: since,
  })
  if (error) return { status: "error", error: `release_queue: ${error.message}`, detail: { settings } }
  const clients = byClient(data)
  const total = (k: keyof ClientRelease) => Object.values(clients).reduce((n, c) => n + c[k], 0)
  const overLimit = Object.entries(clients).filter(([, c]) => c.released > settings.limit).map(([id]) => id)
  const detail = { settings, since, clients, released: total("released"), deadline: total("deadline"), expired: total("expired"), belowFloor: total("belowFloor") }
  // Cannot happen (the limit is in the same statement); if it does, the email says so.
  if (overLimit.length) return { status: "error", units: detail.released, detail, error: `released over the limit of ${settings.limit} for ${overLimit.join(", ")}` }
  return { status: "ok", units: detail.released, detail }
}
