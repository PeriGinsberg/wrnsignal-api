// Run: npx tsx lib/pipeline/pipeline.test.ts
//
// Nightly pipeline, offline: which pairs run first, which step runs next, what
// the watchdog reports, and the cost pace arithmetic and its once-per-period rule.

import { pickPairs, type LastSearch, type PairRow } from "./pairs"
import { nextStep, MAX_CONTINUATIONS, type RunRow } from "./runs"
import { watchdogFindings } from "./watchdog"
import { lastWeek, monthWindow, paceAlerts, projectSearches, projectSpend, runPaceCheck, weeklyReportText, type StepTotals } from "./cost"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

// ---- pairs
const NOW = new Date("2026-10-30T05:00:00Z")
const P = (id: string, title: string, location: string | null = "New York, NY"): PairRow => ({ id, title, location, campus: false })
const pairs = [P("a", "analyst"), P("b", "associate"), P("c", "front desk agent", "Miami, FL"), P("d", "concierge", "Miami, FL"), P("e", "coordinator")]
const last = new Map<string, LastSearch>([
  ["a", { at: "2026-10-26T16:00:00Z", pages: 2 }],
  ["b", { at: "2026-10-25T16:00:00Z", pages: 1 }],
  ["c", { at: "2026-10-27T16:00:00Z", pages: 3 }],
  ["d", { at: "2026-10-29T20:00:00Z", pages: 1 }],
])
const cole = { clientProfileId: "cole0000", targetRoles: ["Front Desk Agent", "concierge"], changedAt: "2026-10-29T22:00:00Z" }
const big = pickPairs(pairs, last, [cole], { cap: 100, maxPages: 3, now: NOW })
const order = big.picked.map((p) => p.id).join("")
ok("never searched first, then a changed client's pairs, then oldest search first", order === "ecdba")
ok("a changed client's pair is priority even if searched this morning (d, 9h ago, before the change)", big.picked.some((p) => p.id === "d" && p.priority?.includes("cole0000")))
ok("priority reasons: never searched / criteria changed", big.picked[0].priority === "never searched" && big.picked.filter((p) => p.priority).length === 3)
const quiet = pickPairs(pairs, last, [], { cap: 100, maxPages: 3, now: NOW })
ok("without a changed client, a pair searched in the last 20h waits", !quiet.picked.some((p) => p.id === "d") && quiet.recent === 1)
ok("estimate: own pages, else maxPages, plus one control per location", big.picked.find((p) => p.id === "e")!.estimate === 4 && big.picked.find((p) => p.id === "a")!.estimate === 2)
const tight = pickPairs(pairs, last, [cole], { cap: 9, maxPages: 3, now: NOW })
ok("the cap ends the list in order; the rest wait", tight.estimate <= 9 && tight.waiting === pairs.length - tight.picked.length && tight.picked[0].id === "e")
ok("case and spacing in target roles do not matter", pickPairs([P("x", " Concierge ")], new Map([["x", { at: "2026-10-01T00:00:00Z", pages: 1 }]]), [cole], { cap: 10, maxPages: 3, now: NOW }).picked[0].priority !== null)
ok("a client changed BEFORE the last search is not priority", pickPairs([P("c", "front desk agent")], new Map([["c", { at: "2026-10-29T23:00:00Z", pages: 1 }]]), [cole], { cap: 10, maxPages: 3, now: NOW }).recent === 1)

// ---- next step
let n = 0
const row = (step: RunRow["step"], status: RunRow["status"], detail: Record<string, any> = {}): RunRow =>
  ({ id: String(n++), night: "2026-10-30", step, status, started_at: `2026-10-30T05:${String(n).padStart(2, "0")}:00Z`, finished_at: null, units: 0, cost_usd: 0, searches: 0, detail, error: status === "error" ? "x" : null })
