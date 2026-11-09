// Run: npx tsx lib/pipeline/pipeline.test.ts
//
// Nightly pipeline, offline: which pairs run first, which step runs next, what
// the watchdog reports, and the cost pace arithmetic and its once-per-period rule.

import { pickPairs, projectLongestWaits, type ClientRoles, type LastSearch, type PairRow } from "./pairs"
import { byClient, queueSettings } from "./queueRelease"
import { closeStale, nextStep, MAX_CONTINUATIONS, STALE_RUNNING_MS, TICK_STEPS, type RunRow } from "./runs"
import { watchdogFindings } from "./watchdog"
import { coverageRows, lastWeek, monthWindow, paceAlerts, projectSearches, projectSpend, queueRows, runPaceCheck, weeklyReportText, type StepTotals } from "./cost"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

// ---- pairs: the per-client fair share
const NOW = new Date("2026-10-30T05:00:00Z")
const P = (id: string, title: string, location: string | null = "New York, NY"): PairRow => ({ id, title, location, campus: false })
const L = (at: string, pages = 2): LastSearch => ({ at, pages })
const C = (id: string, ...roles: string[]): ClientRoles => ({ clientProfileId: id, targetRoles: roles })
const ids = (pk: { picked: { id: string }[] }) => pk.picked.map((p) => p.id).join(",")
{
  const pairs = [P("a", "analyst"), P("b", "associate"), P("c", "front desk agent", "Miami, FL"), P("d", "concierge", "Miami, FL"), P("e", "coordinator"), P("z", "attorney")]
  const last = new Map([["a", L("2026-10-26T16:00:00Z", 2)], ["b", L("2026-10-25T16:00:00Z", 1)], ["c", L("2026-10-27T16:00:00Z", 3)], ["d", L("2026-10-29T20:00:00Z", 1)]])
  const one = pickPairs(pairs, last, [C("x", "Analyst", " associate ", "front desk agent", "concierge", "coordinator")], { cap: 100, maxPages: 3, now: NOW })
  ok("one client: never searched first, then longest since its last search", ids(one) === "e,b,a,c")
  ok("a pair searched in the last 20h waits", !one.picked.some((p) => p.id === "d") && one.recent === 1)
  ok("a pair no active client owns is not searched, and counted", !one.picked.some((p) => p.id === "z") && one.unowned === 1)
  ok("estimate: own pages, else maxPages, plus one control per location", one.picked.find((p) => p.id === "e")!.estimate === 4 && one.picked.find((p) => p.id === "a")!.estimate === 2)
  const tight = pickPairs(pairs, last, [C("x", "analyst", "associate", "coordinator")], { cap: 6, maxPages: 3, now: NOW })
  ok("the cap ends the list in order; the rest wait", ids(tight) === "e,b" && tight.estimate === 5 && tight.waiting === 1)
}
{
  // Sami owns six old pairs; Gabe two newer, Cole one newest. Cap 15, three clients: 5 each.
  const pairs = [
    P("s1", "business analyst"), P("s2", "consulting analyst"), P("s3", "workforce analyst"), P("s4", "marketing analyst"), P("s5", "pricing analyst"), P("s6", "hr analyst"),
    P("g1", "project coordinator", "Philadelphia, PA"), P("g2", "project manager", "Philadelphia, PA"), P("c1", "concierge", "Miami, FL"),
  ]
  const last = new Map([
    ...["s1", "s2", "s3", "s4", "s5", "s6"].map((id, i) => [id, L(`2026-10-20T0${i}:00:00Z`)] as [string, LastSearch]),
    ["g1", L("2026-10-27T05:00:00Z")], ["g2", L("2026-10-27T06:00:00Z")], ["c1", L("2026-10-28T05:00:00Z")],
  ])
  const clients = [C("sami", "business analyst", "consulting analyst", "workforce analyst", "marketing analyst", "pricing analyst", "hr analyst"), C("gabe", "project coordinator", "project manager"), C("cole", "concierge")]
  const r = pickPairs(pairs, last, clients, { cap: 15, maxPages: 3, now: NOW })
  ok("share: cap divided equally across active clients", r.share === 5 && r.clients === 3)
  ok("every client is searched tonight, however few its pairs", ["s", "g", "c"].every((c) => r.picked.some((p) => p.id.startsWith(c))))
  ok("within a share, a client's longest-waiting pairs first", r.picked.filter((p) => p.id.startsWith("s"))[0].id === "s1")
  ok("never over the cap", r.estimate <= 15)
  ok("cole cannot use all its share: the rest goes to the client furthest behind (sami), marked spare", r.picked.some((p) => p.spare && p.id.startsWith("s")) && r.spare.cole === 0)
  ok("charges: no client is charged more than its share", Object.values(r.charged).every((v) => v <= 5 + 1e-9))
  const two = pickPairs(pairs, last, [...clients, C("new", "trademark associate")], { cap: 16, maxPages: 3, now: NOW })
  ok("a client with no pairs still counts for the share; its share goes to spare", two.share === 4 && two.charged.new === 0)
}
{
  const pairs = [P("x", "marketing analyst"), P("y", "brand manager")]
  const last = new Map([["x", L("2026-10-20T00:00:00Z", 1)], ["y", L("2026-10-21T00:00:00Z", 1)]])
  const r = pickPairs(pairs, last, [C("a", "marketing analyst"), C("b", "marketing analyst", "brand manager")], { cap: 4, maxPages: 3, now: NOW })
  ok("a shared pair is searched once and its cost split among its owners", r.picked.filter((p) => p.id === "x").length === 1 && Math.abs(r.charged.a - 1) < 1e-9 && r.picked.find((p) => p.id === "x")!.owners.length === 2)
  ok("b's own pair follows within its share", ids(r) === "x,y" && Math.abs(r.charged.b - 2) < 1e-9)
  const co = pickPairs([P("x", "marketing analyst")], new Map([["x", L("2026-10-20T00:00:00Z", 1)]]), [C("a", "marketing analyst"), C("b", "marketing analyst")], { cap: 4, maxPages: 3, now: NOW, spentTonight: new Map([["b", 2]]), spentEarlier: 2 })
  ok("an owner whose share is spent pays nothing; the picker covers the rest", co.picked.length === 1 && Math.abs(co.charged.a - 2) < 1e-9 && co.charged.b === 2)
}
{
  const pairs = [P("p1", "analyst"), P("p2", "associate"), P("q1", "concierge", "Miami, FL")]
  const last = new Map([["p1", L("2026-10-20T00:00:00Z", 1)], ["p2", L("2026-10-21T00:00:00Z", 1)], ["q1", L("2026-10-22T00:00:00Z", 1)]])
  const cont = pickPairs(pairs, last, [C("a", "analyst", "associate"), C("b", "concierge")], { cap: 6, maxPages: 3, now: NOW, spentTonight: new Map([["a", 3]]), spentEarlier: 3 })
  ok("a continuation: earlier searches come off the client's share and the night's cap", cont.estimate <= 3 && cont.picked.some((p) => p.id === "q1") && Math.abs(cont.charged.a - 3) < 1e-9)
}
{
  const pairs = Array.from({ length: 10 }, (_, i) => P(`b${i}`, `big role ${i}`)).concat([P("s0", "small role", "Miami, FL")])
  const last = new Map(pairs.map((p, i) => [p.id, L(`2026-10-29T04:${10 + i}:00Z`, 1)]))
  const clients = [C("big", ...Array.from({ length: 10 }, (_, i) => `big role ${i}`)), C("small", "small role")]
  const w = projectLongestWaits(pairs, last, clients, { cap: 6, maxPages: 3, from: NOW, nights: 14 })
  ok("projection: a client with few pairs waits about a night", w.get("small")! <= 1.05)
  ok("projection: a client with many pairs waits longer", w.get("big")! > 2)
  ok("projection: a pair never searched before or during the run is null", projectLongestWaits([P("n", "never")], new Map(), [C("x", "never")], { cap: 0, maxPages: 3, from: NOW, nights: 3 }).get("x") === null)
}

