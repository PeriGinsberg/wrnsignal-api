/**
 * Phase 0 follow-up: does adding "2027" or "new grad" to a Google Jobs query pull
 * earlier-career postings? Page 1 only, 3 titles x 2 cities x 3 variants = 18
 * SerpApi searches. No database access.
 *
 *   SERPAPI_KEY read from .env.phase0 at the repo root (falls back to the shell env).
 *   npx tsx tests/job-sourcing/variants-phase0.ts
 */
import { existsSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2")
  }
}
const SERPAPI_KEY = fileEnv.SERPAPI_KEY || process.env.SERPAPI_KEY
if (!SERPAPI_KEY) { console.error(`SERPAPI_KEY required in ${ENV_FILE}`); process.exit(1) }

const TITLES = ["human capital analyst", "management consulting analyst", "people analytics analyst"]
const CITIES = ["New York, NY", "Boston, MA"]
const VARIANTS = [
  { key: "plain", add: "" },
  { key: "2027", add: "2027" },
  { key: "new grad", add: "new grad" },
]

// ---------------------------------------------------------------------------
// Early-career signals
// ---------------------------------------------------------------------------
// Years: the lowest minimum a posting states for experience. "0-2 years",
// "1+ years", "2-3+ years of consulting" all count; "3-5 years" does not.
// Company-history lines ("with over 35 years of experience, we...") are not
// requirements and are skipped.
const YEARS_EXPR = /\b(\d{1,2})\s*\+?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b/gi
const FIRM_AGE = /\b(?:we have|has (?:successfully|been)|founded|our (?:firm|company)|for over \d+ years|with over \d+ years|more than \d+ years (?:of|in) business)\b/i
const NO_EXP = /\b(?:no (?:prior |previous )?(?:work )?experience (?:is )?(?:required|necessary|needed)|0\s*(?:-|–|to)\s*\d\s*years?)\b/i
const GRAD = /\b(?:graduat\w*|class of|grad(?:uation)? date|degree (?:completion|conferred)|expected to (?:complete|receive|earn))\b[^.]{0,80}\b202[67]\b|\b202[67]\b[^.]{0,60}\b(?:graduat\w*|grads?|class)\b/i

function sentences(text: string): string[] {
  return text
    .replace(/([.!?;:])(?=[A-Z])/g, "$1\n")
    .replace(/([a-z)])(?=[A-Z][a-z])/g, "$1\n")
    .split(/(?<=[.!?])\s+|\n+|•|·/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

function minYears(text: string): number | null {
  let min: number | null = null
  for (const s of sentences(text)) {
    if (FIRM_AGE.test(s) || !/experience|exp\b/i.test(s)) continue
    for (const m of s.matchAll(YEARS_EXPR)) {
      const n = Number(m[1])
      if (n <= 30 && (min === null || n < min)) min = n
    }
  }
  return min
}

type Job = { title: string; company: string; years: number | null; noExp: boolean; grad: string | null }

function classify(j: any): Job {
  const text = [j.description || "", ...(j.job_highlights || []).flatMap((h: any) => h.items || [])].join("\n")
  const g = sentences(text).find((s) => GRAD.test(s))
  return {
    title: j.title,
    company: String(j.company_name || "").trim(),
    years: minYears(text),
    noExp: NO_EXP.test(text),
    grad: g ? g.slice(0, 160) : null,
  }
}
const early = (j: Job) => j.noExp || (j.years !== null && j.years <= 2) || !!j.grad

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/\./g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(inc|llc|llp|ltd|corp|corporation|co|company|plc|group|the|us|usa)\b/g, " ").replace(/\s+/g, " ").trim()

;(async () => {
  const raw: any[] = []
  const cells = new Map<string, Job[]>() // `${title}|${city}|${variant}` -> jobs
  let used = 0
  for (const title of TITLES)
    for (const city of CITIES)
      for (const v of VARIANTS) {
        const q = [title, v.add, city].filter(Boolean).join(" ")
        const p = new URLSearchParams({ engine: "google_jobs", q, hl: "en", gl: "us", api_key: SERPAPI_KEY })
        const res = await fetch("https://serpapi.com/search.json?" + p.toString())
        const json: any = await res.json().catch(() => ({}))
        used++
        raw.push({ q, json })
        const err = json?.error && !/hasn't returned any results/i.test(json.error) ? json.error : null
        const jobs = (json?.jobs_results || []).map(classify)
        cells.set(`${title}|${city}|${v.key}`, jobs)
        console.log(`  [${used}/18] ${String(jobs.length).padStart(2)} jobs${err ? "  ERROR " + err : ""}  ${q}`)
      }

  const stat = (jobs: Job[]) => {
    const emp = new Set(jobs.map((j) => norm(j.company)).filter(Boolean))
    const yrs = jobs.filter((j) => j.noExp || (j.years !== null && j.years <= 2)).length
    const grad = jobs.filter((j) => j.grad).length
    return { n: jobs.length, emp: emp.size, yrs, grad, early: jobs.filter(early).length }
  }
  const fmt = (s: ReturnType<typeof stat>) => `${String(s.n).padStart(3)} res  ${String(s.emp).padStart(3)} emp  ${String(s.early).padStart(2)} early (${s.yrs}y/${s.grad}g)`
  const W = 36

  console.log("\nPer query. res = results on page 1, emp = distinct employers, early = results stating a minimum of 0-2 years OR a 2026-2027 graduation (y = years, g = grad year)\n")
  console.log("".padEnd(44) + VARIANTS.map((v) => v.key.padEnd(W)).join(""))
  for (const title of TITLES)
    for (const city of CITIES)
      console.log(`${title}, ${city}`.padEnd(44) + VARIANTS.map((v) => fmt(stat(cells.get(`${title}|${city}|${v.key}`)!)).padEnd(W)).join(""))

  console.log("\nTotals per variant (employers deduped across the 6 queries in each variant)")
  for (const v of VARIANTS) {
    const all = TITLES.flatMap((t) => CITIES.flatMap((c) => cells.get(`${t}|${c}|${v.key}`)!))
    const s = stat(all)
    console.log(`  ${v.key.padEnd(10)} ${String(s.n).padStart(3)} results  ${String(s.emp).padStart(3)} distinct employers  ${s.early} early-career (${s.yrs} state 0-2 yrs, ${s.grad} mention 2026/2027 grad)  = ${s.n ? ((100 * s.early) / s.n).toFixed(0) : 0}%`)
  }

  console.log("\nEarly-career hits, with the evidence")
  for (const v of VARIANTS) {
    console.log(`\n  [${v.key}]`)
    for (const t of TITLES) for (const c of CITIES) for (const j of cells.get(`${t}|${c}|${v.key}`)!) {
      if (!early(j)) continue
      const why = [j.noExp ? "no experience required" : j.years !== null && j.years <= 2 ? `min ${j.years} yrs` : "", j.grad ? `grad: "${j.grad}"` : ""].filter(Boolean).join("; ")
      console.log(`    ${j.company} | ${j.title} (${c})  ${why}`)
    }
  }

  const out = join(tmpdir(), "serpapi-phase0-variants-raw.json")
  writeFileSync(out, JSON.stringify({ used, raw }, null, 2))
  console.log(`\nSearches used: ${used}. Raw responses: ${out}`)
})().catch((e) => { console.error(e); process.exit(1) })