const ns = (rows: RunRow[]) => { const x = nextStep(rows); return x.kind === "run" ? `${x.step}${x.continuation ? "+" : ""}` : x.kind }
ok("nothing yet: Google Jobs", ns([]) === "google_jobs")
ok("ATS rows do not count as tick steps", ns([row("ats_grnhse", "ok"), row("ats_smartrecruiters", "ok")]) === "google_jobs")
ok("Google Jobs capped or failed is still done for the night: enrich next", ns([row("google_jobs", "capped", { capReason: "cap" })]) === "enrich" && ns([row("google_jobs", "error")]) === "enrich")
ok("enrich out of time: enrich again", ns([row("google_jobs", "ok"), row("enrich", "capped", { capReason: "deadline" })]) === "enrich+")
ok("enrich at its cap: match next", ns([row("google_jobs", "ok"), row("enrich", "capped", { capReason: "cap" })]) === "match")
ok("a running row: busy", ns([row("google_jobs", "ok"), row("enrich", "running")]) === "busy")
const many = [row("google_jobs", "ok"), ...Array.from({ length: MAX_CONTINUATIONS + 1 }, () => row("enrich", "capped", { capReason: "deadline" }))]
ok("continuations stop after MAX_CONTINUATIONS: match next", ns(many) === "match")
ok("all four done: done", ns([row("google_jobs", "ok"), row("enrich", "ok"), row("match", "ok"), row("link_check", "ok")]) === "done")

// ---- watchdog
const w = watchdogFindings([row("ats_grnhse", "ok"), row("google_jobs", "error"), row("enrich", "ok"), row("match", "capped", { capReason: "deadline", deferred: 812 }), row("link_check", "running")])
ok("watchdog: a missing step is skipped", w.some((f) => f.startsWith("ats_smartrecruiters: skipped")))
ok("watchdog: out of time with work left is reported", w.some((f) => f.startsWith("match: ran out of time") && f.includes("812")))
ok("watchdog: still running is reported", w.some((f) => f.startsWith("link_check: still running")))
ok("watchdog: a failure is not repeated (the tick sent it)", !w.some((f) => f.startsWith("google_jobs")) && w.length === 3)

// ---- cost arithmetic
const nov10 = monthWindow(new Date("2026-11-11T00:00:00Z"))
ok("month window: November has 30 days, 10 elapsed on the 11th", nov10.days === 30 && nov10.elapsedDays === 10 && nov10.label === "2026-11")
ok("projection: fee once plus AI spend scaled to the month", Math.abs(projectSpend(25, 40, nov10) - 115) < 1e-9)
const acct = { used: 3000, allowance: 10000, periodStart: "2026-10-25T15:49:03Z", periodEnd: "2026-11-25T15:49:03Z" }
const sp = projectSearches(acct, new Date("2026-11-03T15:49:03Z"))
ok("searches: by billing period (9 of 31 days -> x31/9)", Math.abs(sp.projected - (3000 * 31) / 9) < 1e-6 && Math.abs(sp.elapsedDays - 9) < 1e-9)
const pace = (mtd: number, projected: number, days: number, sProj: number | null) => paceAlerts({
  spend: { mtd, projected, budget: 110, elapsedDays: days, month: "2026-11" },
  searches: sProj === null ? null : { used: 3000, projected: sProj, allowance: 10000, elapsedDays: days, periodStart: "2026-10-25T15:49:03Z" },
})
ok("spend over $110 on pace: alert", pace(65, 115, 10, 9000).map((a) => a.kind).join() === "spend")
ok("searches over 10,000 on pace: alert, keyed by billing period", pace(50, 90, 10, 10300).map((a) => `${a.kind}:${a.period}`).join() === "searches:2026-10-25")
ok("under both: no alert", pace(50, 90, 10, 9000).length === 0)
ok("first two days: no alert however it projects", pace(42, 160, 1.2, 30000).length === 0)
ok("SearchApi unavailable: spend still checked", pace(65, 115, 10, null).map((a) => a.kind).join() === "spend")
const lw = lastWeek(new Date("2026-11-02T13:00:00Z"))
ok("last week, sent Monday Nov 2: Oct 26 to Nov 1", lw.fromNight === "2026-10-26" && lw.toNight === "2026-11-01")

