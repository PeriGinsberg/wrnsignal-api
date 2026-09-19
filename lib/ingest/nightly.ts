/**
 * The nightly sweep: every active pair, every configured board, both sources.
 *
 * WHAT IT WRITES: one ingest_runs row per board per pair, and postings. It
 * DELETES NOTHING. ingest_runs is the record of what ingest did, and the only
 * reason 193 SmartRecruiters adds are currently unaccounted for is that an
 * earlier test tidied its own rows away.
 *
 * WHAT IT ALERTS ON, and nothing else:
 *   1. zero total found across every pair and board
 *   2. any control_passed = false
 *   3. any status = error
 *
 * Each is unambiguous and each is a fault rather than a slow night. Threshold
 * alerting ("found dropped 40%") was considered and left out for the reason
 * the artifact monitor states: it is where false positives start, and a
 * monitor that cries wolf gets muted, which is the same end state as no
 * monitor reached more slowly.
 *
 * A ZERO FROM ONE BOARD IS NOT A FAULT. HMGroup, RedBull and Ramboll3 all
 * legitimately return 0 for "analyst" in New York while passing their controls.
 * Zero is only alerting when EVERY board of EVERY pair returns nothing at once,
 * which is a system failure, not a market.
 */

import { type SupabaseClient } from "@supabase/supabase-js"
import { loadSources } from "./boards"
import { runSweep, type BoardOutcome } from "./runner"
import type { IngestPair } from "./types"
import { sendIngestAlert, alertSubject, alertBody, type AlertReason, type IngestAlert } from "../email/sendIngestAlert"

export type NightlyResult = {
  alert: IngestAlert | null
  /** Flat record of every board-run, for printing or testing. */
  runs: { source: string; org: string; pair: string; outcome: BoardOutcome }[]
  totals: IngestAlert["totals"]
  durationMs: number
}

/** Active pairs, from the table. No fallback: an empty table is a real state. */
async function loadPairs(sb: SupabaseClient): Promise<IngestPair[]> {
  const { data, error } = await sb
    .from("ingest_pairs")
    .select("id, title, location")
    .eq("active", true)
    .order("title")
  if (error) throw new Error(`could not load ingest_pairs: ${error.message}`)
  return (data || []).map((p: any) => ({ id: p.id, title: p.title, location: p.location }))
}

export async function runNightly(
  sb: SupabaseClient,
  opts: { environment?: string; dryRun?: boolean; source?: string } = {}
): Promise<NightlyResult> {
  const environment = opts.environment ?? process.env.VERCEL_ENV ?? "local"
  const startedAt = Date.now()

  const pairs = await loadPairs(sb)
  // ONE SOURCE PER CALL when `source` is given. Each source now has its own
  // cron on its own schedule: a 149-board combined sweep took 731s against a
  // 300s function ceiling, and one source failing should not delay or cancel
  // the other. Each writes its own ingest_runs rows and alerts on its own.
  const allSources = await loadSources(sb)
  const sources = opts.source ? allSources.filter((s) => s.adapter.source === opts.source) : allSources
  if (opts.source && !sources.length) {
    throw new Error(
      `no active boards for source "${opts.source}" in ingest_boards ` +
        `(configured: ${allSources.map((s) => s.adapter.source).join(", ") || "none"})`
    )
  }
  const runs: NightlyResult["runs"] = []

  for (const { adapter, boards } of sources) {
    // runSweep caches boards for local-filtering sources and does not for
    // server-filtering ones, so this one call is correct for both.
    const swept = await runSweep(adapter, pairs, boards, sb)
    for (const { pair, outcomes } of swept) {
      for (const outcome of outcomes) {
        runs.push({ source: adapter.source, org: outcome.org, pair: pair.title, outcome })
      }
    }
  }

  const totals = {
    pairs: pairs.length,
    boards: sources.reduce((n, s) => n + s.boards.length, 0),
    runs: runs.length,
    found: runs.reduce((n, r) => n + r.outcome.foundCount, 0),
    added: runs.reduce((n, r) => n + r.outcome.addedCount, 0),
    requests: runs.reduce((n, r) => n + r.outcome.requestsMade, 0),
  }

  // ---- the three conditions
  const reasons: AlertReason[] = []

  if (totals.found === 0) reasons.push({ kind: "zero_found", totalFound: 0 })

  // STRICTLY false. A null control could not be performed -- an empty board has
  // nothing to narrow -- and is not evidence of a broken filter.
  const failed = runs.filter((r) => r.outcome.controlPassed === false)
  if (failed.length) {
    reasons.push({
      kind: "control_failed",
      rows: failed.map((r) => ({
        source: r.source,
        org: r.org,
        pair: r.pair,
        detail: r.outcome.status === "skipped" ? "skipped, nothing ingested" : r.outcome.status,
      })),
    })
  }

  const errored = runs.filter((r) => r.outcome.status === "error")
  if (errored.length) {
    reasons.push({
      kind: "run_error",
      rows: errored.map((r) => ({
        source: r.source,
        org: r.org,
        pair: r.pair,
        error: (r.outcome.error ?? "").slice(0, 200),
      })),
    })
  }

  const lines = runs.map(
    (r) =>
      "  " +
      (r.source + "/" + r.org).padEnd(30) +
      ('"' + r.pair + '"').padEnd(14) +
      r.outcome.status.padEnd(9) +
      "ctrl=" + String(r.outcome.controlPassed).padEnd(6) +
      "found=" + String(r.outcome.foundCount).padStart(4) +
      "  added=" + String(r.outcome.addedCount).padStart(4) +
      "  req=" + r.outcome.requestsMade
  )

  const durationMs = Date.now() - startedAt
  const alert: IngestAlert | null = reasons.length
    ? { environment, reasons, lines, totals, durationMs }
    : null

  if (alert && !opts.dryRun) await sendIngestAlert(alert)

  return { alert, runs, totals, durationMs }
}

export { alertSubject, alertBody }
