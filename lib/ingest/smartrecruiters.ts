/**
 * SmartRecruiters ingest adapter.
 *
 *   GET https://api.smartrecruiters.com/v1/companies/<org>/postings
 *       ?q=<keyword>&city=<city>&limit=<n>
 *
 * Public, unauthenticated. `org` is the company identifier as it appears in the
 * apply URL (jobs.smartrecruiters.com/<org>/<id>-<slug>): AECOM2, CityOfNewYork,
 * HMGroup.
 *
 * WHY THIS SOURCE FIRST. Of the platforms surveyed it is the only one where
 * both filters are plain free text and compose: `q` and `city` need no facet
 * GUID lookup (Workday), no numeric location id (Oracle) and no undocumented
 * parameter spelling (the Jibe API honours `keywords`, not `keyword`). It is
 * the cheapest place to get the interface shape right.
 *
 * Verified against AECOM2 before this was written:
 *   unfiltered         5266
 *   q=engineer         3613
 *   q=<nonsense>          0   <- the control this adapter runs every time
 *   q=engineer&city=New York 51
 */

import type { ControlResult, FetchResult, FetchedPosting, IngestPair, SourceAdapter } from "./types"
import { httpJson } from "./http"

const API = "https://api.smartrecruiters.com/v1/companies"

/**
 * The control term. Must be something no posting can contain: no real title,
 * no company name, no stray substring match.
 */
const NONSENSE = "zzqqxwvnonsenseterm"

/** One page. Pagination is deliberately out of scope for step 2. */
const PAGE_LIMIT = 100

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

function url(org: string, params: Record<string, string>) {
  const u = new URL(`${API}/${encodeURIComponent(org)}/postings`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

async function get(target: string): Promise<{ json: any; attempts: number }> {
  return httpJson(target, { headers: { "user-agent": UA, accept: "application/json" } }, { label: target })
}

/** location "New York, NY" -> the city SmartRecruiters wants. */
function cityOf(location: string | null): string | null {
  if (!location) return null
  const city = location.split(",")[0]?.trim()
  return city || null
}

function mapPosting(j: any, org: string): FetchedPosting {
  const loc = j.location || {}
  return {
    source_job_id: j.id != null ? String(j.id) : null,
    title: j.name ?? "",
    // company.name is the posting's own employer, which is NOT always the org:
    // Bertelsmann-Jobs carries both Penguin Random House and Arvato. Falling
    // back to org would silently merge them.
    company: j.company?.name ?? org,
    location: loc.fullLocation ?? [loc.city, loc.region, loc.country].filter(Boolean).join(", ") ?? null,
    // Constructed: the postings list carries no apply link, only `ref`, which is
    // the API URL. This is the public posting page and it redirects to the slug.
    apply_url: j.id != null ? `https://jobs.smartrecruiters.com/${org}/${j.id}` : null,
    posted_at: j.releasedDate ?? null,
    raw: j,
  }
}

export const smartRecruitersAdapter: SourceAdapter = {
  source: "smartrecruiters",
  // `q` and `city` are sent to the API and the API narrows. A passing control
  // here is evidence about SmartRecruiters, not about this file.
  filtering: "server",

  // The control sends a CONSTANT nonsense term plus the pair's city. It never
  // sends pair.title, so two pairs differing only in title get an identical
  // request and an identical answer. The city is the whole dependency.
  controlScope(pair: IngestPair): string {
    return cityOf(pair.location) ?? "*no-location*"
  },

  async control(pair: IngestPair, org: string): Promise<ControlResult> {
    const city = cityOf(pair.location)
    const params: Record<string, string> = { q: NONSENSE, limit: "1" }
    if (city) params.city = city

    const target = url(org, params)
    const { json: j, attempts } = await get(target)
    const total = typeof j?.totalFound === "number" ? j.totalFound : null
    const returned = Array.isArray(j?.content) ? j.content.length : 0

    // "Returns anything" is read strictly: a non-zero total OR a non-empty page.
    // Trusting totalFound alone would miss a board that reports 0 and still
    // hands back rows.
    const passed = total === 0 && returned === 0

    return {
      passed,
      requests: 1,
      attempts,
      detail: { term: NONSENSE, city, url: target, totalFound: total, returned },
    }
  },

  async fetch(pair: IngestPair, org: string): Promise<FetchResult> {
    const city = cityOf(pair.location)
    const params: Record<string, string> = { q: pair.title, limit: String(PAGE_LIMIT) }
    if (city) params.city = city

    const { json: j, attempts } = await get(url(org, params))
    const content: any[] = Array.isArray(j?.content) ? j.content : []
    return {
      postings: content.map((p) => mapPosting(p, org)),
      requests: 1,
      attempts,
      // totalFound against what one page returned: the same truncation signal
      // Workday needed, on a source that also pages and also does not here.
      detail: {
        totalFound: typeof j?.totalFound === "number" ? j.totalFound : null,
        returned: content.length,
        page_limit: PAGE_LIMIT,
        paginated: false,
      },
    }
  },
}
