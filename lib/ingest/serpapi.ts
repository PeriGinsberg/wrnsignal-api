/**
 * SerpApi ingest adapter: Google Jobs through SerpApi.
 *
 *   GET https://serpapi.com/search.json?engine=google_jobs&q=<title> <location>
 *       &hl=en&gl=us[&next_page_token=...]
 *
 * Paid, keyed (SERPAPI_KEY). Every request is one SerpApi search, so
 * requests_made on the run row IS the bill.
 *
 * NOT A BOARD. Every other adapter reads one employer's board, addressed by
 * `org`. Google Jobs is an index across all of them, so there is exactly one
 * "board", GOOGLE_JOBS, and each posting carries its own employer in
 * company_name. postings.org_slug is therefore "google_jobs" for every row
 * this writes, and says which index found it, not who is hiring.
 *
 * THE LOCATION GOES IN THE QUERY TEXT, not in SerpApi's `location` parameter.
 * That parameter only accepts Google's canonical place names and rejects
 * anything else; "Chicago, IL" appended to q is what Phase 0 measured
 * (2026-10-25: 15 pairs, 40 searches, 232-row hiring.cafe baseline).
 *
 * PAGINATION IS NEEDED. Phase 0: page 1 holds at most 10 jobs, and 12 of 15 of
 * Alex's pairs returned 7-10 more on page 2. A next_page_token is offered even
 * when the next page is empty, so "more available" is only trusted by fetching.
 */

import type { ControlResult, FetchResult, FetchedPosting, IngestPair, SourceAdapter } from "./types"
import { httpJson } from "./http"
import type { SearchBudget } from "./searchCap"
import { normText } from "./fingerprint"
import { chooseApplyLink, linksFromRaw } from "./applyLinks"

const API = "https://serpapi.com/search.json"

/** The single "board" this source has. */
export const GOOGLE_JOBS = "google_jobs"

/** Must match nothing. Same idea as the SmartRecruiters control term. */
export const NONSENSE = "zzqqxwvnonsenseterm"

/** Pages per pair. 3 covered every page that had jobs in Phase 0 bar one. */
export const DEFAULT_MAX_PAGES = 3

/**
 * The class a campus pair is recruiting. Campus hiring runs a year ahead:
 * from August on, firms are recruiting next year's graduates (in October 2026,
 * "2027" pulled Guidehouse Campus 2027 and Thinkbrg Fall 2027 in Phase 0).
 */
export function campusYear(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
}

