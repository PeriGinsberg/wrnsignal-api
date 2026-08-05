// app/api/internal/monitor/artifact-writes/route.ts
//
// The reconciliation monitor. Counts rows per day per artifact table and
// alerts when one goes silent.
//
// WHY THIS EXISTS. positioning_runs stopped persisting on production for two
// weeks and nobody knew. Commit A made that failure audible
// (ARTIFACT_WRITE_FAILED, console.error). This is the listening: a log message
// nobody reads is not a signal, and the positioning message existed the whole
// time.
//
// This check would have fired on 2026-07-24, one day after the last write.
//
// THE SIGNAL IS ZERO-IN-24H AND NOTHING ELSE, deliberately. It is unambiguous
// and it catches the failure that actually happened. Week-over-week drop
// detection was considered and deferred: it is where false positives start,
// and a monitor that cries wolf gets muted, which is the same failure mode as
// no monitor at all, arrived at more slowly.
//
// KNOWN GAP, stated rather than implied away: this does NOT catch per-user
// partial failure. One profile's writes failing while everyone else's succeed
// produces a lower count, not a zero, and a table doing 40/day that drops to
// 35 looks like a quiet Tuesday. The only signal for that is
// ARTIFACT_WRITE_FAILED in the logs, which is grep-on-demand, not push.
//
// LIVENESS. Every run writes a monitor_runs row, healthy or not, so a stopped
// monitor is detectable rather than silent — `SELECT max(ran_at)`. The
// external dead-man's switch (Healthchecks.io) is the other half: it alarms
// when it stops being pinged, which is the only arrangement where the monitor
// failing is itself alerted on, because the alarm lives outside the system it
// watches.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sendMonitorAlert, type TableCounts } from "@/lib/email/sendMonitorAlert"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * THE WATCHED TABLES. One declared constant — adding a table later is a
 * one-line change here, not a hunt through a query. Every table in this list
 * must have a `created_at timestamptz`.
 */
const WATCHED_TABLES = [
  "jobfit_runs",
  "positioning_runs",
  "coverletter_runs",
  "networking_runs",
  "interview_prep_runs",
] as const

const MONITOR_NAME = "artifact-writes"
const DAYS = 7
const DAY_MS = 86_400_000

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Checked because this
 * route is reachable from the internet and would otherwise let anyone trigger
 * an email. Manual runs during verification use the same header.
 */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get("authorization") || ""
  return header === `Bearer ${secret}`
}

/**
 * ALERTS ARE OPT-IN PER ENVIRONMENT, and default to OFF.
 *
 * Found by dry-running the count logic against dev: this signal is calibrated
 * for PRODUCTION volume. Prod does ~40 positioning_runs a day, so zero is
 * unambiguous. Dev does 2 jobfit_runs a WEEK, so "0 in 24h" is a normal
 * Tuesday and the monitor would email every single day.
 *
 * That matters more than it sounds. Vercel crons run on every project that
 * deploys this vercel.json, and the staging project deploys as "production"
 * — so without this guard, staging would send daily false alarms, the alerts
 * would get filtered, and the real one would be filtered with them. A muted
 * monitor is the failure mode this whole commit exists to prevent.
 *
 * The monitor still RUNS everywhere and still writes its heartbeat everywhere,
 * which is what makes it verifiable on dev. It just does not email.
 */
function alertsEnabled(): boolean {
  return process.env.MONITOR_ALERTS_ENABLED === "true"
}

/**
 * Whether the dead-man's switch was actually armed on this run.
 *
 *   true             pinged, and the ping was accepted
 *   false            configured, but the ping did not land
 *   "not_configured" no URL set for this environment
 */
type PingResult = true | false | "not_configured"