const steps = { ats_grnhse: { cost: 0, units: 14630, searches: 0, runs: 7 }, ats_smartrecruiters: { cost: 0, units: 4300, searches: 0, runs: 7 },
  google_jobs: { cost: 4.76, units: 1190, searches: 1190, runs: 7 }, enrich: { cost: 3.45, units: 3000, searches: 0, runs: 9 },
  match: { cost: 0.51, units: 3000, searches: 0, runs: 8 }, link_check: { cost: 0, units: 1680, searches: 0, runs: 7 } } as StepTotals
const text = weeklyReportText({ weekFrom: "2026-10-26", weekTo: "2026-11-01", steps, weekAi: { enrichNightly: 3.45, matchNightly: 0.51, enrichManual: 1.2, matchManual: 0.4, total: 5.56 },
  mtd: 61.2, projected: 101.4, budget: 110, fee: 40, month: "2026-11", account: acct, searchesProjected: 9600, searchError: null })
ok("weekly email: every step, manual runs, MTD, projection and searches", ["Google Jobs", "Enrichment", "Matching", "Link check", "Greenhouse sweep", "Manual runs", "$1.60",
  "Month to date (2026-11): $61.20", "Projected for 2026-11: $101.40 (limit $110)", "3000 of 10000 searches", "on pace for 9600"].every((s) => text.includes(s)))
ok("weekly email: no OVER flag under the limits", !text.includes("OVER"))

// ---- once per period, against an in-memory stand-in for the two tables runPaceCheck touches
function fakeDb(runs: { enrichment_runs: any[]; match_runs: any[] }) {
  const alerts: any[] = []
  const select = (rows: any[]) => { const q: any = { gte: () => q, lt: () => q, range: async (a: number) => ({ data: a === 0 ? rows : [], error: null }) }; return q }
  return {
    alerts,
    from(t: string) {
      if (t === "cost_alerts") return {
        insert: (r: any) => ({ select: () => ({ single: async () => alerts.some((x) => x.kind === r.kind && x.period === r.period)
          ? { data: null, error: { code: "23505", message: "duplicate" } } : (alerts.push({ ...r, id: String(alerts.length) }), { data: { id: String(alerts.length - 1) }, error: null }) }) }),
        delete: () => ({ eq: async (_: string, id: string) => { alerts.splice(alerts.findIndex((x) => x.id === id), 1); return { error: null } } }),
      }
      return { select: () => select((runs as any)[t]) }
    },
  } as any
}
;(async () => {
  const db = fakeDb({ enrichment_runs: [{ cost_usd: 60, triggered_by: "nightly:pipeline" }], match_runs: [{ cost_usd: 5, triggered_by: "manual:run-matching" }] })
  const mails: string[] = []
  const send = async (s: string) => { mails.push(s) }
  const at = new Date("2026-11-11T00:00:00Z")
  const r1 = await runPaceCheck(db, { now: at, send })
  const r2 = await runPaceCheck(db, { now: at, send })
  ok("pace: $40 + $65 in 10 days projects over $110, one email", r1.sent.length === 1 && mails.length === 1 && mails[0].includes("$235"))
  ok("pace: the second check that period sends nothing", r2.sent.length === 0 && r2.alreadySent.length === 1 && mails.length === 1)
  ok("pace: no SearchApi key is reported, not thrown", r1.searchError === "SEARCHAPI_KEY is not set here")
  const db2 = fakeDb({ enrichment_runs: [{ cost_usd: 60, triggered_by: "nightly:pipeline" }], match_runs: [] })
  let threw = false
  try { await runPaceCheck(db2, { now: at, send: async () => { throw new Error("postmark down") } }) } catch { threw = true }
  ok("pace: a failed email removes its record, so the next check retries", threw && db2.alerts.length === 0)

  console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
  if (failures) process.exit(1)
})()
