/**
 * Phase 0 test for the job sourcing engine: SerpApi Google Jobs vs. what SIGNAL
 * already knows about one client. READ-ONLY against Supabase (selects only).
 *
 *   SERPAPI_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are read from .env.phase0
 *   at the repo root (gitignored). Blank values there fall back to the shell env.
 *   npx tsx tests/job-sourcing/serpapi-phase0.ts [--client "sami zivitz"] [--cap 40] [--dry]
 *
 * --dry resolves titles/locations/baseline and prints the query plan without
 * spending any SerpApi searches.
 */
import { existsSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { deriveTitles } from "../../lib/laneProposal"
import { LOCATIONS } from "../../lib/hiringcafe"

const arg = (n: string, d?: string) => { const i = process.argv.indexOf("--" + n); const v = process.argv[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : d }
const CLIENT = arg("client", "sami zivitz")!
const CAP = Number(arg("cap", "40"))
const DRY = process.argv.includes("--dry")

const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2")
  }
}
const env = (k: string) => fileEnv[k] || process.env[k]

const SUPABASE_URL = env("SUPABASE_URL")
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const SERPAPI_KEY = env("SERPAPI_KEY")
if (!SUPABASE_URL || !SERVICE_KEY) { console.error(`SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (fill in ${ENV_FILE})`); process.exit(1) }
if (!SERPAPI_KEY && !DRY) { console.error(`SERPAPI_KEY required in ${ENV_FILE} (or pass --dry)`); process.exit(1) }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const FALLBACK_BASELINE = [
  "WTW", "Aon", "Mercer", "Charles River Associates", "Analysis Group", "Putnam Associates", "Deloitte",
  "Tapestry", "Amazon", "J.Crew", "Coty", "Shiseido", "e.l.f. Beauty", "Unilever", "TikTok", "Google",
  "Whatnot", "ShopMy", "Paramount", "Brunswick Group",
]

// ---------------------------------------------------------------------------
// Employer name normalisation
// ---------------------------------------------------------------------------
const SUFFIX = /\b(inc|incorporated|llc|llp|lp|ltd|limited|corp|corporation|co|company|plc|group|holdings|the|us|usa|na)\b/g
function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\./g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim()
}
// Same employer if normalised names are equal, or one is a whole-word prefix of
// the other ("deloitte" ~ "deloitte consulting", "amazon" ~ "amazon web services").
function sameEmployer(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  return l.startsWith(s + " ")
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
const STATE = /^(?:[A-Z]{2}|USA?|United States)$/
function splitLocations(raw: string | null): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const chunk of raw.split(/\s*(?:[;|\n/]|\band\b|\bor\b)\s*/i)) {
    // "New York, NY, Boston, MA" → rejoin "City, ST" pairs after a comma split.
    for (const tok of chunk.split(/\s*,\s*/).filter(Boolean)) {
      if (STATE.test(tok) && out.length) out[out.length - 1] += ", " + tok
      else out.push(tok)
    }
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))]
}
const isRemote = (l: string) => /\b(remote|anywhere|nationwide)\b/i.test(l)

// ---------------------------------------------------------------------------
// SerpApi
// ---------------------------------------------------------------------------
type Query = { title: string; location: string | null; q: string }
type PageResult = { page: number; count: number; nextToken: string | null; employers: string[]; error?: string }

