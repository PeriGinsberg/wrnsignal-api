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
}

export type QReason = { value: string; label: string; requiresNote?: true }

export type QueueResponse = {
  ok: true; asOf: string; lastVisitAt?: string; minScoreLoaded: number
  reasons: QReason[]; clients: QClient[]; jobs: QJob[]
}
