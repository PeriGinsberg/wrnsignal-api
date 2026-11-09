/**
 * The coach's Job Queue: every client's match queue on one page, one row per
 * job (copies of a job grouped by linker v2's rules, lib/ingest/linkV2.ts), a
 * chip per client with that client's best score across the copies.
 *
 * DECISIONS go on posting_matches (20261120_job_queue_matches.sql), on EVERY
 * copy the client has of the job, so linking or unlinking copies later never
 * brings a decided job back as undecided. At read time a client's chip that
 * has any decided copy shows that decision (a copy that arrived after the
 * decision inherits it).
 *
 * Reads client_match_queue (undecided and evaluating rows) plus the last 30
 * days of decided rows. Writes posting_matches and posting_coach_flags only.
 *
 * WHO SEES WHAT: a coach reaches only the clients of their own practice (their
 * own coach_clients links, plus their principal's when they are a delegate,
 * lib/collab/delegation.ts). The queue, decisions, proposals and flags all go
 * through that; flags and saved links are stored per practice.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { owningCoachId, resolveDelegation } from "@/lib/collab/delegation"
import { normText } from "@/lib/ingest/fingerprint"
import { employerKey } from "@/lib/ingest/link"
import { compact, groupCopies, type CopyRow } from "@/lib/ingest/linkV2"

/** The Not a fit reasons the Job Queue offers. Older lane reasons stay valid in the column. */
export const MATCH_REASONS: ReadonlyArray<{ value: string; label: string; requiresNote?: true }> = [
  { value: "too_senior", label: "Too senior" },
  { value: "wrong_function", label: "Wrong function" },
  { value: "wrong_industry", label: "Wrong industry" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "pay_too_low", label: "Pay too low" },
  { value: "wrong_timing", label: "Wrong timing" },
  { value: "wrong_major", label: "Wrong major" },
  { value: "other", label: "Other (note required)", requiresNote: true },
]
const REASON_VALUES = new Set(MATCH_REASONS.map((r) => r.value))

export const COACH_FLAGS = ["closed", "bad_link", "not_us"] as const
export type CoachFlag = (typeof COACH_FLAGS)[number]

/** Rows below this best score are not loaded (the page's lowest filter). */
export const LOAD_MIN_SCORE = 30
const DECIDED_DAYS = 30
const VISIT_PAGE = "job_queue"
/** A visit within this long of the last one is the same visit (a reload, a double fetch). */
const SAME_VISIT_MS = 30 * 60e3

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function assertCoach(sb: SupabaseClient, profileId: string) {
  const { data, error } = await sb.from("client_profiles").select("is_coach").eq("id", profileId).single()
  if (error) throw new Error(`client_profiles: ${error.message}`)
  if (data?.is_coach !== true) throw new HttpError(403, "Forbidden: caller is not a coach")
}

export type ClientAccess = { clientProfileId: string; accessLevel: string; coachClientId: string }

/** Active clients the coach (or a coach they act for) has, with the access level. */
export async function coachClients(sb: SupabaseClient, coachProfileId: string): Promise<ClientAccess[]> {
  const { actingIds } = await resolveDelegation(sb, coachProfileId)
  const { data, error } = await sb.from("coach_clients").select("id, client_profile_id, access_level")
    .in("coach_profile_id", actingIds).eq("status", "active").not("client_profile_id", "is", null)
  if (error) throw new Error(`coach_clients: ${error.message}`)
  const seen = new Map<string, ClientAccess>()
  for (const r of data ?? []) {
    const prev = seen.get(r.client_profile_id)
    if (!prev || r.access_level === "full") seen.set(r.client_profile_id, { clientProfileId: r.client_profile_id, accessLevel: r.access_level, coachClientId: r.id })
  }
  return [...seen.values()]
}

export async function assertFullAccess(sb: SupabaseClient, coachProfileId: string, clientProfileId: string) {
  const c = (await coachClients(sb, coachProfileId)).find((x) => x.clientProfileId === clientProfileId)
  if (!c || c.accessLevel !== "full") throw new HttpError(403, "Forbidden: full access to this client required")
}

async function pageAll<T>(q: (a: number, b: number) => any, size = 1000): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += size) {
    const { data, error } = await q(a, a + size - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < size) break
  }
  return out
}

/** Records this visit; returns the previous one ("new since my last visit"). */
export async function recordVisit(sb: SupabaseClient, coachProfileId: string): Promise<string | null> {
  const { data } = await sb.from("coach_page_visits").select("last_visit_at, previous_visit_at")
    .eq("coach_profile_id", coachProfileId).eq("page", VISIT_PAGE).maybeSingle()
  const now = new Date()
  if (data && now.getTime() - new Date(data.last_visit_at).getTime() < SAME_VISIT_MS) return data.previous_visit_at
  const previous = data?.last_visit_at ?? null
  const { error } = await sb.from("coach_page_visits").upsert(
    { coach_profile_id: coachProfileId, page: VISIT_PAGE, last_visit_at: now.toISOString(), previous_visit_at: previous },
    { onConflict: "coach_profile_id,page" })
  if (error) throw new Error(`coach_page_visits: ${error.message}`)
  return previous
}

