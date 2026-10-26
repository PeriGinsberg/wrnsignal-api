/**
 * Re-enrich only the postings a client could actually see (cost control,
 * 2026-10-26): postings enriched before --cutoff that are still live (seen in
 * the last LIVE_DAYS), have a description, and pass the hard rules for at least
 * one active client in client_match_criteria.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/reenrich-for-clients.ts --cutoff <ts> --count
 *   ANTHROPIC_API_KEY=... NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/reenrich-for-clients.ts --cutoff <ts> --prod
 *
 * Flags:
 *   --cutoff ts        re-enrich postings last enriched before this (required)
 *   --rules location   pass the location rule for some client (default)
 *   --rules all        pass every rule except start for some client (the
 *                      client's queue as it will be)
 *   --client id        only this client's criteria
 *   --employment       only postings whose employment type the 2026-10-26
 *                      internship fix can change: the title states an
 *                      internship, or the type includes internship. Job type is
 *                      then not used to choose either: it is the field being fixed.
 *   --count            print the count and estimated cost; write nothing
 *   --prod             required to write to prod
 *
 * Start is never used to choose: it is the field being added.
 * Estimated cost uses $0.0011 per posting, the 2026-10-25/26 Haiku average.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { criteriaFromRow, fromPosting, LIVE_DAYS } from "../../lib/match/runMatching"
import { applyRules } from "../../lib/match/rules"
import { INTERN_TITLE, runEnrichment } from "../../lib/ingest/enrichPostings"

const PROD_REF = "ejhnokcnahauvrcbcmic"
const PER_POSTING_USD = 0.0011
const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) for (const l of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && m[2]) fileEnv[m[1]] = m[2] }
const env = (k: string) => process.env[k] || fileEnv[k]
const arg = (n: string) => { const i = process.argv.indexOf("--" + n); const v = process.argv[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : undefined }
const flag = (n: string) => process.argv.includes("--" + n)

const URL_ = env("SUPABASE_URL")!, KEY = env("SUPABASE_SERVICE_ROLE_KEY")!
const ref = new URL(URL_).hostname.split(".")[0]
const CUTOFF = arg("cutoff")
const RULES = arg("rules") ?? "location"
const COUNT = flag("count")
const EMPLOYMENT = flag("employment")
if (!CUTOFF || !["location", "all"].includes(RULES)) { console.error("--cutoff <ts> required; --rules location|all"); process.exit(1) }
if (ref === PROD_REF && !COUNT && !flag("prod")) { console.error(`Refusing to write to prod (${ref}) without --prod.`); process.exit(1) }
if (!COUNT && !process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY must be set"); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

async function pageAll<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await q(a, a + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return out
}

;(async () => {
  let cq = sb.from("client_match_criteria").select("*").eq("active", true)
  if (arg("client")) cq = cq.eq("client_profile_id", arg("client")!)
  const { data: rows, error } = await cq
  if (error) throw error
  if (!rows?.length) { console.error("no active client_match_criteria"); process.exit(1) }
  const { data: profiles } = await sb.from("client_profiles")
    .select("id, grad_date, education_status, timeline, resume_text, profile_text, coach_notes_avoid, coach_notes_concerns")
    .in("id", rows.map((r) => r.client_profile_id))
  const clients = rows.map((r) => criteriaFromRow(r, profiles!.find((p) => p.id === r.client_profile_id)))

  const since = new Date(Date.now() - LIVE_DAYS * 86400e3).toISOString()
  const postings = await pageAll<any>((a, b) => sb.from("postings")
    .select("id, source, title, cleaned_title, company, location, years_min, years_max, years_basis, salary_low, salary_high, salary_period, graduation_from, graduation_to, level, requirements_summary, employment_types")
    .not("description_md5", "is", null).is("enrichment_failed_at", null)
    .or(`enriched_at.is.null,enriched_at.lt.${CUTOFF}`)
    .gte("last_seen_at", since).order("id").range(a, b))

  const affected = (p: any) => !EMPLOYMENT || INTERN_TITLE.test(p.title) || (p.employment_types ?? []).includes("internship")
  const passes = (p: any) => affected(p) && clients.some((c) => {
    const f = applyRules({ ...c, availableFrom: null, ...(EMPLOYMENT ? { jobTypes: [] } : {}) }, fromPosting(p))
    return RULES === "location" ? !f.includes("location") : f.length === 0
  })
  const ids = postings.filter(passes).map((p) => p.id)
  const bySource: Record<string, number> = {}
  for (const p of postings) if (ids.includes(p.id)) bySource[p.source] = (bySource[p.source] ?? 0) + 1
  console.log(`Project ${ref}: ${clients.length} active client(s); ${postings.length} live postings still to re-enrich; ${ids.length} pass the ${RULES === "location" ? "location rule" : "rules (except start)"} for a client ${JSON.stringify(bySource)}; estimated $${(ids.length * PER_POSTING_USD).toFixed(2)}`)
  if (COUNT || !ids.length) return

  let done = 0, failed = 0, cost = 0
  for (let i = 0; i < ids.length; i += 100) {
    const s = await runEnrichment(sb, { ids: ids.slice(i, i + 100), reenrichBefore: CUTOFF, limit: 100, triggeredBy: `manual:reenrich-for-clients:${RULES}${EMPLOYMENT ? ":employment" : ""}` })
    done += s.succeeded; failed += s.failed; cost += s.costUsd
    for (const r of s.rows) for (const d of r.demoted) console.log(`  demoted ${d.field} (${d.why}): ${r.company} | ${r.title}`)
    for (const r of s.rows) if (r.status === "failed") console.log(`  failed ${r.company} | ${r.title}: ${r.error?.slice(0, 160)}`)
    console.log(`  ${Math.min(i + 100, ids.length)}/${ids.length}: enriched ${done}, failed ${failed}, $${cost.toFixed(4)}`)
  }
  console.log(`Done: ${done} re-enriched, ${failed} failed, $${cost.toFixed(4)}`)
})().catch((e) => { console.error(e); process.exit(1) })
