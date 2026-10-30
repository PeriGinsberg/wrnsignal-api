/**
 * Google Jobs, whichever wrapper fetches it.
 *
 * GOOGLE_JOBS_PROVIDER picks the API: "searchapi" (the default) or "serpapi".
 * Anything else, including unset, is SearchApi. Both return the same index
 * (2026-10-25: 116 of 140 page-1 jobs identical across Alex's 15 pairs).
 *
 * The two are separate sources ("serpapi", "searchapi") in postings and
 * ingest_runs, so cost and results stay attributable to the API that produced
 * them. They are treated as one KIND of source: aggregators, which never
 * overwrite or outrank a direct source's row. Switching provider is a setting
 * change: a re-find by the new provider updates the old provider's row like any
 * re-find.
 */

import { type SupabaseClient } from "@supabase/supabase-js"
import type { IngestPair, SourceAdapter } from "./types"
import { serpApiAdapter, GOOGLE_JOBS } from "./serpapi"
import { searchApiAdapter } from "./searchapi"
import { runSweep, type BoardOutcome } from "./runner"
import { SearchBudget, searchCapFromEnv } from "./searchCap"
import { sendIngestAlert, type IngestAlert } from "../email/sendIngestAlert"

export const GOOGLE_JOBS_SOURCES = ["serpapi", "searchapi"] as const
export type GoogleJobsProvider = (typeof GOOGLE_JOBS_SOURCES)[number]

export function googleJobsProvider(): GoogleJobsProvider {
  return process.env.GOOGLE_JOBS_PROVIDER === "serpapi" ? "serpapi" : "searchapi"
}

/** The env var holding the key for a provider. */
export const providerKeyName = (p: GoogleJobsProvider) => (p === "serpapi" ? "SERPAPI_KEY" : "SEARCHAPI_KEY")

export function googleJobsAdapter(
  opts: { provider?: GoogleJobsProvider; apiKey?: string; maxPages?: number; budget?: SearchBudget } = {}
): SourceAdapter {
  const provider = opts.provider ?? googleJobsProvider()
  const o = { apiKey: opts.apiKey, maxPages: opts.maxPages, budget: opts.budget }
  return provider === "serpapi" ? serpApiAdapter(o) : searchApiAdapter(o)
}

export type GoogleJobsRun = {
  swept: { pair: IngestPair; outcomes: BoardOutcome[] }[]
  budget: SearchBudget
  /** Set when the cap stopped the run; already sent unless dryRun. */
  alert: IngestAlert | null
}

/**
 * One Google Jobs run over `pairs`, under a search cap (GOOGLE_JOBS_SEARCH_CAP,
 * default 60). If the cap stops the run, the ingest alert goes out.
 *
 * `adapter` is built here unless given, so the budget it spends is the one the
 * runner checks. A caller passing its own adapter must give it the same budget.
 */
export async function runGoogleJobs(
  sb: SupabaseClient,
  pairs: IngestPair[],
  opts: {
    provider?: GoogleJobsProvider
    apiKey?: string
    maxPages?: number
    cap?: number
    adapter?: (budget: SearchBudget) => SourceAdapter
    environment?: string
    dryRun?: boolean
    send?: (a: IngestAlert) => Promise<void>
    /** Epoch ms after which no new pair starts (runSweep). */
    deadline?: number
  } = {}
): Promise<GoogleJobsRun> {
  const startedAt = Date.now()
  const budget = new SearchBudget(opts.cap ?? searchCapFromEnv())
  const adapter = opts.adapter
    ? opts.adapter(budget)
    : googleJobsAdapter({ provider: opts.provider, apiKey: opts.apiKey, maxPages: opts.maxPages, budget })
  const swept = await runSweep(adapter, pairs, [GOOGLE_JOBS], sb, { budget, deadline: opts.deadline })

  if (!budget.stopped) return { swept, budget, alert: null }

  const outcomes = swept.flatMap((s) => s.outcomes.map((o) => ({ pair: s.pair, o })))
  const alert: IngestAlert = {
    environment: opts.environment ?? process.env.VERCEL_ENV ?? "local",
    reasons: [{ kind: "search_cap", source: adapter.source, cap: budget.cap, spent: budget.spent, pairsRun: swept.length, pairsTotal: pairs.length }],
    lines: outcomes.map(({ pair, o }) =>
      `  ${adapter.source}/${o.org}  "${pair.title} | ${pair.location ?? "-"}"  ${o.status}  found=${o.foundCount}  added=${o.addedCount}  req=${o.requestsMade}`
    ),
    totals: {
      pairs: pairs.length,
      boards: 1,
      runs: outcomes.length,
      found: outcomes.reduce((n, x) => n + x.o.foundCount, 0),
      added: outcomes.reduce((n, x) => n + x.o.addedCount, 0),
      requests: budget.spent,
    },
    durationMs: Date.now() - startedAt,
  }
  if (!opts.dryRun) await (opts.send ?? sendIngestAlert)(alert)
  return { swept, budget, alert }
}
