#!/usr/bin/env tsx
/**
 * Run one search lane: fan out to hiring.cafe, one query per lane title, then
 * upsert the results into lane_results.
 *
 * Usage:
 *   npx tsx scripts/run-search-lane.ts --lane <uuid>
 *   npx tsx scripts/run-search-lane.ts --lane <uuid> --dry-run   # fetch + filter, no writes
 *   npx tsx scripts/run-search-lane.ts --list                    # lanes with counts
 *   npx tsx scripts/run-search-lane.ts --lane <uuid> --days 14
 *   npx tsx scripts/run-search-lane.ts --lane-json <path>        # a lane that isn't saved yet
 *
 * --lane-json runs a lane config from a file (propose-search-lane.ts --json
 * writes one) instead of loading a row. It is always a dry run: there is no
 * lane row for lane_results.lane_id to reference, so writing is not a policy
 * choice here, it is impossible. The point is that a proposal is tested by the
 * same filter code that runs saved lanes — a second implementation of
 * applyLaneFilters would let a proposal pass a check the real runner fails.
 *
 * Hits whatever SUPABASE_URL points to in .env.local.
 *
 * Dedup: (lane_id, job_id) is unique, so re-running is idempotent. A job the
 * lane already knows about gets its mutable fields refreshed and last_seen_at
 * advanced; first_seen_at is left alone, because "when did this lane first
 * surface this job" is the whole point of keeping history. That is why the
 * upsert cannot be a blind whole-row overwrite.
 *
 * The same job legitimately arrives from more than one title in a single run
 * (a posting matches both "sports coordinator" and "partnership coordinator").
 * We fold in memory before touching the database, because sending both to one
 * upsert call would have them collide on the unique constraint inside a single
 * statement — Postgres rejects that outright ("cannot affect row a second
 * time"), rather than picking a winner.
 */

import { createClient } from "@supabase/supabase-js"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { runLane, resolvePresets, type Lane, type TitleOutcome } from "../lib/laneRunner"

function loadEnvLocal() {
  for (const name of [".env.local", ".env.development.local"]) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    try {
      // @ts-ignore - Node 20.6+
      if (typeof process.loadEnvFile === "function") {
        // @ts-ignore
        process.loadEnvFile(path)
        return
      }
    } catch {}
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)")
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

/**
 * Everything about actually running a lane — the filters, the fold, the upsert
 * and the three-state location rule — lives in lib/laneRunner.ts, because the
 * nightly cron runs the same code. This file is the command line around it:
 * argument parsing, the run log, and the table at the end.
 */

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

async function listLanes() {
  const { data, error } = await sb
    .from("search_lanes")
    .select("id, name, active, titles, location, years_max, client_profile_id")
    .order("created_at")
  if (error) throw new Error(error.message)
  if (!data?.length) return console.log("no lanes")
  for (const l of data) {
    const { count } = await sb
      .from("lane_results")
      .select("*", { count: "exact", head: true })
      .eq("lane_id", l.id)
    console.log(
      `${l.id}  ${l.active ? "active " : "paused "} ${String(l.name).padEnd(28)} ` +
        `${(l.titles as string[]).length} titles  ${count ?? 0} results`
    )
  }
}

