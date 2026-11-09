/**
 * Which Google Jobs pairs tonight's run searches, under the search cap.
 *
 * PER-CLIENT FAIR SHARE (Peri, 2026-11-09; replaces the 2-a-client floor):
 *   1. Every active client (client_match_criteria.active) gets an equal share
 *      of the night's cap: cap / clients. A pair belongs to a client when its
 *      title is one of the client's target roles. Clients take turns, one pair
 *      at a time, each taking its own pair that has waited longest since its
 *      last search (never searched first). A pair that does not fit what is
 *      left of the client's share ends that client's turns: smaller pairs do
 *      not jump it.
 *   2. A pair owned by several clients is searched once and costs each owner
 *      an even part. An owner whose share is spent pays what it has; the
 *      client taking the pair pays the rest.
 *   3. What no client could use (a client with no pairs, all searched today,
 *      or a remainder too small for its next pair) goes to the client furthest
 *      behind: the one whose next pair has waited longest, one pair at a time,
 *      while it fits.
 * Pairs no active client owns are not searched. A pair searched in the last
 * RESEARCH_AFTER_HOURS is left out. Simulated on the week of 2026-11-02 (tests/
 * pipeline/fair-share-sim.local.mts): every client searched every night it was
 * active; Sami (93 pairs) goes from ~390 searches a week to ~205.
 *
 * CONTINUATIONS. When the step resumes later the same night, each client's
 * share is what is left after its part of tonight's earlier searches
 * (spentTonight, split the same way), and the night's total is what is left of
 * the cap.
 *
 * THE ESTIMATE KEEPS THE CAP A CEILING. A pair costs its own last search's
 * pages (else maxPages) plus one control search per location not already paid
 * for tonight. The runner's SearchBudget still stops hard at the cap; hitting
 * it means paging ran deeper than the estimate, and that is the alert.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { GOOGLE_JOBS_SOURCES } from "../ingest/googleJobs"
import type { IngestPair } from "../ingest/types"

export const RESEARCH_AFTER_HOURS = 20
const DAY = 86400e3

/** Google Jobs searches a night (PIPELINE_SEARCH_CAP). */
export function searchCapFromEnv(): number {
  const v = Number(process.env.PIPELINE_SEARCH_CAP)
  return Number.isFinite(v) && v > 0 ? v : 170
}

export type PairRow = { id: string; title: string; location: string | null; campus: boolean }
/** pages: result pages the pair's last search fetched, control search excluded. */
export type LastSearch = { at: string; pages: number }
export type ClientRoles = { clientProfileId: string; targetRoles: string[] }

/** owners: active clients the pair belongs to. spare: taken from what no client's share used. */
export type PickedPair = IngestPair & { id: string; estimate: number; lastSearchedAt: string | null; owners: string[]; spare: boolean }
export type PairPick = {
  picked: PickedPair[]
  estimate: number
  /** Each client's share of the night's cap. */
  share: number
  clients: number
  /** Per client: tonight's charge from its share (earlier runs included), and from spare. */
  charged: Record<string, number>
  spare: Record<string, number>
  /** Eligible pairs left for a later night. */
  waiting: number
  /** Searched too recently to be eligible. */
  recent: number
  /** Active pairs no active client owns: not searched. */
  unowned: number
}

const key = (s: string) => s.trim().toLowerCase()

export function ownersByPair(pairs: PairRow[], clients: ClientRoles[]): Map<string, string[]> {
  const byRole = new Map<string, string[]>()
  for (const c of clients) for (const r of new Set(c.targetRoles.map(key))) byRole.set(r, [...(byRole.get(r) ?? []), c.clientProfileId])
  return new Map(pairs.map((p) => [p.id, [...new Set(byRole.get(key(p.title)) ?? [])]]))
}

