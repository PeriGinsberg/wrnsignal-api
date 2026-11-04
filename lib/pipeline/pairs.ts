/**
 * Which Google Jobs pairs tonight's run searches, under the search cap.
 *
 * ORDER:
 *   0. EVERY CLIENT, EVERY NIGHT (Peri, 2026-11-04): each client with criteria
 *      gets their FLOOR_PER_CLIENT eligible pairs that come first by the order
 *      below, clients taken in the order of their first such pair. A pair
 *      shared by several clients counts for each. Simulated on the prod pairs
 *      (2026-11-04): oldest-first alone left 9 of 12 clients with nights with
 *      no search, because one client owned a third of all pairs. When the
 *      floor's estimate is over half the cap, it drops to 1 a client
 *      (floorPerClient says which ran).
 *   1. Pairs never searched, and pairs belonging to a client whose searches
 *      changed (targets_changed_at: new client, target roles, markets, switched
 *      back on) after the pair's last search. A pair belongs to a client when
 *      its title is one of the client's target roles. A new client's first
 *      queue should not wait for the rotation to come round.
 *   2. Everything else, longest since its last search first.
 * A pair searched in the last RESEARCH_AFTER_HOURS is left out unless it is a
 * priority pair: spare budget is not spent re-reading this morning's results.
 *
 * THE ESTIMATE KEEPS THE CAP A CEILING, NOT A ROTATION. Pairs are taken while
 * their estimated cost fits: the pair's own last search count (pages it
 * needed), else maxPages, plus one control search per location not already
 * paid for tonight. The runner's SearchBudget still stops hard at the cap, and
 * hitting it means paging ran deeper than the estimate: that is the alert.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { GOOGLE_JOBS_SOURCES } from "../ingest/googleJobs"
import type { IngestPair } from "../ingest/types"

export const RESEARCH_AFTER_HOURS = 20
export const FLOOR_PER_CLIENT = 2

export type PairRow = { id: string; title: string; location: string | null; campus: boolean }
/** pages: result pages the pair's last search fetched, control search excluded. */
export type LastSearch = { at: string; pages: number }
export type ClientRoles = { clientProfileId: string; targetRoles: string[]; changedAt: string }

/** floor: picked as one of a client's nightly guaranteed pairs. */
export type PickedPair = IngestPair & { id: string; estimate: number; priority: string | null; lastSearchedAt: string | null; floor: boolean }
export type PairPick = {
  picked: PickedPair[]
  estimate: number
  /** Pairs guaranteed to each client tonight: FLOOR_PER_CLIENT, or 1 when that would take over half the cap. */
  floorPerClient: number
  /** Eligible pairs left for a later night: over the cap, in order. */
  waiting: number
  /** Searched too recently to be eligible. */
  recent: number
}

const key = (s: string) => s.trim().toLowerCase()