export type Chip = {
  /** client_profile_id */
  c: string
  /** Best judge score across this client's copies. */
  s: number | null
  why: string | null
  /** Earliest first_queued_at across the copies. */
  q: string | null
  /** Best (lowest) queue rank. */
  rk: number | null
  /** Every copy's score, when there are several. */
  all?: (number | null)[]
  /** Every copy's match id: a decision is written to all of them. */
  ids: string[]
  status: "evaluating" | "fit" | "not_fit" | null
  reason: string | null
  note: string | null
  jobfitScore: number | null
  jobfitDecision: string | null
  /** Fit because it was already in the client's tracker ("Already added"). */
  alreadyAdded?: true
}

export type Listing = { postingId: string; t: string; co: string; loc: string | null; url: string | null; lk: string | null; closed: boolean; lcs: string | null }

export type Job = {
  /** The primary posting id. */
  key: string
  t: string; co: string; loc: string | null; url: string | null; lk: string | null; rep: boolean
  ymin: number | null; ymax: number | null; yb: string | null
  sl: number | null; sh: number | null; sp: string | null
  st: string | null; dl: string | null; closed: boolean; lcs: string | null
  seen: string | null; req: string | null; campus: boolean; tier: string | null
  flag: string | null; badLink: boolean
  postingIds: string[]
  m: Chip[]
  /** The copies, best link first, when there is more than one. */
  ls?: Listing[]
  /**
   * Title + employer (aliases resolved), compacted: the page shows jobs that
   * share it in several cities as one row (display only, lib/match/jobQueue.ts
   * keeps them separate jobs).
   */
  ck: string
}

const STATUS: Record<string, Chip["status"]> = { evaluating: "evaluating", push: "fit", dismiss: "not_fit" }

export type QueueRow = {
  match_id: string; client_profile_id: string; posting_id: string; score: number | null; judge_reason: string | null
  rank: number | null; first_queued_at: string | null; source: string; raw_title: string; title: string; company: string
  location: string | null; apply_url: string | null; apply_link_kind: string | null; republished_only: boolean
  link_check_status: string | null; likely_closed: boolean; years_min: number | null; years_max: number | null; years_basis: string | null
  salary_low: number | null; salary_high: number | null; salary_period: string | null; start_label: string | null
  application_deadline: string | null; requirements_summary: string | null; first_seen_at: string | null; tier_label: string | null
  campus_signal: boolean | null; action: string | null; coach_flag: string | null; coach_apply_url: string | null; bad_link: boolean
  dismiss_reason?: string | null; note?: string | null; actioned_at?: string | null; jobfit_score?: number | null; jobfit_decision?: string | null
  /** A Fit marked "Already added": it was in the tracker before (20261126). */
  already_added?: boolean
  /** Ranking keys (client_match_queue's order), for rank among the loaded rows. */
  tier?: number; preferred_market?: boolean
}

/** What the page asks for. Every filter here is applied in the database. */
export type QueueFilters = {
  /** Best client score shown (the page's filter): rows at or above it, plus other clients' rows at LOAD_MIN_SCORE+ on the same jobs. */
  minScore?: number
  /** One client, or every client the coach reaches. */
  clientId?: string | null
  /** Load decisions of the last 30 days ("Hide jobs I've decided" off). */
  decided?: boolean
  /** Always load decisions made since this time (the coach's own, this visit). */
  decidedSince?: string | null
  /** Also load matches the judge has not scored (one client only: thousands of rows). */
  unscored?: boolean
}

const MATCH_COLS = "id, client_profile_id, posting_id, score, judge_reason, first_queued_at, action, apply_url, apply_link_kind, preferred_market, dismiss_reason, note, actioned_at, jobfit_score, jobfit_decision, already_added"
const POSTING_COLS = "id, source, title, cleaned_title, company, location, apply_url, apply_link_kind, link_check_status, years_min, years_max, years_basis, salary_low, salary_high, salary_period, application_deadline, requirements_summary, first_seen_at, last_seen_at, closed_at, campus_signal, start_type, start_date, start_season, start_year"
/** Ids per .in() filter: keeps the request URL short. */
const IN_CHUNK = 150
const STALE_DAYS = 14

const chunk = <T,>(xs: T[], n = IN_CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n))

/**
 * The Job Queue, without client_match_queue: that view ranks a client's whole
 * queue (every judged and unjudged match) before any filter applies, which
 * timed out on prod. Here each filter is a WHERE on posting_matches (index
 * posting_matches_jobqueue_idx, 20261123), postings are read by id for the rows
 * kept, and the view's columns (tier, start label, link kind, practice flags,
 * staleness) are computed from the same inputs. rank is the row's place among
 * the client's LOADED rows in the view's order, not the whole queue.
 */