export function pickPairs(
  pairs: PairRow[],
  last: Map<string, LastSearch>,
  clients: ClientRoles[],
  opts: { cap: number; maxPages: number; now?: Date; spentTonight?: Map<string, number>; spentEarlier?: number },
): PairPick {
  const now = (opts.now ?? new Date()).getTime()
  const ids = [...new Set(clients.map((c) => c.clientProfileId))]
  const owners = ownersByPair(pairs, clients)
  const lastMs = (id: string) => (last.has(id) ? new Date(last.get(id)!.at).getTime() : -Infinity)
  const recentCutoff = now - RESEARCH_AFTER_HOURS * 3600e3
  const owned = pairs.filter((p) => owners.get(p.id)!.length)
  const eligible = owned.filter((p) => lastMs(p.id) < recentCutoff)
  const pagesOf = (id: string) => Math.min(Math.max(last.get(id)?.pages ?? opts.maxPages, 1), opts.maxPages)

  const share = ids.length ? opts.cap / ids.length : 0
  const budget = new Map(ids.map((c) => [c, share - (opts.spentTonight?.get(c) ?? 0)]))
  const charged = new Map(ids.map((c) => [c, opts.spentTonight?.get(c) ?? 0]))
  const spare = new Map(ids.map((c) => [c, 0]))
  let left = opts.cap - (opts.spentEarlier ?? 0)

  const byAge = (a: PairRow, b: PairRow) => lastMs(a.id) - lastMs(b.id) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
  const queue = new Map(ids.map((c) => [c, eligible.filter((p) => owners.get(p.id)!.includes(c)).sort(byAge)]))
  const taken = new Set<string>(), paidLoc = new Set<string>()
  const picked: PickedPair[] = []
  const next = (c: string) => queue.get(c)!.find((p) => !taken.has(p.id))
  const costOf = (p: PairRow) => pagesOf(p.id) + (paidLoc.has(p.location ?? "*no-location*") ? 0 : 1)
  const take = (p: PairRow, isSpare: boolean) => {
    const cost = costOf(p)
    taken.add(p.id); paidLoc.add(p.location ?? "*no-location*"); left -= cost
    picked.push({ id: p.id, title: p.title, location: p.location, campus: p.campus, estimate: cost, lastSearchedAt: last.get(p.id)?.at ?? null, owners: owners.get(p.id)!, spare: isSpare })
  }

  // 1. Shares, in turns. Clients furthest behind take the first turn.
  const turnOrder = ids.filter((c) => next(c)).sort((a, b) => byAge(next(a)!, next(b)!) || a.localeCompare(b))
  const open = new Set(turnOrder)
  while (open.size) {
    for (const c of turnOrder) {
      if (!open.has(c)) continue
      const p = next(c)
      if (!p) { open.delete(c); continue }
      const cost = costOf(p)
      const own = owners.get(p.id)!
      const part = cost / own.length
      const co = own.filter((o) => o !== c).map((o) => [o, Math.min(part, Math.max(budget.get(o)!, 0))] as const)
      const mine = cost - co.reduce((s, [, v]) => s + v, 0)
      if (mine > budget.get(c)! + 1e-9 || cost > left) { open.delete(c); continue }
      take(p, false)
      budget.set(c, budget.get(c)! - mine); charged.set(c, charged.get(c)! + mine)
      for (const [o, v] of co) { budget.set(o, budget.get(o)! - v); charged.set(o, charged.get(o)! + v) }
    }
  }

  // 2. What is left, to whoever's next pair has waited longest.
  const done = new Set<string>()
  for (;;) {
    const cand = ids.filter((c) => !done.has(c) && next(c))
      .sort((a, b) => byAge(next(a)!, next(b)!) || (charged.get(a)! + spare.get(a)!) - (charged.get(b)! + spare.get(b)!) || a.localeCompare(b))
    if (!cand.length) break
    const c = cand[0], p = next(c)!, cost = costOf(p)
    if (cost > left) { done.add(c); continue }
    take(p, true)
    for (const o of owners.get(p.id)!) spare.set(o, spare.get(o)! + cost / owners.get(p.id)!.length)
  }

  return {
    picked, estimate: picked.reduce((n, p) => n + p.estimate, 0), share, clients: ids.length,
    charged: Object.fromEntries(charged), spare: Object.fromEntries(spare),
    waiting: eligible.length - picked.length, recent: owned.length - eligible.length, unowned: pairs.length - owned.length,
  }
}

/**
 * Pure. Runs the pick forward `nights` nights (each at 05:00 UTC from `from`)
 * and returns, per client, the longest any of its pairs waits: at the moment it
 * is searched, or still waiting at the end. null: a pair never searched before
 * or during the run.
 */
