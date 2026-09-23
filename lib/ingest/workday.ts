/**
 * Workday ingest adapter.
 *
 *   POST https://<tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
 *   {"appliedFacets":{}, "limit":20, "offset":0, "searchText":"<keyword>"}
 *
 * Public, unauthenticated. This is the same CXS endpoint the careers site's own
 * front end calls.
 *
 * A WORKDAY BOARD NEEDS THREE THINGS, not one. The pod (wd1, wd5, wd103) is
 * part of the hostname and is NOT derivable from the tenant; the tenant and the
 * site are both path segments of the CXS URL and neither alone addresses a
 * board. So `org` here is the composite "tenant/pod/site", parsed back apart in
 * boardOf(). That keeps ingest_runs.org_slug readable
 * ("interpublic/wd5/OMC") and unambiguous, at the cost of org_slug meaning
 * something slightly different for this source than for Greenhouse. Storing it
 * in ingest_boards will want either this composite or the tenant_id column that
 * postings already has.
 *
 * LOCATION IS NOT SENT. Workday's location filter is not free text: it needs
 * facet GUIDs fetched per tenant, which is a second request and a per-tenant
 * mapping that breaks when Workday reissues ids. Every seeded pair is
 * location-null, so there is nothing to send and nothing is invented. A pair
 * WITH a location would currently be filtered on keyword only, which would
 * silently widen it -- so fetch() refuses rather than pretending.
 *
 * posted_at IS ALWAYS NULL. The list endpoint returns postedOn as prose
 * ("Posted 30+ Days Ago", "Posted Today"), not a date. Parsing that into a
 * timestamp would be inventing precision the source did not give; the raw
 * string is kept in `raw` where it can be read for what it is.
 *
 * company IS THE TENANT. The CXS list response carries no employer name at all,
 * only job fields. SmartRecruiters falls back to the org when company.name is
 * absent and this does the same thing, deliberately and always. It means
 * postings.company reads "interpublic" rather than "Interpublic Group", which
 * is ugly and honest; resolving tenants to display names is an employer table,
 * not a guess made here.
 */

import type { ControlResult, FetchResult, FetchedPosting, IngestPair, SourceAdapter } from "./types"
import { httpJson } from "./http"
import { norm, containsPhraseInTitle } from "./text"

/** Must be something no posting can contain. Same term as SmartRecruiters. */
const NONSENSE = "zzqqxwvnonsenseterm"

/**
 * Workday's own maximum. Probed directly: limit=20 returns 20 rows with a
 * total; limit=50 and limit=100 both return an empty body with no total at all,
 * so asking for more than 20 gets you nothing rather than more. Pagination is
 * the only way to see past the first 20.
 */
const PAGE_LIMIT = 20

/**
 * How many pages one board may cost, before pagination stops and says so.
 *
 * Configurable because the right number is a judgement about time, not a fact:
 * at 20 rows per page and 500ms of politeness between boards, a 3,000-posting
 * tenant would otherwise spend 150 requests and several minutes on its own and
 * starve the other 246 boards. The cap turns "one board ran away with the
 * sweep" from an unbounded cost into a recorded fact (page_cap_hit), which is
 * the same trade the enrichment worklist makes: bounded and visible beats
 * complete and silent.
 *
 * Default 10 = up to 200 postings per board per pair.
 */