// ---- next step
let n = 0
const row = (step: RunRow["step"], status: RunRow["status"], detail: Record<string, any> = {}): RunRow =>
  ({ id: String(n++), night: "2026-10-30", step, status, started_at: `2026-10-30T05:${String(n).padStart(2, "0")}:00Z`, finished_at: null, units: 0, cost_usd: 0, searches: 0, detail, error: status === "error" ? "x" : null })
const ns = (rows: RunRow[]) => { const x = nextStep(rows); return x.kind === "run" ? `${x.step}${x.continuation ? "+" : ""}` : x.kind }
ok("nothing yet: Google Jobs", ns([]) === "google_jobs")
ok("ATS rows do not count as tick steps", ns([row("ats_grnhse", "ok"), row("ats_smartrecruiters", "ok")]) === "google_jobs")
ok("Google Jobs at its cap or failed is done for the night: enrich next", ns([row("google_jobs", "capped", { capReason: "cap" })]) === "enrich" && ns([row("google_jobs", "error")]) === "enrich")
ok("Google Jobs out of time: Google Jobs again", ns([row("google_jobs", "capped", { capReason: "deadline", deferred: 27 })]) === "google_jobs+")
ok("Google Jobs killed: Google Jobs again", ns([row("google_jobs", "capped", { capReason: "killed" })]) === "google_jobs+")
ok("match killed: match again", ns([row("google_jobs", "ok"), row("enrich", "ok"), row("match", "capped", { capReason: "killed" })]) === "match+")
ok("match done: the queue release next", ns([row("google_jobs", "ok"), row("enrich", "ok"), row("match", "ok")]) === "queue_release")
ok("queue release failed: not run again, link check next", ns([row("google_jobs", "ok"), row("enrich", "ok"), row("match", "ok"), row("queue_release", "error")]) === "link_check")
ok("queue release killed: not run again, link check next", ns([row("google_jobs", "ok"), row("enrich", "ok"), row("match", "ok"), row("queue_release", "capped", { capReason: "killed" })]) === "link_check")
ok("link check killed: not run again", ns([row("google_jobs", "ok"), row("enrich", "ok"), row("match", "ok"), row("queue_release", "ok"), row("link_check", "capped", { capReason: "killed" })]) === "done")
ok("a running ATS sweep does not hold up the ticks", ns([row("ats_smartrecruiters", "running")]) === "google_jobs")
ok("enrich out of time: enrich again", ns([row("google_jobs", "ok"), row("enrich", "capped", { capReason: "deadline" })]) === "enrich+")
ok("enrich at its cap: match next", ns([row("google_jobs", "ok"), row("enrich", "capped", { capReason: "cap" })]) === "match")
ok("a running row: busy", ns([row("google_jobs", "ok"), row("enrich", "running")]) === "busy")
const many = [row("google_jobs", "ok"), ...Array.from({ length: MAX_CONTINUATIONS + 1 }, () => row("enrich", "capped", { capReason: "deadline" }))]
ok("continuations stop after MAX_CONTINUATIONS: match next", ns(many) === "match")
ok("all five done: done", ns([row("google_jobs", "ok"), row("enrich", "ok"), row("match", "ok"), row("queue_release", "ok"), row("link_check", "ok")]) === "done")

