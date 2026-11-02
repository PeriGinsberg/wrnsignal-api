/**
 * Linker v2: copies of one job, stored as several rows. REPORT ONLY.
 *
 * Today's linker (link.ts) joins rows only across sources, on an exact
 * normalized title and a shared city. Measured on prod 2026-11-02, 159 of the
 * 161 duplicate groups were within ONE source (Google Jobs returning a job
 * through several sites), and the rest differed by spelling it cannot see. v2:
 *
 *   KEY       compact cleaned title + compact employer key (spaces and "and"
 *             removed: "U.S."/"US", "JPMorganChase"/"JPMorgan Chase") + the
 *             3+ digit numbers in the RAW title that are not years (store and
 *             requisition codes, which title cleaning drops: Domino's 03177
 *             and 05179 are two stores).
 *   SOURCE    any; same-source rows link too.
 *   PLACE     same normalized location -> tier same_location.
 *             A vague row (a US state alone, the US, remote, anywhere, blank)
 *             joins the key's single specific place -> tier no_city, and only
 *             when the state matches where it names one. A key with two
 *             places links no vague row: they may be two openings. A non-US
 *             city is a place of its own.
 *   PRIMARY   a direct source, then the best apply link (employer, board,
 *             republisher, other), then a link checked open, then the
 *             earliest seen.
 *
 * Nothing here writes posting_links. runLinkerV2Report logs a posting_link_runs
 * row (mode 'report', rule_version v2-...) after every v1 run. The Job Queue
 * groups its rows with groupCopies(), on the fly, so coaches see one row per
 * job before any link is written.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { normLocation, normText } from "./fingerprint"
import { employerKey, isDirect } from "./link"

export const LINK_V2_RULE_VERSION = "v2-2026-11-02.1"

const US_STATES = new Set(["al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc","pr"])
const VAGUE = /^(united states( of america)?|usa|us|u s|america|anywhere|remote|nationwide|hybrid|multiple locations|various)?$/
const KIND_ORDER: Record<string, number> = { employer: 0, board: 1, republisher: 2, other: 3, google: 3 }

export const compact = (s: string) => s.replace(/\band\b/g, "").replace(/\s+/g, "")
/** The specific place a normalized location names, "" when it names none more specific than a US state. */
export const placeOf = (l: string) => (l.includes("|") ? l : US_STATES.has(l) || VAGUE.test(l) ? "" : l)
/** The US state a normalized location is in, if it says. */
export const stateOf = (l: string) => (l.includes("|") ? l.split("|")[1] : US_STATES.has(l) ? l : null)
/** 3+ digit numbers in the raw title that are not years: store and requisition codes. */
export const numsOf = (title: string | null | undefined) =>
  [...new Set((String(title ?? "").match(/\d{3,}/g) ?? []).filter((n) => !/^20\d\d$/.test(n)))].sort().join(",")

export type CopyRow = {
  id: string
  source: string
  title: string
  cleaned_title?: string | null
  company: string
  location: string | null
  apply_link_kind?: string | null
  link_check_status?: string | null
  first_seen_at?: string | null
}

export type CopyGroup<T extends CopyRow> = {
  primary: T
  /** Primary first. */
  members: T[]
  /** secondary id -> tier */
  tiers: Map<string, "same_location" | "no_city">
}

