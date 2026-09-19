/**
 * Runs one ingest_pair against one source, across that source's boards, and
 * records what happened.
 *
 * ONE ingest_runs ROW PER BOARD. A run is "we asked this board this question",
 * so five boards produce five rows and "which board failed" is a column rather
 * than a JSONB dig.
 *
 * THE CONTROL COMES FIRST, FOR EVERY BOARD, AND AN EXPLICIT FAILURE VETOES THE
 * WHOLE PAIR. Each board is asked to prove its filter narrows. If any board
 * answers false, nothing is ingested for the pair and every board gets a
 * skipped row carrying its own control_passed, so the one that broke is
 * identifiable.
 *
 * Pair-level abort is kept deliberately, rather than skipping only the failing
 * board. A board that ignores its filter is evidence the source is not
 * behaving as understood, and the useful response is to stop and look rather
 * than to ingest four fifths of an answer. Per-board veto is now expressible
 * if that judgement changes: it is a one-line change here, not a schema change.
 *
 * A null CONTROL IS NOT A VETO. null means the control could not be performed
 * -- an empty board has nothing to narrow -- which is not evidence of a broken
 * filter. A board whose control THREW is a third case: it does not veto the
 * others, but it cannot be fetched either, so it gets an error row of its own.
 *
 * THE COUNTS CLOSE: found = added + refound + intra_run_duplicate. Each posting
 * is classified once, at the moment it is written, from evidence the database
 * returns rather than from a guess.
 */

import { type SupabaseClient } from "@supabase/supabase-js"
import type { FetchedPosting, IngestPair, SourceAdapter } from "./types"

export type BoardOutcome = {
  runId: string | null
  org: string
  status: "ok" | "error" | "skipped"
  controlPassed: boolean | null
  requestsMade: number
  foundCount: number
  addedCount: number
  refoundCount: number
  intraRunDuplicateCount: number
  error: string | null
}

/** Politeness gap between board calls. */
const SPACING_MS = 500
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Classification = "added" | "refound" | "intra_run_duplicate"

/**
 * Write one posting and say which of the three it was.
 *
 * ADDED is read off the row itself: on insert first_seen_at and last_seen_at
 * take the same statement timestamp, and on update postings_touch_last_seen
 * advances last_seen_at while pinning first_seen_at, so they differ. Equal
 * means inserted.
 *
 * REFOUND vs INTRA_RUN_DUPLICATE is then decided by whether this run has
 * already touched that fingerprint. The fingerprint comes back from the
 * database rather than being recomputed here, because a TypeScript mirror of
 * the SQL normalization is a thing that drifts.
 *
 * ONE ROW AT A TIME, on purpose. Two postings in one batch can share a
 * fingerprint, and Postgres rejects a statement that touches one row twice
 * rather than picking a winner. Batching needs the fold done in SQL.
 */
async function upsertPosting(
  sb: SupabaseClient,
  source: string,
  org: string,
  p: FetchedPosting,
  seen: Set<string>
): Promise<Classification> {
  const { data, error } = await sb
    .from("postings")
    .upsert(
      {
        source,
        org_slug: org,
        source_job_id: p.source_job_id,
        title: p.title,
        company: p.company,
        location: p.location,
        apply_url: p.apply_url,
        posted_at: p.posted_at,
        raw: p.raw,
        // first_seen_at and last_seen_at are deliberately absent. See types.ts.
      },
      { onConflict: "fingerprint", ignoreDuplicates: false }
    )
    .select("fingerprint, first_seen_at, last_seen_at")

  if (error) throw new Error(`upsert failed for "${p.title}" @ ${p.company}: ${error.message}`)
  const row = data?.[0]
  if (!row) throw new Error(`upsert returned no row for "${p.title}" @ ${p.company}`)

  const alreadyThisRun = seen.has(row.fingerprint)
  seen.add(row.fingerprint)

  if (alreadyThisRun) return "intra_run_duplicate"
  return Date.parse(row.first_seen_at) === Date.parse(row.last_seen_at) ? "added" : "refound"
}