// ---- closing a killed run
{
  const updates: any[] = []
  const fakeSb: any = { from: () => ({ update: (u: any) => ({ eq: async () => { updates.push(u); return { error: null } } }) }) }
  const now = Date.parse("2026-10-30T05:20:00Z")
  const killed = { ...row("google_jobs", "running", { pairsDone: ["p1"] }), started_at: "2026-10-30T05:00:33Z" }
  const sr = { ...row("ats_smartrecruiters", "running"), started_at: "2026-10-30T04:30:06Z" }
  const fresh = { ...row("enrich", "running"), started_at: new Date(now - STALE_RUNNING_MS + 60_000).toISOString() }
  ;(async () => {
    const closed = await closeStale(fakeSb, [killed, sr, fresh], now, TICK_STEPS)
    ok("closeStale: only stale rows of the steps given (not the ATS row, not a fresh one)", closed.length === 1 && closed[0] === killed)
    ok("closeStale: killed is capped, not an error, with its progress kept", updates[0]?.status === "capped" && updates[0]?.error === null && updates[0]?.detail.capReason === "killed" && updates[0]?.detail.pairsDone[0] === "p1")
    ok("closeStale: and the next tick runs it again", ns([killed]) === "google_jobs+")
  })()
}

// ---- watchdog
const w = watchdogFindings([row("ats_grnhse", "ok"), row("google_jobs", "error"), row("enrich", "ok"), row("match", "capped", { capReason: "deadline", deferred: 812 }), row("link_check", "running")])
ok("watchdog: a missing step is skipped", w.some((f) => f.startsWith("ats_smartrecruiters: skipped")))
ok("watchdog: out of time with work left is reported", w.some((f) => f.startsWith("match: ran out of time") && f.includes("812")))
ok("watchdog: still running is reported", w.some((f) => f.startsWith("link_check: still running")))
ok("watchdog: a failure is not repeated (the tick sent it); a missing queue release is skipped", !w.some((f) => f.startsWith("google_jobs")) && w.some((f) => f.startsWith("queue_release: skipped")) && w.length === 4)
const w2 = watchdogFindings([row("ats_grnhse", "ok"), row("ats_smartrecruiters", "capped", { capReason: "deadline", pairsLeft: 4 }), row("google_jobs", "capped", { capReason: "killed" }), row("enrich", "ok"), row("match", "ok"), row("queue_release", "ok"), row("link_check", "ok")])
ok("watchdog: an ATS sweep with pairs left is reported", w2.some((f) => f.startsWith("ats_smartrecruiters: ran out of time") && f.includes("4")))
ok("watchdog: a killed step left that way is reported as killed", w2.some((f) => f.startsWith("google_jobs: was killed at the time limit")))

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
  match: { cost: 0.51, units: 3000, searches: 0, runs: 8 }, queue_release: { cost: 0, units: 96, searches: 0, runs: 7 }, link_check: { cost: 0, units: 1680, searches: 0, runs: 7 } } as StepTotals
