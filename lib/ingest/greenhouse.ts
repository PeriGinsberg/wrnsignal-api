/**
 * Greenhouse ingest adapter.
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/<org>/jobs
 *
 * Public, unauthenticated. `org` is the board slug from the apply URL
 * (job-boards.greenhouse.io/<org>/jobs/<id>): capco, point72, janestreet.
 *
 * NO SERVER-SIDE FILTER. The endpoint takes no keyword or location parameter
 * and returns the entire board in one response. Narrowing therefore happens
 * here, in memory, which changes what the control can prove -- see `filtering`
 * in types.ts. In short: a passing control on SmartRecruiters is evidence the
 * SOURCE filtered; a passing control here is evidence OUR PREDICATE filtered.
 * Both are worth asserting; they are not the same claim.
 *
 * ONE REQUEST PER BOARD, not two. control() fetches the board, runs its
 * assertions against it, and hands the same payload to fetch() through
 * ControlResult.carry. Without that this adapter would download every board
 * twice per pair.
 *
 * CONTENT IS PULLED, and the predicate searches it. ?content=true is the same
 * endpoint with a query parameter, so it costs NO extra requests -- only
 * payload. Measured across these five boards it is 11.6x the bytes (1.4 MB to
 * 16.4 MB) and about 1.4x the wall clock.
 *
 * That is paid for because title-only matching had 40% recall: the same five
 * boards yielded 23 postings on title tokens and 57 once descriptions were
 * searched, and the 34 missed were real analyst work titled "Business
 * Analytics", "Data Management" or "Fundamental Researcher". SmartRecruiters'
 * `q` searches full posting text, so title-only also made the two sources'
 * counts incomparable.
 *
 * The description lands in postings.raw as a side effect, which is wanted: no
 * ATS surveyed exposes a requirements summary, so the raw text is the only
 * thing a later extraction pass can work from.
 */

import type { ControlResult, FetchResult, FetchedPosting, IngestPair, SourceAdapter } from "./types"

const API = "https://boards-api.greenhouse.io/v1/boards"

/** Must match no real title. Same term the SmartRecruiters adapter uses. */
const NONSENSE = "zzqqxwvnonsenseterm"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export type GhJob = {
  id: number
  title: string
  company_name?: string
  location?: { name?: string }
  absolute_url?: string
  first_published?: string
  updated_at?: string
  [k: string]: unknown
}

export async function board(org: string, withContent = false): Promise<GhJob[]> {
  const target = `${API}/${encodeURIComponent(org)}/jobs` + (withContent ? "?content=true" : "")
  const res = await fetch(target, { headers: { "user-agent": UA, accept: "application/json" } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${target} -- ${text.slice(0, 200)}`)
  let j: any
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response (${res.headers.get("content-type")}) for ${target}`)
  }
  return Array.isArray(j?.jobs) ? j.jobs : []
}

export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()

/** Greenhouse returns `content` as HTML-escaped markup. */
export function plainText(content: unknown): string {
  return String(content ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, " ")
}

/**
 * SENIORITY TOKENS, which are matched against the TITLE ONLY.
 *
 * WHY THEY ARE DIFFERENT. A domain noun in a description is evidence the
 * posting is about that domain. A seniority word in a description is not
 * evidence of anything: almost every job description mentions managers,
 * directors or leads, because almost every job reports to one, works with one
 * or trains one. Measured on the mediabrands board, the pair "manager" matched
 * 89 postings and 50 of those matched on the description alone -- "train
 * analysts and managers", "a team of managers and/or analysts", "Work with
 * Manager/Sr. Specialist". None was a management vacancy.
 *
 * So these tokens must appear where the claim is actually made: the title.
 */
const SENIORITY_TOKENS = new Set([
  "manager", "director", "senior", "lead", "head", "chief", "vp",
])

/**
 * THE LOCAL PREDICATE, SPLIT BY TOKEN KIND.
 *
 *   seniority token -> must appear in the TITLE
 *   any other token -> may appear in the TITLE OR DESCRIPTION
 *
 * WIDENED FROM TITLE-ONLY, deliberately, and it trades precision for recall.
 * Title-only found 40% of what this finds. It also pulls in postings that
 * merely MENTION the term -- "Academy Senior Recruiter" matched "analyst"
 * because the body says so -- and that is accepted: this is a recall filter
 * feeding JobFit, which does the real relevance work. A posting that never
 * reaches the scorer cannot be scored.
 *
 * Substring, not word-boundary: "data" matches "Database". Same bare-.includes()
 * weakness the JobFit CAPABILITY_RULES carry, and widening the haystack to the
 * whole description makes it bite harder than it did on titles alone. Written
 * in one place so it can be tightened in one place.
 */
