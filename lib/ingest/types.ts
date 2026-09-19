/**
 * The contract every ingest source implements.
 *
 * Deliberately small. A source knows how to prove its own filter works and how
 * to fetch a page of postings; everything else -- upserting, counting, writing
 * ingest_runs -- belongs to the runner and must not be reimplemented per
 * source, because that is how eleven adapters end up counting "found" eleven
 * slightly different ways.
 */

/** A row of ingest_pairs, or a synthetic pair for a one-off run. */
export type IngestPair = {
  /** ingest_pairs.id, or null for a pair that is not stored. */
  id: string | null
  title: string
  /** NULL means no geographic filter, which is distinct from "anywhere". */
  location: string | null
}

/**
 * One posting as the source gave it, mapped onto the columns postings stores.
 *
 * NOTE WHAT IS ABSENT: first_seen_at and last_seen_at. An adapter never sets
 * them. The database owns both (see 20260918_postings_touch_last_seen.sql) and
 * sending last_seen_at on an upsert trips postings_seen_order during
 * pre-conflict constraint evaluation.
 */
export type FetchedPosting = {
  source_job_id: string | null
  title: string
  company: string
  location: string | null
  apply_url: string | null
  posted_at: string | null
  /** The source's own object, unmodified. */
  raw: Record<string, unknown>
}

/**
 * The result of asking a source to prove its filter actually applies.
 *
 * Half the platforms surveyed accept an unknown or unhandled filter parameter,
 * return HTTP 200, and hand back the UNFILTERED board. Oracle echoed back
 * Location: "New York" while ignoring it; the Jibe API ignored `keyword` and
 * only honoured `keywords`. Both look exactly like a successful narrow search,
 * so every run asks the question rather than assuming.
 */
export type ControlResult = {
  /**
   * THREE-VALUED, matching ingest_runs.control_passed.
   *
   *   true  -- the assertions held. The filter narrows and rejects nonsense.
   *   false -- an assertion FAILED. The filter demonstrably did not work and
   *            nothing from this source can be trusted for this pair. This is
   *            the value that vetoes.
   *   null  -- the control could not be performed at all. An empty board has
   *            nothing to narrow, so `unfiltered > filtered` is false without
   *            anything being wrong. Not evidence of a broken filter, and
   *            therefore NOT a veto.
   *
   * Collapsing null into false would mean a board with no open roles silently
   * aborts the pair for every other board, which is a worse bug than the one
   * the assertion exists to catch. `reason` in detail says which null this is.
   */
  passed: boolean | null
  /** What was asked and what came back, for the ingest_runs record. */
  detail: Record<string, unknown>
  /** HTTP requests this control spent. */
  requests: number
  /**
   * Whatever control() already fetched, handed straight back to this same
   * adapter's fetch() for the same (pair, org). Opaque to the runner, which
   * only carries it across.
   *
   * WHY THIS EXISTS. A server-filtering source issues two genuinely different
   * queries, so control and fetch are separate requests and there is nothing
   * to share. A locally-filtering source has ONE request -- the whole board --
   * and then filters in memory, so without this the control and the fetch
   * would download the identical payload twice. On a 773-job Greenhouse board
   * that is a megabyte of duplicate traffic per pair, for nothing.
   */
  carry?: unknown
}

export type FetchResult = {
  postings: FetchedPosting[]
  requests: number
}

export interface SourceAdapter {
  /** Matches lane_results.source vocabulary: smartrecruiters, grnhse, lever... */
  readonly source: string

  /**
   * WHERE THE FILTERING HAPPENS, and therefore what a passing control means.
   *
   *   "server" -- the pair's title and location are sent as query parameters
   *     and the source narrows the result. A passing control is evidence about
   *     the SOURCE: its filter provably bit.
   *
   *   "local" -- the source has no keyword filter and returns the whole board;
   *     narrowing happens here. A passing control is evidence about OUR OWN
   *     CODE: our predicate narrowed and rejected a nonsense term. It says
   *     nothing about the source, because the source was never asked to filter.
   *
   * These are not the same guarantee and control_passed must not be read
   * across sources as though they were. The runner records this in
   * control_detail so a reader can tell which claim a TRUE is making.
   */
  readonly filtering: "server" | "local"

  /**
   * Prove the filter narrows before anything is ingested.
   *
   * For a server-filtering source: issue the pair's filter with a term that
   * cannot match. Returning anything means the source ignored the filter and
   * its numbers cannot be trusted for this pair.
   *
   * For a locally-filtering source: fetch the board and assert the local
   * predicate narrows it, and that a nonsense term narrows it to nothing.
   *
   * `cached` is a board this same adapter returned as `carry` earlier in the
   * sweep. An adapter that accepts it MUST report requests: 0, because it made
   * none. Symmetric with fetch(): both ends of the pipeline can be fed a board
   * that has already been downloaded.
   */
  control(pair: IngestPair, org: string, cached?: unknown): Promise<ControlResult>

  /**
   * The real query. One page; pagination is a later concern.
   *
   * `carry` is whatever this adapter's own control() returned, or undefined.
   * An adapter that does not set carry can ignore the parameter.
   */
  fetch(pair: IngestPair, org: string, carry?: unknown): Promise<FetchResult>
}