export async function loadJobQueue(sb: SupabaseClient, coachProfileId: string, f: QueueFilters = {}) {
  const min = Math.max(LOAD_MIN_SCORE, Math.floor(f.minScore ?? LOAD_MIN_SCORE))
  // JOBQUEUE_TIMING=1 logs each step's time (tests/jobqueue timing scripts).
  const t0 = Date.now(), lap = (what: string) => { if (process.env.JOBQUEUE_TIMING) console.log(`  [loader] ${what}: ${Date.now() - t0}ms`) }
  const access = await coachClients(sb, coachProfileId)
  const ids = access.map((a) => a.clientProfileId)
  if (f.clientId && !ids.includes(f.clientId)) throw new HttpError(403, "Forbidden: not your client")
  if (f.unscored && !f.clientId) throw new HttpError(400, "Unscored jobs load for one client at a time")
  if (!ids.length) return { clients: [], jobs: [] as Job[], minScore: min }

  const [{ data: crit, error: cErr }, { data: profsAll, error: pErr }] = await Promise.all([
    sb.from("client_match_criteria").select("client_profile_id, available_from").in("client_profile_id", ids).eq("active", true),
    sb.from("client_profiles").select("id, name, email").in("id", ids),
  ])
  if (cErr) throw new Error(`client_match_criteria: ${cErr.message}`)
  if (pErr) throw new Error(`client_profiles: ${pErr.message}`)
  const availableFrom = new Map((crit ?? []).map((c: any) => [c.client_profile_id as string, c.available_from as string | null]))
  const all = [...availableFrom.keys()]
  if (!all.length) return { clients: [], jobs: [] as Job[], minScore: min }
  // Every client stays in the list (the page's Client filter); rows load for the chosen one.
  const profs = (profsAll ?? []).filter((p: any) => availableFrom.has(p.id))
  const active = f.clientId ? all.filter((c) => c === f.clientId) : all
  if (!active.length) return { clients: clientList(profs, new Map()), jobs: [] as Job[], minScore: min }
  const since = f.decided ? new Date(Date.now() - DECIDED_DAYS * 864e5).toISOString() : f.decidedSince ?? null

  const [read, practices, aliases] = await Promise.all([
    readRows(sb, { clients: active, min, unscored: !!f.unscored, since }),
    practicesByClient(sb, active),
    sb.from("employer_aliases").select("alias_norm, canonical").then(({ data }) => new Map((data ?? []).map((x: any) => [x.alias_norm as string, x.canonical as string]))),
  ])
  const { rowsIn, postings, flags, secondaries } = read
  lap(`${read.via}: ${rowsIn.length} match rows, ${postings.size} postings, ${flags.length} flags`)
  // 3. The view's columns, from the same inputs.
  const staleBefore = Date.now() - STALE_DAYS * 864e5
  const rows: QueueRow[] = []
  for (const m of rowsIn) {
    const p: any = postings.get(m.posting_id)
    if (!p || secondaries.has(p.id)) continue
    const decidedRow = m.action === "push" || m.action === "dismiss"
    const fl = folded(flags.filter((x: any) => x.posting_id === p.id && practices.get(m.client_profile_id)?.has(x.practice_coach_id)))
    if (!decidedRow) {
      if (p.closed_at || !p.last_seen_at || new Date(p.last_seen_at).getTime() <= staleBefore) continue
      if (fl.flag === "closed" || fl.flag === "not_us") continue
    }
    const kind = fl.applyUrl ? "employer" : m.apply_link_kind ?? p.apply_link_kind
    const t = tierOf(availableFrom.get(m.client_profile_id) ?? null, p, m.score)
    rows.push({
      match_id: m.id, client_profile_id: m.client_profile_id, posting_id: p.id, score: m.score, judge_reason: m.judge_reason, rank: null,
      first_queued_at: m.first_queued_at, source: p.source, raw_title: p.title, title: p.cleaned_title ?? p.title, company: p.company, location: p.location,
      apply_url: fl.applyUrl ?? m.apply_url ?? p.apply_url, apply_link_kind: kind,
      republished_only: !fl.applyUrl && ["republisher", "other", "google"].includes(kind ?? ""),
      link_check_status: p.link_check_status, likely_closed: p.link_check_status === "likely_closed",
      years_min: p.years_min, years_max: p.years_max, years_basis: p.years_basis, salary_low: p.salary_low, salary_high: p.salary_high, salary_period: p.salary_period,
      start_label: startLabel(p), application_deadline: p.application_deadline, requirements_summary: p.requirements_summary, first_seen_at: p.first_seen_at,
      tier_label: decidedRow ? null : t.label, campus_signal: p.campus_signal, action: m.action,
      coach_flag: decidedRow ? null : fl.flag, coach_apply_url: fl.applyUrl, bad_link: !decidedRow && fl.flag === "bad_link" && !fl.applyUrl,
      dismiss_reason: m.dismiss_reason, note: m.note, actioned_at: m.actioned_at, jobfit_score: m.jobfit_score, jobfit_decision: m.jobfit_decision,
      already_added: !!m.already_added, tier: t.tier, preferred_market: !!m.preferred_market,
    })
  }

  // Rank among each client's loaded undecided rows, in client_match_queue's order.
  const byClient = new Map<string, QueueRow[]>()
  for (const r of rows) if (r.action !== "push" && r.action !== "dismiss") byClient.set(r.client_profile_id, [...(byClient.get(r.client_profile_id) ?? []), r])
  const sizes = new Map<string, number>()
  for (const [c, rs] of byClient) {
    rs.sort(queueOrder).forEach((r, i) => { r.rank = i + 1 })
    sizes.set(c, rs.length)
  }

  const jobs = buildJobs(rows, aliases)
  lap(`built ${jobs.length} jobs from ${rows.length} rows`)
  return { clients: clientList(profs, sizes), jobs, minScore: min }
}