/**
 * Boards already downloaded in this sweep, keyed by org.
 *
 * SWEEP-SCOPED, NOT PROCESS-SCOPED. It lives for one runSweep call and is
 * thrown away after, so a board is at most as stale as the sweep is long.
 * A module-level cache would quietly serve yesterday's board.
 */
export type BoardCache = Map<string, unknown>

/**
 * Run several pairs against the same boards, downloading each board once.
 *
 * ONLY FOR LOCAL-FILTERING SOURCES. A server-filtering source issues a
 * genuinely different query per pair -- SmartRecruiters' `q=analyst` and
 * `q=director` are different requests with different answers -- so there is
 * nothing to reuse and caching would be wrong, not just useless. The guard is
 * on adapter.filtering rather than on a flag a caller could get wrong.
 */
export async function runSweep(
  adapter: SourceAdapter,
  pairs: IngestPair[],
  orgs: string[],
  sb: SupabaseClient
): Promise<{ pair: IngestPair; outcomes: BoardOutcome[] }[]> {
  const cache: BoardCache | null = adapter.filtering === "local" ? new Map() : null
  const results: { pair: IngestPair; outcomes: BoardOutcome[] }[] = []
  for (const pair of pairs) {
    results.push({ pair, outcomes: await runPair(adapter, pair, orgs, sb, cache) })
  }
  return results
}