/**
 * Best-effort ping to the external dead-man's switch. Never blocks the run,
 * but ALWAYS reports what happened.
 *
 * This function shipped broken once and is worth the comment. It read
 * HEALTHCHECK_PING_URL while the variable was named HEALTHCHECKS_PING_URL, so
 * it returned early on every run and the swallowing catch meant nothing was
 * logged — the monitor answered `ok: true` while its own liveness switch was
 * never armed. That is precisely the false comfort this whole workstream
 * exists to remove, reproduced inside the tool built to prevent it.
 *
 * The fix is not just the name: the RESULT is now returned and surfaced in the
 * response body, so "the switch is armed" is something the monitor states
 * rather than something a reader infers from silence.
 *
 * PROD ONLY, deliberately. Do NOT set this on staging: staging pinging the
 * production check would keep it green while production was dead, which is
 * worse than having no check at all — the alarm would be actively lying.
 */
async function pingDeadMansSwitch(): Promise<PingResult> {
  const url = process.env.HEALTHCHECKS_PING_URL
  if (!url) return "not_configured"
  try {
    const res = await fetch(url, { method: "POST" })
    return res.ok
  } catch {
    // A failed ping is not a failed monitor, so this stays swallowed and the
    // run still succeeds. Healthchecks.io will alarm on its own if the pings
    // stop, which is the point. But it is reported, not hidden.
    return false
  }
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const now = Date.now()
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"

  try {
    const counts: TableCounts[] = []
    const unreadable: string[] = []

    for (const table of WATCHED_TABLES) {
      const daily: number[] = []
      let readable = true
      // Newest bucket first, so daily[0] is the last 24 hours.
      for (let d = 0; d < DAYS; d++) {
        const to = new Date(now - d * DAY_MS).toISOString()
        const from = new Date(now - (d + 1) * DAY_MS).toISOString()
        const { count, error } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .gte("created_at", from)
          .lt("created_at", to)
        if (error) { readable = false; break }
        daily.push(count ?? 0)
      }

      if (!readable) {
        // A table that cannot be READ is a louder problem than one that is
        // quiet, and it must not be reported as "0 rows" — that would be the
        // monitor inventing a clean answer from a broken one.
        unreadable.push(table)
        continue
      }

      counts.push({
        table,
        daily,
        last24h: daily[0] ?? 0,
        total7d: daily.reduce((a, b) => a + b, 0),
      })
    }

    // A table with NO rows in the whole window has never been written and is
    // not silent — it is new. interview_prep_runs is exactly this today. Only
    // a table with history behind it can go quiet.
    const silentTables = counts
      .filter((c) => c.last24h === 0 && c.total7d > 0)
      .map((c) => c.table)

    const problem = silentTables.length > 0 || unreadable.length > 0
    const status: "ok" | "alert" = problem ? "alert" : "ok"

    // HEARTBEAT FIRST, and unconditionally. Written before the email so a
    // Postmark outage cannot make a run that happened look like a run that
    // never did.
    const { error: hbErr } = await supabase.from("monitor_runs").insert({
      monitor: MONITOR_NAME,
      status,
      detail: { environment, counts, silentTables, unreadable },
    })
    if (hbErr) {
      console.error(
        `MONITOR_HEARTBEAT_FAILED monitor=${MONITOR_NAME} reason=${hbErr.message}`,
      )
    }

    const alerted = problem && alertsEnabled()
    if (alerted) {
      await sendMonitorAlert({
        silentTables: [...silentTables, ...unreadable.map((t) => `${t} (unreadable)`)],
        counts,
        environment,
      })
    }

    // Deliberately AFTER the heartbeat, so a slow or failing third party can
    // never stop the run being recorded. That ordering is also why `pinged` is
    // not in the heartbeat row: it is not known yet when that row is written.
    const pinged = await pingDeadMansSwitch()

    // `alerted` and `pinged` are returned so a manual run STATES its own
    // liveness instead of leaving it to be inferred from an empty inbox or a
    // dashboard that never went green.
    return Response.json({ ok: true, status, alerted, pinged, silentTables, unreadable, counts })
  } catch (err: any) {
    // A thrown monitor is a dead monitor. Say so loudly, and deliberately do
    // NOT ping the dead-man's switch — letting Healthchecks.io notice the
    // silence is the whole reason it exists.
    console.error(`MONITOR_FAILED monitor=${MONITOR_NAME} reason=${err?.message || String(err)}`)
    return Response.json({ ok: false, error: err?.message || String(err) }, { status: 500 })
  }
}