type ReadArgs = { clients: string[]; min: number; unscored: boolean; since: string | null }
type Read = { via: string; rowsIn: any[]; postings: Map<string, any>; flags: any[]; secondaries: Set<string> }

/**
 * The rows the Job Queue shows, in ONE database call: job_queue_rows()
 * (20261124) filters posting_matches, joins postings and the posting's flags,
 * and leaves out linked secondaries. Before that function exists, the same
 * reads go through the API in batches (much slower on prod: every batch is a
 * round trip).
 */
async function readRows(sb: SupabaseClient, r: ReadArgs): Promise<Read> {
  const { data, error } = await sb.rpc("job_queue_rows", {
    p_clients: r.clients, p_min_score: r.min, p_floor: LOAD_MIN_SCORE, p_unscored: r.unscored, p_decided_since: r.since,
  })
  if (error) {
    // PGRST202: the function is not there yet (migration not applied).
    // 57014: it hit the statement timeout; the batched reads still work.
    if (error.code === "PGRST202" || error.code === "57014") {
      if (error.code === "57014") console.error("[job-queue] job_queue_rows timed out; loading through API requests")
      return { ...(await readRowsByRequests(sb, r)), via: error.code === "57014" ? "api requests (job_queue_rows timed out)" : "api requests" }
    }
    throw new Error(`job_queue_rows: ${error.message}`)
  }
  const postings = new Map<string, any>()
  const flags: any[] = []
  const rowsIn = (data as any[] ?? []).map((x) => {
    if (!postings.has(x.posting_id)) {
      postings.set(x.posting_id, {
        id: x.posting_id, source: x.p_source, title: x.p_title, cleaned_title: x.p_cleaned_title, company: x.p_company, location: x.p_location,
        apply_url: x.p_apply_url, apply_link_kind: x.p_apply_link_kind, link_check_status: x.p_link_check_status,
        years_min: x.p_years_min, years_max: x.p_years_max, years_basis: x.p_years_basis,
        salary_low: x.p_salary_low, salary_high: x.p_salary_high, salary_period: x.p_salary_period,
        application_deadline: x.p_application_deadline, requirements_summary: x.p_requirements_summary,
        first_seen_at: x.p_first_seen_at, last_seen_at: x.p_last_seen_at, closed_at: x.p_closed_at, campus_signal: x.p_campus_signal,
        start_type: x.p_start_type, start_date: x.p_start_date, start_season: x.p_start_season, start_year: x.p_start_year,
      })
      for (const fl of x.flags ?? []) flags.push({ ...fl, posting_id: x.posting_id })
    }
    return x
  })
  return { via: "job_queue_rows", rowsIn, postings, flags, secondaries: new Set() }
}

