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
import { sendStalenessAlert, type StalenessAlert } from "../email/sendIngestAlert"

export const DEFAULT_THRESHOLD_HOURS = 36

export type StalenessResult = {
  stale: boolean
  /** null when ingest_runs is empty: never run at all. */
  lastRunAt: string | null
  hoursSince: number | null
  thresholdHours: number
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

  const alert: StalenessAlert | null = stale
    ? {
        environment,
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

  return { stale, lastRunAt, hoursSince, thresholdHours, alert }
}