export function matches(job: GhJob, title: string, city: string | null): boolean {
  const titleHay = norm(job.title)
  // Built only if a domain token needs it. Flattening a 20 KB description for
  // a pair that is nothing but seniority words would be pure waste.
  let fullHay: string | null = null

  for (const tok of norm(title).split(" ").filter(Boolean)) {
    if (SENIORITY_TOKENS.has(tok)) {
      if (!titleHay.includes(tok)) return false
    } else {
      if (fullHay === null) fullHay = norm(job.title + " " + plainText((job as any).content))
      if (!fullHay.includes(tok)) return false
    }
  }
  if (!city) return true
  return norm(job.location?.name).includes(norm(city))
}

/** location "New York, NY" -> the part worth matching on. */
export function cityOf(location: string | null): string | null {
  if (!location) return null
  const city = location.split(",")[0]?.trim()
  return city || null
}

function mapJob(j: GhJob, org: string): FetchedPosting {
  return {
    source_job_id: j.id != null ? String(j.id) : null,
    title: j.title ?? "",
    // company_name is the board's own label and is present on this endpoint.
    company: j.company_name ?? org,
    location: j.location?.name ?? null,
    apply_url: j.absolute_url ?? null,
    // first_published is when the posting went up; updated_at moves on every
    // edit. Preferring first_published keeps "when was this posted" meaning
    // that rather than "when did someone touch it".
    posted_at: j.first_published ?? j.updated_at ?? null,
    raw: j as Record<string, unknown>,
  }
}

export const greenhouseAdapter: SourceAdapter = {
  source: "grnhse",
  filtering: "local",

  async control(pair: IngestPair, org: string, cached?: unknown): Promise<ControlResult> {
    const city = cityOf(pair.location)
    // A board already downloaded earlier in this sweep. The assertions are
    // per-pair and run against the same payload, so nothing is lost by reusing
    // it and a 7.6 MB download per pair is saved.
    const reuse = Array.isArray(cached) ? (cached as GhJob[]) : null
    const jobs = reuse ?? (await board(org, true))

    const unfiltered = jobs.length
    const filtered = jobs.filter((j) => matches(j, pair.title, city)).length
    const nonsense = jobs.filter((j) => matches(j, NONSENSE, city)).length

    // Both assertions must hold:
    //   narrows  -- the predicate actually removed something. A filter that
    //               returns the whole board is not filtering.
    //   rejects  -- a term that cannot match returns nothing.
    const narrows = unfiltered > filtered
    const rejects = nonsense === 0

    // AN EMPTY BOARD IS NOT A FAILED CONTROL. There is nothing to narrow, so
    // `narrows` is false without anything being wrong. Reporting false here
    // would veto the pair across every other board because one employer has no
    // open roles. null says "could not be performed", which is the truth.
    const empty = unfiltered === 0
    const passed = empty ? null : narrows && rejects
    const reason = empty
      ? "board is empty: 0 postings, nothing to narrow"
      : passed
        ? null
        : [!narrows ? "predicate did not narrow the board" : null, !rejects ? "nonsense term matched " + nonsense + " posting(s)" : null]
            .filter(Boolean)
            .join("; ")

    return {
      passed,
      requests: reuse ? 0 : 1,
      carry: jobs,
      detail: {
        filtering: "local",
        term: NONSENSE,
        city,
        unfiltered,
        filtered,
        nonsense,
        narrows,
        rejects,
        empty_board: empty,
        reason,
      },
    }
  },

  async fetch(pair: IngestPair, org: string, carry?: unknown): Promise<FetchResult> {
    const city = cityOf(pair.location)
    // control() already downloaded this board. Re-fetching would double every
    // board's traffic to get a byte-identical payload.
    const cached = Array.isArray(carry) ? (carry as GhJob[]) : null
    const jobs = cached ?? (await board(org, true))

    return {
      postings: jobs.filter((j) => matches(j, pair.title, city)).map((j) => mapJob(j, org)),
      requests: cached ? 0 : 1,
    }
  },
}