/** The same rows through the API: matches per client, then postings, flags and links by id. */
async function readRowsByRequests(sb: SupabaseClient, r: ReadArgs): Promise<Read> {
  const { clients: active, min } = r
  const undecided = (ids: string[] = active) => sb.from("posting_matches").select(MATCH_COLS).in("client_profile_id", ids).eq("rule_failures", "{}")
  // Undecided rows show only once released (20261127); Add Job in progress always shows.
  const released = (ids: string[] = active) => undecided(ids).not("released_at", "is", null)
  const reads: Promise<any[]>[] = [
    ...active.map((c) => pageAll<any>((a, b) => released([c]).is("action", null).gte("score", min).order("score", { ascending: false }).order("id").range(a, b))),
    pageAll<any>((a, b) => undecided().eq("action", "evaluating").order("id").range(a, b)),
  ]
  if (r.unscored) reads.push(pageAll<any>((a, b) => released().is("action", null).is("score", null).order("id").range(a, b)))
  if (r.since) reads.push(pageAll<any>((a, b) => sb.from("posting_matches").select(MATCH_COLS).in("client_profile_id", active)
    .in("action", ["push", "dismiss"]).gte("actioned_at", r.since!).order("id").range(a, b)))
  const matches = (await Promise.all(reads)).flat()
  // Other clients' chips on the same jobs (the page's "+N under 50").
  if (min > LOAD_MIN_SCORE && active.length > 1) {
    const hot = [...new Set(matches.map((m) => m.posting_id as string))]
    const more = await Promise.all(chunk(hot).map((part) => pageAll<any>((a, b) => released().is("action", null)
      .in("posting_id", part).gte("score", LOAD_MIN_SCORE).lt("score", min).order("id").range(a, b))))
    matches.push(...more.flat())
  }
  const seenMatch = new Set<string>()
  const rowsIn = matches.filter((m) => !seenMatch.has(m.id) && seenMatch.add(m.id))
  const postingIds = [...new Set(rowsIn.map((m) => m.posting_id as string))]
  const byIds = async (table: string, cols: string, col: string) => (await Promise.all(chunk(postingIds).map(async (part) => {
    const { data, error } = await sb.from(table).select(cols).in(col, part)
    if (error) throw new Error(`${table}: ${error.message}`)
    return (data ?? []) as any[]
  }))).flat()
  const [ps, flags, links] = await Promise.all([
    byIds("postings", POSTING_COLS, "id"),
    byIds("posting_coach_flags", "posting_id, practice_coach_id, flag, apply_url, url_saved_at", "posting_id"),
    byIds("posting_links", "secondary_id", "secondary_id"),
  ])
  return { via: "api requests", rowsIn, postings: new Map(ps.map((p) => [p.id as string, p])), flags, secondaries: new Set(links.map((l) => l.secondary_id as string)) }
}

