/**
 * Has ingest run at all?
 *
 * SEPARATE FROM THE SWEEP, DELIBERATELY AND NECESSARILY. The failure this
 * catches is the nightly run NOT HAPPENING, so it cannot live inside the
 * nightly run: a check that only executes when the thing it checks executes
 * can never fire. That is the mistake lane_results made -- the only evidence a
 * lane had stopped was the absence of rows, and absence is not a signal.
 *
 * So this reads max(created_at) from ingest_runs and nothing else. It does not
 * call an adapter, does not need the sweep's config, and does not care why the
 * rows are missing. It answers one question: when did ingest last write
 * anything, and was that too long ago.
 *
 * WHY 36 HOURS for a nightly job. 24 would fire on an ordinary late run or a
 * cron drifting by an hour; 48 would let a whole day pass unnoticed. 36 misses
 * no more than one scheduled run and tolerates a late one.
 *
 * WHAT THIS STILL DOES NOT CATCH, stated rather than implied away: if the
 * platform's scheduler is down, this check does not run either, and its
 * silence looks exactly like health. The only arrangement that catches that is
 * an alarm living outside the system -- the external dead-man's switch the
 * artifact-write monitor already uses (HEALTHCHECKS_PING_URL), which alarms
 * when it STOPS being pinged. This function is the inner layer of that pair,
 * not a replacement for it.
 */

import { type SupabaseClient } from "@supabase/supabase-js"
import { sendStalenessAlert, type StalenessAlert, type StuckRun } from "../email/sendIngestAlert"

export const DEFAULT_THRESHOLD_HOURS = 36

/**
 * STUCK RUNS (added 2026-10-25). Enrichment and matching runs open a row as
 * 'running' and close it when they finish. One that hangs, or whose process
 * dies, leaves the row open forever and nothing else notices: a backfill batch
 * stalled for an hour that night and only a person watching saw it. Every run
 * so far took under 30 minutes, so 2 hours is long past any healthy run.
 */
export const STUCK_RUN_HOURS = 2

const RUN_TABLES = [
  { table: "enrichment_runs", rowsTable: "postings", fk: "enrichment_run_id" },
  { table: "match_runs", rowsTable: "posting_matches", fk: "match_run_id" },
] as const

export async function findStuckRuns(
  sb: SupabaseClient,
  now: Date,
  hours = STUCK_RUN_HOURS,
): Promise<{ stuck: StuckRun[]; errors: string[] }> {
  const cutoff = new Date(now.getTime() - hours * 3_600_000).toISOString()
  const stuck: StuckRun[] = []
  const errors: string[] = []
  for (const t of RUN_TABLES) {
    const { data, error } = await sb.from(t.table).select("id, started_at, triggered_by").eq("status", "running").lt("started_at", cutoff)
    // PGRST205: the table does not exist in this environment, so nothing can be stuck in it.
    if (error) { if (error.code !== "PGRST205") errors.push(`${t.table}: ${error.message}`); continue }
    for (const r of data ?? []) {
      const { count } = await sb.from(t.rowsTable).select("id", { count: "exact", head: true }).eq(t.fk, r.id)
      stuck.push({
        table: t.table, id: r.id, startedAt: r.started_at, triggeredBy: r.triggered_by,
        hoursRunning: (now.getTime() - Date.parse(r.started_at)) / 3_600_000, written: count ?? null,
      })
    }
  }
  return { stuck, errors }
}

export type StalenessResult = {
  stale: boolean
  /** null when ingest_runs is empty: never run at all. */
  lastRunAt: string | null
  hoursSince: number | null
  thresholdHours: number
  stuckRuns: StuckRun[]
  checkErrors: string[]
  alert: StalenessAlert | null
}

export async function checkStaleness(
  sb: SupabaseClient,
  opts: { thresholdHours?: number; environment?: string; dryRun?: boolean; now?: Date } = {}
): Promise<StalenessResult> {
  const thresholdHours = opts.thresholdHours ?? DEFAULT_THRESHOLD_HOURS
  const environment = opts.environment ?? process.env.VERCEL_ENV ?? "local"
  const now = opts.now ?? new Date()

  const { data, error } = await sb
    .from("ingest_runs")
    .select("created_at, source, org_slug, pair_title, status")
    .order("created_at", { ascending: false })
    .limit(5)
  if (error) throw new Error(`could not read ingest_runs: ${error.message}`)

  const rows = data || []
  const lastRunAt = rows[0]?.created_at ?? null
  const hoursSince =
    lastRunAt === null ? null : (now.getTime() - Date.parse(lastRunAt)) / 3_600_000

  // AN EMPTY TABLE IS STALE. "Never run" and "has not run in two days" are the
  // same operational fact: nothing is ingesting. Treating null as healthy would
  // make a brand new deployment that never wired up its cron look fine forever.
  const stale = hoursSince === null || hoursSince > thresholdHours
  const { stuck, errors } = await findStuckRuns(sb, now)

  const alert: StalenessAlert | null = stale || stuck.length || errors.length
    ? {
        environment,
        stale,
        stuckRuns: stuck,
        stuckAfterHours: STUCK_RUN_HOURS,
        checkErrors: errors,
        lastRunAt,
        hoursSince,
        thresholdHours,
        recent: rows.map((r: any) => ({
          source: r.source,
          org: r.org_slug ?? "(no board)",
          pair: r.pair_title ?? "(no pair)",
          status: r.status,
          at: r.created_at,
        })),
      }
    : null

  if (alert && !opts.dryRun) await sendStalenessAlert(alert)

  return { stale, lastRunAt, hoursSince, thresholdHours, stuckRuns: stuck, checkErrors: errors, alert }
}