const DEFAULT_MAX_PAGES = 10
function maxPages(): number {
  const raw = Number(process.env.INGEST_WORKDAY_MAX_PAGES)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_PAGES
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export type WorkdayBoard = { tenant: string; pod: string; site: string }

/** "tenant/pod/site" -> its parts, or null if the org string is not that shape. */
export function boardOf(org: string): WorkdayBoard | null {
  const parts = String(org ?? "").split("/").filter(Boolean)
  if (parts.length !== 3) return null
  const [tenant, pod, site] = parts
  if (!/^wd\d+$/i.test(pod)) return null
  if (!tenant || !site) return null
  return { tenant, pod: pod.toLowerCase(), site }
}

export const boardKey = (b: WorkdayBoard): string => `${b.tenant}/${b.pod}/${b.site}`

/**
 * Derive a board from a posting's apply_url.
 *
 * RETURNS null RATHER THAN GUESSING. A URL that is not a myworkdayjobs host, or
 * that has no `job`/`details` anchor to locate the site against, yields null.
 * Half-derived board coordinates produce requests to endpoints that 404 or,
 * worse, belong to somebody else.
 *
 * The site is taken as the segment immediately BEFORE the `job` (or `details`)
 * anchor rather than as "the first segment". That is what makes an optional
 * locale prefix harmless: ".../en-US/external/job/..." and ".../external/job/..."
 * both yield "external". Anchoring on position instead would need a locale
 * stripper, and a two-letter stripper is exactly what ate a legitimate
 * two-letter site slug during the earlier ATS survey.
 */
export function boardFromApplyUrl(applyUrl: string | null | undefined): WorkdayBoard | null {
  if (!applyUrl) return null
  let u: URL
  try {
    u = new URL(String(applyUrl))
  } catch {
    return null
  }
  const host = u.hostname.match(/^(.+)\.(wd\d+)\.myworkdayjobs\.com$/i)
  if (!host) return null
  const tenant = host[1].toLowerCase()
  const pod = host[2].toLowerCase()

  const segs = u.pathname.split("/").filter(Boolean)
  const anchor = segs.findIndex((s) => s === "job" || s === "details")
  if (anchor < 1) return null
  const site = segs[anchor - 1]
  if (!site) return null

  return { tenant, pod, site }
}

const cxsUrl = (b: WorkdayBoard) =>
  `https://${b.tenant}.${b.pod}.myworkdayjobs.com/wday/cxs/${b.tenant}/${b.site}/jobs`

/** The public posting page the externalPath points at. */
const applyUrlFor = (b: WorkdayBoard, externalPath: string | null): string | null =>
  externalPath ? `https://${b.tenant}.${b.pod}.myworkdayjobs.com/${b.site}${externalPath}` : null

async function search(
  b: WorkdayBoard,
  searchText: string,
  limit: number,
  offset: number,
): Promise<{ json: any; attempts: number }> {
  const target = cxsUrl(b)
  return httpJson(
    target,
    {
      method: "POST",
      headers: {
        "user-agent": UA,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText }),
    },
    { label: target },
  )
}

function mapPosting(j: any, b: WorkdayBoard): FetchedPosting {
  const bullets: string[] = Array.isArray(j?.bulletFields) ? j.bulletFields : []
  return {
    // bulletFields[0] is the requisition id on every tenant surveyed. The
    // externalPath is the fallback: always present, always unique per posting.
    source_job_id: bullets[0] ?? (j?.externalPath ? String(j.externalPath) : null),
    title: j?.title ?? "",
    company: b.tenant,
    location: j?.locationsText ?? null,
    apply_url: applyUrlFor(b, j?.externalPath ?? null),
    // postedOn is prose, not a date. See the header.
    posted_at: null,
    raw: j,
  }
}

