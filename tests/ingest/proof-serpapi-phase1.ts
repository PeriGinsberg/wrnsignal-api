/**
 * BUILD-PLAN Phase 1 proofs for the SerpApi source, plus a cross-source check.
 * Dev only: refuses the prod project.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/proof-serpapi-phase1.ts
 *
 * Proof 1: run the same pair twice. The second run must add nothing it had
 *          already seen, and no posting may end up as two rows.
 * Proof 2: run two pairs that overlap. Every posting both returned must be one
 *          row, found as new by the first pair and re-found by the second.
 * Cross-source: SerpApi postings that share a normalized title with another
 *          source's posting at a similar company name but got a different
 *          fingerprint (the same role from two sources failing to collide).
 *
 * WRITES postings and ingest_runs on dev. About 15 SerpApi searches.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { serpApiAdapter, GOOGLE_JOBS } from "../../lib/ingest/serpapi"
import { runSweep } from "../../lib/ingest/runner"
import { fingerprintOf, normText, normLocation } from "../../lib/ingest/fingerprint"
import type { FetchedPosting, IngestPair, SourceAdapter } from "../../lib/ingest/types"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const env: Record<string, string> = {}
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2].trim()) env[m[1]] = m[2].trim() }
const get = (k: string) => process.env[k] || env[k]
const URL_ = get("SUPABASE_URL")!, KEY = get("SUPABASE_SERVICE_ROLE_KEY")!, SERPAPI_KEY = get("SERPAPI_KEY")!
const ref = new URL(URL_).hostname.split(".")[0]
if (ref === PROD_REF) { console.error("Refusing to run against prod."); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

// Wrap the adapter so the proof sees exactly what each fetch handed the runner.
const captured: FetchedPosting[][] = []
const base = serpApiAdapter({ apiKey: SERPAPI_KEY, maxPages: 3 })
const adapter: SourceAdapter = {
  ...base,
  controlScope: base.controlScope,
  control: base.control.bind(base),
  async fetch(pair, org, carry) {
    const r = await base.fetch(pair, org, carry)
    captured.push(r.postings)
    return r
  },
}
const fps = (ps: FetchedPosting[]) => new Set(ps.map((p) => fingerprintOf(p)))

async function loadPair(title: string, location: string): Promise<IngestPair> {
  const { data, error } = await sb.from("ingest_pairs").select("id,title,location,campus").eq("title", title).eq("location", location).contains("sources", ["serpapi"]).single()
  if (error || !data) throw new Error(`pair not found: ${title} | ${location}`)
  return { id: data.id, title: data.title, location: data.location, campus: data.campus }
}

async function rowsFor(fingerprints: string[]) {
  const out: any[] = []
  for (let i = 0; i < fingerprints.length; i += 100) {
    const { data, error } = await sb.from("postings").select("id,fingerprint,source,source_job_id,title,company,location,first_seen_at,last_seen_at").in("fingerprint", fingerprints.slice(i, i + 100))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

async function serpRows() {
  const out: any[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings").select("id,fingerprint,source_job_id,title,company,location").eq("source", "serpapi").range(f, f + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Two rows that are one posting: same Google job_id, or same title+company+location text under different fingerprints. */
function duplicateGroups(rows: any[]) {
  const byJob = new Map<string, any[]>()
  for (const r of rows) if (r.source_job_id) byJob.set(r.source_job_id, [...(byJob.get(r.source_job_id) || []), r])
  return [...byJob.values()].filter((g) => new Set(g.map((r) => r.fingerprint)).size > 1)
}

function line(label: string, o: any) {
  return `  ${label.padEnd(44)} ${o.status} ctrl=${o.controlPassed} found=${o.foundCount} added=${o.addedCount} refound=${o.refoundCount} dup=${o.intraRunDuplicateCount} req=${o.requestsMade}${o.error ? " ERROR " + o.error : ""}`
}

