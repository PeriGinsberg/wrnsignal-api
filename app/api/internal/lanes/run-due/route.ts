// app/api/internal/lanes/run-due/route.ts
//
// The nightly lane sweep. Runs every active lane once a day, one at a time.
//
// WHY SPACED RATHER THAN PARALLEL. Every lane is several hiring.cafe requests
// (a buildId read plus one search per title). Firing every lane at once turns a
// nightly refresh into a burst against a third party that already drops clients
// it dislikes — and one 429 would fail lanes that had nothing wrong with them.
// So lanes run in sequence with a gap, oldest-run first.
//
// WHY OLDEST-FIRST. The sweep has a wall-clock budget and lanes grow without
// bound, so some day it will not reach the end of the list. Oldest-first makes
// that shortfall rotate: every lane still runs, just not every night. Running in
// creation order would starve the newest lanes forever.
//
// WHAT GETS LOGGED, and why every run writes a row: a lane that stopped RUNNING
// and a lane that is finding nothing look identical from the review queue. Rows
// land in lane_runs per lane; the sweep's own heartbeat goes to monitor_runs
// under monitor='lane-sweep', reusing the table that already answers "did the
// scheduled thing run at all" (20260805_monitor_runs.sql).
//
// PRODUCTION IS EXPECTED TO SKIP. Vercel crons run on every project that
// deploys this vercel.json, and the staging project deploys as "production" —
// the same trap the artifact monitor documents. Prod Supabase has no lane tables
// at all, so this route detects their absence and records a skip instead of
// throwing a nightly error. It starts working by itself the day the lane
// migrations are applied there, with no code change.

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { runLane, type Lane } from "@/lib/laneRunner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// The sweep is deliberately serial and paced, so it needs the long ceiling.
export const maxDuration = 300

const MONITOR_NAME = "lane-sweep"

/**
 * Wall-clock budget for the whole sweep, under maxDuration with room to write
 * the log rows afterwards. Being killed mid-write is what would make the log
 * lie, so the budget exists to guarantee the bookkeeping completes.
 */
const BUDGET_MS = 230_000

/** Gap between lanes. Paced, not parallel — see the header. */
const SPACING_MS = 15_000

/**
 * Do not start a lane with less than this left. A lane cut off halfway wastes
 * the requests it already made and writes a misleading partial result; better to
 * record it as skipped and let tomorrow's rotation pick it up.
 */
const MIN_LANE_MS = 35_000

const LANE_FIELDS =
  "id, client_profile_id, name, active, titles, keyword, location, years_max, companies, exclusions"

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Checked because this
 * route is reachable from the internet and would otherwise let anyone spend our
 * request budget against a third party. Manual runs use the same header.
 */
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Does a table exist? Uses a non-head select on purpose: a head+count select
 * against a missing table returns 204 with error === null, which reads as
 * "exists, zero rows" (see 20260817_search_lanes.sql).
 */
async function tableMissing(supabase: SupabaseClient, table: string, col: string): Promise<boolean> {
  const { error } = await supabase.from(table).select(col).limit(1)
  return error?.code === "PGRST205"
}