export const workdayAdapter: SourceAdapter = {
  source: "workday",

  // searchText goes to the API and the API narrows. A passing control here is
  // evidence about Workday, not about this file.
  filtering: "server",

  // The control sends a CONSTANT nonsense term and nothing else: no location is
  // ever sent, and pair.title is not used. So the verdict depends on the board
  // alone and one control per board per sweep is the whole truth.
  controlScope(): string {
    return "*"
  },

  async control(_pair: IngestPair, org: string): Promise<ControlResult> {
    const b = boardOf(org)
    if (!b) throw new Error(`not a workday board key (expected "tenant/pod/site"): ${org}`)

    const { json: j, attempts } = await search(b, NONSENSE, 1, 0)
    const total = typeof j?.total === "number" ? j.total : null
    const returned = Array.isArray(j?.jobPostings) ? j.jobPostings.length : 0

    // Read strictly, as for SmartRecruiters: a non-zero total OR a non-empty
    // page means the filter did not bite. Trusting `total` alone would miss a
    // board that reports 0 and still hands back rows.
    const passed = total === 0 && returned === 0

    return {
      passed,
      requests: 1,
      attempts,
      detail: {
        term: NONSENSE,
        url: cxsUrl(b),
        tenant: b.tenant,
        site: b.site,
        total,
        returned,
        location_sent: null,
      },
    }
  },

  async fetch(pair: IngestPair, org: string): Promise<FetchResult> {
    const b = boardOf(org)
    if (!b) throw new Error(`not a workday board key (expected "tenant/pod/site"): ${org}`)

    // A located pair would be filtered on keyword only, which is a silently
    // wider query than the pair asked for. Refuse instead.
    if (pair.location !== null) {
      throw new Error(
        `workday cannot filter by location (needs per-tenant facet ids); ` +
          `pair "${pair.title}" carries location ${JSON.stringify(pair.location)}`
      )
    }

    const cap = maxPages()
    const raw: any[] = []
    let requests = 0
    let attempts = 0
    let pages = 0
    let total: number | null = null
    let stoppedBecause = "exhausted"

    for (let offset = 0; pages < cap; offset += PAGE_LIMIT) {
      const r = await search(b, pair.title, PAGE_LIMIT, offset)
      requests++
      attempts += r.attempts
      pages++

      // TOTAL IS ONLY ON THE FIRST PAGE. Probed directly: offset=0 reports
      // total: 304, and the very next page reports total: 0 while returning 20
      // real postings. Re-reading it per page would make the loop stop after
      // two pages on every board and look like the board was exhausted.
      if (offset === 0) total = typeof r.json?.total === "number" ? r.json.total : null

      const page: any[] = Array.isArray(r.json?.jobPostings) ? r.json.jobPostings : []
      for (const p of page) raw.push(p)

      // Pagination accounting uses the RAW count, never the kept count. The
      // post-filter below discards most rows, and stopping when the KEPT count
      // reached total would walk every board to its page cap.
      if (page.length < PAGE_LIMIT) { stoppedBecause = "short_page"; break }
      if (total !== null && raw.length >= total) { stoppedBecause = "reached_total"; break }
    }

    const capHit = pages >= cap && stoppedBecause === "exhausted"
    if (capHit) stoppedBecause = "page_cap"

    // THE POST-FILTER. searchText RANKS, it does not filter: it accepts the
    // pair's words and returns what Workday judges related. Measured on dev, a
    // "financial analyst" sweep returned 9,550 postings of which 3.0% had that
    // phrase in the title and 35.6% had even the word "analyst"; the rest were
    // Phlebotomist, Dietitian Clinical, Versanddisponent (m/w/d).
    //
    // The control cannot catch that. It proves the nonsense term returns zero,
    // which it does on every board, so the filter IS applied -- it says nothing
    // about whether the filter is TIGHT. So the same whole-word phrase
    // predicate Greenhouse uses is applied here, against the TITLE, which is
    // all the list endpoint gives us.
    const phrase = norm(pair.title)
    const kept = raw.filter((j) => containsPhraseInTitle(norm(j?.title ?? ""), phrase))

    return {
      postings: kept.map((p) => mapPosting(p, b)),
      requests,
      attempts,
      detail: {
        // What the board says it holds, what the source handed over, and what
        // survived the predicate. All three, because any two of them alone
        // hide either the truncation or the ranking noise.
        total,
        returned_by_source: raw.length,
        kept_after_predicate: kept.length,
        keep_rate: raw.length ? Number((kept.length / raw.length).toFixed(4)) : null,
        pages,
        page_limit: PAGE_LIMIT,
        max_pages: cap,
        page_cap_hit: capHit,
        stopped_because: stoppedBecause,
        // Completeness is about the SOURCE's pagination, not the predicate:
        // "did we see everything Workday would give us for this term".
        complete: total === null ? null : raw.length >= total,
      },
    }
  },
}