async function runOneLane(l: Lane, opts: { dryRun: boolean; days: number; pages: number }) {
  if (!l.active) console.log(`(lane is paused — running anyway because it was named explicitly)\n`)

  let markets: string
  try {
    const presets = resolvePresets(l)
    markets = presets.length ? `${presets.join(", ")} @ ${l.location?.radius_miles ?? 25}mi` : "(no filter — nationwide)"
  } catch (e: any) {
    markets = `(not set — will error: ${e.message})`
  }
  console.log(`lane: ${l.name}  (${l.id})`)
  console.log(`  titles:     ${l.titles.join(" | ")}`)
  console.log(`  keyword:    ${l.keyword ?? "(none)"}`)
  console.log(`  location:   ${markets}, posted ≤ ${opts.days}d`)
  console.log(`  years_max:  ${l.years_max ?? "none"}`)
  console.log(`  companies:  ${l.companies?.length ? l.companies.join(", ") : "(no restriction)"}`)
  console.log(`  exclusions: ${JSON.stringify(l.exclusions || {})}`)
  console.log()

  // Printed as each title finishes rather than collected and dumped, so a slow
  // run shows progress instead of looking hung.
  const onTitle = (t: TitleOutcome) => {
    const dropStr = Object.entries(t.dropped).map(([k, v]) => `${v} ${k}`).join(", ")
    console.log(
      `  "${t.query}" → ${t.fetched} fetched of ${t.available} available, ` +
        `${t.kept} pass filters, ${t.fresh} new to this run` +
        (dropStr ? `  [dropped: ${dropStr}]` : "") +
        (t.capped ? `  ⚠ capped at ${opts.pages} page(s) — pass --pages to go deeper` : "")
    )
  }

  const result = await runLane(l, sb, { days: opts.days, pages: opts.pages, dryRun: opts.dryRun, onTitle })

  console.log(`\n${result.unique} unique jobs after folding titles`)
  if (opts.dryRun) {
    console.log("(--dry-run: nothing written)\n")
    return
  }
  console.log(`upserted ${result.written}: ${result.added} new, ${result.refreshed} refreshed\n`)

  // A manual run is logged too, tagged 'manual', so a burst of CLI runs during
  // debugging cannot be mistaken for the nightly sweep misfiring.
  const { error: logErr } = await sb.from("lane_runs").insert({
    lane_id: l.id,
    status: "ok",
    trigger: "manual",
    finished_at: new Date().toISOString(),
    titles_run: result.perTitle.length,
    jobs_found: result.perTitle.reduce((n, t) => n + t.kept, 0),
    jobs_added: result.added,
    detail: result.perTitle,
  })
  // Absent table = migration not applied here yet; say so once and carry on
  // rather than failing a run that already succeeded.
  if (logErr) console.log(`(not logged to lane_runs: ${logErr.message})\n`)
}

async function loadLane(laneId: string): Promise<Lane> {
  const { data, error } = await sb.from("search_lanes").select("*").eq("id", laneId).single()
  if (error) throw new Error(`lane ${laneId}: ${error.message}`)
  return data as Lane
}

/**
 * A proposal read off disk. Defaults fill the columns the DB would have
 * defaulted, so an unsaved lane and a saved one reach applyLaneFilters in the
 * same shape — a missing `companies` must arrive as [] ("no restriction"), not
 * as undefined.
 */
function laneFromFile(path: string): Lane {
  const raw = JSON.parse(readFileSync(path, "utf8"))
  if (!Array.isArray(raw.titles) || !raw.titles.length) throw new Error(`${path}: lane has no titles`)
  return {
    id: `(unsaved: ${path})`,
    client_profile_id: raw.client_profile_id ?? "(none)",
    name: raw.name ?? "(unnamed proposal)",
    active: raw.active ?? true,
    titles: raw.titles,
    keyword: raw.keyword ?? null,
    location: raw.location ?? {},
    years_max: raw.years_max ?? null,
    companies: raw.companies ?? [],
    exclusions: raw.exclusions ?? {},
  }
}

async function main() {
  if (process.argv.includes("--list")) return listLanes()

  const laneFile = arg("lane-json")
  const laneId = arg("lane")
  if (!laneFile && !laneId) {
    console.error(
      "usage: run-search-lane.ts --lane <uuid> [--dry-run] [--days N] [--pages N]\n" +
        "       run-search-lane.ts --lane-json <path> [--days N] [--pages N]\n" +
        "       run-search-lane.ts --list"
    )
    process.exit(1)
  }

  const lane = laneFile ? laneFromFile(laneFile) : await loadLane(laneId!)
  await runOneLane(lane, {
    // An unsaved lane has no id to write results against, so --dry-run is not
    // optional there; forcing it beats accepting the flag and ignoring it.
    dryRun: Boolean(laneFile) || process.argv.includes("--dry-run"),
    days: Number(arg("days", "29")),
    pages: Number(arg("pages", "1")),
  })
}

// Guarded so this file can be imported without running the CLI. Nothing
// imports it today — queryFor moved to lib/hiringcafe.ts — but the guard costs
// nothing and its absence is the kind of thing you discover at the worst time.
if (require.main === module) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
