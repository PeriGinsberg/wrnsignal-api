/**
 * Phase 1 follow-up proofs on dev, with temporary pairs (not stored in
 * ingest_pairs; ingest_runs rows carry pair_id NULL).
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/proof-serpapi-followups.ts
 *
 * Provider: GOOGLE_JOBS_PROVIDER (default searchapi, lib/ingest/googleJobs.ts).
 *
 * 1. Cross-source collision: a title Point72 has on its Greenhouse board, run
 *    through Google Jobs in New York. Any SerpApi result whose fingerprint equals a
 *    Greenhouse row must leave that row's source, board, apply link, job id,
 *    raw and last_seen_at untouched, record the sighting in
 *    last_seen_elsewhere_at, and be counted as refound by the runner
 *    (postings_touch_last_seen, 20261027_posting_links.sql; searchapi from
 *    20261028_google_jobs_aggregators.sql).
 *    If the plain title returns no Point72 result, it reruns with "Point72"
 *    in the query so the collision path is actually exercised.
 * 2. Campus pair: management consulting analyst, Boston, MA, campus = true.
 *
 * Flags: --title "..." (default "Business Analyst, Equities Technology"),
 *        --only-cross / --only-campus, --cap N (default 12).
 *
 * WRITES postings and ingest_runs on dev. Refuses prod. ~8-12 searches, never
 * more than the cap.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { queryFor, GOOGLE_JOBS } from "../../lib/ingest/serpapi"
import { GOOGLE_JOBS_SOURCES, googleJobsAdapter, providerKeyName, type GoogleJobsProvider } from "../../lib/ingest/googleJobs"
import { SearchBudget } from "../../lib/ingest/searchCap"
import { runSweep } from "../../lib/ingest/runner"
import { fingerprintOf, normText, normLocation } from "../../lib/ingest/fingerprint"
import type { FetchedPosting, IngestPair, SourceAdapter } from "../../lib/ingest/types"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const env: Record<string, string> = {}
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2].trim()) env[m[1]] = m[2].trim() }
const get = (k: string) => process.env[k] || env[k]
const URL_ = get("SUPABASE_URL")!, KEY = get("SUPABASE_SERVICE_ROLE_KEY")!
const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF) { console.error("Refusing to run against prod."); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

const COLS = "id,fingerprint,source,org_slug,source_job_id,title,company,location,apply_url,raw,first_seen_at,last_seen_at,last_seen_elsewhere_at"
type Row = Record<string, any>

// Snapshot the rows a fetch is about to collide with, BEFORE the runner upserts.
const snapshots: Row[][] = []
const captured: FetchedPosting[][] = []
const PROVIDER: GoogleJobsProvider = get("GOOGLE_JOBS_PROVIDER") === "serpapi" ? "serpapi" : "searchapi"
const ci = process.argv.indexOf("--cap")
const budget = new SearchBudget(ci >= 0 ? Number(process.argv[ci + 1]) : 12)
const base = googleJobsAdapter({ provider: PROVIDER, apiKey: get(providerKeyName(PROVIDER)), maxPages: 3, budget })
const adapter: SourceAdapter = {
  ...base,
  controlScope: base.controlScope,
  control: base.control.bind(base),
  async fetch(pair, org, carry) {
    const r = await base.fetch(pair, org, carry)
    captured.push(r.postings)
    const fps = [...new Set(r.postings.map((p) => fingerprintOf(p)))]
    const { data, error } = await sb.from("postings").select(COLS).in("fingerprint", fps).not("source", "in", `(${GOOGLE_JOBS_SOURCES.join(",")})`)
    if (error) throw error
    snapshots.push(data || [])
    return r
  },
}

const outcomeLine = (o: any) =>
  `${o.status} ctrl=${o.controlPassed} found=${o.foundCount} added=${o.addedCount} refound=${o.refoundCount} dup=${o.intraRunDuplicateCount} searches=${o.requestsMade}${o.error ? " ERROR " + o.error : ""}`

async function crossSource(title: string) {
  const pair: IngestPair = { id: null, title, location: "New York, NY" }
  console.log(`  q="${queryFor(pair)}"`)
  const o = (await runSweep(adapter, [pair], [GOOGLE_JOBS], sb, { budget }))[0]?.outcomes[0]
  if (!o) throw new Error(`search cap ${budget.cap} reached before this pair (${budget.spent} spent)`)
  console.log(`  ${outcomeLine(o)}`)
  const results = captured[captured.length - 1] ?? []
  const before = snapshots[snapshots.length - 1]

  const p72 = results.filter((p) => /point\s*72/i.test(p.company))
  console.log(`  Point72 results from Google: ${p72.length}`)
  for (const p of p72) {
    const fp = fingerprintOf(p)
    const gh = before.find((r) => r.fingerprint === fp)
    console.log(`    "${p.title}" | ${p.company} | ${p.location}  -> ${gh ? "COLLIDED with " + gh.source + " row" : "no collision"}`)
    if (!gh) {
      // Show the nearest Greenhouse row so the reason is visible.
      const { data } = await sb.from("postings").select("title,company,location").eq("source", "grnhse").eq("org_slug", "point72")
      const near = (data || []).find((r) => normText(r.title) === normText(p.title))
      console.log(near
        ? `      same title on Greenhouse, but location "${near.location}" -> "${normLocation(near.location)}" vs Google "${p.location}" -> "${normLocation(p.location)}"`
        : `      no Greenhouse row with title "${normText(p.title)}"`)
    }
  }

  if (!before.length) return { collided: 0, intact: true }
  const { data: after } = await sb.from("postings").select(COLS).in("id", before.map((r) => r.id))
  let intact = true
  for (const b of before) {
    const a = (after || []).find((r) => r.id === b.id)!
    const same = (k: string) => JSON.stringify(a[k]) === JSON.stringify(b[k])
    const checks = {
      source: same("source"), org_slug: same("org_slug"), source_job_id: same("source_job_id"),
      apply_url: same("apply_url"), raw: same("raw"), first_seen_at: same("first_seen_at"),
      // A Google sighting is not the employer's board: last_seen_at must not move.
      last_seen_unchanged: same("last_seen_at"),
      elsewhere_recorded: !!a.last_seen_elsewhere_at && (!b.last_seen_elsewhere_at || Date.parse(a.last_seen_elsewhere_at) > Date.parse(b.last_seen_elsewhere_at)),
    }
    const ok = Object.values(checks).every(Boolean)
    intact &&= ok
    console.log(`  collided row: ${b.title} | ${b.location}`)
    console.log(`    source ${b.source} -> ${a.source};  apply_url ${b.apply_url} -> ${a.apply_url}`)
    console.log(`    last_seen ${b.last_seen_at} -> ${a.last_seen_at};  last_seen_elsewhere ${b.last_seen_elsewhere_at} -> ${a.last_seen_elsewhere_at}`)
    console.log(`    checks: ${JSON.stringify(checks)}  => ${ok ? "INTACT" : "OVERWRITTEN"}`)
  }
  // The runner must count these as re-found, not added.
  const counted = o.refoundCount >= before.length
  console.log(`  runner: refound ${o.refoundCount} >= ${before.length} collided: ${counted}`)
  return { collided: before.length, intact: intact && counted }
}

;(async () => {
  console.log(`Project: ${ref} (dev)  provider: ${PROVIDER}  search cap: ${budget.cap}\n`)

  // ---------------- 1. cross-source collision with Point72's Greenhouse board
  if (!process.argv.includes("--only-campus")) {
    const ai = process.argv.indexOf("--title")
    const TITLE = ai >= 0 && process.argv[ai + 1] ? process.argv[ai + 1] : "Business Analyst, Equities Technology"
    console.log(`1. CROSS-SOURCE: "${TITLE}" (Point72 Greenhouse, New York, NY)`)
    let r = await crossSource(TITLE)
    if (!/point\s*72/i.test(TITLE) && !captured[captured.length - 1].some((p) => /point\s*72/i.test(p.company))) {
      console.log(`\n  Plain title returned no Point72 result; rerunning with the employer in the query.`)
      r = await crossSource(`Point72 ${TITLE}`)
    }
    console.log(`  Searches spent: ${budget.spent} of ${budget.cap}`)
    console.log(`  RESULT: ${r.collided ? (r.intact ? `PASS: ${r.collided} collision(s), Greenhouse row(s) intact` : "FAIL: Greenhouse row overwritten") : "NO COLLISION occurred, so the trigger path was not exercised"}\n`)
  }
  if (process.argv.includes("--only-cross")) return

  // ---------------- 2. campus pair
  const campus: IngestPair = { id: null, title: "management consulting analyst", location: "Boston, MA", campus: true }
  console.log(`2. CAMPUS PAIR: ${campus.title} | ${campus.location} | campus=true`)
  console.log(`  q="${queryFor(campus)}"`)
  const oc = (await runSweep(adapter, [campus], [GOOGLE_JOBS], sb, { budget }))[0]?.outcomes[0]
  if (!oc) throw new Error(`search cap ${budget.cap} reached before the campus pair`)
  console.log(`  ${outcomeLine(oc)}`)
  const { data: run } = await sb.from("ingest_runs").select("pair_title,pair_location,fetch_detail").eq("id", oc.runId).single()
  console.log(`  ingest_runs row: pair_title="${run?.pair_title}" pair_location="${run?.pair_location}" fetch_detail=${JSON.stringify(run?.fetch_detail)}`)
  const res = captured[captured.length - 1]
  const seen = new Set<string>()
  for (const p of res) {
    const fp = fingerprintOf(p); if (seen.has(fp)) continue; seen.add(fp)
    const age = ((p.raw as any).extensions || []).find((e: string) => /ago/.test(e)) || "-"
    console.log(`    ${p.company} | ${p.title} | ${p.location} | ${age} | via ${(p.raw as any).via}`)
  }
})().catch((e) => { console.error(e); process.exit(1) })