/** What is actually sent as q. Stored in fetch_detail so a run row says it. */
export function queryFor(pair: IngestPair, now = new Date()): string {
  return [pair.title, pair.campus ? String(campusYear(now)) : "", pair.location ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
}

/**
 * Google gives age as "21 days ago" / "5 hours ago", not a date. Hours and
 * days convert well enough to store; "1 month ago" is too coarse to pretend
 * otherwise, so it stays NULL. The original string is kept in raw.
 */
export function postedAt(extensions: unknown, now: Date): string | null {
  if (!Array.isArray(extensions)) return null
  for (const e of extensions) {
    const m = String(e).match(/^(\d+)\+?\s+(hour|day)s?\s+ago$/i)
    if (m) {
      const ms = Number(m[1]) * (m[2].toLowerCase() === "hour" ? 3_600_000 : 86_400_000)
      return new Date(now.getTime() - ms).toISOString()
    }
  }
  return null
}

/**
 * Google lists several apply links per job, mostly aggregators. Prefer the
 * employer's own: a link whose label names the company ("Careers At Inspire
 * Brands", "BCG Careers - Boston Consulting Group"). Phase 0 found the first
 * listed link was usually an aggregator even when the employer's was present.
 */
/** The best apply link by lib/ingest/applyLinks.ts: employer or ATS, then boards, republishers last. */
function applyLink(j: any) {
  return chooseApplyLink(String(j.company_name ?? ""), linksFromRaw(j), j.share_link ?? null)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const BOARDS = /^(handshake|linkedin|indeed|glassdoor|ziprecruiter)$/i

/**
 * Google Jobs titles carry suffixes the employer never wrote:
 *   "Sector Analyst, MI-Data at Point72 New York, NY"
 *   "2027 Summer Internship - Data Scientist | Point72 | Handshake"
 * They break both the fingerprint and cross-source linking, so they are cut.
 * Only an " at <this company>" tail and " | " segments naming this company or
 * a job board are removed; anything else is left alone. Idempotent.
 */
export function cleanTitle(title: string, company: string): string {
  let t = String(title ?? "").trim()
  const co = String(company ?? "").trim()
  if (co) t = t.replace(new RegExp(`\\s+at\\s+${escapeRe(co)}\\b.*$`, "i"), "")
  const parts = t.split(/\s+\|\s+/)
  if (parts.length > 1) {
    const coN = normText(co)
    const cut = parts.findIndex((x, i) => i > 0 && (normText(x) === coN || BOARDS.test(x.trim())))
    if (cut > 0) t = parts.slice(0, cut).join(" | ")
  }
  return t.trim()
}

function mapPosting(j: any, now: Date): FetchedPosting {
  const link = applyLink(j)
  return {
    source_job_id: j.job_id ? String(j.job_id) : null,
    // Cleaned. Google's original title stays in raw.title.
    title: cleanTitle(j.title, j.company_name),
    company: String(j.company_name ?? "").trim(),
    location: j.location ? String(j.location) : null,
    apply_url: link?.url ?? null,
    ...(link ? { apply_link_kind: link.kind } : {}),
    posted_at: postedAt(j.extensions, now),
    raw: j,
  }
}

/** "Google hasn't returned any results for this query." is an empty page, not a failure. */
const NO_RESULTS = /hasn't returned any results/i

export function serpApiAdapter(opts: { apiKey?: string; maxPages?: number; budget?: SearchBudget } = {}): SourceAdapter {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES

  async function search(q: string, nextToken: string | null) {
    const apiKey = opts.apiKey ?? process.env.SERPAPI_KEY
    if (!apiKey) throw new Error("SERPAPI_KEY is not set")
    const u = new URL(API)
    u.searchParams.set("engine", "google_jobs")
    u.searchParams.set("q", q)
    u.searchParams.set("hl", "en")
    u.searchParams.set("gl", "us")
    if (nextToken) u.searchParams.set("next_page_token", nextToken)
    // The label must not carry the key: it ends up in HttpFailed messages and
    // from there in ingest_runs.error.
    const label = `serpapi q="${q}"${nextToken ? " (next page)" : ""}`
    u.searchParams.set("api_key", apiKey)
    // Counted before sending: the cap is a ceiling, never an overshoot.
    opts.budget?.take()
    const { json, attempts } = await httpJson(u.toString(), { headers: { accept: "application/json" } }, { label })
    if (json?.error && !NO_RESULTS.test(json.error)) throw new Error(`SerpApi error for ${label}: ${json.error}`)
    const jobs: any[] = Array.isArray(json?.jobs_results) ? json.jobs_results : []
    return { jobs, next: (json?.serpapi_pagination?.next_page_token as string | undefined) ?? null, attempts }
  }

  return {
    source: "serpapi",
    filtering: "server",

    // The control sends a constant nonsense title plus the pair's location, and
    // never the title or campus year, so its verdict depends on the location
    // alone: one search per market per sweep, not one per pair.
    controlScope(pair: IngestPair): string {
      return pair.location ?? "*no-location*"
    },

    async control(pair: IngestPair): Promise<ControlResult> {
      const q = [NONSENSE, pair.location ?? ""].filter(Boolean).join(" ")
      const { jobs, attempts } = await search(q, null)
      // Google Jobs is a fuzzy index. If it answers a nonsense term with jobs,
      // it is not honouring the query and nothing it returns for this location
      // can be read as a result for the pair.
      return {
        passed: jobs.length === 0,
        requests: 1,
        attempts,
        detail: { term: NONSENSE, q, returned: jobs.length },
      }
    },

    async fetch(pair: IngestPair): Promise<FetchResult> {
      const now = new Date()
      const q = queryFor(pair, now)
      const postings: FetchedPosting[] = []
      const perPage: number[] = []
      let next: string | null = null
      let requests = 0
      let attempts = 0
      let capReached = false
      let pageError: string | null = null

      for (let page = 1; page <= maxPages; page++) {
        // Out of searches with more pages on offer: keep what is in hand rather
        // than fail the pair, and record that the cap cut it short.
        if (page > 1 && opts.budget && opts.budget.remaining === 0) { opts.budget.refuse(); capReached = true; break }
        let r: Awaited<ReturnType<typeof search>>
        try {
          r = await search(q, page === 1 ? null : next)
        } catch (e: any) {
          // A later page failing keeps the pages in hand: Google rejected the
          // next_page_token on 10 of 127 pairs on 2026-10-26, and the pair kept
          // nothing. The first page failing is still the pair's failure.
          if (page === 1) throw e
          requests++
          attempts++
          pageError = String(e?.message ?? e)
          break
        }
        requests++
        attempts += r.attempts
        perPage.push(r.jobs.length)
        postings.push(...r.jobs.map((j) => mapPosting(j, now)))
        next = r.next
        if (!next || r.jobs.length === 0) break
      }

      return {
        // A row with no title or company would fail postings' CHECKs and take
        // the whole batch down with it. Dropped here and counted in detail.
        postings: postings.filter((p) => p.title && p.company),
        requests,
        attempts,
        detail: {
          q,
          campus: Boolean(pair.campus),
          per_page: perPage,
          max_pages: maxPages,
          // Pages ran out before the source did: a truncated pair, not an
          // exhausted one.
          truncated: Boolean(next) && perPage.length === maxPages && perPage[perPage.length - 1] > 0,
          cap_reached: capReached,
          ...(pageError ? { next_page_error: pageError } : {}),
          dropped_blank: postings.filter((p) => !p.title || !p.company).length,
        },
      }
    },
  }
}
