/**
 * Cross-source linking: the same job found by two sources, as two rows.
 *
 * The fingerprint (normalized title + company + location, hashed) decides what
 * is one ROW. It is exact on purpose and misses the same job when sources
 * spell the employer or the place differently: Greenhouse's Point72 says
 * "New York" (which the fingerprint reads as the state) where Google says
 * "New York, NY". This module links such rows without touching identity.
 *
 * A LINK: two rows from DIFFERENT sources where
 *   1. the employer key matches (employer_aliases, else the normalized company
 *      with legal endings such as Inc / LLC / L.P. stripped),
 *   2. the normalized title matches exactly (SerpApi titles cleaned first), and
 *   3. the locations share a city (tier "city"), or one side gave only a count
 *      like "10 Locations" and there is exactly one candidate on each side
 *      (tier "count_location").
 * The direct-source row is primary. Between two direct sources the
 * earlier-seen row is primary. A secondary is never anyone's primary.
 *
 * REPORT MODE IS THE DEFAULT. runLinker() always writes its proposal to
 * posting_link_runs. It writes posting_links only when INGEST_LINK_MODE=write,
 * and postings_canonical hides only what posting_links holds, so in report mode
 * nothing anywhere changes. Measured on dev before building: 8 proposed links,
 * all correct by hand; prod had no employer on two sources.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { normText, stateCode } from "./fingerprint"
import { cleanTitle } from "./serpapi"
import { GOOGLE_JOBS_SOURCES } from "./googleJobs"

export const LINK_RULE_VERSION = "2026-10-25.1"

export type LinkMode = "report" | "write"
/** Report unless explicitly switched on. Anything else, including unset, is report. */
export function linkMode(): LinkMode {
  return process.env.INGEST_LINK_MODE === "write" ? "write" : "report"
}

/** Aggregator sources. A row from one of these is never primary over a direct row. */
// Google Jobs, through either provider. Matches the list in
// postings_touch_last_seen (20261028_google_jobs_aggregators.sql).
const AGGREGATORS = new Set<string>(GOOGLE_JOBS_SOURCES)
export const isDirect = (source: string) => !AGGREGATORS.has(source)

// ---------------------------------------------------------------------------
// Employer
// ---------------------------------------------------------------------------
// Legal endings only. "group" and "holdings" are part of real names, and
// stripping "group" is what made Capital One match Capital Group in Phase 0.
const LEGAL = /\s(?:inc|incorporated|llc|l l c|lp|l p|llp|l l p|ltd|limited|plc|corp|corporation|co|company|pllc|pc|sa|s a|sas|s a s|ag|gmbh|bv|b v|nv|n v)$/