export function projectLongestWaits(
  pairs: PairRow[],
  last: Map<string, LastSearch>,
  clients: ClientRoles[],
  opts: { cap: number; maxPages: number; from: Date; nights?: number },
): Map<string, number | null> {
  const state = new Map([...last].map(([k, v]) => [k, { ...v }]))
  const owners = ownersByPair(pairs, clients)
  const worst = new Map<string, number | null>(clients.map((c) => [c.clientProfileId, 0]))
  const bump = (c: string, w: number | null) => { const cur = worst.get(c); if (cur === null) return; worst.set(c, w === null ? null : Math.max(cur ?? 0, w)) }
  const start = Date.UTC(opts.from.getUTCFullYear(), opts.from.getUTCMonth(), opts.from.getUTCDate(), 5)
  const nights = opts.nights ?? 28
  for (let d = 0; d < nights; d++) {
    const at = new Date(start + d * DAY)
    const r = pickPairs(pairs, state, clients, { cap: opts.cap, maxPages: opts.maxPages, now: at })
    for (const p of r.picked) {
      const prev = state.get(p.id)
      if (prev) for (const o of p.owners) bump(o, (at.getTime() - new Date(prev.at).getTime()) / DAY)
      state.set(p.id, { at: at.toISOString(), pages: prev?.pages ?? opts.maxPages })
    }
  }
  const end = start + nights * DAY
  for (const p of pairs) for (const o of owners.get(p.id) ?? []) {
    const s = state.get(p.id)
    bump(o, s ? (end - new Date(s.at).getTime()) / DAY : null)
  }
  return worst
}

async function pageAll<T>(q: (a: number, b: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await q(a, a + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

/** Active Google Jobs pairs, each pair's last Google Jobs search, and active clients' roles. */
export async function loadPickInputs(sb: SupabaseClient): Promise<{ pairs: PairRow[]; last: Map<string, LastSearch>; clients: ClientRoles[] }> {
  const pairs = await pageAll<any>((a, b) => sb.from("ingest_pairs").select("id, title, location, campus")
    .eq("active", true).overlaps("sources", [...GOOGLE_JOBS_SOURCES]).order("id").range(a, b))
  // Newest first, so the first row seen per pair is its last search. requests_made
  // counts the location's control search too, unless an earlier pair paid for it.
  const runs = await pageAll<any>((a, b) => sb.from("ingest_runs").select("pair_id, started_at, requests_made, control_detail")
    .in("source", [...GOOGLE_JOBS_SOURCES]).not("pair_id", "is", null).order("started_at", { ascending: false }).range(a, b))
  const last = new Map<string, LastSearch>()
  for (const r of runs) {
    if (last.has(r.pair_id)) continue
    const control = r.control_detail?.control_reused === false ? 1 : 0
    last.set(r.pair_id, { at: new Date(r.started_at).toISOString(), pages: r.requests_made - control })
  }
  const crit = await pageAll<any>((a, b) => sb.from("client_match_criteria").select("client_profile_id, target_roles").eq("active", true).order("client_profile_id").range(a, b))
  return {
    pairs: pairs.map((p) => ({ ...p, campus: !!p.campus })),
    last,
    clients: crit.map((c) => ({ clientProfileId: c.client_profile_id, targetRoles: c.target_roles ?? [] })),
  }
}

/** Each client's part of the Google Jobs searches since `since`: a search's requests split evenly among its pair's owners. */
export async function spentByClientSince(sb: SupabaseClient, since: string, pairs: PairRow[], clients: ClientRoles[]): Promise<Map<string, number>> {
  const owners = ownersByPair(pairs, clients)
  const runs = await pageAll<any>((a, b) => sb.from("ingest_runs").select("pair_id, requests_made").in("source", [...GOOGLE_JOBS_SOURCES])
    .not("pair_id", "is", null).gte("started_at", since).order("started_at").range(a, b))
  const out = new Map<string, number>()
  for (const r of runs) {
    const own = owners.get(r.pair_id) ?? []
    for (const o of own) out.set(o, (out.get(o) ?? 0) + (r.requests_made ?? 0) / own.length)
  }
  return out
}

/** Loads everything and picks. `since`: when tonight's first run started (a continuation), so earlier searches come off each share. */
export async function loadAndPickPairs(
  sb: SupabaseClient,
  opts: { cap: number; maxPages: number; now?: Date; since?: string; spentEarlier?: number },
): Promise<PairPick & { total: number }> {
  const { pairs, last, clients } = await loadPickInputs(sb)
  const spentTonight = opts.since ? await spentByClientSince(sb, opts.since, pairs, clients) : undefined
  const pick = pickPairs(pairs, last, clients, { cap: opts.cap, maxPages: opts.maxPages, now: opts.now, spentTonight, spentEarlier: opts.spentEarlier })
  return { ...pick, total: pairs.length }
}