/** client_match_queue's ORDER BY: likely_closed, bad_link, tier, score desc (unscored last), preferred market first, republished last, newest. */
export function queueOrder(a: QueueRow, b: QueueRow): number {
  const k = (r: QueueRow) => [r.likely_closed ? 1 : 0, r.bad_link ? 1 : 0, r.tier ?? 1, r.score === null ? Infinity : -r.score, r.preferred_market ? 0 : 1, r.republished_only ? 1 : 0]
  const x = k(a), y = k(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return (b.first_queued_at ?? "").localeCompare(a.first_queued_at ?? "")
}

/** client_match_queue's tier and tier_label (20261106, 20261107). */
export function tierOf(availableFrom: string | null, p: any, score: number | null, today = new Date()): { tier: number; label: string } {
  const d = today.toISOString().slice(0, 10)
  if (availableFrom && availableFrom > d) return p.campus_signal && (score ?? -1) >= 40 ? { tier: 1, label: "campus" } : { tier: 2, label: "timing unknown" }
  const start = statedStart(p)
  const in3 = new Date(today); in3.setMonth(in3.getMonth() + 3)
  return start && start > in3.toISOString().slice(0, 10) ? { tier: 2, label: "starts in 3+ months" } : { tier: 1, label: "now or not stated" }
}
function statedStart(p: any): string | null {
  if (p.start_type === "date") return p.start_date ?? null
  if (p.start_type === "season" && p.start_year) {
    const mo = ({ spring: "03", summer: "06", fall: "09" } as Record<string, string>)[p.start_season] ?? "01"
    return `${p.start_year}-${mo}-01`
  }
  return null
}
export function startLabel(p: any): string {
  if (p.start_type === "date" && p.start_date) return `starts ${String(p.start_date).slice(0, 10)}`
  if (p.start_type === "season") return `starts ${p.start_season} ${p.start_year}`
  if (p.start_type === "immediate") return "starts immediately"
  return "start not stated"
}
/** A client's practices' flags on one posting, folded as the view does: closed, not_us, bad_link; newest saved link. */
function folded(fs: any[]): { flag: string | null; applyUrl: string | null } {
  const order: Record<string, number> = { closed: 0, not_us: 1, bad_link: 2 }
  const flag = fs.map((x) => x.flag).filter(Boolean).sort((a, b) => (order[a] ?? 3) - (order[b] ?? 3))[0] ?? null
  const link = fs.filter((x) => x.apply_url).sort((a, b) => String(b.url_saved_at).localeCompare(String(a.url_saved_at)))[0]?.apply_url ?? null
  return { flag, applyUrl: link }
}
/** client -> the practices that reach it: its active coaches and their principals. */
async function practicesByClient(sb: SupabaseClient, clientIds: string[]): Promise<Map<string, Set<string>>> {
  const { data: cc, error } = await sb.from("coach_clients").select("client_profile_id, coach_profile_id").in("client_profile_id", clientIds).eq("status", "active")
  if (error) throw new Error(`coach_clients: ${error.message}`)
  const coaches = [...new Set((cc ?? []).map((r: any) => r.coach_profile_id as string))]
  const { data: d, error: dErr } = coaches.length
    ? await sb.from("coach_delegates").select("delegate_coach_profile_id, principal_coach_profile_id").in("delegate_coach_profile_id", coaches).eq("status", "active")
    : { data: [], error: null }
  if (dErr) throw new Error(`coach_delegates: ${dErr.message}`)
  const out = new Map<string, Set<string>>()
  for (const r of cc ?? []) {
    const s = out.get(r.client_profile_id) ?? new Set<string>()
    s.add(r.coach_profile_id)
    for (const x of d ?? []) if (x.delegate_coach_profile_id === r.coach_profile_id) s.add(x.principal_coach_profile_id)
    out.set(r.client_profile_id, s)
  }
  return out
}

function clientList(profs: any[], sizes: Map<string, number>) {
  return profs.map((p) => {
    const name = (p.name || p.email || "Client").trim()
    return { id: p.id as string, name, first: name.split(/\s+/)[0], queueSize: sizes.get(p.id) ?? 0 }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

const KIND: Record<string, number> = { employer: 0, board: 1, republisher: 2, other: 3, google: 3 }
const listingRank = (r: QueueRow) => [KIND[r.apply_link_kind ?? ""] ?? 4, r.link_check_status === "open" ? 0 : r.link_check_status ? 1 : 2, r.likely_closed ? 1 : 0, -new Date(r.first_seen_at ?? 0).getTime()]
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }

/** Queue rows (one per client per posting) -> one job per group of copies. Pure. */
export function buildJobs(rows: QueueRow[], aliases: Map<string, string> = new Map()): Job[] {
  const byPosting = new Map<string, QueueRow[]>()
  for (const r of rows) byPosting.set(r.posting_id, [...(byPosting.get(r.posting_id) ?? []), r])
  const copyRows: (CopyRow & { rs: QueueRow[] })[] = [...byPosting.entries()].map(([id, rs]) => ({
    id, source: rs[0].source, title: rs[0].raw_title, cleaned_title: rs[0].title, company: rs[0].company, location: rs[0].location,
    apply_link_kind: rs[0].apply_link_kind, link_check_status: rs[0].link_check_status, first_seen_at: rs[0].first_seen_at, rs,
  }))

  const jobs: Job[] = []
  for (const g of groupCopies(copyRows, aliases)) {
    const listings = g.members.map((m) => m.rs[0]).sort((a, b) => cmp(listingRank(a), listingRank(b)))
    const p = listings[0]
    const perClient = new Map<string, QueueRow[]>()
    for (const m of g.members) for (const r of m.rs) perClient.set(r.client_profile_id, [...(perClient.get(r.client_profile_id) ?? []), r])
    const chips: Chip[] = [...perClient.entries()].map(([c, rs]) => {
      rs.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      // A decision on any copy is the client's decision on the job: the
      // newest one, push over dismiss over evaluating when simultaneous.
      const decided = rs.filter((r) => r.action === "push" || r.action === "dismiss").sort((a, b) => (b.actioned_at ?? "").localeCompare(a.actioned_at ?? ""))[0]
      const evaluating = rs.find((r) => r.action === "evaluating")
      const d = decided ?? evaluating
      const ranks = rs.map((r) => r.rank).filter((x): x is number => x !== null)
      return {
        c, s: rs[0].score, why: rs[0].judge_reason,
        q: rs.map((r) => r.first_queued_at).filter(Boolean).sort()[0] ?? null,
        rk: ranks.length ? Math.min(...ranks) : null,
        all: rs.length > 1 ? rs.map((r) => r.score) : undefined,
        ids: rs.map((r) => r.match_id),
        status: d ? STATUS[d.action!] : null,
        reason: decided?.dismiss_reason ?? null,
        note: d?.note ?? null,
        jobfitScore: rs.find((r) => r.jobfit_score != null)?.jobfit_score ?? null,
        jobfitDecision: rs.find((r) => r.jobfit_decision)?.jobfit_decision ?? null,
        ...(decided?.action === "push" && decided.already_added ? { alreadyAdded: true as const } : {}),
      }
    }).sort((a, b) => (b.s ?? -1) - (a.s ?? -1))
    const flagged = g.members.map((m) => m.rs[0]).find((r) => r.coach_flag)
    jobs.push({
      key: g.primary.id,
      t: p.title, co: p.company, loc: p.location, url: p.apply_url, lk: p.apply_link_kind, rep: p.republished_only,
      ymin: p.years_min, ymax: p.years_max, yb: p.years_basis, sl: p.salary_low, sh: p.salary_high, sp: p.salary_period,
      st: p.start_label, dl: p.application_deadline, closed: p.likely_closed, lcs: p.link_check_status,
      seen: listings.map((l) => l.first_seen_at).filter(Boolean).sort()[0] ?? null, req: p.requirements_summary,
      campus: listings.some((l) => l.campus_signal), tier: p.tier_label,
      flag: flagged?.coach_flag ?? null, badLink: listings.every((l) => l.bad_link) && listings.some((l) => l.bad_link),
      postingIds: g.members.map((m) => m.id),
      m: chips,
      ls: listings.length > 1 ? listings.map((l) => ({ postingId: l.posting_id, t: l.title, co: l.company, loc: l.location, url: l.apply_url, lk: l.apply_link_kind, closed: l.likely_closed, lcs: l.link_check_status })) : undefined,
      ck: `${compact(normText(p.title))}||${compact(employerKey(p.company, aliases))}`,
    })
  }
  // Fully ordered (key last): the route pages through this list, and every
  // page request rebuilds it, so equal jobs must not swap places between pages.
  return jobs.sort((a, b) => (b.m[0]?.s ?? -1) - (a.m[0]?.s ?? -1) || b.m.length - a.m.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------
export type DecisionInput = {
  clientProfileId: string
  matchIds: string[]
  /** null = undo: back to undecided. */
  action: "evaluating" | "push" | "dismiss" | null
  reason?: string | null
  note?: string | null
  actorId: string
  jobfit?: { score: number | null; decision: string | null; runId: string | null; applicationId: string | null }
  /** A Fit marked "Already added" (in the tracker before): no JobFit, nothing added. */
  alreadyAdded?: boolean
}

/**
 * Writes the decision on every copy. Records the judge score and the queue rank
 * and size at the moment of deciding (the weekly measure reads them).
 */
export async function recordDecision(sb: SupabaseClient, d: DecisionInput): Promise<{ updated: number }> {
  const matchIds = [...new Set(d.matchIds)].filter(Boolean)
  if (!matchIds.length) throw new HttpError(400, "match_ids is required")
  // A job shown in several cities is decided for all of them at once.
  if (matchIds.length > 120) throw new HttpError(400, "too many match_ids")
  if (d.action === "dismiss") {
    if (!d.reason || !REASON_VALUES.has(d.reason)) throw new HttpError(400, "A Not a fit reason is required")
    if (d.reason === "other" && !(d.note ?? "").trim()) throw new HttpError(400, "Other needs a note")
  }
  const { data: ms, error } = await sb.from("posting_matches").select("id, client_profile_id, score, action").in("id", matchIds)
  if (error) throw new Error(`posting_matches: ${error.message}`)
  if ((ms ?? []).length !== matchIds.length || (ms ?? []).some((m: any) => m.client_profile_id !== d.clientProfileId)) {
    throw new HttpError(400, "match_ids must all belong to this client")
  }

  let atAction: Record<string, unknown> = { score_at_action: null, rank_at_action: null, queue_size_at_action: null }
  if (d.action === "push" || d.action === "dismiss") {
    // Filtered by client first: the view's ranking is per client, so this ranks
    // one client's queue, not every client's (a match_id filter alone cannot be
    // pushed below the window function).
    const { data: q } = await sb.from("client_match_queue").select("rank").eq("client_profile_id", d.clientProfileId).in("match_id", matchIds).order("rank").limit(1)
    const { count } = await sb.from("client_match_queue").select("match_id", { count: "exact", head: true }).eq("client_profile_id", d.clientProfileId)
    const best = Math.max(...(ms ?? []).map((m: any) => m.score ?? -1))
    atAction = { score_at_action: best >= 0 ? best : null, rank_at_action: q?.[0]?.rank ?? null, queue_size_at_action: count ?? null }
  }
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = d.action === null
    ? { action: null, dismiss_reason: null, actioned_at: null, actioned_by: null, ...atAction }
    : {
        action: d.action, dismiss_reason: d.action === "dismiss" ? d.reason : null, actioned_at: now, actioned_by: d.actorId,
        ...(d.note !== undefined ? { note: d.note?.trim() || null } : {}),
        ...(d.action === "evaluating" ? {} : atAction),
      }
  // Only a Fit can be "already added" (posting_matches_already_added_is_fit).
  patch.already_added = d.action === "push" && !!d.alreadyAdded
  if (d.jobfit) Object.assign(patch, {
    jobfit_score: d.jobfit.score, jobfit_decision: d.jobfit.decision, jobfit_run_id: d.jobfit.runId, signal_application_id: d.jobfit.applicationId,
  })
  let q = sb.from("posting_matches").update(patch).in("id", matchIds).eq("client_profile_id", d.clientProfileId)
  // Opening Add Job never downgrades a decision already made.
  if (d.action === "evaluating") q = q.or("action.is.null,action.eq.evaluating")
  const { data: up, error: upErr } = await q.select("id")
  if (upErr) throw new Error(`posting_matches update: ${upErr.message}`)
  return { updated: up?.length ?? 0 }
}

// ---------------------------------------------------------------------------
// Posting flags: per practice (20261122_posting_coach_flags_by_practice.sql)
// ---------------------------------------------------------------------------
// A practice is a principal coach plus their active delegates (coach_delegates).
// A flag or saved link is stored under the flagging coach's practice and
// reaches only clients of that practice: client_match_queue applies it where
// the practice is one of the client's coaches or their principal.

/** The practice a coach acts in: their principal, or themselves. */
export async function practiceOf(sb: SupabaseClient, coachProfileId: string): Promise<string> {
  try { return owningCoachId(await resolveDelegation(sb, coachProfileId)) }
  catch (e: any) { throw new HttpError(400, e?.message || "Could not tell which practice this coach acts in") }
}

/** Every practice that reaches a client: its active coaches and their principals. */
export async function clientPractices(sb: SupabaseClient, clientProfileId: string): Promise<string[]> {
  const { data: cc, error } = await sb.from("coach_clients").select("coach_profile_id").eq("client_profile_id", clientProfileId).eq("status", "active")
  if (error) throw new Error(`coach_clients: ${error.message}`)
  const coaches = [...new Set((cc ?? []).map((r: any) => r.coach_profile_id as string))]
  if (!coaches.length) return []
  const { data: d, error: dErr } = await sb.from("coach_delegates").select("principal_coach_profile_id").in("delegate_coach_profile_id", coaches).eq("status", "active")
  if (dErr) throw new Error(`coach_delegates: ${dErr.message}`)
  return [...new Set([...coaches, ...(d ?? []).map((r: any) => r.principal_coach_profile_id as string)])]
}

/** The newest link a coach of this client's practices saved for the posting. */
export async function savedLinkFor(sb: SupabaseClient, postingId: string, clientProfileId: string): Promise<string | null> {
  const practices = await clientPractices(sb, clientProfileId)
  if (!practices.length) return null
  const { data, error } = await sb.from("posting_coach_flags").select("apply_url").eq("posting_id", postingId).in("practice_coach_id", practices)
    .not("apply_url", "is", null).order("url_saved_at", { ascending: false }).limit(1)
  if (error) throw new Error(`posting_coach_flags: ${error.message}`)
  return data?.[0]?.apply_url ?? null
}

/** A coach may flag a posting only when one of their own clients (full access) has it. */
export async function assertPostingAccess(sb: SupabaseClient, coachProfileId: string, postingIds: string[]) {
  const full = (await coachClients(sb, coachProfileId)).filter((c) => c.accessLevel === "full").map((c) => c.clientProfileId)
  if (!full.length) throw new HttpError(403, "Forbidden")
  const { data, error } = await sb.from("posting_matches").select("posting_id").in("posting_id", postingIds).in("client_profile_id", full)
  if (error) throw new Error(`posting_matches: ${error.message}`)
  const ok = new Set((data ?? []).map((r: any) => r.posting_id))
  if (postingIds.some((id) => !ok.has(id))) throw new HttpError(403, "Forbidden: posting is not in any of your clients' queues")
}

export async function setPostingFlag(sb: SupabaseClient, input: { postingIds: string[]; flag?: CoachFlag | null; applyUrl?: string | null; actorId: string }) {
  const now = new Date().toISOString()
  if (input.applyUrl !== undefined && input.applyUrl !== null && !/^https?:\/\/\S+$/i.test(input.applyUrl)) throw new HttpError(400, "apply_url must be an http(s) link")
  if (input.flag !== undefined && input.flag !== null && !COACH_FLAGS.includes(input.flag)) throw new HttpError(400, "unknown flag")
  const practice = await practiceOf(sb, input.actorId)
  const { data: existing, error } = await sb.from("posting_coach_flags").select("*").in("posting_id", input.postingIds).eq("practice_coach_id", practice)
  if (error) throw new Error(`posting_coach_flags: ${error.message}`)
  const by = new Map((existing ?? []).map((r: any) => [r.posting_id, r]))
  const upserts: any[] = []
  const deletes: string[] = []
  for (const id of input.postingIds) {
    const r: any = { ...(by.get(id) ?? { posting_id: id, practice_coach_id: practice, flag: null, flagged_at: null, flagged_by: null, apply_url: null, url_saved_at: null, url_saved_by: null }) }
    if (input.flag !== undefined) Object.assign(r, input.flag ? { flag: input.flag, flagged_at: now, flagged_by: input.actorId } : { flag: null, flagged_at: null, flagged_by: null })
    if (input.applyUrl !== undefined) Object.assign(r, input.applyUrl ? { apply_url: input.applyUrl.trim(), url_saved_at: now, url_saved_by: input.actorId } : { apply_url: null, url_saved_at: null, url_saved_by: null })
    if (!r.flag && !r.apply_url) { if (by.has(id)) deletes.push(id); continue }
    delete r.created_at
    upserts.push({ ...r, updated_at: now })
  }
  if (upserts.length) {
    const { error: e } = await sb.from("posting_coach_flags").upsert(upserts, { onConflict: "posting_id,practice_coach_id" })
    if (e) throw new Error(`posting_coach_flags upsert: ${e.message}`)
  }
  if (deletes.length) {
    const { error: e } = await sb.from("posting_coach_flags").delete().in("posting_id", deletes).eq("practice_coach_id", practice)
    if (e) throw new Error(`posting_coach_flags delete: ${e.message}`)
  }
  return { updated: upserts.length + deletes.length }
}