/** Heartbeat for the sweep itself, so a stopped cron is detectable. */
async function heartbeat(supabase: SupabaseClient, detail: Record<string, unknown>) {
  // status is constrained to 'ok' | 'alert' by monitor_runs. 'alert' is reserved
  // for a sweep where at least one lane actually failed — a skip is not a fault.
  const status = (detail.lanes_error as number) > 0 ? "alert" : "ok"
  const { error } = await supabase.from("monitor_runs").insert({ monitor: MONITOR_NAME, status, detail })
  // A failed heartbeat must not fail the sweep — the lanes already ran. It is
  // logged loudly instead, which is what the artifact monitor is for.
  if (error) console.error(`[${MONITOR_NAME}] heartbeat insert failed: ${error.message}`)
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS
  const supabase = getSupabaseAdmin()

  // --- environments without the lane feature -------------------------------
  for (const [table, col] of [
    ["search_lanes", "id"],
    ["lane_runs", "id"],
  ] as const) {
    if (await tableMissing(supabase, table, col)) {
      const detail = { skipped: `${table} does not exist in this database`, lanes_error: 0 }
      await heartbeat(supabase, detail)
      return Response.json({ ok: true, skipped: detail.skipped }, { status: 200 })
    }
  }

  const { data: laneRows, error: lanesErr } = await supabase
    .from("search_lanes")
    .select(LANE_FIELDS)
    .eq("active", true)
  if (lanesErr) throw new Error(`could not load lanes: ${lanesErr.message}`)
  const lanes = (laneRows ?? []) as Lane[]

  // Oldest-run first. One query for recent history rather than one per lane; a
  // lane with no history at all sorts first, because it has never run.
  const { data: history } = await supabase
    .from("lane_runs")
    .select("lane_id, started_at")
    .order("started_at", { ascending: false })
    .limit(1000)
  const lastRun = new Map<string, string>()
  for (const h of history ?? []) {
    const row = h as any
    if (!lastRun.has(row.lane_id)) lastRun.set(row.lane_id, row.started_at)
  }
  lanes.sort((a, b) => (lastRun.get(a.id) ?? "").localeCompare(lastRun.get(b.id) ?? ""))

  const summary: Array<{ lane: string; name: string; status: string; added?: number; found?: number; error?: string }> = []
  let ok = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i]

    if (Date.now() + MIN_LANE_MS > deadline) {
      // Record the shortfall rather than returning quietly. A sweep that runs
      // out of budget every night is a capacity problem, and it is only visible
      // if the lanes it never reached say so.
      for (const rest of lanes.slice(i)) {
        await supabase.from("lane_runs").insert({
          lane_id: rest.id,
          status: "skipped",
          trigger: "cron",
          finished_at: new Date().toISOString(),
          duration_ms: 0,
          error: "sweep ran out of its time budget before reaching this lane",
        })
        summary.push({ lane: rest.id, name: rest.name, status: "skipped" })
        skipped++
      }
      break
    }

    // The row is written BEFORE the run, pre-marked as not having reported back.
    // If this function is killed mid-lane the row survives as a visible failure;
    // a row written only on completion would make a timeout look like a lane
    // that never ran.
    const laneStart = Date.now()
    const { data: runRow } = await supabase
      .from("lane_runs")
      .insert({
        lane_id: lane.id,
        status: "error",
        trigger: "cron",
        error: "run did not report back (killed or timed out)",
        titles_run: lane.titles?.length ?? 0,
      })
      .select("id")
      .single()

    try {
      const result = await runLane(lane, supabase)
      const found = result.perTitle.reduce((n, t) => n + t.kept, 0)
      if (runRow?.id) {
        await supabase
          .from("lane_runs")
          .update({
            status: "ok",
            error: null,
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - laneStart,
            titles_run: result.perTitle.length,
            jobs_found: found,
            jobs_added: result.added,
            detail: result.perTitle,
          })
          .eq("id", runRow.id)
      }
      ok++
      summary.push({ lane: lane.id, name: lane.name, status: "ok", added: result.added, found })
    } catch (err: any) {
      const message = err?.message || String(err)
      // One lane failing must not stop the sweep: the others are unrelated, and
      // a board hiccup on lane 1 should not cost every lane behind it.
      if (runRow?.id) {
        await supabase
          .from("lane_runs")
          .update({
            status: "error",
            error: message.slice(0, 1000),
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - laneStart,
          })
          .eq("id", runRow.id)
      }
      failed++
      summary.push({ lane: lane.id, name: lane.name, status: "error", error: message })
      console.error(`[${MONITOR_NAME}] lane ${lane.id} (${lane.name}) failed: ${message}`)
    }

    const isLast = i === lanes.length - 1
    if (!isLast && Date.now() + SPACING_MS + MIN_LANE_MS <= deadline) await sleep(SPACING_MS)
  }

  const detail = {
    lanes_total: lanes.length,
    lanes_ok: ok,
    lanes_error: failed,
    lanes_skipped: skipped,
    duration_ms: Date.now() - startedAt,
    lanes: summary,
  }
  await heartbeat(supabase, detail)

  return Response.json({ ok: true, ...detail }, { status: 200 })
}