export function pickPairs(
  pairs: PairRow[],
  last: Map<string, LastSearch>,
  clients: ClientRoles[],
  opts: { cap: number; maxPages: number; now?: Date; floor?: number },
): PairPick {
  const now = (opts.now ?? new Date()).getTime()
  const rolesBy = new Map<string, ClientRoles[]>()
  for (const c of clients) for (const r of c.targetRoles) {
    const k = key(r)
    rolesBy.set(k, [...(rolesBy.get(k) ?? []), c])
  }

  const priorityOf = (p: PairRow): string | null => {
    const l = last.get(p.id)
    if (!l) return "never searched"
    const changed = (rolesBy.get(key(p.title)) ?? []).filter((c) => c.changedAt > l.at)
    return changed.length ? `criteria changed since last search (${changed.map((c) => c.clientProfileId.slice(0, 8)).join(", ")})` : null
  }

  const withMeta = pairs.map((p) => ({ p, priority: priorityOf(p), lastAt: last.get(p.id)?.at ?? null }))
  const recentCutoff = now - RESEARCH_AFTER_HOURS * 3600e3
  const eligible = withMeta.filter((x) => x.priority || !x.lastAt || new Date(x.lastAt).getTime() < recentCutoff)
  const recent = withMeta.length - eligible.length
  eligible.sort((a, b) => {
    if (!!a.priority !== !!b.priority) return a.priority ? -1 : 1
    const at = a.lastAt ?? "", bt = b.lastAt ?? ""
    return at < bt ? -1 : at > bt ? 1 : a.p.title.localeCompare(b.p.title)
  })

  const pagesOf = (id: string) => Math.min(Math.max(last.get(id)?.pages ?? opts.maxPages, 1), opts.maxPages)
  /** Search estimate of a list in order: own pages plus one control per location not yet paid. */
  const costOf = (list: typeof eligible) => {
    const locs = new Set<string>()
    return list.reduce((n, x) => { const loc = x.p.location ?? "*no-location*"; const c = pagesOf(x.p.id) + (locs.has(loc) ? 0 : 1); locs.add(loc); return n + c }, 0)
  }

  // Each client's first n pairs in eligible order; clients in the order of their first pair.
  const ownersOf = (p: PairRow) => [...new Set((rolesBy.get(key(p.title)) ?? []).map((c) => c.clientProfileId))]
  const floorPairs = (n: number) => {
    const count = new Map<string, number>()
    const taken = new Set<string>()
    const out: typeof eligible = []
    const clientOrder: string[] = []
    for (const x of eligible) for (const c of ownersOf(x.p)) if (!clientOrder.includes(c)) clientOrder.push(c)
    for (let round = 1; round <= n; round++) {
      for (const c of clientOrder) {
        if ((count.get(c) ?? 0) >= round) continue
        const x = eligible.find((e) => !taken.has(e.p.id) && ownersOf(e.p).includes(c))
        if (!x) continue
        taken.add(x.p.id)
        out.push(x)
        for (const o of ownersOf(x.p)) count.set(o, (count.get(o) ?? 0) + 1)
      }
    }
    return out
  }
  let floorPerClient = Math.max(opts.floor ?? FLOOR_PER_CLIENT, 0)
  let floor = floorPairs(floorPerClient)
  while (floorPerClient > 1 && costOf(floor) > opts.cap / 2) floor = floorPairs(--floorPerClient)
  const inFloor = new Set(floor.map((x) => x.p.id))
  const ordered = [...floor, ...eligible.filter((x) => !inFloor.has(x.p.id))]

  const paidLocations = new Set<string>()
  const picked: PickedPair[] = []
  let estimate = 0
  let i = 0
  for (; i < ordered.length; i++) {
    const { p, priority, lastAt } = ordered[i]
    const loc = p.location ?? "*no-location*"
    const cost = pagesOf(p.id) + (paidLocations.has(loc) ? 0 : 1)
    // In order: a pair that does not fit ends tonight's list rather than letting smaller ones jump it.
    if (estimate + cost > opts.cap) break
    paidLocations.add(loc)
    estimate += cost
    picked.push({ id: p.id, title: p.title, location: p.location, campus: p.campus, estimate: cost, priority, lastSearchedAt: lastAt, floor: inFloor.has(p.id) })
  }
  return { picked, estimate, floorPerClient, waiting: ordered.length - i, recent }
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

/** Loads active Google Jobs pairs, each pair's last Google Jobs search, and active clients' roles, then picks. */
export async function loadAndPickPairs(sb: SupabaseClient, opts: { cap: number; maxPages: number; now?: Date }): Promise<PairPick & { total: number }> {
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
  // Before 20261111_nightly_pipeline.sql there is no targets_changed_at: creation is the only change known.
  const read = (cols: string) => pageAll<any>((a, b) => sb.from("client_match_criteria").select(cols).eq("active", true).range(a, b))
  const crit = await read("client_profile_id, target_roles, created_at, targets_changed_at")
    .catch((e) => (/targets_changed_at/.test(String(e?.message)) ? read("client_profile_id, target_roles, created_at") : Promise.reject(e)))
  const clients: ClientRoles[] = crit.map((c) => ({
    clientProfileId: c.client_profile_id,
    targetRoles: c.target_roles ?? [],
    changedAt: new Date(c.targets_changed_at ?? c.created_at).toISOString(),
  }))
  const pick = pickPairs(pairs.map((p) => ({ ...p, campus: !!p.campus })), last, clients, opts)
  return { ...pick, total: pairs.length }
}
