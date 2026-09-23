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
import { httpRequest } from "./http"
import { norm, containsPhrase, containsPhraseInTitle } from "./text"

// Re-exported so existing importers (and the test scripts) keep working.
export { norm, containsPhrase, containsPhraseInTitle }

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

/**
 * The whole board in one call, with the attempt count it cost.
 *
 * Returns attempts alongside the jobs rather than just the jobs, so a board
 * that answered only on its third try is distinguishable from one that answered
 * immediately. Greenhouse is the least likely of the three sources to need it
 * (one request per board per sweep, then cached), but a shared retry policy
 * that reports differently per adapter is the kind of inconsistency that makes
 * the numbers untrustworthy later.
 */
export async function board(
  org: string,
  withContent = false,
): Promise<{ jobs: GhJob[]; attempts: number }> {
  const target = `${API}/${encodeURIComponent(org)}/jobs` + (withContent ? "?content=true" : "")
  const r = await httpRequest(target, { headers: { "user-agent": UA, accept: "application/json" } }, { label: target })
  let j: any
  try {
    j = JSON.parse(r.text)
  } catch {
    throw new Error(`non-JSON response for ${target} -- ${r.text.slice(0, 200)}`)
  }
  return { jobs: Array.isArray(j?.jobs) ? j.jobs : [], attempts: r.attempts }
}



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
 * THE LOCAL PREDICATE: WHOLE-WORD PHRASE, PLUS A TITLE CONSTRAINT ON SENIORITY.
 *
 *   the pair, as a PHRASE -> must appear in the TITLE OR DESCRIPTION,
 *                            contiguous, in order, on whole-word boundaries
 *   each seniority token   -> must ALSO appear in the TITLE, as a whole word
 *
 * TWO BUGS THIS REPLACES, both measured on the 6,026 stored prod postings.
 *
 * 1. SUBSTRING MATCHING. The old predicate used bare .includes(), so a token
 *    matched inside any longer word. "ip associate" matched 2,555 postings and
 *    only 43 of them on the title: "ip" was landing inside multIPle, ownerSHIP,
 *    relationSHIPs, shIPping, leaderSHIP and particIPates, while "associate"
 *    landed inside the boilerplate "working conditions associated with this
 *    job". 2,537 of the 2,555 had a token that never appeared as a whole word
 *    anywhere in the posting. Two accidental substrings in unrelated prose are
 *    not a match.
 *
 * 2. SCATTERED TOKENS. Each token was checked independently, so a multi-word
 *    pair matched if its words appeared ANYWHERE, however far apart.
 *    "process engineering" matched 1,950 postings and exactly ONE on the title,
 *    because "during the interview process" plus "our engineering team" appears
 *    in a large share of tech descriptions. Requiring the phrase is what makes
 *    a two-word pair mean the two-word thing.
 *
 * WHOLE-WORD IS CHEAP HERE because norm() has already reduced the text to
 * lowercase alphanumeric tokens separated by single spaces. Padding both sides
 * with a space turns " phrase " into an exact word-boundary test with no regex
 * and nothing to escape.
 *
 * STILL A RECALL FILTER, NOT A RELEVANCE JUDGEMENT. The phrase may appear in
 * the description rather than the title, so a posting that merely discusses the
 * role still comes through. That is deliberate and unchanged: JobFit does the
 * real relevance work, and a posting that never reaches the scorer cannot be
 * scored. What changed is that the phrase now has to actually be there.
 *
 * THE SENIORITY RULE IS UNCHANGED and remains a separate, additional test.
 * "manager" in a pair still has to be in the title, so a Coordinator posting
 * whose body mentions a project manager is still rejected.
 */
/**
 * norm(title + description) per job, memoized for the life of the sweep.
 *
 * Flattening a 20 KB description is the expensive part of matching, and a
 * cached board is matched against EVERY pair in the sweep: at 33 pairs that is
 * the same HTML stripped 33 times per job for an identical result. Keyed on the
 * job object itself and held weakly, so it dies with the cached board rather
 * than growing for the life of the process.
 */
