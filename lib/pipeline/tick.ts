/**
 * One tick of the nightly pipeline: run the next step tonight still needs.
 *
 * ORDER: Google Jobs -> enrich -> match -> link check, after the ATS sweeps
 * (03:00-03:15, 04:00-04:45), which keep their own crons and only record here. The cron
 * fires every 15 minutes from 05:00 to 07:45 UTC; each tick does one step (or
 * one stretch of a long one) inside the function's time limit, so a step that
 * runs out of time continues on the next tick instead of being killed. If one
 * is killed anyway, the next tick closes its row as "killed" and continues it
 * the same way (runs.ts closeStale).
 *
 * CAPS ARE PER NIGHT: searches, postings enriched and judgments, summed over
 * every run of the step tonight. Hitting one stops that step for the night and
 * emails. Running out of time is not a cap: the next tick continues, and only
 * work still left when the night's ticks are over is reported (watchdog).
 *
 * EMAILS, right away: a step that fails, a step that hits its cap, a step left
 * running by a killed function. The pace check runs after every tick.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { GOOGLE_JOBS_SOURCES, runGoogleJobs } from "../ingest/googleJobs"
import { runLinker } from "../ingest/link"
import { countWorklist, runEnrichment } from "../ingest/enrichPostings"
import { runMatching } from "../match/runMatching"
import { runLinkCheck } from "../match/linkCheck"
import { closeStale, finishStep, nextStep, nightOf, nightRows, startStep, TICK_STEPS, type RunRow, type StepResult, type TickStep } from "./runs"
import { loadAndPickPairs } from "./pairs"
import { runPaceCheck, SEARCHAPI_MONTHLY_FEE_USD } from "./cost"

const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

export const CAPS = {
  /** Google Jobs searches a night. 229 pairs at ~2.2 searches is ~500 a pass, so each pair every ~3 nights; ~5,300 a month of the 10,000 plan. */
  searches: num(process.env.PIPELINE_SEARCH_CAP, 170),
  /** Postings enriched a night (~$0.00115 each). */
  enrich: num(process.env.PIPELINE_ENRICH_CAP, 1500),
  /** Judge calls a night, all clients (~$0.00017 each). */
  judgments: num(process.env.PIPELINE_JUDGE_CAP, 4000),
}
export const MAX_PAGES = 3
export const SEARCHAPI_PLAN_SEARCHES = num(process.env.SEARCHAPI_PLAN_SEARCHES, 10000)
/** How long a tick's step may take: the function limit is 800s, and scans, writes and the pace check need the rest. */
export const TICK_BUDGET_MS = 640_000
export const TRIGGERED_BY = "nightly:pipeline"

export type Send = (subject: string, text: string) => Promise<void>
type Ctx = { sb: SupabaseClient; rows: RunRow[]; deadline: number; environment: string }

const tonight = (rows: RunRow[], step: TickStep) => rows.filter((r) => r.step === step).reduce((n, r) => n + r.units, 0)

/**
 * Google Jobs searches already spent tonight, read from ingest_runs rather than
 * pipeline_runs: a killed run never records its searches in pipeline_runs, but
 * each pair it finished wrote its ingest_runs row.
 */
export async function searchesSince(sb: SupabaseClient, since: string): Promise<number> {
  let n = 0
  for (let a = 0; ; a += 1000) {
    const { data, error } = await sb.from("ingest_runs").select("requests_made").in("source", [...GOOGLE_JOBS_SOURCES])
      .gte("finished_at", since).order("finished_at").range(a, a + 999)
    if (error) throw new Error("ingest_runs read failed: " + error.message)
    n += (data ?? []).reduce((s, r: any) => s + (r.requests_made ?? 0), 0)
    if (!data || data.length < 1000) return n
  }
}