const text = weeklyReportText({ weekFrom: "2026-10-26", weekTo: "2026-11-01", steps, weekAi: { enrichNightly: 3.45, matchNightly: 0.51, enrichManual: 1.2, matchManual: 0.4, total: 5.56 },
  mtd: 61.2, projected: 101.4, budget: 110, fee: 40, month: "2026-11", account: acct, searchesProjected: 9600, searchError: null })
ok("weekly email: every step, manual runs, MTD, projection and searches", ["Google Jobs", "Enrichment", "Matching", "Link check", "Greenhouse sweep", "Manual runs", "$1.60",
  "Month to date (2026-11): $61.20", "Projected for 2026-11: $101.40 (limit $110)", "3000 of 10000 searches", "on pace for 9600"].every((s) => text.includes(s)))
ok("weekly email: no OVER flag under the limits", !text.includes("OVER"))

// ---- weekly coverage by client
const wkFrom = new Date("2026-10-26T04:00:00Z"), wkTo = new Date("2026-11-02T05:00:00Z")
const cvRows = coverageRows(
  [{ id: "sami", name: "Sami", targetRoles: ["Business Analyst", "consulting analyst"] }, { id: "cole", name: "Cole", targetRoles: ["concierge"] }, { id: "new", name: "New", targetRoles: ["paralegal"] }],
  [{ id: "p1", title: "business analyst" }, { id: "p2", title: "consulting analyst" }, { id: "p3", title: "concierge" }],
  [
    { pair_id: "p1", started_at: "2026-10-28T03:30:00Z" }, // night of Oct 27 ET
    { pair_id: "p2", started_at: "2026-10-29T04:30:00Z" }, // Oct 29 ET
    { pair_id: "p1", started_at: "2026-10-29T05:10:00Z" }, // Oct 29 ET, same night
    { pair_id: "p1", started_at: "2026-10-31T03:00:00Z" }, // Oct 30 ET
    { pair_id: "p3", started_at: "2026-10-20T04:00:00Z" }, // before the week
  ], wkFrom, wkTo, new Map<string, number | null>([["sami", 3], ["cole", null], ["new", 0]]))
