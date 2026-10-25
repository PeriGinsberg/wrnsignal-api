/**
 * Phase 0 follow-up: sample N jobs from serpapi-phase0-raw.json (written by
 * serpapi-phase0.ts), excluding recruiters and job sites, and check each one.
 * Read-only: no database access, no SerpApi calls; only GETs the apply links.
 *
 *   npx tsx tests/job-sourcing/sample-phase0.ts [--n 25] [--seed 20261025] [--raw <path>]
 */
import { readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const arg = (n: string, d?: string) => { const i = process.argv.indexOf("--" + n); const v = process.argv[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : d }
const N = Number(arg("n", "25"))
const SEED = Number(arg("seed", "20261025"))
const RAW = arg("raw", join(tmpdir(), "serpapi-phase0-raw.json"))!

// Staffing agencies, recruiters and job sites that showed up as company_name.
const NOT_EMPLOYER = [
  "jobot", "insight global", "jobrapido", "wall street oasis", "remote worker", "hr tech job", "beacon hill",
  "lancesoft", "ampcus", "cynet systems", "argyle infotech", "synthires", "neotecra", "landing point", "referment",
  "hirevouch", "whitecap workforce", "avid technical resources", "padmore global", "meds talent", "eliassen group",
  "cst connections", "technology resource services", "genius business solutions", "idr, inc", "quest oracle community",
  "instantserve", "kmg healthcare", "pivotal solutions", "datacatalyst", "focuspoint", "bocusa",
  "jpmc candidate experience page", "piedmont careers", "employers association of the northeast",
]
const isNotEmployer = (c: string) => NOT_EMPLOYER.some((x) => c.toLowerCase().includes(x))

// Apply-link hosts that belong to an employer's own ATS or careers site, preferred
// over aggregators for the liveness check.
const ATS = /myworkdayjobs\.com|greenhouse\.io|lever\.co|icims\.com|taleo\.net|successfactors|oraclecloud\.com|smartrecruiters\.com|ashbyhq\.com|jobvite\.com|ultipro|dayforcehcm|paylocity|adp\.com|usajobs\.gov|^careers\.|^jobs\.|\/careers?\//i
const AGGREGATOR = /bebee|ziprecruiter|jobleads|linkedin|trabajo|monster|jobilize|indeed|vaia|careerbuilder|theladders|tealhq|jobzmall|talent\.com|learn4good|lensa|glassdoor|jobrapido|simplyhired|bandana|jobright|recruit\.net|jobmesh|jooble|lifeworq|builtin|sonara|levels\.fyi|expertini|career\.io|adzuna|tallo|hackajob|dice\.com|univision|gilect|fish4|technyc/i

function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// Descriptions often arrive with list items glued together ("...role.Experience
// building", "requiredPower BI"), so split on those seams as well as on punctuation.
function sentences(text: string): string[] {
  return text
    .replace(/([.!?;:])(?=[A-Z])/g, "$1\n")
    .replace(/([a-z)])(?=[A-Z][a-z])/g, "$1\n")
    .split(/(?<=[.!?])\s+|\n+|•|·/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}
const clip = (s: string, n = 220) => (s.length > n ? s.slice(0, n - 1) + "…" : s)

// A deadline only counts when the sentence actually gives a date.
const DATE = /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?|\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4})\b/i
const DEADLINE = /\b(deadline(?!-driven|s\b)|apply by|applications? (?:will be )?(?:accepted|received|due) (?:until|through|by)|closing date|close[sd]? on|posting (?:closes|end date|expires)|accepting applications (?:until|through))\b/i
// Company-history boilerplate ("With over 35 years of ... experience, we have")
// states the firm's age, not a requirement.
const FIRM_AGE = /\b(?:we have|has (?:successfully|been)|founded|our (?:firm|company)|for over \d+ years|with over \d+ years)\b/i
const YEARS = /\b(\d+\s*\+?\s*(?:-|–|to)?\s*\d*\+?\s*(?:years?|yrs?)\b[^.]*\b(?:experience|exp)\b|(?:experience|exp)\b[^.]{0,60}\b\d+\s*\+?\s*(?:years?|yrs?)\b|(?:class of|graduat\w*|grad date|degree)[^.]{0,80}\b20\d\d\b|\b20\d\d\b[^.]{0,40}graduat\w*|recent (?:college )?graduates?|entry[- ]level)/i

type Live = "live" | "closed" | "unknown"
const CLOSED_TEXT = /no longer (?:accepting applications|available|open|active)|position (?:has been|is) (?:filled|closed)|job (?:has )?(?:expired|is closed|is no longer)|this job (?:posting )?(?:is )?(?:closed|expired|unavailable)|posting (?:has )?(?:expired|closed)|job not found|page not found|requisition (?:is )?(?:closed|no longer)/i