export async function runPair(
  adapter: SourceAdapter,
  pair: IngestPair,
  orgs: string[],
  sb: SupabaseClient,
  cache?: BoardCache | null
): Promise<BoardOutcome[]> {
  const startedAt = Date.now()

  const writeRun = async (o: {
    org: string
    status: "ok" | "error" | "skipped"
    controlPassed: boolean | null
    requests: number
    found: number
    added: number
    refound: number
    dup: number
    controlDetail: Record<string, unknown> | null
    error: string | null
  }): Promise<string | null> => {
    const { data, error } = await sb
      .from("ingest_runs")
      .insert({
        source: adapter.source,
        org_slug: o.org,
        // Requires 20260918_ingest_runs_filtering.sql.
        filtering: adapter.filtering,
        pair_id: pair.id,
        pair_title: pair.title,
        pair_location: pair.location,
        status: o.status,
        requests_made: o.requests,
        found_count: o.found,
        added_count: o.added,
        refound_count: o.refound,
        intra_run_duplicate_count: o.dup,
        control_passed: o.controlPassed,
        control_detail: o.controlDetail,
        error: o.error,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      })
      .select("id")
    if (error) {
      // An unlogged run is the exact state this table exists to prevent.
      throw new Error(`ingest_runs insert failed: ${error.message}`)
    }
    return data?.[0]?.id ?? null
  }

  // ---- 1. control every board before anything is ingested
  const controls = new Map<
    string,
    {
      passed: boolean | null
      requests: number
      detail: Record<string, unknown> | null
      error: string | null
      carry?: unknown
    }
  >()

  for (const org of orgs) {
    let spent = 0
    try {
      const c = await adapter.control(pair, org, cache?.get(org))
      spent = c.requests
      // Keep whatever the adapter handed back, so the next pair in this sweep
      // gets it instead of downloading the board again.
      if (cache && c.carry !== undefined) cache.set(org, c.carry)
      controls.set(org, {
        passed: c.passed,
        requests: c.requests,
        // Stamped by the runner rather than trusted from the adapter, so every
        // row says which claim its control_passed is making even if an adapter
        // forgets to put it in its own detail.
        detail: { filtering: adapter.filtering, ...(c.detail ?? {}) },
        error: null,
        carry: c.carry,
      })
    } catch (err: any) {
      // A control that could not run is NOT a control that passed.
      spent = 1
      controls.set(org, {
        passed: null,
        requests: 1,
        detail: { filtering: adapter.filtering },
        error: err?.message || String(err),
      })
    }
    // Pace only when a request was actually made. Sleeping between cache hits
    // would make a cached sweep no faster than an uncached one.
    if (spent > 0) await sleep(SPACING_MS)
  }

  // ONLY AN EXPLICIT false VETOES. null means the control could not be
  // performed -- an empty board, or a control request that threw -- which is
  // not evidence that the filter is broken. Treating null as a veto would let
  // one employer with no open roles abort the pair for every other board.
  const vetoed = orgs.some((o) => controls.get(o)?.passed === false)

  if (vetoed) {
    const out: BoardOutcome[] = []
    for (const org of orgs) {
      const c = controls.get(org)!
      const status = c.error ? "error" : "skipped"
      const runId = await writeRun({
        org,
        status,
        controlPassed: c.passed,
        requests: c.requests,
        found: 0,
        added: 0,
        refound: 0,
        dup: 0,
        controlDetail: c.detail,
        error: c.error,
      })
      out.push({
        runId,
        org,
        status,
        controlPassed: c.passed,
        requestsMade: c.requests,
        foundCount: 0,
        addedCount: 0,
        refoundCount: 0,
        intraRunDuplicateCount: 0,
        error: c.error,
      })
    }
    return out
  }

  // ---- 2. the real fetch, now that no board has failed its control
  const out: BoardOutcome[] = []
  for (const org of orgs) {
    const c = controls.get(org)!

    // A control that THREW leaves this board unfetchable. It does not veto the
    // others, but it cannot be ingested either: record the error and move on.
    // (A control that returned null because the board was empty is fine to
    // fetch -- it will simply return nothing.)
    if (c.error) {
      const runId = await writeRun({
        org, status: "error", controlPassed: c.passed, requests: c.requests,
        found: 0, added: 0, refound: 0, dup: 0, controlDetail: c.detail, error: c.error,
      })
      out.push({
        runId, org, status: "error", controlPassed: c.passed, requestsMade: c.requests,
        foundCount: 0, addedCount: 0, refoundCount: 0, intraRunDuplicateCount: 0, error: c.error,
      })
      continue
    }

    let requests = c.requests
    let madeRequest = false
    let found = 0
    let added = 0
    let refound = 0
    let dup = 0
    // Scoped to this board's run, which is what "within this same run" means
    // now that a run is one board.
    const seen = new Set<string>()

    try {
      // carry lets a locally-filtering adapter reuse the board its own control
      // already downloaded, instead of fetching the identical payload twice.
      const r = await adapter.fetch(pair, org, c.carry)
      requests += r.requests
      found = r.postings.length
      for (const p of r.postings) {
        const kind = await upsertPosting(sb, adapter.source, org, p, seen)
        if (kind === "added") added++
        else if (kind === "refound") refound++
        else dup++
      }
      const runId = await writeRun({
        org, status: "ok", controlPassed: c.passed, requests, found, added, refound, dup,
        controlDetail: c.detail, error: null,
      })
      out.push({
        runId, org, status: "ok", controlPassed: c.passed, requestsMade: requests,
        foundCount: found, addedCount: added, refoundCount: refound,
        intraRunDuplicateCount: dup, error: null,
      })
      madeRequest = requests > 0
    } catch (err: any) {
      const message = err?.message || String(err)
      // found_count still describes what the source handed back, so on a
      // partial failure the four numbers do not close. That is why the
      // reconciliation constraint only binds status = 'ok'.
      const runId = await writeRun({
        org, status: "error", controlPassed: c.passed, requests, found, added, refound, dup,
        controlDetail: c.detail, error: message.slice(0, 1000),
      })
      out.push({
        runId, org, status: "error", controlPassed: c.passed, requestsMade: requests,
        foundCount: found, addedCount: added, refoundCount: refound,
        intraRunDuplicateCount: dup, error: message,
      })
    }
    if (madeRequest) await sleep(SPACING_MS)
  }

  return out
}