async function serp(q: string, nextToken: string | null): Promise<{ json: any; error?: string }> {
  const p = new URLSearchParams({ engine: "google_jobs", q, hl: "en", gl: "us", api_key: SERPAPI_KEY! })
  if (nextToken) p.set("next_page_token", nextToken)
  const res = await fetch("https://serpapi.com/search.json?" + p.toString())
  const json = await res.json().catch(() => ({}))
  // "Google hasn't returned any results" is an empty page, not a failure.
  if (json?.error && !/hasn't returned any results/i.test(json.error)) return { json, error: json.error }
  if (!res.ok) return { json, error: `HTTP ${res.status}` }
  return { json }
}

;(async () => {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0]
  console.log(`Supabase project: ${ref} (read-only)\n`)

  // --- 1. Find the client -------------------------------------------------
  const { data: profiles, error: pErr } = await sb
    .from("client_profiles")
    .select("id,name,email,target_roles,target_locations,preferred_locations,created_at")
    .or(`name.ilike.%${CLIENT}%,email.ilike.%${CLIENT}%`)
  if (pErr) throw pErr
  if (!profiles?.length) { console.error(`no client_profiles row matching "${CLIENT}"`); process.exit(1) }
  console.log(`client_profiles matches (${profiles.length}):`)
  for (const p of profiles) console.log(`  ${p.id}  ${p.name}  <${p.email}>  roles=${JSON.stringify(p.target_roles)}  locs=${JSON.stringify(p.target_locations)}  pref=${JSON.stringify(p.preferred_locations)}`)
  const ids = profiles.map((p) => p.id)

  const { data: ccRows, error: ccErr } = await sb
    .from("coach_clients")
    .select("id,client_profile_id,target_roles,target_locations,preferred_locations")
    .in("client_profile_id", ids)
  if (ccErr) throw ccErr
  for (const c of ccRows || []) console.log(`  coach_clients ${c.id} → ${c.client_profile_id}  roles=${JSON.stringify(c.target_roles)}  locs=${JSON.stringify(c.target_locations)}  pref=${JSON.stringify(c.preferred_locations)}`)

  const { data: lanes, error: lErr } = await sb
    .from("search_lanes")
    .select("id,client_profile_id,name,active,titles,location")
    .in("client_profile_id", ids)
  if (lErr) throw lErr
  console.log(`\nsearch_lanes: ${lanes?.length || 0}`)
  for (const l of lanes || []) console.log(`  ${l.id}  ${l.active ? "active" : "paused"}  "${l.name}"  titles=${JSON.stringify(l.titles)}  location=${JSON.stringify(l.location)}`)

  // --- 2. Titles + locations ---------------------------------------------
  // Lanes are what SIGNAL actually searches; the profile/capture fields are the
  // client's own words. Use lanes when they exist, then fall back.
  let titles: string[] = []
  let locations: string[] = []
  let titleSource = ""
  let locationSource = ""

  const activeLanes = (lanes || []).filter((l) => l.active)
  const useLanes = activeLanes.length ? activeLanes : lanes || []
  if (useLanes.length) {
    titles = [...new Set(useLanes.flatMap((l) => (Array.isArray(l.titles) ? l.titles : []).map((t: string) => t.toLowerCase().trim())))]
    titleSource = `search_lanes (${useLanes.length} ${activeLanes.length ? "active" : "paused"})`
    const presets = new Set<string>()
    let anywhere = false
    for (const l of useLanes) {
      const loc = l.location || {}
      const ps: string[] = Array.isArray(loc.presets) ? loc.presets : loc.preset ? [loc.preset] : []
      if (!ps.length) anywhere = true
      ps.forEach((p) => presets.add(p))
    }
    locations = [...presets].map((p) => LOCATIONS[p]?.formatted_address?.replace(/, US(A)?$/, "") || p)
    if (anywhere) locations.push("Remote")
    locationSource = "search_lanes.location presets"
  }
  const prof = profiles.find((p) => p.target_roles) || profiles[0]
  const cc = (ccRows || []).find((c) => c.target_roles || c.target_locations)
  if (!titles.length) {
    const raw = prof.target_roles || cc?.target_roles || null
    const d = deriveTitles(raw)
    titles = d.titles
    titleSource = prof.target_roles ? "client_profiles.target_roles" : "coach_clients.target_roles"
    if (d.dropped.length) console.log(`  titles over lane cap (kept anyway for this test): ${d.dropped.join(", ")}`)
    titles = [...titles, ...d.dropped]
    if (d.discarded.length) console.log(`  titles discarded by deriveTitles (single word / too long): ${d.discarded.join(", ")}`)
  }
  if (!locations.length) {
    const raw = [prof.target_locations || cc?.target_locations, prof.preferred_locations || cc?.preferred_locations].filter(Boolean).join("; ")
    locations = splitLocations(raw)
    locationSource = prof.target_locations ? "client_profiles.target/preferred_locations" : "coach_clients.target/preferred_locations"
  }
  if (!titles.length) { console.error("no target titles found for this client"); process.exit(1) }
  if (!locations.length) { locations = [""]; locationSource += " (none found: queries run without a location)" }

  console.log(`\nTitles (${titles.length}) from ${titleSource}:\n  ${titles.join("\n  ")}`)
  console.log(`Locations (${locations.length}) from ${locationSource}:\n  ${locations.map((l) => l || "(none)").join("\n  ")}`)

  // --- 3. Baseline --------------------------------------------------------
  let baselineSource: string
  let baselineNames: string[]
  const laneIds = (lanes || []).map((l) => l.id)
  let laneRows: { company: string | null }[] = []
  if (laneIds.length) {
    for (let f = 0; ; f += 1000) {
      const { data, error } = await sb.from("lane_results").select("company").in("lane_id", laneIds).range(f, f + 999)
      if (error) throw error
      laneRows.push(...(data || []))
      if (!data || data.length < 1000) break
    }
  }
  const laneCompanies = laneRows.map((r) => r.company).filter((c): c is string => !!c)
  if (laneCompanies.length) {
    baselineSource = `lane_results (${laneRows.length} rows across ${laneIds.length} lanes)`
    baselineNames = laneCompanies
  } else {
    baselineSource = `fallback list (Sami has ${laneRows.length} lane_results rows)`
    baselineNames = FALLBACK_BASELINE
  }
  console.log(`\nBaseline: ${baselineSource}; ${new Set(baselineNames.map(norm).filter(Boolean)).size} distinct employers`)

  // --- 4. Query plan, capped ----------------------------------------------
  const plan: Query[] = []
  for (const title of titles)
    for (const loc of locations) {
      const location = loc || null
      plan.push({ title, location, q: location ? `${title} ${location}` : title })
    }
  const firstPass = plan.slice(0, CAP)
  const skipped = plan.slice(CAP)
  console.log(`\nQuery plan: ${plan.length} title x location combos, cap ${CAP}; first pages: ${firstPass.length}; not run: ${skipped.length}`)
  for (const s of skipped) console.log(`  not run: ${s.q}`)

  if (DRY) { console.log("\n--dry: no SerpApi calls made."); return }

  // --- 5. Run: page 1 of every planned query, then page 2+ with leftover budget
  let used = 0
  const results = new Map<string, { query: Query; pages: PageResult[] }>()
  const raw: any[] = []

  async function runPage(query: Query, token: string | null, page: number) {
    used++
    const { json, error } = await serp(query.q, token)
    raw.push({ q: query.q, page, json })
    const jobs: any[] = Array.isArray(json?.jobs_results) ? json.jobs_results : []
    const pr: PageResult = {
      page,
      count: jobs.length,
      nextToken: json?.serpapi_pagination?.next_page_token || null,
      employers: jobs.map((j) => String(j.company_name || "").trim()).filter(Boolean),
      error,
    }
    const entry = results.get(query.q) || { query, pages: [] }
    entry.pages.push(pr)
    results.set(query.q, entry)
    return pr
  }

  for (const query of firstPass) {
    const pr = await runPage(query, null, 1)
    console.log(`  [${used}/${CAP}] p1 ${pr.count} jobs${pr.nextToken ? " (+more)" : ""}${pr.error ? "  ERROR " + pr.error : ""}  ${query.q}`)
  }
  // Round-robin deeper pages across queries that still have a next token.
  let progressed = true
  while (used < CAP && progressed) {
    progressed = false
    for (const { query, pages } of results.values()) {
      if (used >= CAP) break
      const last = pages[pages.length - 1]
      if (!last.nextToken || last.error) continue
      const pr = await runPage(query, last.nextToken, last.page + 1)
      progressed = true
      console.log(`  [${used}/${CAP}] p${pr.page} ${pr.count} jobs${pr.nextToken ? " (+more)" : ""}${pr.error ? "  ERROR " + pr.error : ""}  ${query.q}`)
    }
  }

  // --- 6. Compare ---------------------------------------------------------
  const serpDisplay = new Map<string, string>() // norm -> first display name
  for (const { pages } of results.values()) for (const p of pages) for (const e of p.employers) { const n = norm(e); if (n && !serpDisplay.has(n)) serpDisplay.set(n, e) }
  const baseDisplay = new Map<string, string>()
  for (const e of baselineNames) { const n = norm(e); if (n && !baseDisplay.has(n)) baseDisplay.set(n, e) }

  const serpKeys = [...serpDisplay.keys()]
  const baseKeys = [...baseDisplay.keys()]
  const baseMatched = baseKeys.filter((b) => serpKeys.some((s) => sameEmployer(s, b)))
  const serpMatched = new Set(serpKeys.filter((s) => baseKeys.some((b) => sameEmployer(s, b))))
  const onlySerp = serpKeys.filter((s) => !serpMatched.has(s)).map((k) => serpDisplay.get(k)!).sort((a, b) => a.localeCompare(b))
  const onlyBase = baseKeys.filter((b) => !baseMatched.includes(b)).map((k) => baseDisplay.get(k)!).sort((a, b) => a.localeCompare(b))

  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a")
  const anyMore = [...results.values()].filter(({ pages }) => pages[0]?.nextToken)
  const paged = [...results.values()].filter(({ pages }) => pages.length > 1)
  const errors = [...results.values()].flatMap(({ query, pages }) => pages.filter((p) => p.error).map((p) => `${query.q} p${p.page}: ${p.error}`))

  console.log("\n================ REPORT ================")
  console.log(`Baseline used: ${baselineSource}`)
  console.log(`Searches run: ${used} of cap ${CAP} (${firstPass.length} first pages, ${used - firstPass.length} pagination pages); ${skipped.length} planned queries not run`)
  if (errors.length) console.log(`Errors (${errors.length}):\n  ${errors.join("\n  ")}`)
  console.log(`\nResults per query (jobs per page):`)
  for (const { query, pages } of results.values()) {
    const total = pages.reduce((a, p) => a + p.count, 0)
    const last = pages[pages.length - 1]
    console.log(`  ${String(total).padStart(3)}  [${pages.map((p) => p.count).join("+")}]${last.nextToken ? " more available" : ""}  ${query.q}`)
  }
  console.log(`\nPagination: ${anyMore.length} of ${results.size} queries had more than one page available; ${paged.length} got extra pages from leftover budget.`)
  console.log(`  Page 1 alone returns at most ~10 jobs, so ${anyMore.length ? "yes, pagination is needed for full recall on those queries" : "no, page 1 covered every query"}.`)

  console.log(`\nDistinct employers: SerpApi ${serpKeys.length}, baseline ${baseKeys.length}`)
  console.log(`Overlap: ${baseMatched.length} baseline employers found in SerpApi = ${pct(baseMatched.length, baseKeys.length)} of baseline, ${pct(serpMatched.size, serpKeys.length)} of SerpApi employers`)
  console.log(`  matched: ${baseMatched.map((k) => baseDisplay.get(k)).sort().join(", ") || "(none)"}`)
  // Pairs that only the starts-with rule joined, for hand review.
  const prefixPairs: string[] = []
  for (const b of baseMatched) for (const s of serpKeys) if (s !== b && sameEmployer(s, b) && !serpKeys.includes(b))
    prefixPairs.push(`${baseDisplay.get(b)}  <->  ${serpDisplay.get(s)}`)
  console.log(`\nMatched only by the starts-with rule (${prefixPairs.length} pairs, baseline <-> SerpApi):\n  ${prefixPairs.join("\n  ") || "(none)"}`)

  // Overlap restricted to employers the lane found repeatedly.
  const baseRows = new Map<string, number>()
  for (const e of baselineNames) { const n = norm(e); if (n) baseRows.set(n, (baseRows.get(n) || 0) + 1) }
  const heavy = baseKeys.filter((b) => (baseRows.get(b) || 0) >= 3)
  const heavyMatched = heavy.filter((b) => baseMatched.includes(b))
  const label = (k: string) => `${baseDisplay.get(k)} (${baseRows.get(k)})`
  console.log(`\nOverlap, baseline employers with 3+ lane_results rows: ${heavyMatched.length} of ${heavy.length} = ${pct(heavyMatched.length, heavy.length)}`)
  console.log(`  matched: ${heavyMatched.map(label).sort().join(", ") || "(none)"}`)
  console.log(`  not found: ${heavy.filter((b) => !heavyMatched.includes(b)).map(label).sort().join(", ") || "(none)"}`)

  console.log(`\nOnly in SerpApi (${onlySerp.length}):\n  ${onlySerp.join("\n  ") || "(none)"}`)
  console.log(`\nOnly in baseline (${onlyBase.length}):\n  ${onlyBase.join("\n  ") || "(none)"}`)

  const out = join(tmpdir(), `serpapi-phase0-raw-${CLIENT.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`)
  writeFileSync(out, JSON.stringify({ baselineSource, titles, locations, plan, used, raw }, null, 2))
  console.log(`\nRaw SerpApi responses saved to ${out}`)
})().catch((e) => { console.error(e); process.exit(1) })
