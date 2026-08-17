/**
 * hiring.cafe job fetcher.
 *
 * hiring.cafe (hiringcafe.com) is a Next.js pages-router app. Its search page
 * is server-rendered, so the whole result set is available from the SSR data
 * endpoint:
 *
 *   GET /_next/data/<buildId>/index.json?searchState=<urlencoded JSON>&page=<n>
 *
 * The response is { pageProps: { ssrHits, ssrTotalCount, ssrError, ... } }.
 *
 * Usage:
 *   npx tsx scripts/fetch-hiringcafe.ts \
 *     --query "sports coordinator" --location nyc --radius 25 --days 29 \
 *     --seniority "No Prior Experience Required,Entry Level,Mid Level"
 *
 *   --pages 3     fetch 3 pages (page size is ~40-60, set by the server)
 *   --json        emit the parsed rows as JSON instead of the table
 *
 * Three things this endpoint will silently punish you for:
 *
 *   1. curl cannot reach the host. Cloudflare drops curl's TLS fingerprint —
 *      the connection hangs and times out with zero bytes, no error page.
 *      Node's built-in fetch gets through fine. Don't "fix" a hang by adding
 *      headers; the client is the problem.
 *
 *   2. buildId changes on every hiring.cafe deploy, and a stale one 404s.
 *      We scrape it from the homepage each run and retry once on a 404.
 *
 *   3. `address_components` must be the FULL Google Places array (locality +
 *      administrative_area_level_1 + country). Pass a truncated one and the
 *      backend does not reject the request — it returns HTTP 200 with
 *      ssrTotalCount: 0 and ssrError: "Failed to load jobs. Please try again."
 *      which reads exactly like a legitimate zero-result search. That is why
 *      locations live in the preset table below rather than being assembled
 *      from a lat/lon pair, and why parseResponse() throws on ssrError.
 */

const ORIGIN = "https://hiringcafe.com"

// Cloudflare wants a browser UA in addition to a browser TLS stack.
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
}

// Full Google Places payloads. See note 3 above — do not trim these.
const LOCATIONS: Record<string, any> = {
  nyc: {
    formatted_address: "New York, NY, USA",
    types: ["locality", "political"],
    geometry: { location: { lat: 40.7127753, lon: -74.0059728 } },
    id: "ChIJOwg_06VPwokRYv534QaPC8g",
    address_components: [
      { long_name: "New York", short_name: "New York", types: ["locality", "political"] },
      { long_name: "New York", short_name: "NY", types: ["administrative_area_level_1", "political"] },
      { long_name: "United States", short_name: "US", types: ["country", "political"] },
    ],
  },
}

// Exact strings the backend filters on — anything else silently matches nothing.
export const SENIORITY_LEVELS = [
  "No Prior Experience Required",
  "Entry Level",
  "Mid Level",
  "Senior Level",
] as const

export type SearchOpts = {
  query: string
  location: keyof typeof LOCATIONS | string
  radiusMiles: number
  days: number
  seniority: string[]
}

export function buildSearchState(opts: SearchOpts): Record<string, any> {
  const place = LOCATIONS[opts.location]
  if (!place) {
    throw new Error(
      `Unknown location "${opts.location}". Known: ${Object.keys(LOCATIONS).join(", ")}. ` +
        `Add a full Google Places entry to LOCATIONS — a partial one returns a fake zero-result.`
    )
  }
  return {
    locations: [
      {
        ...place,
        // A locality takes a radius; states/countries take flexible_regions instead.
        options: { radius: opts.radiusMiles, radius_unit: "miles", ignore_radius: false },
      },
    ],
    searchQuery: opts.query,
    dateFetchedPastNDays: opts.days,
    seniorityLevel: opts.seniority,
    sortBy: "default",
  }
}

export async function resolveBuildId(): Promise<string> {
  const res = await fetch(`${ORIGIN}/`, { headers: HEADERS })
  if (!res.ok) throw new Error(`homepage fetch failed: HTTP ${res.status}`)
  const html = await res.text()
  const m = html.match(/"buildId":"([^"]+)"/)
  if (!m) throw new Error("could not find buildId in homepage HTML")
  return m[1]
}

export type JobRow = ReturnType<typeof parseHit>