const samiRow = cvRows.find((r) => r.name === "Sami")!, coleRow = cvRows.find((r) => r.name === "Cole")!, newRow = cvRows.find((r) => r.name === "New")!
ok("coverage: searches and distinct ET nights in the week", samiRow.searches === 4 && samiRow.nightsSearched === 3 && samiRow.pairs === 2)
ok("coverage: longest wait is the stalest pair at week end", Math.abs(samiRow.longestWaitDays! - (wkTo.getTime() - new Date("2026-10-29T04:30:00Z").getTime()) / 86400e3) < 1e-9)
ok("coverage: a client not searched all week: 0 nights, wait from the earlier search, listed first", coleRow.nightsSearched === 0 && coleRow.longestWaitDays! > 12 && cvRows[2].name === "Sami")
ok("coverage: a client whose roles have no pairs", newRow.pairs === 0 && newRow.searches === 0)
const cvText = weeklyReportText({ weekFrom: "2026-10-26", weekTo: "2026-11-01", steps, weekAi: { enrichNightly: 3.45, matchNightly: 0.51, enrichManual: 1.2, matchManual: 0.4, total: 5.56 },
  mtd: 61.2, projected: 101.4, budget: 110, fee: 40, month: "2026-11", account: acct, searchesProjected: 9600, searchError: null,
  coverage: { rows: cvRows, cap: 300, clients: 12, nights: 7 },
  queue: { rows: queueRows([
    { clients: { sami: { released: 8, deadline: 1, expired: 3, belowFloor: 40 }, cole: { released: 2, deadline: 0, expired: 0, belowFloor: 5 } } },
    { clients: { sami: { released: 8, deadline: 0, expired: 4, belowFloor: 35 }, gone: { released: 8, deadline: 0, expired: 0, belowFloor: 1 } } },
  ], [{ id: "sami", name: "Sami" }, { id: "cole", name: "Cole" }, { id: "new", name: "New" }]), settings: queueSettings({}), nightsRun: 2, nights: 7 } })
ok("weekly email: coverage section with the share, misses, no pairs, projected waits", ["Search coverage by client", "Each client's share each night: 25.0 searches (cap 300 across 12 active clients)", "MISSED 7 nights", "NO PAIRS", "searched 3 of 7 nights", "projected longest wait 3.0 days", "projected: a pair never searched"].every((x) => cvText.includes(x)))
ok("weekly email: queue section per client: shown, expired, below floor, with totals", ["Job Queue by client (2 of 7 nightly releases ran; floor 60, 8 a night, expire after 7 nights, deadline rule at 50+)",
  "Sami                   shown  16, expired    7, below floor    75  (1 shown early for a deadline)", "New                    shown   0, expired    0, below floor     0",
  "All clients            shown  18, expired    7, below floor    80"].every((x) => cvText.includes(x)))
ok("weekly email: a client no longer active is left out of the queue section", !cvText.includes("gone"))
ok("weekly email: no queue section when none is given", !text.includes("Job Queue by client"))

// ---- queue release
ok("queue settings: defaults 60 / 8 / 7 / 50", JSON.stringify(queueSettings({})) === JSON.stringify({ floor: 60, limit: 8, expireNights: 7, deadlineMin: 50 }))
ok("queue settings: from the environment; junk falls back", JSON.stringify(queueSettings({ PIPELINE_QUEUE_FLOOR: "55", PIPELINE_QUEUE_LIMIT: "10", PIPELINE_QUEUE_EXPIRE_NIGHTS: "x", PIPELINE_QUEUE_DEADLINE_MIN: "0" })) === JSON.stringify({ floor: 55, limit: 10, expireNights: 7, deadlineMin: 50 }))
const bc = byClient({ released: { a: { released: 8, deadline: 2 } }, expired: { a: 3, b: 1 }, below_floor: { c: 40 } })
ok("release result per client: every client that had anything, zeros filled", bc.a.released === 8 && bc.a.deadline === 2 && bc.a.expired === 3 && bc.b.released === 0 && bc.b.expired === 1 && bc.c.belowFloor === 40)
ok("weekly email: no coverage section when none is given", !text.includes("Search coverage"))

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
