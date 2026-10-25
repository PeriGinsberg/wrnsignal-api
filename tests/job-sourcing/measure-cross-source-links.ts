/**
 * Read-only measurement for the cross-source linking design (no product code).
 * Proposes links between postings from DIFFERENT sources when:
 *   employer key matches  (employer_aliases canonical, else normalized company
 *                          with legal endings stripped)
 *   normalized title matches exactly
 *   locations share at least one city (bare cities and multi-city lists parsed;
 *                          if both sides name a state for that city, it must agree)
 * and prints every proposed link plus near misses, so the rules can be judged
 * before anything is built.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/job-sourcing/measure-cross-source-links.ts
 */
import { readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { normText, stateCode } from "../../lib/ingest/fingerprint"

// Shell env first (for a read-only prod run), else .env.phase0. Select-only.
const env: Record<string, string> = {}
for (const l of readFileSync(join(__dirname, "..", "..", ".env.phase0"), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (process.env[k]) env[k] = process.env[k]!
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Google Jobs title suffixes (decision 2): " at <Company> <City...>" and
// " | <Company> | <Board>". Only SerpApi titles are cleaned.
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function cleanTitle(title: string, company: string): string {
  let t = title
  const co = company.trim()
  if (co) t = t.replace(new RegExp(`\\s+at\\s+${escapeRe(co)}\\b.*$`, "i"), "")
  const parts = t.split(/\s+\|\s+/)
  if (parts.length > 1) {
    const coN = normText(company)
    const cut = parts.findIndex((x, i) => i > 0 && (normText(x) === coN || /^(handshake|linkedin|indeed|glassdoor|ziprecruiter)$/i.test(x.trim())))
    if (cut > 0) t = parts.slice(0, cut).join(" | ")
  }
  return t.trim()
}
const isCountLoc = (l: string | null) => !!l && /^\s*\d+\s+locations?\s*$/i.test(l)

// ---------------------------------------------------------------- employer key
const LEGAL = /\s(?:inc|incorporated|llc|l l c|lp|l p|llp|l l p|ltd|limited|plc|corp|corporation|co|company|pllc|pc|sa|s a|sas|s a s|ag|gmbh|bv|b v|nv|n v)$/
function employerKey(company: string, aliases: Map<string, string>): string {
  const n = normText(company)
  const a = aliases.get(n)
  if (a) return normText(a)
  let k = n.replace(/^the\s+/, "")
  for (let prev = ""; prev !== k; ) { prev = k; k = k.replace(LEGAL, "") }
  return k
}

// ---------------------------------------------------------------- cities
const COUNTRY = new Set(["united states", "united states of america", "usa", "us", "u s", "u s a", "america", "uk", "united kingdom", "canada"])
const NOT_PLACE = /\b(remote|anywhere|hybrid|nationwide|multiple locations|various)\b/
type City = { city: string; state: string | null }
function cities(raw: string | null): City[] {
  if (!raw) return []
  let s = raw.toLowerCase().replace(/\(\s*\+?\s*\d+\s+others?\s*\)/g, " ")
  if (/^\s*\d+\s+locations?\s*$/.test(s)) return []
  const out: City[] = []
  for (const chunk of s.split(/\s*(?:;|\||\/|\n|\bor\b|\band\b)\s*/)) {
    const toks = chunk.split(",").map((t) => normText(t)).filter((t) => t && !COUNTRY.has(t))
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]
      if (NOT_PLACE.test(t)) continue
      const next = toks[i + 1]
      const isCode = (x?: string) => !!x && x.length === 2 && !!stateCode(x)
      // "New York, NY" / "Toronto, Ontario" (two-part): second token qualifies the first.
      if (next && (isCode(next) || (toks.length === 2 && stateCode(next)))) {
        out.push({ city: t, state: stateCode(next) ?? next }); i++; continue
      }
      // A full state name inside a longer list ("Chicago, Florida, New York") is a
      // region, not a city -- unless it stands alone ("New York" = the city).
      if (stateCode(t) && t.length > 2 && toks.length > 1 && t !== "new york" && t !== "washington") continue
      if (isCode(t)) continue
      out.push({ city: t, state: null })
    }
  }
  return out
}
function sharedCity(a: City[], b: City[]): string | null {
  for (const x of a) for (const y of b) {
    if (x.city !== y.city) continue
    if (x.state && y.state && x.state !== y.state) continue
    return x.city
  }
  return null
}

;(async () => {
  console.log("project:", new URL(env.SUPABASE_URL).hostname.split(".")[0])
  const rows: any[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings").select("id,source,org_slug,title,company,location,fingerprint,first_seen_at").order("id").range(f, f + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const { data: al } = await sb.from("employer_aliases").select("alias,canonical")
  const aliases = new Map((al || []).map((a) => [normText(a.alias), a.canonical]))
  const bySrc: Record<string, number> = {}; for (const r of rows) bySrc[r.source] = (bySrc[r.source] || 0) + 1
  console.log(`postings ${rows.length} ${JSON.stringify(bySrc)}; employer_aliases rows: ${aliases.size}\n`)

  for (const r of rows) {
    r.key = employerKey(r.company, aliases)
    const ct = r.source === "serpapi" ? cleanTitle(r.title, r.company) : r.title
    r.t = normText(ct)
    r.titleCleaned = ct !== r.title
    r.c = cities(r.location)
  }
  console.log(`serpapi titles cleaned: ${rows.filter((r) => r.titleCleaned).length}`)

  // index by (key,title)
  const idx = new Map<string, any[]>()
  for (const r of rows) { const k = r.key + "||" + r.t; idx.set(k, [...(idx.get(k) || []), r]) }

  type Link = { primary: any; secondary: any; city: string; candidates: number; tier: "city" | "count_location" }
  const links: Link[] = []
  const unmatchedSameKeyTitle: { a: any; b: any }[] = []
  const direct = (r: any) => r.source !== "serpapi"
  for (const group of idx.values()) {
    const srcs = new Set(group.map((r) => r.source))
    if (srcs.size < 2) continue
    // Every row is linked to the best primary from another source.
    for (const sec of group) {
      const prims = group
        .filter((p) => p.source !== sec.source)
        // primary must be "more direct": serpapi never primary over a direct row;
        // between two direct sources the earlier-seen row is primary.
        .filter((p) => (direct(p) && !direct(sec)) || (direct(p) && direct(sec) && (p.first_seen_at < sec.first_seen_at || (p.first_seen_at === sec.first_seen_at && p.id < sec.id))))
      if (!prims.length) continue
      const ok = prims.map((p) => ({ p, city: sharedCity(p.c, sec.c) })).filter((x) => x.city)
      if (ok.length) {
        // Prefer the candidate whose whole location matches most exactly.
        ok.sort((x, y) => Number(normText(y.p.location) === normText(sec.location)) - Number(normText(x.p.location) === normText(sec.location)))
        links.push({ primary: ok[0].p, secondary: sec, city: ok[0].city!, candidates: ok.length, tier: "city" })
        continue
      }
      // Count-only tier (decision 1): one side gives only "N Locations", and there is
      // exactly one candidate on each side.
      const countC = prims.filter((p) => isCountLoc(p.location) || isCountLoc(sec.location))
      const back = countC.length === 1
        ? group.filter((x) => x.source === sec.source && x.id !== countC[0].id && (isCountLoc(countC[0].location) || isCountLoc(x.location)))
        : []
      if (countC.length === 1 && back.length === 1) links.push({ primary: countC[0], secondary: sec, city: "(count)", candidates: 1, tier: "count_location" })
      else for (const p of prims) unmatchedSameKeyTitle.push({ a: p, b: sec })
    }
  }

  const show = (r: any) => `[${r.source}${r.org_slug ? "/" + r.org_slug : ""}] ${r.company} | ${r.title} | ${r.location ?? "-"}`
  const pairKey = (l: Link) => `${l.primary.source} <- ${l.secondary.source} [${l.tier}]`
  const byPair: Record<string, number> = {}; for (const l of links) byPair[pairKey(l)] = (byPair[pairKey(l)] || 0) + 1
  console.log(`PROPOSED LINKS: ${links.length}  ${JSON.stringify(byPair)}`)
  console.log(`  secondaries with more than one possible primary: ${links.filter((l) => l.candidates > 1).length}\n`)

  const isP72 = (l: Link) => /point72/.test(l.primary.key) || /point72/.test(l.secondary.key)
  console.log(`POINT72 LINKS: ${links.filter(isP72).length}`)
  for (const l of links.filter(isP72)) console.log(`  [${l.tier}] city=${l.city}${l.candidates > 1 ? ` (${l.candidates} candidates)` : ""}\n    P ${show(l.primary)}\n    S ${show(l.secondary)}`)
  console.log(`\nOTHER LINKS: ${links.filter((l) => !isP72(l)).length}`)
  for (const l of links.filter((l) => !isP72(l))) console.log(`  [${l.tier}] city=${l.city}${l.candidates > 1 ? ` (${l.candidates} candidates)` : ""}\n    P ${show(l.primary)}\n    S ${show(l.secondary)}`)

  console.log(`\nSAME EMPLOYER + TITLE, DIFFERENT SOURCE, NO SHARED CITY: ${unmatchedSameKeyTitle.length}`)
  for (const u of unmatchedSameKeyTitle) console.log(`    ${show(u.a)}  [${u.a.c.map((c: City) => c.city + (c.state ? "/" + c.state : "")).join(";")}]\n    ${show(u.b)}  [${u.b.c.map((c: City) => c.city + (c.state ? "/" + c.state : "")).join(";")}]`)

  // Near misses: same employer key on two sources, shared city, title differs.
  const byKey = new Map<string, any[]>()
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) || []), r])
  const sharedEmployers = [...byKey.entries()].filter(([, g]) => new Set(g.map((r) => r.source)).size > 1)
  console.log(`\nEMPLOYER KEYS PRESENT ON 2+ SOURCES: ${sharedEmployers.length}`)
  for (const [k, g] of sharedEmployers) {
    const per: Record<string, number> = {}; for (const r of g) per[r.source] = (per[r.source] || 0) + 1
    console.log(`  ${k}  ${JSON.stringify(per)}  spellings: ${[...new Set(g.map((r) => r.company))].join(" / ")}`)
  }

  // Alias suggestions: a key on one source that starts with a key on another.
  const keySources = new Map<string, Set<string>>()
  for (const r of rows) { if (!keySources.has(r.key)) keySources.set(r.key, new Set()); keySources.get(r.key)!.add(r.source) }
  const keys = [...keySources.keys()].filter((k) => k.length > 2)
  const cand: { long: string; short: string; longSrc: string; shortSrc: string; extra: number }[] = []
  for (const long of keys) for (const short of keys) {
    if (long === short || !long.startsWith(short + " ")) continue
    const ls = [...keySources.get(long)!], ss = [...keySources.get(short)!]
    if (ls.every((x) => ss.includes(x)) && ss.every((x) => ls.includes(x)) && ls.length === 1) continue // same single source only
    if (!ls.some((x) => !ss.includes(x)) && !ss.some((x) => !ls.includes(x))) continue
    // Links accepting this alias would add.
    let extra = 0
    for (const s2 of rows.filter((r) => r.key === long)) {
      const prims = (idx.get(short + "||" + s2.t) || []).filter((p) => p.source !== s2.source)
      if (prims.some((p) => sharedCity(p.c, s2.c))) extra++
    }
    cand.push({ long, short, longSrc: ls.join(","), shortSrc: ss.join(","), extra })
  }
  cand.sort((a, b) => b.extra - a.extra)
  console.log(`
ALIAS SUGGESTIONS (key on one source starts with a key on another; NOT applied): ${cand.length}`)
  console.log(`  that would add links: ${cand.filter((c) => c.extra).length} suggestions, ${cand.reduce((n, c) => n + c.extra, 0)} links`)
  for (const c of cand) console.log(`  "${c.long}" [${c.longSrc}]  ->  "${c.short}" [${c.shortSrc}]${c.extra ? `   +${c.extra} link(s)` : ""}`)
})().catch((e) => { console.error(e); process.exit(1) })
