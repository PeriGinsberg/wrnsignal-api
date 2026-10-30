/**
 * What tonight's nightly pipeline would do, read without doing any of it: no
 * searches, no model calls, no writes. Works before 20261111_nightly_pipeline.sql
 * is applied (it reads no pipeline table).
 *
 *   npx tsx tests/pipeline/dry-run.ts [--pairs 40]
 *
 * Creds: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the shell, else
 * .env.phase0. SEARCHAPI_KEY likewise (only /api/v1/me is called, which spends
 * no search).
 *
 * Judgments are estimated by running the hard rules locally: what passes and
 * has a description is what the judge would be asked about.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { loadAndPickPairs } from "../../lib/pipeline/pairs"
import { CAPS, MAX_PAGES, SEARCHAPI_PLAN_SEARCHES } from "../../lib/pipeline/tick"
import { costPosition, SEARCHAPI_MONTHLY_FEE_USD } from "../../lib/pipeline/cost"
import { countWorklist } from "../../lib/ingest/enrichPostings"
import { fromPosting, loadMatchWork } from "../../lib/match/runMatching"
import { applyRules } from "../../lib/match/rules"

const ENV_FILE = join(__dirname, "..", "..", ".env.phase0")
const fileEnv: Record<string, string> = {}
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && m[2]) fileEnv[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2")
  }
}
const env = (k: string) => process.env[k] || fileEnv[k]
const arg = (name: string) => { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : undefined }

const URL_ = env("SUPABASE_URL"), KEY = env("SUPABASE_SERVICE_ROLE_KEY")
if (!URL_ || !KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
const usd = (n: number) => `$${n.toFixed(2)}`

;(async () => {
  const now = new Date()
  console.log(`Supabase project: ${new URL(URL_).hostname.split(".")[0]}   dry run at ${now.toISOString()}`)
  console.log(`Caps per night: ${CAPS.searches} searches, ${CAPS.enrich} postings enriched, ${CAPS.judgments} judgments\n`)

  // 0. ATS, already run tonight by their own crons
  const today = now.toISOString().slice(0, 10)
  console.log("0. ATS sweeps (own crons, 03:00-03:15 and 04:00-04:45 UTC), tonight so far:")
  for (const source of ["grnhse", "smartrecruiters"]) {
    const head = (q: any) => q.then((r: any) => r.count ?? 0)
    const all = await head(sb.from("ingest_runs").select("id", { count: "exact", head: true }).eq("source", source).gte("started_at", today))
    const err = await head(sb.from("ingest_runs").select("id", { count: "exact", head: true }).eq("source", source).eq("status", "error").gte("started_at", today))
    console.log(`   ${source.padEnd(16)} ${all} board runs, ${err} errors`)
  }

  // 1. Google Jobs
  const pick = await loadAndPickPairs(sb, { cap: CAPS.searches, maxPages: MAX_PAGES, now })
  const pri = pick.picked.filter((p) => p.priority)
  console.log(`\n1. Google Jobs: ${pick.picked.length} of ${pick.total} active pairs, estimated ${pick.estimate} of ${CAPS.searches} searches (~${usd(pick.estimate * SEARCHAPI_MONTHLY_FEE_USD / SEARCHAPI_PLAN_SEARCHES)} of the plan)`)
  console.log(`   ${pri.length} priority (never searched, or a client's criteria changed since), ${pick.waiting} waiting for a later night, ${pick.recent} searched in the last 20h`)
  const show = Number(arg("pairs") ?? 40)
  pick.picked.slice(0, show).forEach((p, i) => console.log(`   ${String(i + 1).padStart(3)}. est ${p.estimate}  ${p.title} | ${p.location ?? "nationwide"}${p.campus ? " [campus]" : ""}  last ${p.lastSearchedAt?.slice(0, 16) ?? "never"}${p.priority ? "  PRIORITY: " + p.priority : ""}`))
  if (pick.picked.length > show) console.log(`   ... ${pick.picked.length - show} more`)
  const nextUp = pick.picked.at(-1)
  if (nextUp) console.log(`   last in tonight's list: ${nextUp.title} | ${nextUp.location ?? "nationwide"}`)

  // 2. Enrich
  const wl = await countWorklist(sb)
  const enrichRuns = await sb.from("enrichment_runs").select("attempted, cost_usd").gt("attempted", 0).order("started_at", { ascending: false }).limit(20)
  const perPosting = (enrichRuns.data ?? []).reduce((n, r: any) => n + Number(r.cost_usd), 0) / Math.max(1, (enrichRuns.data ?? []).reduce((n, r: any) => n + r.attempted, 0))
  console.log(`\n2. Enrich: ${wl.due} due now (${wl.dueNew} new, ${wl.dueChanged} changed), plus whatever tonight's Google Jobs adds; cap ${CAPS.enrich}`)
  console.log(`   at ${usd(perPosting)}... per posting (last 20 runs: $${perPosting.toFixed(5)}): ${usd(Math.min(wl.due, CAPS.enrich) * perPosting)} for what is due now`)

  // 3. Match
  const { data: crit } = await sb.from("client_match_criteria").select("client_profile_id").eq("active", true).order("client_profile_id")
  const { data: profs } = await sb.from("client_profiles").select("id, name").in("id", (crit ?? []).map((c: any) => c.client_profile_id))
  const mr = await sb.from("match_runs").select("api_calls, cost_usd").gt("api_calls", 0).order("started_at", { ascending: false }).limit(30)
  const perJudge = (mr.data ?? []).reduce((n, r: any) => n + Number(r.cost_usd), 0) / Math.max(1, (mr.data ?? []).reduce((n, r: any) => n + r.api_calls, 0))
  console.log(`\n3. Match: ${crit?.length ?? 0} active clients, in this order; judgments estimated by running the rules locally (~$${perJudge.toFixed(5)} each)`)
  // Same allocation as the tick: new postings for every client first, then re-judging, under one nightly cap.
  const per: { name: string; work: number; fresh: number; judgeNew: number; judgeOld: number }[] = []
  for (const { client_profile_id: id } of crit ?? []) {
    const name = (profs ?? []).find((p: any) => p.id === id)?.name ?? id.slice(0, 8)
    const w = await loadMatchWork(sb, id)
    const fresh = w.work.filter((p: any) => !w.existing.has(p.id)).length
    const judge = w.work.filter((p: any) => p.description_md5 && !applyRules(w.criteria, fromPosting(p)).length)
    const judgeNew = judge.filter((p: any) => !w.existing.has(p.id)).length
    per.push({ name, work: w.work.length, fresh, judgeNew, judgeOld: judge.length - judgeNew })
  }
  let left = CAPS.judgments
  const take = (n: number) => { const t = Math.min(n, Math.max(left, 0)); left -= t; return t }
  const pass1 = per.map((c) => take(c.judgeNew)), pass2 = per.map((c) => take(c.judgeOld))
  per.forEach((c, i) => {
    const tonight = pass1[i] + pass2[i], all = c.judgeNew + c.judgeOld
    console.log(`   ${c.name.padEnd(18)} evaluate ${String(c.work).padStart(5)} (${c.fresh} new, ${c.work - c.fresh} criteria/description changed)  judge new ${String(c.judgeNew).padStart(3)}, re-judge ${String(c.judgeOld).padStart(4)}  tonight ${String(pass1[i]).padStart(3)} + ${String(pass2[i]).padStart(4)}  ~${usd(tonight * perJudge)}${tonight < all ? `  deferred ${all - tonight}` : ""}`)
  })
  const total = per.reduce((n, c) => n + c.judgeNew + c.judgeOld, 0), done = Math.min(total, CAPS.judgments)
  console.log(`   total to judge ${total} (${per.reduce((n, c) => n + c.judgeNew, 0)} new); tonight ${done} (~${usd(done * perJudge)})${total > CAPS.judgments ? `, cap reached: ${total - CAPS.judgments} re-judgments wait for the next nights and the cap alert goes out` : ""}`)

  // 4. Link check
  const { data: q } = await sb.from("client_match_queue").select("posting_id, apply_url").lte("rank", 30)
  const links = new Set((q ?? []).filter((r: any) => r.apply_url).map((r: any) => `${r.posting_id} ${r.apply_url}`)).size
  console.log(`\n4. Link check: top 30 of each queue, ${links} links (before tonight's matching reshuffles the tops); $0`)

  // Cost position
  const pos = await costPosition(sb, now, env("SEARCHAPI_KEY"))
  console.log(`\nCost: month to date ${usd(pos.mtd)} (${usd(SEARCHAPI_MONTHLY_FEE_USD)} plan + ${usd(pos.ai.total)} AI: enrich ${usd(pos.ai.enrichNightly + pos.ai.enrichManual)}, match ${usd(pos.ai.matchNightly + pos.ai.matchManual)}), projected ${usd(pos.projected)} for ${pos.window.label}`)
  if (pos.account) console.log(`SearchApi: ${pos.account.used} of ${pos.account.allowance} used, period ${pos.account.periodStart.slice(0, 10)} to ${pos.account.periodEnd.slice(0, 10)}, on pace for ${Math.round(pos.pace.searches!.projected)}`)
  else console.log(`SearchApi usage unavailable: ${pos.searchError}`)
})().catch((e) => { console.error(e); process.exit(1) })