function parseHit(hit: any) {
  const v = hit.v5_processed_job_data || {}
  const c = hit.enriched_company_data || {}
  return {
    id: hit.id,
    // job_title_raw is the posting's own title; core_job_title is normalized.
    title: hit.job_information?.job_title_raw ?? v.core_job_title ?? null,
    normalized_title: v.core_job_title ?? null,
    company: v.company_name ?? c.name ?? null,
    company_website: v.company_website ?? c.homepage_uri ?? null,
    company_size: c.nb_employees ?? null,
    company_industries: c.industries ?? [],
    apply_url: hit.apply_url ?? null,
    source: hit.source ?? null,

    location: v.formatted_workplace_location ?? null,
    workplace_type: v.workplace_type ?? null,
    cities: v.workplace_cities ?? [],
    states: v.workplace_states ?? [],
    geo: hit._geoloc?.[0] ?? null,

    seniority: v.seniority_level ?? null,
    role_type: v.role_type ?? null,
    commitment: v.commitment ?? [],
    category: v.job_category ?? null,

    // yoe is null-but-meaningful: the "not_mentioned" flag distinguishes
    // "posting says 0 years" from "posting never said".
    min_yoe: v.is_min_industry_and_role_yoe_not_mentioned ? null : v.min_industry_and_role_yoe ?? null,
    min_mgmt_yoe: v.is_min_management_and_leadership_yoe_not_mentioned
      ? null
      : v.min_management_and_leadership_yoe ?? null,
    bachelors: v.bachelors_degree_requirement ?? null,
    bachelors_fields: v.bachelors_degree_fields_of_study ?? [],
    tools: v.technical_tools ?? [],
    certifications: v.licenses_or_certifications ?? [],
    requirements_summary: v.requirements_summary ?? null,

    salary_min: v.yearly_min_compensation ?? null,
    salary_max: v.yearly_max_compensation ?? null,
    salary_currency: v.listed_compensation_currency ?? null,
    salary_frequency: v.listed_compensation_frequency ?? null,
    salary_transparent: v.is_compensation_transparent ?? null,

    posted_at: v.estimated_publish_date ?? null,
    posted_at_millis: v.estimated_publish_date_millis ?? null,
    visa_sponsorship: v.visa_sponsorship ?? null,
    security_clearance: v.security_clearance ?? null,
    is_expired: hit.is_expired ?? null,
  }
  // Deliberately dropped: job_information.viewedByUsers / hiddenFromUsers —
  // arrays of other people's account ids, no use to us.
}

function parseResponse(json: any): { rows: JobRow[]; total: number; isLastPage: boolean } {
  const pp = json?.pageProps
  if (!pp) throw new Error("response had no pageProps — endpoint shape changed")
  if (pp.ssrError) throw new Error(`hiring.cafe returned ssrError: ${JSON.stringify(pp.ssrError)}`)
  return {
    rows: (pp.ssrHits || []).map(parseHit),
    total: pp.ssrTotalCount ?? 0,
    isLastPage: Boolean(pp.ssrIsLastPage),
  }
}

export async function fetchJobs(
  opts: SearchOpts & { pages?: number }
): Promise<{ rows: JobRow[]; total: number }> {
  let buildId = await resolveBuildId()
  const searchState = buildSearchState(opts)
  const encoded = encodeURIComponent(JSON.stringify(searchState))

  const rows: JobRow[] = []
  let total = 0

  for (let page = 0; page < (opts.pages ?? 1); page++) {
    const url = `${ORIGIN}/_next/data/${buildId}/index.json?searchState=${encoded}&page=${page}`
    let res = await fetch(url, { headers: HEADERS })

    // A 404 means the site redeployed since we read the buildId. Re-read once.
    if (res.status === 404) {
      buildId = await resolveBuildId()
      res = await fetch(
        `${ORIGIN}/_next/data/${buildId}/index.json?searchState=${encoded}&page=${page}`,
        { headers: HEADERS }
      )
    }
    if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status}`)

    const parsed = parseResponse(await res.json())
    total = parsed.total
    rows.push(...parsed.rows)
    if (parsed.isLastPage) break
    if (page > 0) await new Promise((r) => setTimeout(r, 400))
  }

  return { rows, total }
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

async function main() {
  const opts = {
    query: arg("query", "sports coordinator")!,
    location: arg("location", "nyc")!,
    radiusMiles: Number(arg("radius", "25")),
    days: Number(arg("days", "29")),
    seniority: arg("seniority", "No Prior Experience Required,Entry Level,Mid Level")!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pages: Number(arg("pages", "1")),
  }

  const unknown = opts.seniority.filter((s) => !SENIORITY_LEVELS.includes(s as any))
  if (unknown.length) {
    throw new Error(
      `Unknown seniority ${JSON.stringify(unknown)}. Valid: ${SENIORITY_LEVELS.join(" | ")}`
    )
  }

  const { rows, total } = await fetchJobs(opts)

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  console.log(
    `query="${opts.query}" location=${opts.location} radius=${opts.radiusMiles}mi ` +
      `days=${opts.days} seniority=[${opts.seniority.join(", ")}]`
  )
  console.log(`${total} total, ${rows.length} fetched\n`)

  for (const r of rows) {
    const pay =
      r.salary_min && r.salary_max
        ? `$${Math.round(r.salary_min / 1000)}k-$${Math.round(r.salary_max / 1000)}k`
        : "—"
    console.log(
      [
        r.title,
        `@ ${r.company}`,
        `| ${r.seniority}`,
        `| ${r.location}`,
        `| ${r.workplace_type}`,
        `| ${pay}`,
        `| ${String(r.posted_at).slice(0, 10)}`,
      ].join(" ")
    )
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
