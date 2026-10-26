/**
 * SearchApi ingest adapter: Google Jobs through SearchApi.
 *
 *   GET https://www.searchapi.io/api/v1/search?engine=google_jobs&q=<title> <location>
 *       &hl=en&gl=us[&next_page_token=...]
 *
 * Paid, keyed (SEARCHAPI_KEY). One request is one SearchApi search.
 *
 * SAME INDEX AS serpapi.ts, DIFFERENT WRAPPER. Measured 2026-10-25 on Alex's 15
 * pairs, page 1 run back to back: 140 SerpApi vs 141 SearchApi jobs, 116 the
 * same posting. Everything that is about Google Jobs rather than the wrapper
 * (query text, the single google_jobs "board", title cleanup, posted age, the
 * nonsense-term control) is shared with serpapi.ts. What differs, and is
 * handled here:
 *
 *   description    HTML in 128 of 141 jobs: stripped to text. The original is
 *                  kept as raw.description_html.
 *   apply links    apply_link (Google's main button, never one of the list)
 *                  plus apply_links [{ source, link }] on 105 of 141; SerpApi's
 *                  apply_options [{ title, link }] does not exist.
 *   sharing_link   SerpApi's share_link.
 *   via            "via Careers At MolsonCoors": the prefix is dropped.
 *   pagination     pagination.next_page_token (null on a short last page).
 *   job_id         absent on every job, so source_job_id is NULL. Identity is
 *                  the fingerprint, as it already is for every source.
 *
 * Rows are written under source "searchapi". The database treats it exactly
 * like "serpapi": an aggregator that never overwrites a direct source's row
 * (20261028_google_jobs_aggregators.sql), and lib/ingest/link.ts never makes
 * it a primary.
 */

import type { ControlResult, FetchResult, FetchedPosting, IngestPair, SourceAdapter } from "./types"
import { httpJson } from "./http"
import type { SearchBudget } from "./searchCap"
import { DEFAULT_MAX_PAGES, NONSENSE, cleanTitle, postedAt, queryFor } from "./serpapi"
import { chooseApplyLink, linksFromRaw } from "./applyLinks"

const API = "https://www.searchapi.io/api/v1/search"

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", bull: "•", hellip: "…" }

/**
 * HTML to plain text, keeping the line structure a reader (and the enrichment
 * prompt) needs: block ends and <br> become newlines, list items become "- ".
 */
export function htmlToText(html: string): string {
  return String(html ?? "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    // Not </li>: the next <li> already starts a line, and both would leave a
    // blank line between items.
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** The best apply link by lib/ingest/applyLinks.ts: employer or ATS, then boards, republishers last. */
function applyLink(j: any) {
  return chooseApplyLink(String(j.company_name ?? ""), linksFromRaw(j).map((l) => ({ url: l.url, source: l.source })), j.sharing_link ?? null)
}

export function mapSearchApiJob(j: any, now: Date): FetchedPosting {
  const link = applyLink(j)
  const html = typeof j.description === "string" ? j.description : ""
  const isHtml = /<[a-z][^>]*>/i.test(html)
  const ext = Array.isArray(j.extensions) ? j.extensions : []
  const posted = j.detected_extensions?.posted_at
  return {
    // SearchApi gives no job id.
    source_job_id: null,
    // Cleaned. Google's original title stays in raw.title.
    title: cleanTitle(j.title ?? "", j.company_name ?? ""),
    company: String(j.company_name ?? "").trim(),
    location: j.location ? String(j.location) : null,
    apply_url: link?.url ?? null,
    ...(link ? { apply_link_kind: link.kind } : {}),
    posted_at: postedAt(posted ? [posted, ...ext] : ext, now),
    raw: {
      ...j,
      description: isHtml ? htmlToText(html) : html,
      ...(isHtml ? { description_html: html } : {}),
      via: typeof j.via === "string" ? j.via.replace(/^via\s+/i, "") : j.via,
      share_link: j.sharing_link ?? null,
      provider: "searchapi",
    },
  }
}

/**
 * An empty result, not a failure. SearchApi says "Google Jobs didn't return any
 * results." (seen on the nonsense-term control, 2026-10-25); SerpApi's wording
 * is "Google hasn't returned any results". Both are matched.
 */
const NO_RESULTS = /(?:didn't|did not|hasn't|has not) return(?:ed)? any results|no results/i
export const isNoResultsError = (e: unknown) => NO_RESULTS.test(String(e ?? ""))

export function searchApiAdapter(opts: { apiKey?: string; maxPages?: number; budget?: SearchBudget } = {}): SourceAdapter {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES

  async function search(q: string, nextToken: string | null) {
    const apiKey = opts.apiKey ?? process.env.SEARCHAPI_KEY
    if (!apiKey) throw new Error("SEARCHAPI_KEY is not set")
    const u = new URL(API)
    u.searchParams.set("engine", "google_jobs")
    u.searchParams.set("q", q)
    u.searchParams.set("hl", "en")
    u.searchParams.set("gl", "us")
    if (nextToken) u.searchParams.set("next_page_token", nextToken)
    // The label must not carry the key: it ends up in ingest_runs.error.
    const label = `searchapi q="${q}"${nextToken ? " (next page)" : ""}`
    u.searchParams.set("api_key", apiKey)
    // Counted before sending: the cap is a ceiling, never an overshoot.
    opts.budget?.take()
    const { json, attempts } = await httpJson(u.toString(), { headers: { accept: "application/json" } }, { label })
    const jobs: any[] = Array.isArray(json?.jobs) ? json.jobs : []
    if (json?.error && !(jobs.length === 0 && isNoResultsError(json.error))) {
      throw new Error(`SearchApi error for ${label}: ${json.error}`)
    }
    return { jobs, next: (json?.pagination?.next_page_token as string | undefined) ?? null, attempts }
  }

  return {
    source: "searchapi",
    filtering: "server",

    // Same control as serpapi.ts: a constant nonsense title plus the location.
    controlScope(pair: IngestPair): string {
      return pair.location ?? "*no-location*"
    },

    async control(pair: IngestPair): Promise<ControlResult> {
      const q = [NONSENSE, pair.location ?? ""].filter(Boolean).join(" ")
      const { jobs, attempts } = await search(q, null)
      return { passed: jobs.length === 0, requests: 1, attempts, detail: { term: NONSENSE, q, returned: jobs.length } }
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
        postings.push(...r.jobs.map((j) => mapSearchApiJob(j, now)))
        next = r.next
        if (!next || r.jobs.length === 0) break
      }

      return {
        postings: postings.filter((p) => p.title && p.company),
        requests,
        attempts,
        detail: {
          q,
          provider: "searchapi",
          campus: Boolean(pair.campus),
          per_page: perPage,
          max_pages: maxPages,
          truncated: Boolean(next) && perPage.length === maxPages && perPage[perPage.length - 1] > 0,
          cap_reached: capReached,
          ...(pageError ? { next_page_error: pageError } : {}),
          dropped_blank: postings.filter((p) => !p.title || !p.company).length,
        },
      }
    },
  }
}