/** aliases: alias_norm -> canonical, as stored in employer_aliases. */
export function employerKey(company: string, aliases: Map<string, string>): string {
  const n = normText(company)
  const canonical = aliases.get(n)
  if (canonical) return normText(canonical)
  let k = n.replace(/^the\s+/, "")
  for (let prev = ""; prev !== k; ) { prev = k; k = k.replace(LEGAL, "") }
  return k
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------
export type City = { city: string; state: string | null }

const COUNTRY = new Set(["united states", "united states of america", "usa", "us", "u s", "u s a", "america", "uk", "united kingdom", "canada"])
const NOT_PLACE = /\b(remote|anywhere|hybrid|nationwide|multiple locations|various)\b/
const OFFICE_WORDS = /\s(?:office|headquarters|hq|warehouse)$/
const STREET_WORDS = new Set(["avenue", "ave", "street", "st", "road", "rd", "boulevard", "blvd", "plaza", "place", "pl", "drive", "dr", "lane", "ln", "way"])

/**
 * Spellings of one city, matched on the WHOLE cleaned name only, so "brooklyn
 * park" and "south san francisco" stay themselves. Measured on prod: "new york
 * city" alone is 986 location parts, a quarter of New York mentions.
 */
const CITY_VARIANTS: Record<string, City> = {
  "new york city": { city: "new york", state: "ny" },
  "nyc": { city: "new york", state: "ny" },
  "manhattan": { city: "new york", state: "ny" },
  "brooklyn": { city: "new york", state: "ny" },
  "dc": { city: "washington", state: "dc" },
  "d c": { city: "washington", state: "dc" },
  "washington dc": { city: "washington", state: "dc" },
  "washington d c": { city: "washington", state: "dc" },
}

export const isCountLocation = (l: string | null | undefined) => !!l && /^\s*\d+\s+locations?\s*$/i.test(l)

/**
 * "us new york" -> "new york"; "new york office" -> "new york";
 * "new york 245 park avenue" -> "new york"; "new york office 27th st" -> "new york".
 */
function cleanPlace(t: string): string {
  let words = t.replace(/^us\s+/, "").split(" ").filter(Boolean)
  const digit = words.findIndex((w) => /\d/.test(w))
  if (digit > 0) words = words.slice(0, digit)
  if (words.length >= 3 && STREET_WORDS.has(words[words.length - 1])) words = words.slice(0, -2)
  let s = words.join(" ")
  for (let prev = ""; prev !== s; ) { prev = s; s = s.replace(OFFICE_WORDS, "") }
  return s.trim()
}

/** Apply CITY_VARIANTS unless an explicit, different state says otherwise. */
function canonicalCity(c: City): City {
  const v = CITY_VARIANTS[c.city]
  if (!v) return c
  if (c.state && v.state && c.state !== v.state) return c
  return { city: v.city, state: c.state ?? v.state }
}

/**
 * Every city a location names. Splits on ; | / " or " " and ", then on commas.
 * A state code after a city qualifies it ("New York, NY"), as does a full state
 * name in a two-part location ("Seattle, Washington"). A full state name inside
 * a longer list ("Chicago, Florida, New York") is a region and is dropped,
 * except New York and Washington, which stand for their cities. Remote,
 * Anywhere, counts and countries name no city.
 */
export function citiesOf(raw: string | null | undefined): City[] {
  if (!raw || isCountLocation(raw)) return []
  const s = raw.toLowerCase().replace(/\(\s*\+?\s*\d+\s+others?\s*\)/g, " ")
  const out: City[] = []
  // " or " / " and " need whitespace on both sides: "portland, or" is Oregon.
  for (const chunk of s.split(/\s*(?:;|\||\/|\n)\s*|\s+(?:or|and)\s+/)) {
    const toks = chunk
      .split(",")
      .map((t) => cleanPlace(normText(t)))
      .filter((t) => t && !COUNTRY.has(t))
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (NOT_PLACE.test(t)) continue
      const next = toks[i + 1]
      const isCode = (x?: string) => !!x && x.length === 2 && !!stateCode(x)
      if (CITY_VARIANTS[t]) { out.push(canonicalCity({ city: t, state: isCode(next) ? stateCode(next) : null })); if (isCode(next)) i++; continue }
      if (next && (isCode(next) || (toks.length === 2 && stateCode(next)))) {
        out.push(canonicalCity({ city: t, state: stateCode(next) })); i++; continue
      }
      if (stateCode(t) && t.length > 2 && toks.length > 1 && t !== "new york" && t !== "washington") continue
      if (isCode(t)) continue
      // "new york ny" with no comma: a trailing state code inside the token.
      const m = t.match(/^(.+)\s([a-z]{2})$/)
      if (m && stateCode(m[2]) && !CITY_VARIANTS[t]) { out.push(canonicalCity({ city: m[1], state: stateCode(m[2]) })); continue }
      out.push(canonicalCity({ city: t, state: null }))
    }
  }
  return out
}

/**
 * The first city both sides name, or null. Where both give a state for it, the
 * states must agree (Portland OR is not Portland ME). Bare "Washington" is
 * Washington DC only when the other side SAYS DC; bare against bare is no match.
 */
export function sharedCity(a: City[], b: City[]): string | null {
  for (const x of a) for (const y of b) {
    if (x.city !== y.city) continue
    if (x.city === "washington" && (x.state === null || y.state === null)) {
      const other = x.state === null ? y : x
      if (other.state === "dc") return "washington"
      continue
    }
    if (x.state && y.state && x.state !== y.state) continue
    return x.city
  }
  return null
}

// ---------------------------------------------------------------------------
// Proposal (pure)
// ---------------------------------------------------------------------------
export type LinkRow = {
  id: string
  source: string
  org_slug: string | null
  title: string
  company: string
  location: string | null
  first_seen_at: string
}

export type ProposedLink = {
  primary_id: string
  secondary_id: string
  tier: "city" | "count_location"
  employer_key: string
  matched_city: string | null
  candidates: number
  primary_source: string
  secondary_source: string
  primary: string
  secondary: string
}

export type Proposal = {
  links: ProposedLink[]
  ambiguous: ProposedLink[]
  nearMisses: { a: string; b: string; employer_key: string; title: string }[]
  aliasSuggestions: { alias: string; alias_sources: string[]; canonical: string; canonical_sources: string[]; would_add: number }[]
}

