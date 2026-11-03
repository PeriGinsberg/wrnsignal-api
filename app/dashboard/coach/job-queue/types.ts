// Shapes of GET /api/coach/job-queue (lib/match/jobQueue.ts, compacted by the
// route: empty fields are left out, a chip names its client by index).

export type QClient = { id: string; name: string; first: string; queueSize: number }

export type QChip = {
  /** Index into clients[]. */
  c: number
  s?: number
  why?: string
  q?: string
  rk?: number
  all?: (number | null)[]
  ids: string[]
  status?: "evaluating" | "fit" | "not_fit"
  reason?: string
  note?: string
  jobfitScore?: number
  jobfitDecision?: string
  /** A Fit marked "Already added": it was in the tracker before. */
  alreadyAdded?: boolean
  // Set by the page on a city group's chip (several cities as one row):
  /** How many of the group's cities this client has. */
  n?: number
  /** The city job with this client's best score: Add Job opens it. */
  bestKey?: string
  bestLoc?: string
  /** The ids a group's Not a fit writes: every city but those already Fit. */
  actIds?: string[]
  /** Decisions differ across the cities, e.g. "Not a fit in 2 of 5 cities". */
  split?: string
}

export type QListing = { postingId: string; t: string; co: string; loc?: string; url?: string; lk?: string; closed?: boolean; lcs?: string }

export type QJob = {
  key: string
  t: string; co: string; loc?: string; url?: string; lk?: string; rep?: boolean
  ymin?: number; ymax?: number; yb?: string
  sl?: number; sh?: number; sp?: string
  st?: string; dl?: string; closed?: boolean; lcs?: string
  seen?: string; campus?: boolean; tier?: string
  flag?: "closed" | "bad_link" | "not_us"; badLink?: boolean
  postingIds: string[]
  m: QChip[]
  ls?: QListing[]
  /** Title + employer key: jobs sharing it in several cities show as one row. */
  ck?: string
  // Set by the page on a city group (display only, never sent back):
  /** The member jobs' keys, best first. */
  members?: string[]
  cities?: number
}

export type QReason = { value: string; label: string; requiresNote?: true }

export type QueueResponse = {
  ok: true; asOf: string; lastVisitAt?: string; minScoreLoaded: number
  reasons: QReason[]; clients: QClient[]; jobs: QJob[]
}

/** One page of GET /api/coach/job-queue?page=N. Page 0 carries the head. */
export type QueuePage = {
  ok: true; snap: string; page: number; pages: number; total: number; jobs: QJob[]
  asOf?: string; lastVisitAt?: string; minScoreLoaded?: number; reasons?: QReason[]; clients?: QClient[]
  /** Later pages: the clients their chip indices refer to. */
  clientIds?: string[]
}