const HAYSTACKS = new WeakMap<object, string>()

function fullHaystack(job: GhJob): string {
  const hit = HAYSTACKS.get(job as unknown as object)
  if (hit !== undefined) return hit
  const built = norm(job.title + " " + plainText((job as any).content))
  HAYSTACKS.set(job as unknown as object, built)
  return built
}

export function matches(job: GhJob, title: string, city: string | null): boolean {
  const phrase = norm(title)
  if (phrase === "") return false

  const titleHay = norm(job.title)

  // Seniority first: it reads the title only, so it is cheap, and failing here
  // avoids flattening a 20 KB description to learn nothing. Title-only, so the
  // plural tolerance applies: "Project Managers" carries "manager".
  for (const tok of phrase.split(" ").filter(Boolean)) {
    if (SENIORITY_TOKENS.has(tok) && !containsPhraseInTitle(titleHay, tok)) return false
  }

  // The pair as a phrase: exact anywhere in title or description, OR pluralised
  // in the title. An exact title hit is already covered by the first arm, since
  // the title is part of the full haystack, so the second arm adds exactly one
  // thing: a plural head noun in the title.
  if (!containsPhrase(fullHaystack(job), phrase) && !containsPhraseInTitle(titleHay, phrase)) return false

  if (!city) return true
  return containsPhrase(norm(job.location?.name), norm(city))
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
    const fetched = reuse ? null : await board(org, true)
    const jobs = reuse ?? fetched!.jobs

    const unfiltered = jobs.length
    const filtered = jobs.filter((j) => matches(j, pair.title, city)).length
    const nonsense = jobs.filter((j) => matches(j, NONSENSE, city)).length

    // Both assertions must hold:
    //   narrows  -- the predicate actually removed something. A filter that
    //               returns the whole board is not filtering.
    //   rejects  -- a term that cannot match returns nothing.
    const narrows = unfiltered > filtered
    const rejects = nonsense === 0

    // ONLY `rejects` CAN VETO. The two assertions answer different questions
    // and only one of them is evidence of a broken filter:
    //
    //   rejects=false  the predicate matched a term that cannot exist. It is
    //                  not filtering, and nothing from this board can be
    //                  trusted. This is the veto.
    //
    //   narrows=false  the predicate kept everything, which on a small
    //                  specialist board means every posting genuinely mentions
    //                  the term. Orenda and Dirac both did this for "engineer"
    //                  -- 18 of 18 and 6 of 6 -- and the predicate was working
    //                  perfectly; there was simply nothing to remove.
    //
    // Treating narrows=false as a veto cost 96 of 447 board-runs on the first
    // 149-board sweep, cancelled by two small boards that had done nothing
    // wrong. null says "could not be performed", which is the truth.
    //
    //   empty board    same thing in the limit: 0 > 0 is false.
    const empty = unfiltered === 0
    const passed = !rejects ? false : empty || !narrows ? null : true
    const reason = !rejects
      ? "nonsense term matched " + nonsense + " posting(s): the predicate is not filtering"
      : empty
        ? "board is empty: 0 postings, nothing to narrow"
        : !narrows
          ? "predicate kept all " + unfiltered + " postings: every one matches, nothing to narrow"
          : null

    return {
      passed,
      requests: reuse ? 0 : 1,
      attempts: reuse ? 0 : fetched!.attempts,
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
    const fetched = cached ? null : await board(org, true)
    const jobs = cached ?? fetched!.jobs
    const kept = jobs.filter((j) => matches(j, pair.title, city))

    return {
      postings: kept.map((j) => mapJob(j, org)),
      requests: cached ? 0 : 1,
      attempts: cached ? 0 : fetched!.attempts,
      // The whole board arrives in one call, so there is no truncation to
      // report: `complete` is unconditionally true here, unlike Workday.
      detail: {
        board_size: jobs.length,
        returned: kept.length,
        paginated: false,
        complete: true,
      },
    }
  },
}
