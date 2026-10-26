/**
 * Phase 3 replay: run the matcher (lib/match) on lane results a coach already
 * pushed or dismissed, and compare (BUILD-PLAN.md Phase 3).
 *
 *   SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod> ANTHROPIC_API_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/match/replay.ts --out <dir> [--efforts low,medium]
 *
 * READ-ONLY on the database (lane_results, search_lanes, client_profiles).
 * Writes only to --out: judgments.json (a cache keyed by row, effort and judge
 * prompt hash, so a rerun or --report costs nothing for rows already judged)
 * and report.txt.
 *
 *   --report   no API calls: rebuild the report from judgments.json
 *
 * WHAT IS SCORED
 *   pushes                                      -> where they land in the queue
 *   dismissals, except already_applied / other  -> where they land
 * already_applied and other are not judged: the matcher cannot know either.
 * 'cleared' rows are a bulk queue clear, not a judgment, and are left out.
 *
 * THE LAUNCH DESIGN IS A RANKED QUEUE (decided 2026-10-25): every posting that
 * passes the hard rules is shown, sorted by score. So the headline is how well
 * the score ranks pushes above dismissals within each client's queue: AUC, and
 * how far down the queue a coach must read to reach every push. The threshold
 * table is kept for reference only.
 *
 * WHAT THE JUDGE IS GIVEN, as live matching will give it: the client's
 * criteria and background (resume excerpt), and the coach's 10 most recent
 * decisions for this client made BEFORE the one being judged, so a row never
 * sees its own answer. "Today" for each judgment is the day it was decided.
 *
 * THE INPUT IS WHAT LANE RESULTS CARRY: title, company, locations, seniority,
 * min_yoe (hiring.cafe's, treated as required), employment type, salary and a
 * requirements summary. No full description is stored, so the judge reads the
 * summary. Live matching reads the enriched posting.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { createClient } from "@supabase/supabase-js"
import { seedCriteria, toStateCode, type MatchCriteria } from "../../lib/match/criteria"
import { applyRules, type MatchPosting, type RuleFailure } from "../../lib/match/rules"
import { judge, JUDGE_PROMPT_SHA256, type Judgment, type JudgeUsage, type PastDecision } from "../../lib/match/judge"

const arg = (n: string) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : undefined }
const OUT = arg("out")
const REPORT_ONLY = process.argv.includes("--report")
const EFFORTS = (arg("efforts") ?? "low").split(",") as ("low" | "medium")[]
const EXAMPLES = 10
if (!OUT) { console.error("--out <dir> required"); process.exit(1) }
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", ...(REPORT_ONLY ? [] : ["ANTHROPIC_API_KEY"])]) if (!process.env[k]) { console.error(`${k} must be set`); process.exit(1) }
mkdirSync(OUT, { recursive: true })
const CACHE = join(OUT, "judgments.json")
type Cached = { judgment: Judgment | null; usage: JudgeUsage | null; error: string | null }
const cache: Record<string, Cached> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {}
const key = (id: string, effort: string) => `${id}:${effort}:${JUDGE_PROMPT_SHA256.slice(0, 12)}`

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const COMMITMENT: Record<string, string> = { "Full Time": "full_time", Internship: "internship", "Part Time": "part_time", Temporary: "temporary", Seasonal: "seasonal", Volunteer: "volunteer", Contract: "contract" }
const PERIOD: Record<string, string> = { Yearly: "year", Hourly: "hour", Monthly: "month", Weekly: "week", Daily: "day" }

/** A lane_results row in the matcher's posting shape. */
export function fromLaneResult(r: any): MatchPosting {
  const place = (s: string) => {
    const parts = s.split(",").map((x) => x.trim())
    const country = parts.length >= 2 ? parts[parts.length - 1] : null
    return { city: parts.length >= 3 ? parts[0] : null, state: country === "US" ? toStateCode(parts[parts.length - 2]) : null, country }
  }
  const cities: string[] = Array.isArray(r.cities) ? r.cities : []
  const states: string[] = Array.isArray(r.states) ? r.states : []
  const locations = cities.length ? cities.map(place) : states.length ? states.map((s) => ({ ...place(", " + s), city: null })) : null
  const types = (Array.isArray(r.commitment) ? r.commitment : []).map((c: string) => COMMITMENT[c] ?? c.toLowerCase())
  return {
    title: r.title ?? "",
    company: r.company ?? "",
    locations,
    remote: r.workplace_type ? r.workplace_type === "Remote" : null,
    yearsMin: r.min_yoe ?? null,
    yearsMax: null,
    yearsBasis: r.min_yoe != null ? "required" : null,
    employmentTypes: types.length ? types : null,
    salaryLow: r.salary_min ?? null,
    salaryHigh: r.salary_max ?? null,
    salaryPeriod: r.salary_frequency ? PERIOD[r.salary_frequency] ?? null : null,
    graduationFrom: null,
    graduationTo: null,
    level: [r.seniority, r.role_type === "People Manager" ? "people manager" : null].filter(Boolean).join(", ") || null,
    startType: null, startDate: null, startSeason: null, startYear: null, campus: null,
    text: r.requirements_summary ?? "",
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i]) } }))
}