;(async () => {
  console.log(`Project: ${ref} (dev)\n`)
  const before = (await serpRows()).length
  console.log(`serpapi postings before: ${before}\n`)

  // ---------------- Proof 1: same pair twice
  const p1 = await loadPair("financial analyst", "Chicago, IL")
  console.log("PROOF 1: same pair twice  ->  financial analyst | Chicago, IL")
  const r1a = (await runSweep(adapter, [p1], [GOOGLE_JOBS], sb))[0].outcomes[0]
  const fA = fps(captured[captured.length - 1])
  const countAfterA = (await serpRows()).length
  const r1b = (await runSweep(adapter, [p1], [GOOGLE_JOBS], sb))[0].outcomes[0]
  const fB = fps(captured[captured.length - 1])
  const countAfterB = (await serpRows()).length
  const newInB = [...fB].filter((f) => !fA.has(f))
  console.log(line("run 1", r1a))
  console.log(line("run 2", r1b))
  console.log(`  distinct fingerprints: run 1 ${fA.size}, run 2 ${fB.size}, in run 2 but not run 1: ${newInB.length}`)
  console.log(`  serpapi rows: ${before} -> ${countAfterA} after run 1 -> ${countAfterB} after run 2 (delta ${countAfterB - countAfterA})`)
  const rowsB = await rowsFor([...fB])
  const perFp = new Map<string, number>(); for (const r of rowsB) perFp.set(r.fingerprint, (perFp.get(r.fingerprint) || 0) + 1)
  console.log(`  every run-2 fingerprint is exactly one row: ${[...fB].every((f) => perFp.get(f) === 1)}`)
  const pass1 = r1b.status === "ok" && r1b.addedCount === newInB.length && countAfterB - countAfterA === newInB.length && [...fB].every((f) => perFp.get(f) === 1)
  console.log(`  RESULT: ${pass1 ? "PASS" : "FAIL"}  (run 2 added ${r1b.addedCount}; expected exactly the ${newInB.length} posting(s) Google returned that run 1 had not)\n`)

  // ---------------- Proof 2: two overlapping pairs
  const pA = await loadPair("wealth management associate", "Columbus, OH")
  const pB = await loadPair("private wealth analyst", "Columbus, OH")
  console.log("PROOF 2: overlapping pairs  ->  wealth management associate | Columbus, OH  +  private wealth analyst | Columbus, OH")
  const sweep = await runSweep(adapter, [pA, pB], [GOOGLE_JOBS], sb)
  const gA = fps(captured[captured.length - 2])
  const gB = fps(captured[captured.length - 1])
  const shared = [...gA].filter((f) => gB.has(f))
  const oA = sweep[0].outcomes[0], oB = sweep[1].outcomes[0]
  console.log(line("pair A (wealth management associate)", oA))
  console.log(line("pair B (private wealth analyst)", oB))
  const sharedRows = await rowsFor(shared)
  const sharedPer = new Map<string, number>(); for (const r of sharedRows) sharedPer.set(r.fingerprint, (sharedPer.get(r.fingerprint) || 0) + 1)
  console.log(`  postings returned by both pairs: ${shared.length}`)
  for (const r of sharedRows) console.log(`    ${r.company} | ${r.title} | ${r.location}`)
  const sharedOneRow = shared.every((f) => sharedPer.get(f) === 1)
  // B can only add what neither A nor anything earlier had stored.
  const pass2 = oA.status === "ok" && oB.status === "ok" && shared.length > 0 && sharedOneRow && oB.refoundCount >= shared.length
  console.log(`  each shared posting is one row: ${sharedOneRow}; pair B re-found ${oB.refoundCount} (>= ${shared.length} shared)`)
  console.log(`  RESULT: ${shared.length === 0 ? "INCONCLUSIVE (no overlap returned)" : pass2 ? "PASS" : "FAIL"}\n`)

  // ---------------- Duplicates across everything SerpApi wrote
  const allSerp = await serpRows()
  const dupJobs = duplicateGroups(allSerp)
  console.log(`DUPLICATE CHECK across all ${allSerp.length} serpapi rows: Google job_ids stored under 2+ fingerprints: ${dupJobs.length}`)
  for (const g of dupJobs.slice(0, 10)) console.log("   " + g.map((r: any) => `${r.company} | ${r.title} | ${r.location}`).join("   <>   "))

  // Fingerprint collisions inside a fetch: two Google jobs folded into one row.
  const folded: string[] = []
  for (const batch of captured) {
    const byFp = new Map<string, FetchedPosting[]>()
    for (const p of batch) byFp.set(fingerprintOf(p), [...(byFp.get(fingerprintOf(p)) || []), p])
    for (const g of byFp.values()) if (new Set(g.map((p) => p.source_job_id)).size > 1) folded.push(`${g[0].company} | ${g[0].title} | ${g[0].location} (${g.length} Google jobs, via ${g.map((p) => (p.raw as any).via).join(", ")})`)
  }
  console.log(`Fingerprint shared by different Google job_ids within one fetch: ${folded.length}`)
  for (const f of [...new Set(folded)]) console.log("   " + f)

  // ---------------- Cross-source: same role, different fingerprint
  const others: any[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("postings").select("source,title,company,location,fingerprint").neq("source", "serpapi").range(f, f + 999)
    if (error) throw error
    others.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  console.log(`\nCROSS-SOURCE CHECK: ${allSerp.length} serpapi rows vs ${others.length} rows from other sources`)
  if (!others.length) { console.log("  dev has no postings from other sources."); return }
  const co = (s: string) => normText(s).replace(/\b(inc|llc|llp|ltd|corp|corporation|co|company|plc|group|the|us|usa|na|holdings)\b/g, " ").replace(/\s+/g, " ").trim()
  const similar = (a: string, b: string) => { const x = co(a), y = co(b); if (!x || !y) return false; if (x === y) return true; const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return l.startsWith(s + " ") || l.replace(/ /g, "") === s.replace(/ /g, "") }
  const byTitle = new Map<string, any[]>()
  for (const o of others) { const t = normText(o.title); byTitle.set(t, [...(byTitle.get(t) || []), o]) }
  let sameTitle = 0
  const misses: { s: any; o: any; why: string }[] = []
  let collided = 0
  for (const s of allSerp) {
    const cands = (byTitle.get(normText(s.title)) || []).filter((o) => similar(s.company, o.company))
    if (!cands.length) continue
    sameTitle++
    if (cands.some((o) => o.fingerprint === s.fingerprint)) { collided++; continue }
    const o = cands[0]
    const why = [normText(s.company) !== normText(o.company) ? "company spelling" : "", normLocation(s.location) !== normLocation(o.location) ? "location" : ""].filter(Boolean).join(" + ") || "other"
    misses.push({ s, o, why })
  }
  console.log(`  serpapi rows with a same-title, similar-company posting elsewhere: ${sameTitle}`)
  console.log(`    same fingerprint (collided as intended): ${collided}`)
  console.log(`    DIFFERENT fingerprint: ${misses.length}`)
  const reasons: Record<string, number> = {}; for (const m of misses) reasons[m.why] = (reasons[m.why] || 0) + 1
  console.log(`    by reason: ${JSON.stringify(reasons)}`)
  for (const m of misses) console.log(`      [${m.why}] serpapi: ${m.s.company} | ${m.s.title} | ${m.s.location}   vs   ${m.o.source}: ${m.o.company} | ${m.o.title} | ${m.o.location}`)
})().catch((e) => { console.error(e); process.exit(1) })