const describe = (r: LinkRow) => `[${r.source}${r.org_slug ? "/" + r.org_slug : ""}] ${r.company} | ${r.title} | ${r.location ?? "-"}`

/** Primary wins: direct over aggregator; between direct, earlier first_seen_at, then id. */
function outranks(p: LinkRow, s: LinkRow): boolean {
  if (isDirect(p.source) !== isDirect(s.source)) return isDirect(p.source)
  if (!isDirect(p.source)) return false
  return p.first_seen_at < s.first_seen_at || (p.first_seen_at === s.first_seen_at && p.id < s.id)
}

export function proposeLinks(rows: LinkRow[], aliases: Map<string, string>): Proposal {
  type R = LinkRow & { key: string; t: string; c: City[] }
  const rs: R[] = rows.map((r) => ({
    ...r,
    key: employerKey(r.company, aliases),
    // Cleaning is idempotent, so rows stored before the adapter cleaned titles
    // still link.
    t: normText(isDirect(r.source) ? r.title : cleanTitle(r.title, r.company)),
    c: citiesOf(r.location),
  }))

  const groups = new Map<string, R[]>()
  for (const r of rs) {
    if (!r.key || !r.t) continue
    const g = r.key + "||" + r.t
    groups.set(g, [...(groups.get(g) || []), r])
  }

  const raw: (ProposedLink & { _p: R; _s: R })[] = []
  const nearMisses: Proposal["nearMisses"] = []
  for (const group of groups.values()) {
    if (new Set(group.map((r) => r.source)).size < 2) continue
    for (const sec of group) {
      const prims = group.filter((p) => p.source !== sec.source && outranks(p, sec))
      if (!prims.length) continue
      const byCity = prims
        .map((p) => ({ p, city: sharedCity(p.c, sec.c) }))
        .filter((x) => x.city)
        // Most exact location first.
        .sort((x, y) => Number(normText(y.p.location) === normText(sec.location)) - Number(normText(x.p.location) === normText(sec.location)))
      if (byCity.length) {
        const p = byCity[0].p
        raw.push({ primary_id: p.id, secondary_id: sec.id, tier: "city", employer_key: sec.key, matched_city: byCity[0].city, candidates: byCity.length, primary_source: p.source, secondary_source: sec.source, primary: describe(p), secondary: describe(sec), _p: p, _s: sec })
        continue
      }
      const counted = prims.filter((p) => isCountLocation(p.location) || isCountLocation(sec.location))
      const back = counted.length === 1
        ? group.filter((x) => x.source === sec.source && x.id !== counted[0].id && (isCountLocation(counted[0].location) || isCountLocation(x.location)))
        : []
      if (counted.length === 1 && back.length === 1) {
        const p = counted[0]
        raw.push({ primary_id: p.id, secondary_id: sec.id, tier: "count_location", employer_key: sec.key, matched_city: null, candidates: 1, primary_source: p.source, secondary_source: sec.source, primary: describe(p), secondary: describe(sec), _p: p, _s: sec })
        continue
      }
      for (const p of prims) nearMisses.push({ a: describe(p), b: describe(sec), employer_key: sec.key, title: sec.t })
    }
  }

  // A secondary is never a primary: re-point any chain to its root.
  const parent = new Map(raw.map((l) => [l.secondary_id, l]))
  const links: ProposedLink[] = raw.map(({ _p, _s, ...l }) => {
    let root = l
    for (let hops = 0; parent.has(root.primary_id) && hops < 10; hops++) root = parent.get(root.primary_id)!
    return root === l ? l : { ...l, primary_id: root.primary_id, primary_source: root.primary_source, primary: root.primary }
  })

  // Alias suggestions: a key on one source that starts with a key on another.
  // Suggestions only; they become aliases when a person approves them (prod
  // suggested Gong.io -> GONG!, two different companies).
  const keySources = new Map<string, Set<string>>()
  for (const r of rs) { if (!keySources.has(r.key)) keySources.set(r.key, new Set()); keySources.get(r.key)!.add(r.source) }
  const keys = [...keySources.keys()].filter((k) => k.length > 2)
  const aliasSuggestions: Proposal["aliasSuggestions"] = []
  for (const long of keys) for (const short of keys) {
    if (long === short || !long.startsWith(short + " ")) continue
    const ls = keySources.get(long)!, ss = keySources.get(short)!
    if (![...ls].some((x) => !ss.has(x)) && ![...ss].some((x) => !ls.has(x))) continue
    let wouldAdd = 0
    for (const s of rs.filter((r) => r.key === long)) {
      const prims = (groups.get(short + "||" + s.t) || []).filter((p) => p.source !== s.source && outranks(p, s))
      if (prims.some((p) => sharedCity(p.c, s.c))) wouldAdd++
    }
    aliasSuggestions.push({ alias: long, alias_sources: [...ls], canonical: short, canonical_sources: [...ss], would_add: wouldAdd })
  }

  return { links, ambiguous: links.filter((l) => l.candidates > 1), nearMisses, aliasSuggestions }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
export type LinkerResult = {
  runId: string | null
  mode: LinkMode
  scanned: number
  proposal: Proposal
  written: number
  removed: number
}

/** Every posting plus employer_aliases (alias_norm -> canonical). Read-only. */
export async function loadLinkInputs(sb: SupabaseClient): Promise<{ rows: LinkRow[]; aliases: Map<string, string> }> {
  const rows: LinkRow[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings")
      .select("id,source,org_slug,title,company,location,first_seen_at")
      .order("id").range(f, f + 999)
    if (error) throw new Error(`load postings: ${error.message}`)
    rows.push(...((data || []) as LinkRow[]))
    if (!data || data.length < 1000) break
  }
  const { data: al, error: alErr } = await sb.from("employer_aliases").select("alias_norm,canonical")
  if (alErr) throw new Error(`load employer_aliases: ${alErr.message}`)
  return { rows, aliases: new Map((al || []).map((a: any) => [a.alias_norm as string, a.canonical as string])) }
}

/**
 * Propose links over every posting and log the run. In write mode, also make
 * posting_links equal the proposal (insert/update proposed, delete the rest).
 * Full scan: ~20k rows today. Logs an error row and rethrows on failure.
 */
export async function runLinker(sb: SupabaseClient, opts: { triggeredBy: string; mode?: LinkMode }): Promise<LinkerResult> {
  const mode = opts.mode ?? linkMode()
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  try {
    const { rows, aliases } = await loadLinkInputs(sb)
    const proposal = proposeLinks(rows, aliases)

    let written = 0
    let removed = 0
    if (mode === "write") {
      const now = new Date().toISOString()
      const want = proposal.links.map((l) => ({
        secondary_id: l.secondary_id, primary_id: l.primary_id, tier: l.tier, employer_key: l.employer_key,
        matched_city: l.matched_city, rule_version: LINK_RULE_VERSION, last_confirmed_at: now,
      }))
      for (let i = 0; i < want.length; i += 500) {
        const { error } = await sb.from("posting_links").upsert(want.slice(i, i + 500), { onConflict: "secondary_id" })
        if (error) throw new Error(`write posting_links: ${error.message}`)
      }
      written = want.length
      const keep = new Set(want.map((w) => w.secondary_id))
      const { data: existing, error: exErr } = await sb.from("posting_links").select("secondary_id")
      if (exErr) throw new Error(`read posting_links: ${exErr.message}`)
      const stale = (existing || []).map((e: any) => e.secondary_id as string).filter((id) => !keep.has(id))
      for (let i = 0; i < stale.length; i += 200) {
        const { error } = await sb.from("posting_links").delete().in("secondary_id", stale.slice(i, i + 200))
        if (error) throw new Error(`prune posting_links: ${error.message}`)
      }
      removed = stale.length
    }

    const tierCounts: Record<string, number> = {}
    for (const l of proposal.links) tierCounts[l.tier] = (tierCounts[l.tier] || 0) + 1
    const { data: run, error: runErr } = await sb.from("posting_link_runs").insert({
      mode, rule_version: LINK_RULE_VERSION, triggered_by: opts.triggeredBy, status: "ok",
      postings_scanned: rows.length, proposed_count: proposal.links.length,
      ambiguous_count: proposal.ambiguous.length, near_miss_count: proposal.nearMisses.length,
      written_count: written, removed_count: removed, tier_counts: tierCounts,
      proposed: proposal.links, ambiguous: proposal.ambiguous, near_misses: proposal.nearMisses,
      alias_suggestions: proposal.aliasSuggestions,
      started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    }).select("id")
    if (runErr) throw new Error(`posting_link_runs insert: ${runErr.message}`)
    return { runId: run?.[0]?.id ?? null, mode, scanned: rows.length, proposal, written, removed }
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 1000)
    // Best effort: if the run log itself is what failed, this fails too, and
    // the rethrow is what surfaces it.
    await sb.from("posting_link_runs").insert({
      mode, rule_version: LINK_RULE_VERSION, triggered_by: opts.triggeredBy, status: "error", error: message,
      started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
    })
    throw err
  }
}