;(async () => {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("lane_results")
      .select("id, lane_id, action, reason, note, actioned_at, title, company, location, workplace_type, cities, states, seniority, role_type, min_yoe, commitment, salary_min, salary_max, salary_frequency, requirements_summary")
      .in("action", ["push", "dismiss"]).order("id").range(from, from + 999)
    if (error) throw error
    rows.push(...data!); if (data!.length < 1000) break
  }
  const { data: lanes } = await sb.from("search_lanes").select("id, client_profile_id, name, titles, location, years_max, exclusions, keyword").in("id", [...new Set(rows.map((r) => r.lane_id))])
  const { data: profs } = await sb.from("client_profiles")
    .select("id, job_type, grad_date, education_status, timeline, target_roles, target_industries, excluded_industries, coach_notes_avoid, coach_notes_concerns, resume_text, profile_text")
    .in("id", lanes!.map((l) => l.client_profile_id))
  const laneById = new Map(lanes!.map((l) => [l.id, l]))
  const crit = new Map<string, MatchCriteria>()
  for (const l of lanes!) {
    const { criteria, warnings } = seedCriteria(l, profs!.find((p) => p.id === l.client_profile_id)!)
    crit.set(l.id, criteria)
    for (const w of warnings) console.log(`  ${l.name}: ${w}`)
  }

  // The coach's decisions for a lane, newest first, strictly before `before`.
  const priorDecisions = (laneId: string, before: string): PastDecision[] =>
    rows.filter((x) => x.lane_id === laneId && x.actioned_at < before)
      .sort((a, b) => (a.actioned_at < b.actioned_at ? 1 : -1))
      .slice(0, EXAMPLES)
      .map((x) => ({ title: x.title, company: x.company, action: x.action, reason: x.reason, note: x.note }))

  const scored = rows.filter((r) => r.action === "push" || !["already_applied", "other"].includes(r.reason))
  const evals = scored.map((r) => {
    const c = crit.get(r.lane_id)!, p = fromLaneResult(r)
    return { r, c, p, fails: applyRules(c, p) as RuleFailure[] }
  })
  const toJudge = evals.filter((e) => !e.fails.length).sort((a, b) => (a.r.lane_id < b.r.lane_id ? -1 : 1))
  console.log(`decided rows ${rows.length}; scored ${scored.length} (push ${scored.filter((r) => r.action === "push").length}, dismiss ${scored.filter((r) => r.action === "dismiss").length}); rules failed ${evals.length - toJudge.length}; to judge ${toJudge.length} at ${EFFORTS.join(", ")}`)

  if (!REPORT_ONLY) {
    for (const effort of EFFORTS) {
      const todo = toJudge.filter((e) => !cache[key(e.r.id, effort)]?.judgment)
      console.log(`judging ${todo.length} at effort ${effort}`)
      let done = 0
      await pool(todo, 5, async (e) => {
        try {
          const { judgment, usage } = await judge(e.c, e.p, { effort, examples: priorDecisions(e.r.lane_id, e.r.actioned_at), today: new Date(e.r.actioned_at) })
          cache[key(e.r.id, effort)] = { judgment, usage, error: null }
        } catch (err: any) {
          cache[key(e.r.id, effort)] = { judgment: null, usage: null, error: String(err?.message ?? err).slice(0, 300) }
        }
        if (++done % 50 === 0) { writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  ${done}/${todo.length}`) }
      })
      writeFileSync(CACHE, JSON.stringify(cache))
    }
  }

  // ---- report
  const out: string[] = []
  const say = (s = "") => { out.push(s); console.log(s) }
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a")
  const auc = (p: number[], d: number[]) => { let w = 0; for (const a of p) for (const b of d) w += a > b ? 1 : a === b ? 0.5 : 0; return p.length && d.length ? w / (p.length * d.length) : NaN }

  for (const effort of EFFORTS) {
    const sc = (e: (typeof evals)[number]) => cache[key(e.r.id, effort)]?.judgment?.score ?? null
    const queue = evals.filter((e) => !e.fails.length)
    const errors = queue.filter((e) => sc(e) === null).length
    const usage = Object.entries(cache).filter(([k]) => k.endsWith(`:${effort}:${JUDGE_PROMPT_SHA256.slice(0, 12)}`)).map(([, v]) => v.usage).filter(Boolean) as JudgeUsage[]
    const cost = usage.reduce((n, u) => n + u.costUsd, 0)
    const P = queue.filter((e) => e.r.action === "push"), D = queue.filter((e) => e.r.action === "dismiss")
    say(`\n=== effort ${effort}   judgments ${usage.length}, $${cost.toFixed(4)} ($${(cost / Math.max(usage.length, 1)).toFixed(5)} each), errors ${errors}`)
    say(`  rules: filtered ${evals.filter((e) => e.r.action === "dismiss" && e.fails.length).length} dismissals, dropped ${evals.filter((e) => e.r.action === "push" && e.fails.length).length} pushes; queue has ${queue.length} rows (${P.length} pushes, ${D.length} dismissals)`)
    say(`  AUC all clients: ${auc(P.map(sc) as number[], D.map(sc) as number[]).toFixed(2)}`)

    // Each client's queue sorted by score, highest first; ties broken against the push (pessimistic).
    let pushesTop25 = 0, pushesTop50 = 0, readToLastPush = 0, queueTotal = 0
    say(`  per client (queue sorted by score; a tie places the push below the dismissal):`)
    for (const l of lanes!) {
      const q = queue.filter((e) => e.r.lane_id === l.id)
      if (!q.length) continue
      const sorted = [...q].sort((a, b) => (sc(b) ?? -1) - (sc(a) ?? -1) || (a.r.action === "push" ? 1 : -1))
      const pos = sorted.map((e, i) => (e.r.action === "push" ? i + 1 : 0)).filter(Boolean)
      const n = sorted.length
      pushesTop25 += pos.filter((x) => x <= Math.ceil(n * 0.25)).length
      pushesTop50 += pos.filter((x) => x <= Math.ceil(n * 0.5)).length
      if (pos.length) readToLastPush += Math.max(...pos)
      queueTotal += n
      const p = q.filter((e) => e.r.action === "push").map(sc) as number[], d = q.filter((e) => e.r.action === "dismiss").map(sc) as number[]
      say(`    ${l.name.padEnd(32)} queue ${String(n).padStart(3)}, pushes at ${pos.join(", ") || "-"}; AUC ${auc(p, d).toFixed(2)}`)
    }
    say(`  pushes in the top quarter of their client's queue: ${pushesTop25}/${P.length} (${pct(pushesTop25, P.length)}); top half: ${pushesTop50}/${P.length} (${pct(pushesTop50, P.length)})`)
    say(`  rows a coach reads to reach every push, all clients: ${readToLastPush} of ${queueTotal} (${pct(readToLastPush, queueTotal)})`)
    const kept = (es: typeof queue, t: number) => es.filter((e) => (sc(e) ?? 100) >= t).length
    say(`  for reference, if it were a filter: ${[30, 40, 50, 60, 70].map((t) => `${t}: keep ${pct(kept(P, t), P.length)} / filter ${pct(D.length - kept(D, t), D.length)}`).join("   ")}`)
    say(`  lowest-ranked pushes (bottom half of their queue, or score < 50):`)
    for (const e of P.filter((e) => (sc(e) ?? 100) < 50).sort((a, b) => (sc(a) ?? 0) - (sc(b) ?? 0))) {
      const j = cache[key(e.r.id, effort)]?.judgment
      say(`    ${j?.score} [${laneById.get(e.r.lane_id)!.name}] ${e.r.title} | ${e.r.company}\n        ${j?.reason}`)
    }
    say(`  highest-ranked dismissals (score >= 85):`)
    for (const e of D.filter((e) => (sc(e) ?? 0) >= 85).sort((a, b) => (sc(b) ?? 0) - (sc(a) ?? 0)).slice(0, 12)) {
      const j = cache[key(e.r.id, effort)]?.judgment
      say(`    ${j?.score} [${laneById.get(e.r.lane_id)!.name}] ${e.r.reason}${e.r.note ? ` (note: ${e.r.note})` : ""} | ${e.r.title} | ${e.r.company}\n        ${j?.reason}`)
    }
  }
  writeFileSync(join(OUT, "report.txt"), out.join("\n"))
})().catch((e) => { console.error(e); process.exit(1) })