async function googleJobsStep({ sb, rows, deadline, environment }: Ctx): Promise<StepResult> {
  // A continuation: what earlier runs tonight spent comes off the cap, and
  // pairs they searched are "recent" (searched in the last 20 hours), so only
  // the rest are picked.
  const first = rows.find((r) => r.step === "google_jobs")
  const spentEarlier = first ? await searchesSince(sb, first.started_at) : 0
  const cap = CAPS.searches - spentEarlier
  const pick = await loadAndPickPairs(sb, { cap: Math.max(cap, 0), maxPages: MAX_PAGES })
  const detail: Record<string, any> = {
    pairs: pick.picked.length, pairsActive: pick.total, waiting: pick.waiting, recent: pick.recent, estimate: pick.estimate,
    priority: pick.picked.filter((p) => p.priority).length, searchesEarlierTonight: spentEarlier, capRemaining: cap,
  }
  if (!pick.picked.length) return { status: "ok", detail }
  // The cap alert, if the cap stops the run, is runGoogleJobs' own (search_cap); not sent twice.
  const run = await runGoogleJobs(sb, pick.picked, { cap, maxPages: MAX_PAGES, environment, deadline })
  const outcomes = run.swept.flatMap((s) => s.outcomes.map((o) => ({ pair: s.pair, o })))
  const errors = outcomes.filter((x) => x.o.status === "error")
  Object.assign(detail, {
    pairsRun: run.swept.length, found: outcomes.reduce((n, x) => n + x.o.foundCount, 0), added: outcomes.reduce((n, x) => n + x.o.addedCount, 0), errors: errors.length,
  })
  const searches = run.budget.spent
  const base = { units: searches, searches, costUsd: searches * (SEARCHAPI_MONTHLY_FEE_USD / SEARCHAPI_PLAN_SEARCHES) }
  let linkerError: string | null = null
  try { await runLinker(sb, { triggeredBy: TRIGGERED_BY }) } catch (e: any) { linkerError = String(e?.message ?? e).slice(0, 500) }
  if (errors.length || linkerError) {
    const msg = [
      ...errors.slice(0, 10).map((x) => `${x.pair.title} | ${x.pair.location ?? "-"}: ${(x.o.error ?? "").slice(0, 160)}`),
      ...(linkerError ? [`linker: ${linkerError}`] : []),
    ].join("\n")
    return { ...base, status: "error", detail, error: `${errors.length} of ${outcomes.length} searches failed${linkerError ? ", and the linker failed" : ""}\n${msg}` }
  }
  if (run.budget.stopped) return { ...base, status: "capped", detail: { ...detail, capReason: "cap", alreadyAlerted: true } }
  const notStarted = pick.picked.length - run.swept.length
  if (notStarted > 0) return { ...base, status: "capped", detail: { ...detail, capReason: "deadline", deferred: notStarted } }
  return { ...base, status: "ok", detail }
}

async function enrichStep({ sb, rows, deadline }: Ctx): Promise<StepResult> {
  const remaining = CAPS.enrich - tonight(rows, "enrich")
  const s = await runEnrichment(sb, { limit: remaining, concurrency: 10, deadline, triggeredBy: TRIGGERED_BY })
  const due = (await countWorklist(sb)).due
  const detail = { runId: s.runId, attempted: s.attempted, enriched: s.succeeded, failed: s.failed, skippedShort: s.skippedShort, deferred: s.deferred, dueAfter: due, capRemaining: remaining - s.attempted }
  const base = { units: s.attempted, costUsd: s.costUsd }
  if (s.attempted > 0 && s.failed === s.attempted) return { ...base, status: "error", detail, error: `every posting failed (${s.failed}); first: ${s.rows.find((r) => r.error)?.error?.slice(0, 300)}` }
  if (s.deferred > 0) return { ...base, status: "capped", detail: { ...detail, capReason: "deadline" } }
  if (due > 0 && s.attempted >= remaining) return { ...base, status: "capped", detail: { ...detail, capReason: "cap" } }
  return { ...base, status: "ok", detail }
}

async function matchStep({ sb, rows, deadline }: Ctx): Promise<StepResult> {
  const earlier = tonight(rows, "match")
  let remaining = CAPS.judgments - earlier
  const { data: crit, error } = await sb.from("client_match_criteria").select("client_profile_id").eq("active", true).order("client_profile_id")
  if (error) throw new Error("client_match_criteria: " + error.message)
  const clients: Record<string, any> = {}
  let units = 0, cost = 0, deferred = 0, reachedAll = true
  const failed = new Map<string, string>()
  // Two passes: new postings for every client first, then re-judging (criteria
  // or description changed). A capped night then leaves the backlog, not the
  // new jobs of whichever clients sort last. Only the second pass's deferred
  // count is kept: it covers everything still unjudged.
  for (const pass of ["new", "all"] as const) {
    for (const { client_profile_id: id } of crit ?? []) {
      if (failed.has(id)) continue
      if (Date.now() >= deadline) { reachedAll = false; break }
      try {
        const s = await runMatching(sb, { clientProfileId: id, judgeLimit: Math.max(remaining, 0), deadline, triggeredBy: TRIGGERED_BY, newOnly: pass === "new" })
        units += s.apiCalls; cost += s.costUsd; remaining -= s.apiCalls
        if (pass === "all") deferred += s.deferred
        const prev = clients[id] ?? { judged: 0, judgeErrors: 0, newlyQueued: 0 }
        clients[id] = { judged: prev.judged + s.judged, judgeErrors: prev.judgeErrors + s.judgeErrors, newlyQueued: prev.newlyQueued + s.newlyQueued, deferred: s.deferred, awaitingEnrichment: s.awaitingEnrichment }
      } catch (e: any) {
        failed.set(id, String(e?.message ?? e).slice(0, 300))
      }
    }
    if (!reachedAll) break
  }
  // judgedThisRun is this run's share; the cap is per night, across every run.
  const detail = { clients, judgedThisRun: units, judgedTonight: earlier + units, cap: CAPS.judgments, judgmentsLeftTonight: remaining }
  const base = { units, costUsd: cost }
  if (failed.size) return { ...base, status: "error", detail, error: `matching failed for ${failed.size} client(s)\n${[...failed].map(([id, m]) => `${id}: ${m}`).join("\n")}` }
  if (deferred > 0 && remaining <= 0) return { ...base, status: "capped", detail: { ...detail, capReason: "cap", deferred } }
  if (deferred > 0 || !reachedAll) return { ...base, status: "capped", detail: { ...detail, capReason: "deadline", deferred } }
  return { ...base, status: "ok", detail }
}