async function checkLive(url: string): Promise<{ status: Live; note: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  try {
    // Workday renders client-side; its own JSON endpoint answers the question.
    const wd = url.match(/^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/(.+?)(?:\?|$)/)
    if (wd) {
      const api = `https://${wd[1]}.${wd[2]}.myworkdayjobs.com/wday/cxs/${wd[1]}/${wd[3]}/job/${wd[4]}`
      const r = await fetch(api, { signal: ctl.signal, headers: { Accept: "application/json" } })
      if (r.status === 404) return { status: "closed", note: "Workday API 404" }
      if (r.ok) { const j: any = await r.json().catch(() => null); return j?.jobPostingInfo ? { status: "live", note: "Workday API ok" } : { status: "unknown", note: "Workday API no posting info" } }
      return { status: "unknown", note: `Workday API HTTP ${r.status}` }
    }
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", Accept: "text/html" },
    })
    if (res.status === 404 || res.status === 410) return { status: "closed", note: `HTTP ${res.status}` }
    if (!res.ok) return { status: "unknown", note: `HTTP ${res.status} (blocked or error)` }
    const final = res.url
    // Greenhouse/Lever bounce a closed job back to the board root.
    if (/greenhouse\.io/.test(url) && /[?&]error=true/.test(final)) return { status: "closed", note: "Greenhouse redirected to board (error=true)" }
    const html = await res.text()
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
    const m = text.match(CLOSED_TEXT)
    if (m) return { status: "closed", note: `page says "${m[0]}"` }
    if (/captcha|are you a robot|verify you are human|access denied|cf-chl|just a moment/i.test(text) || text.length < 500)
      return { status: "unknown", note: "bot wall or JS-only page" }
    return { status: "live", note: `HTTP 200, no closed wording${final !== url ? " (redirected)" : ""}` }
  } catch (e: any) {
    return { status: "unknown", note: e?.name === "AbortError" ? "timeout" : String(e?.message || e).slice(0, 60) }
  } finally {
    clearTimeout(timer)
  }
}

;(async () => {
  const raw = JSON.parse(readFileSync(RAW, "utf8"))
  const seen = new Set<string>()
  const pool: any[] = []
  for (const p of raw.raw) for (const j of p.json?.jobs_results || []) {
    if (seen.has(j.job_id)) continue
    seen.add(j.job_id)
    if (!isNotEmployer(String(j.company_name || ""))) pool.push(j)
  }
  const r = rng(SEED)
  for (let i = pool.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [pool[i], pool[k]] = [pool[k], pool[i]] }
  const sample = pool.slice(0, N)
  console.log(`${seen.size} unique jobs, ${pool.length} after excluding recruiters/job sites; sampling ${sample.length} (seed ${SEED})\n`)

  const tally: Record<Live, number> = { live: 0, closed: 0, unknown: 0 }
  let ownLive = 0
  for (const [i, j] of sample.entries()) {
    const desc = String(j.description || "")
    const ss = sentences(desc)
    const deadline = ss.find((s) => DEADLINE.test(s) && DATE.test(s))
    const years = ss.find((s) => YEARS.test(s) && !FIRM_AGE.test(s))
    const opts: { title: string; link: string }[] = j.apply_options || []
    const host = (u: string) => { try { return new URL(u).hostname } catch { return "" } }
    // Employer-owned = an ATS host, or a link whose label/host carries the company's
    // first word ("Careers At Inspire Brands", careers.bcg.com for "Boston Consulting
    // Group" is caught by the label). Everything else is a mirror of the posting.
    const coWord = String(j.company_name || "").toLowerCase().replace(/^the /, "").split(/[^a-z0-9]+/)[0]
    const isOwn = (o: { title: string; link: string }) =>
      !AGGREGATOR.test(host(o.link)) && (ATS.test(host(o.link)) || (coWord.length > 2 && (host(o.link).includes(coWord) || o.title.toLowerCase().includes(coWord))))
    const rank = (o: { title: string; link: string }) => (isOwn(o) ? 0 : /linkedin\.com/.test(host(o.link)) ? 1 : 2)
    const ordered = [...opts].sort((a, b) => rank(a) - rank(b))
    let live: { status: Live; note: string } = { status: "unknown", note: "no apply link" }
    let pick: { title: string; link: string } | undefined
    const tried: string[] = []
    for (const o of ordered.slice(0, 4)) {
      const r = await checkLive(o.link)
      tried.push(`${o.title}: ${r.status}`)
      pick = o
      live = { status: r.status, note: `${r.note}; ${isOwn(o) ? "employer site" : "mirror (" + o.title + ")"}` }
      if (r.status !== "unknown") break
    }
    tally[live.status]++
    if (live.status === "live" && pick && isOwn(pick)) ownLive++
    const age = (j.extensions || []).find((e: string) => /\bago\b|today|yesterday/i.test(e))
    console.log(`${String(i + 1).padStart(2)}. ${j.title}`)
    console.log(`    company:  ${j.company_name}   (via ${j.via})`)
    console.log(`    city:     ${j.location || "?"}`)
    console.log(`    posted:   ${age || "not stated"}`)
    console.log(`    deadline: ${deadline ? clip(deadline) : "none stated"}`)
    console.log(`    yrs/grad: ${years ? clip(years) : "none stated"}`)
    console.log(`    apply:    ${live.status.toUpperCase()}  ${live.note}`)
    if (pick) console.log(`              ${pick.link.replace(/[?&]utm_campaign=.*$/, "")}`)
    if (tried.length > 1) console.log(`              tried: ${tried.join(" | ")}`)
    console.log()
  }
  console.log(`Apply links: live ${tally.live} (${ownLive} on the employer site, ${tally.live - ownLive} on a mirror only), closed ${tally.closed}, unknown ${tally.unknown}`)
})().catch((e) => { console.error(e); process.exit(1) })
