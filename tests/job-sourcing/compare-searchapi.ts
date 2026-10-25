/**
 * SerpApi vs SearchApi, Google Jobs, page 1 only, for the active serpapi pairs
 * (Alex's 15). No database writes: pairs are read from ingest_pairs, then both
 * APIs are called directly, never through the runner.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/job-sourcing/compare-searchapi.ts
 *
 * Keys SERPAPI_KEY and SEARCHAPI_KEY from .env.phase0 (shell env wins).
 * Cost: one search per pair on each API (30 for 15 pairs).
 *
 * Reports per pair: results from each, jobs in both (same fingerprint, and
 * same title + company ignoring location), and which fields the SerpApi
 * adapter (lib/ingest/serpapi.ts) reads that SearchApi's objects lack or leave
 * empty. Raw responses go to the OS temp dir.
 */
import { existsSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { queryFor, cleanTitle } from "../../lib/ingest/serpapi"
import { fingerprintOf, normText } from "../../lib/ingest/fingerprint"

const env: Record<string, string> = {}
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && m[2].trim()) env[m[1]] = m[2].trim() }
const get = (k: string) => process.env[k] || env[k]
const SERP = get("SERPAPI_KEY"), SEARCH = get("SEARCHAPI_KEY")
if (!SERP || !SEARCH) { console.error(`SERPAPI_KEY and SEARCHAPI_KEY required in ${ENV_FILE}`); process.exit(1) }
const sb = createClient(get("SUPABASE_URL")!, get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })

type Norm = { title: string; company: string; location: string | null; fp: string; tc: string }
const norm = (title: string, company: string, location: string | null): Norm => {
  const t = cleanTitle(title, company)
  return { title: t, company, location, fp: fingerprintOf({ title: t, company, location }), tc: normText(t) + "|" + normText(company) }
}
const jobsOf = (j: any): any[] => (Array.isArray(j?.jobs) ? j.jobs : Array.isArray(j?.jobs_results) ? j.jobs_results : [])
const filled = (v: unknown) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)

async function serpapi(q: string) {
  const u = new URL("https://serpapi.com/search.json")
  for (const [k, v] of Object.entries({ engine: "google_jobs", q, hl: "en", gl: "us", api_key: SERP! })) u.searchParams.set(k, v)
  const r = await fetch(u); return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function searchapi(q: string) {
  const u = new URL("https://www.searchapi.io/api/v1/search")
  for (const [k, v] of Object.entries({ engine: "google_jobs", q, hl: "en", gl: "us", api_key: SEARCH! })) u.searchParams.set(k, v)
  const r = await fetch(u); return { status: r.status, json: await r.json().catch(() => ({})) }
}

// What lib/ingest/serpapi.ts reads from a SerpApi job object, and what it is for.
const ADAPTER_FIELDS: [string, string][] = [
  ["job_id", "source_job_id"],
  ["title", "title"],
  ["company_name", "company"],
  ["location", "location"],
  ["description", "raw description (enrichment input)"],
  ["apply_options", "apply_url (employer link preferred)"],
  ["share_link", "apply_url fallback"],
  ["extensions", "posted_at ('N days ago')"],
  ["via", "raw (aggregator name)"],
]

;(async () => {
  const { data: pairs, error } = await sb.from("ingest_pairs").select("title,location,campus").eq("active", true).contains("sources", ["serpapi"]).order("title")
  if (error) throw error
  console.log(`${pairs!.length} pairs; page 1 on each API\n`)
  const raw: any[] = []
  const searchKeys = new Map<string, number>()
  const fieldFill: Record<string, { serp: number; search: number }> = {}
  let serpTotal = 0, searchTotal = 0, bothFp = 0, bothTc = 0

  for (const p of pairs!) {
    const q = queryFor({ id: null, title: p.title, location: p.location, campus: p.campus })
    const [a, b] = await Promise.all([serpapi(q), searchapi(q)])
    raw.push({ q, serpapi: a, searchapi: b })
    const sj = jobsOf(a.json), tj = jobsOf(b.json)
    for (const j of tj) for (const k of Object.keys(j)) searchKeys.set(k, (searchKeys.get(k) || 0) + 1)
    for (const [f] of ADAPTER_FIELDS) {
      fieldFill[f] ??= { serp: 0, search: 0 }
      fieldFill[f].serp += sj.filter((j) => filled(j[f])).length
      fieldFill[f].search += tj.filter((j) => filled(j[f])).length
    }
    const sn = sj.map((j) => norm(j.title ?? "", j.company_name ?? "", j.location ?? null))
    const tn = tj.map((j) => norm(j.title ?? j.position ?? "", j.company_name ?? j.company ?? "", j.location ?? null))
    const sFp = new Set(sn.map((x) => x.fp)), tFp = new Set(tn.map((x) => x.fp))
    const sTc = new Set(sn.map((x) => x.tc)), tTc = new Set(tn.map((x) => x.tc))
    const fp = [...sFp].filter((x) => tFp.has(x)).length
    const tc = [...sTc].filter((x) => tTc.has(x)).length
    serpTotal += sj.length; searchTotal += tj.length; bothFp += fp; bothTc += tc
    const err = (x: any) => (x.json?.error ? ` ERR(${String(x.json.error).slice(0, 60)})` : x.status !== 200 ? ` HTTP ${x.status}` : "")
    console.log(`${String(sj.length).padStart(3)} serpapi${err(a)}  ${String(tj.length).padStart(3)} searchapi${err(b)}  both: ${fp} same fingerprint, ${tc} same title+company   ${q}`)
  }

  console.log(`\nTOTAL: serpapi ${serpTotal}, searchapi ${searchTotal}; in both ${bothFp} by fingerprint, ${bothTc} by title+company`)
  console.log(`\nAdapter fields, jobs with the field filled (serpapi / searchapi):`)
  for (const [f, use] of ADAPTER_FIELDS) console.log(`  ${f.padEnd(14)} ${String(fieldFill[f]?.serp ?? 0).padStart(4)} / ${String(fieldFill[f]?.search ?? 0).padStart(4)}   -> ${use}`)
  console.log(`\nSearchApi job keys seen (count of jobs): ${[...searchKeys.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}(${n})`).join(", ")}`)
  const one = raw.map((r) => jobsOf(r.searchapi.json)[0]).find(Boolean)
  if (one) console.log(`\nOne SearchApi job, values truncated:\n${JSON.stringify(one, (_k, v) => (typeof v === "string" && v.length > 90 ? v.slice(0, 90) + "…" : v), 1).slice(0, 2500)}`)
  const pag = raw.map((r) => Object.keys(r.searchapi.json || {}).filter((k) => /pagination|next/i.test(k))).flat()
  console.log(`\nSearchApi pagination keys at top level: ${[...new Set(pag)].join(", ") || "(none)"}`)

  const out = join(tmpdir(), "compare-searchapi-raw.json")
  writeFileSync(out, JSON.stringify(raw, null, 1))
  console.log(`\nRaw responses: ${out}`)
})().catch((e) => { console.error(e); process.exit(1) })