async function linkCheckStep({ sb }: Ctx): Promise<StepResult> {
  const s = await runLinkCheck(sb, { top: 30 })
  return { status: "ok", units: s.links, detail: { clients: s.clients, postings: s.postings, open: s.open, closed: s.closed, likelyClosed: s.likelyClosed, unknown: s.unknown } }
}

const STEP_FN: Record<TickStep, (c: Ctx) => Promise<StepResult>> = {
  google_jobs: googleJobsStep, enrich: enrichStep, match: matchStep, link_check: linkCheckStep,
}

export type TickResult = {
  night: string
  ran: { step: TickStep; continuation: boolean; result: StepResult } | null
  busy?: string
  done?: boolean
  staleClosed: number
  pace?: { sent: string[]; error?: string }
}

export async function runTick(sb: SupabaseClient, opts: { environment: string; send: Send; now?: Date }): Promise<TickResult> {
  const started = Date.now()
  const night = nightOf(opts.now)
  const rows = await nightRows(sb, night)
  // Tick steps only: each ATS sweep closes its own (app/api/internal/ingest/run-nightly).
  const stale = await closeStale(sb, rows, Date.now(), TICK_STEPS)
  for (const r of stale) await opts.send(`Job sourcing pipeline: ${r.step} was killed at the time limit (${night})`, `${r.step} started at ${r.started_at} and was still running 15 minutes later: the function was killed at its time limit before it could stop itself. ${r.step === "link_check" ? "The link check does not run again tonight." : "This tick continues it from where it stopped."} A kill means the step's own deadline did not hold; worth a look even though nothing is lost.\nEnvironment: ${opts.environment}`)

  const next = nextStep(rows)
  const out: TickResult = { night, ran: null, staleClosed: stale.length }
  if (next.kind === "busy") return { ...out, busy: `${next.step} since ${next.since}` }
  if (next.kind === "done") return { ...out, done: true }

  const id = await startStep(sb, next.step, TRIGGERED_BY, night)
  let result: StepResult
  try {
    result = await STEP_FN[next.step]({ sb, rows, deadline: started + TICK_BUDGET_MS, environment: opts.environment })
  } catch (e: any) {
    result = { status: "error", error: String(e?.message ?? e) }
  }
  await finishStep(sb, id, result)
  out.ran = { step: next.step, continuation: next.continuation, result }

  if (result.status === "error") {
    await opts.send(`Job sourcing pipeline: ${next.step} failed (${night})`, `${next.step} failed.\n\n${result.error}\n\nDetail: ${JSON.stringify(result.detail ?? {}, null, 1)}\nEnvironment: ${opts.environment}`)
  } else if (result.status === "capped" && result.detail?.capReason === "cap" && !result.detail?.alreadyAlerted) {
    await opts.send(`Job sourcing pipeline: ${next.step} hit its nightly cap (${night})`, `${next.step} stopped at its nightly cap with work left; the rest waits for tomorrow night.\n\nCaps: ${JSON.stringify(CAPS)}\nDetail: ${JSON.stringify(result.detail, null, 1)}\nEnvironment: ${opts.environment}`)
  }

  try {
    const pace = await runPaceCheck(sb, { apiKey: process.env.SEARCHAPI_KEY, send: opts.send })
    out.pace = { sent: pace.sent.map((a) => a.kind), ...(pace.searchError ? { error: pace.searchError } : {}) }
  } catch (e: any) {
    out.pace = { sent: [], error: String(e?.message ?? e) }
  }
  return out
}

