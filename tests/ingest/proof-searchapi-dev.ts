/**
 * SearchApi adapter, live on dev. Refuses prod.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/proof-searchapi-dev.ts
 *
 * Step 1: all active Google Jobs pairs (Alex's 15), pages 1-2.
 * Step 2: 3 Chicago pairs again; nothing already stored may be added again.
 * Hard cap: SEARCH_CAP (default 40) SearchApi searches across both steps.
 *
 * Checks: per-pair pages and counts; field coverage (description, apply link,
 * posted age); every direct-source row unchanged except last_seen_elsewhere_at
 * and updated_at; how many SerpApi rows SearchApi took over; the linker report.
 *
 * WRITES on dev: postings, ingest_runs, posting_link_runs (report mode).
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { searchApiAdapter } from "../../lib/ingest/searchapi"
import { GOOGLE_JOBS } from "../../lib/ingest/serpapi"
import { GOOGLE_JOBS_SOURCES } from "../../lib/ingest/googleJobs"
import { runSweep } from "../../lib/ingest/runner"
import { runLinker } from "../../lib/ingest/link"
import { fingerprintOf } from "../../lib/ingest/fingerprint"
import type { FetchedPosting, FetchResult, IngestPair, SourceAdapter } from "../../lib/ingest/types"

const PROD_REF = "ejhnokcnahauvrcbcmic"
// 60 approved for this test; 20 were spent by a first attempt whose location
// checks errored on SearchApi's "didn't return any results" wording (fixed in
// searchapi.ts). CAP is what remains.
const CAP = Number(process.env.SEARCH_CAP || 40)
const env: Record<string, string> = {}
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2].trim()) env[m[1]] = m[2].trim() }
const get = (k: string) => process.env[k] || env[k]
const URL_ = get("SUPABASE_URL")!, KEY = get("SUPABASE_SERVICE_ROLE_KEY")!, SKEY = get("SEARCHAPI_KEY")
if (!SKEY) { console.error("SEARCHAPI_KEY required"); process.exit(1) }
const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF) { console.error("Refusing to run against prod."); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

const base = searchApiAdapter({ apiKey: SKEY, maxPages: 2 })
const fetched: { pair: IngestPair; r: FetchResult }[] = []
const adapter: SourceAdapter = {
  ...base,
  controlScope: base.controlScope,
  control: base.control.bind(base),
  async fetch(pair, org, carry) { const r = await base.fetch(pair, org, carry); fetched.push({ pair, r }); return r },
}

async function all(cols: string, f: (q: any) => any) {
  const out: any[] = []
  for (let o = 0; ; o += 1000) {
    const { data, error } = await f(sb.from("postings").select(cols)).order("id").range(o, o + 999)
    if (error) throw error
    out.push(...(data || [])); if (!data || data.length < 1000) break
  }
  return out
}
const AGG = [...GOOGLE_JOBS_SOURCES]
const directCols = "id,source,org_slug,source_job_id,title,company,location,apply_url,first_seen_at,last_seen_at,last_seen_elsewhere_at,updated_at"
const host = (u: string | null) => { try { return new URL(u || "").hostname } catch { return "" } }
const JOB_BOARD = /bebee|ziprecruiter|jobleads|linkedin|trabajo|monster|jobilize|indeed|vaia|careerbuilder|theladders|tealhq|jobzmall|talent\.com|learn4good|lensa|glassdoor|jobrapido|simplyhired|bandana|jobright|recruit\.net|jobmesh|jooble|lifeworq|builtin|sonara|expertini|career\.io|adzuna|tallo|hackajob|dice\.com|univision|roberthalf|efinancialcareers|handshake|simplify|earnbetter|google\.com/i

async function sweep(label: string, pairs: IngestPair[]) {
  const before = fetched.length
  const res = await runSweep(adapter, pairs, [GOOGLE_JOBS], sb)
  let searches = 0
  console.log(`\n${label}`)
  for (const { pair, outcomes } of res) {
    const o = outcomes[0]
    searches += o.requestsMade
    const f = fetched.slice(before).find((x) => x.pair === pair)
    const pp = (f?.r.detail?.per_page as number[] | undefined) ?? []
    console.log(`  p1 ${String(pp[0] ?? "-").padStart(2)}  p2 ${String(pp[1] ?? "-").padStart(2)}  found ${String(o.foundCount).padStart(2)} added ${String(o.addedCount).padStart(2)} refound ${String(o.refoundCount).padStart(2)} dup ${o.intraRunDuplicateCount} ctrl=${o.controlPassed} searches=${o.requestsMade} ${o.status}${o.error ? " ERR " + o.error.slice(0, 120) : ""}  ${pair.title} | ${pair.location}`)
  }
  const tot = res.flatMap((x) => x.outcomes).reduce((t, o) => ({ found: t.found + o.foundCount, added: t.added + o.addedCount, refound: t.refound + o.refoundCount }), { found: 0, added: 0, refound: 0 })
  console.log(`  totals: found ${tot.found}, added ${tot.added}, refound ${tot.refound}, SearchApi searches ${searches}`)
  return { res, searches, postings: fetched.slice(before).flatMap((x) => x.r.postings) }
}

;(async () => {
  console.log(`Project ${ref} (dev)`)
  const { data: pr, error } = await sb.from("ingest_pairs").select("id,title,location,campus").eq("active", true).overlaps("sources", AGG).order("title")
  if (error) throw error
  const pairs: IngestPair[] = (pr || []).map((p: any) => ({ id: p.id, title: p.title, location: p.location, campus: p.campus }))
  const locs = new Set(pairs.map((p) => p.location))
  // Step 2 re-runs 3 of the Chicago pairs: enough to show a re-run adds nothing,
  // and it keeps the worst case inside CAP.
  const chicago = pairs.filter((p) => p.location === "Chicago, IL").slice(0, 3)
  const worst = pairs.length * 2 + locs.size + chicago.length * 2 + 1
  console.log(`${pairs.length} pairs; worst case ${worst} SearchApi searches (cap ${CAP})`)
  if (worst > CAP) { console.error("would exceed cap"); process.exit(1) }

  // Snapshot every direct-source row and every SerpApi row.
  const directBefore = await all(directCols, (q) => q.not("source", "in", `(${AGG.join(",")})`))
  const serpBefore = await all("id,source", (q) => q.eq("source", "serpapi"))
  const t0 = new Date().toISOString()
  console.log(`snapshot: ${directBefore.length} direct-source rows, ${serpBefore.length} serpapi rows`)

  // ---- Step 1
  const s1 = await sweep("STEP 1: all pairs, pages 1-2 (searchapi)", pairs)
  const ps = s1.postings
  const uniq = new Map(ps.map((p) => [fingerprintOf(p), p]))
  const u = [...uniq.values()]
  const pct = (n: number) => `${n}/${u.length} (${Math.round((100 * n) / Math.max(1, u.length))}%)`
  console.log(`\n  field coverage over ${u.length} distinct jobs fetched:`)
  console.log(`    description present ${pct(u.filter((p) => String((p.raw as any).description || "").trim()).length)}; HTML converted ${(u.filter((p) => (p.raw as any).description_html).length)}; any '<tag' left in text: ${u.filter((p) => /<[a-z][^>]*>/i.test(String((p.raw as any).description || ""))).length}`)
  console.log(`    apply_url present ${pct(u.filter((p) => p.apply_url).length)}; not a known job board or Google ${pct(u.filter((p) => p.apply_url && !JOB_BOARD.test(host(p.apply_url))).length)}`)
  console.log(`    posted_at present ${pct(u.filter((p) => p.posted_at).length)}; source_job_id present ${u.filter((p) => p.source_job_id).length}`)
  console.log(`    via still prefixed "via ": ${u.filter((p) => /^via\s/i.test(String((p.raw as any).via || ""))).length}; titles cleaned: ${u.filter((p) => p.title !== (p.raw as any).title).length}`)
  const pagesWithP2 = s1.res.length ? fetched.filter((x) => ((x.r.detail?.per_page as number[]) || []).length > 1).length : 0
  console.log(`    pairs that reached page 2: ${pagesWithP2}/${pairs.length}`)

  const l1 = await runLinker(sb, { triggeredBy: "manual:proof-searchapi-dev" })
  console.log(`\n  linker (${l1.mode}): proposed ${l1.proposal.links.length} (${l1.proposal.links.filter((l) => l.secondary_source === "searchapi").length} with a searchapi secondary), ambiguous ${l1.proposal.ambiguous.length}, near misses ${l1.proposal.nearMisses.length}, written ${l1.written}`)
  for (const l of l1.proposal.links.filter((l) => l.secondary_source === "searchapi")) console.log(`    [${l.tier}] P ${l.primary}\n             S ${l.secondary}`)

  // ---- Direct rows untouched?
  const directAfter = new Map((await all(directCols, (q) => q.not("source", "in", `(${AGG.join(",")})`))).map((r) => [r.id, r]))
  let changed = 0, sightings = 0
  const bad: string[] = []
  for (const b of directBefore) {
    const a = directAfter.get(b.id)
    if (!a) { bad.push(`missing ${b.id}`); continue }
    const fields = ["source", "org_slug", "source_job_id", "title", "company", "location", "apply_url", "first_seen_at", "last_seen_at"]
    const diff = fields.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    if (a.updated_at !== b.updated_at) changed++
    if (a.last_seen_elsewhere_at !== b.last_seen_elsewhere_at) sightings++
    if (diff.length) bad.push(`${b.source} ${b.title} | ${b.location}: ${diff.join(",")}`)
  }
  console.log(`\n  direct-source rows: ${directBefore.length} checked; core fields changed on ${bad.length}; touched (updated_at moved) ${changed}; new SearchApi sightings recorded ${sightings}`)
  for (const x of bad.slice(0, 10)) console.log(`    CHANGED ${x}`)

  // ---- SerpApi rows taken over
  const serpIds = serpBefore.map((r) => r.id)
  const now: any[] = []
  for (let i = 0; i < serpIds.length; i += 200) {
    const { data } = await sb.from("postings").select("id,source,last_seen_at").in("id", serpIds.slice(i, i + 200))
    now.push(...(data || []))
  }
  const taken = now.filter((r) => r.source === "searchapi")
  console.log(`  serpapi rows now source=searchapi (same job re-found by the new provider): ${taken.length} of ${serpIds.length}; all advanced last_seen_at: ${taken.every((r) => r.last_seen_at > t0)}`)
  const { count: saRows } = await sb.from("postings").select("id", { count: "exact", head: true }).eq("source", "searchapi")
  console.log(`  searchapi rows in postings: ${saRows}`)

  // ---- Step 2
  const s2 = await sweep("STEP 2: 3 Chicago pairs again", chicago)
  const step1Fps = new Set(s1.postings.filter((p) => chicago.some((c) => fetched.find((f) => f.pair === c)?.r.postings.includes(p))).map((p) => fingerprintOf(p)))
  const step2Fps = new Set(s2.postings.map((p) => fingerprintOf(p)))
  const newInStep2 = [...step2Fps].filter((f) => !step1Fps.has(f))
  const added2 = s2.res.reduce((n, x) => n + x.outcomes[0].addedCount, 0)
  console.log(`  distinct jobs: step 1 ${step1Fps.size}, step 2 ${step2Fps.size}, in step 2 but not step 1: ${newInStep2.length}`)
  console.log(`  RESULT: ${added2 <= newInStep2.length ? "PASS" : "FAIL"}: step 2 added ${added2}, which may be at most the ${newInStep2.length} jobs Google had not returned in step 1`)

  console.log(`\nSearchApi searches used: ${s1.searches + s2.searches} of cap ${CAP}`)
})().catch((e) => { console.error(e); process.exit(1) })