/** Primary first: direct source, best link kind, checked open, earliest seen, id. */
export function primaryOrder(a: CopyRow, b: CopyRow): number {
  const k = (r: CopyRow) => [
    isDirect(r.source) ? 0 : 1,
    KIND_ORDER[r.apply_link_kind ?? ""] ?? 4,
    r.link_check_status === "open" ? 0 : 1,
    r.first_seen_at ? new Date(r.first_seen_at).getTime() : Infinity,
  ]
  const x = k(a), y = k(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Every row in exactly one group (most groups have one member). Pure.
 * aliases: alias_norm -> canonical, as in employer_aliases.
 */
export function groupCopies<T extends CopyRow>(rows: T[], aliases: Map<string, string> = new Map()): CopyGroup<T>[] {
  type R = { r: T; key: string; l: string; place: string }
  const rs: R[] = rows.map((r) => {
    const t = compact(normText(r.cleaned_title || r.title))
    const e = compact(employerKey(r.company, aliases))
    const l = normLocation(r.location)
    return { r, key: t && e ? `${t}||${e}||${numsOf(r.title)}` : `__${r.id}`, l, place: placeOf(l) }
  })

  const parent = new Map<string, string>(rs.map((x) => [x.r.id, x.r.id]))
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)! } return x }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }

  const buckets = new Map<string, R[]>()
  for (const x of rs) buckets.set(x.key, [...(buckets.get(x.key) ?? []), x])
  for (const b of buckets.values()) {
    if (b.length < 2) continue
    const byLoc = new Map<string, R[]>()
    for (const x of b) byLoc.set(x.l, [...(byLoc.get(x.l) ?? []), x])
    for (const g of byLoc.values()) for (const x of g.slice(1)) union(g[0].r.id, x.r.id)
    const places = new Set(b.filter((x) => x.place).map((x) => x.place))
    if (places.size > 1) continue
    const states = new Set(b.map((x) => stateOf(x.l)).filter(Boolean))
    if (places.size === 0 && states.size > 1) continue
    const placeState = places.size === 1 ? stateOf([...places][0]) : states.size === 1 ? [...states][0] : null
    const anchor = b.find((x) => x.place) ?? b.find((x) => stateOf(x.l)) ?? b[0]
    for (const x of b) {
      if (x.place) continue
      const s = stateOf(x.l)
      if (s && placeState && s !== placeState) continue
      union(anchor.r.id, x.r.id)
    }
  }

  const byRoot = new Map<string, R[]>()
  for (const x of rs) { const k = find(x.r.id); byRoot.set(k, [...(byRoot.get(k) ?? []), x]) }
  return [...byRoot.values()].map((g) => {
    g.sort((a, b) => primaryOrder(a.r, b.r))
    const p = g[0]
    const tiers = new Map<string, "same_location" | "no_city">()
    for (const x of g.slice(1)) tiers.set(x.r.id, x.l === p.l ? "same_location" : "no_city")
    return { primary: p.r, members: g.map((x) => x.r), tiers }
  })
}

/** Why the members' fingerprints differ, for the report. */
export function groupReasons(members: CopyRow[]): string[] {
  const r: string[] = []
  const n = (f: (m: CopyRow) => string) => new Set(members.map(f)).size > 1
  if (n((m) => normText(m.title))) r.push(n((m) => normText(m.cleaned_title || m.title)) ? "title wording" : "title suffix")
  if (n((m) => normText(m.company))) r.push(n((m) => employerKey(m.company, new Map())) ? "company spelling" : "company legal ending")
  if (n((m) => normLocation(m.location))) r.push("location")
  return r
}

const LIVE_DAYS = 14

/**
 * Propose v2 groups over live canonical postings and log them as a report run.
 * Never writes posting_links. Returns the run id. Throws on failure; the caller
 * (runLinker) catches, so v2 can never fail the pipeline.
 */
export async function runLinkerV2Report(sb: SupabaseClient, opts: { triggeredBy: string }): Promise<{ runId: string | null; groups: number; links: number }> {
  const started = Date.now()
  const since = new Date(started - LIVE_DAYS * 864e5).toISOString()
  const rows: CopyRow[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings_canonical")
      .select("id, source, title, cleaned_title, company, location, apply_link_kind, link_check_status, first_seen_at")
      .gt("last_seen_at", since).is("closed_at", null).order("id").range(f, f + 999)
    if (error) throw new Error(`v2 load postings: ${error.message}`)
    rows.push(...((data ?? []) as CopyRow[]))
    if (!data || data.length < 1000) break
  }
  const { data: al, error: alErr } = await sb.from("employer_aliases").select("alias_norm, canonical")
  if (alErr) throw new Error(`v2 load employer_aliases: ${alErr.message}`)
  const aliases = new Map((al ?? []).map((a: any) => [a.alias_norm as string, a.canonical as string]))

  const groups = groupCopies(rows, aliases).filter((g) => g.members.length > 1)
  const describe = (m: CopyRow) => `[${m.source}${m.apply_link_kind ? "/" + m.apply_link_kind : ""}] ${m.company} | ${m.title} | ${m.location ?? "-"}`
  const proposed = groups.flatMap((g) => g.members.slice(1).map((s) => ({
    primary_id: g.primary.id, secondary_id: s.id, tier: g.tiers.get(s.id), primary: describe(g.primary), secondary: describe(s),
  })))
  const tierCounts: Record<string, number> = {}
  for (const l of proposed) tierCounts[l.tier!] = (tierCounts[l.tier!] ?? 0) + 1
  const { data: run, error } = await sb.from("posting_link_runs").insert({
    mode: "report", rule_version: LINK_V2_RULE_VERSION, triggered_by: opts.triggeredBy, status: "ok",
    postings_scanned: rows.length, proposed_count: proposed.length, tier_counts: tierCounts, proposed,
    groups: groups.map((g) => ({ reasons: groupReasons(g.members), sources: [...new Set(g.members.map((m) => m.source))], members: g.members.map(describe) })),
    started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
  }).select("id")
  if (error) throw new Error(`v2 posting_link_runs insert: ${error.message}`)
  return { runId: run?.[0]?.id ?? null, groups: groups.length, links: proposed.length }
}
