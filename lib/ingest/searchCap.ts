/**
 * A per-run ceiling on paid searches.
 *
 * Google Jobs is billed per search (SerpApi, SearchApi), so one run must not be
 * able to spend without limit: a bad pair list, a loop, or a control that
 * errors and is retried per pair can multiply cost before anyone looks.
 *
 * ONE BUDGET PER RUN, SHARED BY THE ADAPTER AND THE RUNNER. The adapter takes
 * one unit before every search it sends, so the cap is a hard guarantee rather
 * than an estimate: take() throws once it is spent. The runner reads it to stop
 * cleanly before that point, and refuse() records that something was left
 * undone because of the cap, which is what turns into the ingest alert.
 *
 * HITTING THE CAP EXACTLY IS NOT A STOP. A run that needed 60 searches and had
 * 60 finished; only a search wanted and refused counts.
 */

export const DEFAULT_SEARCH_CAP = 60

export class SearchCapReached extends Error {
  /** No HTTP call was made. */
  readonly attempts = 0
  constructor(readonly cap: number) {
    super(`search cap reached: ${cap} searches already spent this run`)
  }
}

export class SearchBudget {
  spent = 0
  /** Searches wanted after the cap was reached. */
  refused = 0
  constructor(readonly cap: number) {}

  get remaining(): number { return Math.max(0, this.cap - this.spent) }
  get stopped(): boolean { return this.refused > 0 }

  take(): void {
    if (this.spent >= this.cap) { this.refused++; throw new SearchCapReached(this.cap) }
    this.spent++
  }

  refuse(n = 1): void { this.refused += n }
}

/** GOOGLE_JOBS_SEARCH_CAP, else 60. A non-positive or non-numeric value means the default. */
export function searchCapFromEnv(value = process.env.GOOGLE_JOBS_SEARCH_CAP): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SEARCH_CAP
}
