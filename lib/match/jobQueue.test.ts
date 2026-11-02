// Run: npx tsx lib/match/jobQueue.test.ts
//
// Job Queue grouping (lib/match/jobQueue.ts buildJobs) and the weekly job's
// pure parts (lib/match/weekly.ts), offline.

import { buildJobs, type QueueRow } from "./jobQueue"
import { lastWeek, measureWeek, snapshotExamples } from "./weekly"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

let n = 0
const row = (posting: string, client: string, score: number | null, extra: Partial<QueueRow> = {}): QueueRow => ({
  match_id: `m${++n}`, client_profile_id: client, posting_id: posting, score, judge_reason: `r${n}`, rank: n, first_queued_at: `2026-10-${10 + n}T00:00:00Z`,
  source: "searchapi", raw_title: "U.S. Private Bank – Program Analyst", title: "U.S. Private Bank – Program Analyst", company: "JPMorgan Chase & Co.",
  location: "Miami, FL", apply_url: `https://x/${posting}`, apply_link_kind: "republisher", republished_only: true, link_check_status: null,
  likely_closed: false, years_min: 0, years_max: null, years_basis: null, salary_low: null, salary_high: null, salary_period: null,
  start_label: "start not stated", application_deadline: null, requirements_summary: null, first_seen_at: "2026-10-20T00:00:00Z",
  tier_label: "now or not stated", campus_signal: true, action: null, coach_flag: null, coach_apply_url: null, bad_link: false, ...extra,
})

// Sami's JPMorgan job: three listings, two of them scored for her (58, 38); Gabe has one.
const jobs = buildJobs([
  row("pA", "sami", 58),
  row("pB", "sami", 38, { raw_title: "U.S. Private Bank - Program Analyst at JPMorgan Chase & Co. Miami, FL", title: "U.S. Private Bank - Program Analyst", apply_link_kind: "employer" }),
  row("pC", "gabe", 44, { company: "JPMorganChase" }),
  row("pD", "sami", 70, { raw_title: "Financial Analyst", title: "Financial Analyst", company: "Acme" }),
])
ok("two jobs", jobs.length === 2)
const jp = jobs.find((j) => j.co.startsWith("JPMorgan"))!
ok("JPMorgan copies are one job with 3 listings", jp.ls?.length === 3 && jp.postingIds.length === 3)
ok("the employer link is the job's link", jp.lk === "employer" && jp.url === "https://x/pB")
const sami = jp.m.find((c) => c.c === "sami")!
ok("Sami's chip: best score 58, both scores kept, both match ids", sami.s === 58 && sami.all?.join(",") === "58,38" && sami.ids.length === 2)
ok("chips best first", jp.m[0].c === "sami" && jp.m[1].c === "gabe")
ok("jobs sorted by best score", jobs[0].co === "Acme")

const decided = buildJobs([
  row("pA", "sami", 58),
  row("pB", "sami", 38, { action: "dismiss", dismiss_reason: "wrong_function", actioned_at: "2026-10-30T00:00:00Z" }),
])
ok("a decision on one copy is the chip's decision", decided[0].m[0].status === "not_fit" && decided[0].m[0].reason === "wrong_function")

const evaluating = buildJobs([row("pA", "sami", 58, { action: "evaluating" })])
ok("evaluating shows as evaluating", evaluating[0].m[0].status === "evaluating")

const stores = buildJobs([
  row("s1", "sami", 50, { raw_title: "Delivery Driver 03177", title: "Delivery Driver", company: "Domino's" }),
  row("s2", "sami", 50, { raw_title: "Delivery Driver 05179", title: "Delivery Driver", company: "Domino's" }),
])
ok("store numbers keep two stores apart", stores.length === 2)

// Weekly
const w = lastWeek(new Date("2026-11-04T15:00:00Z")) // a Wednesday
ok("last week starts the Monday before last", w.weekOf === "2026-10-26" && w.end.toISOString().startsWith("2026-11-02"))
const d = (id: string, action: "push" | "dismiss", title: string, at: string, rank: number, extra: any = {}) =>
  ({ id, action, dismiss_reason: action === "dismiss" ? "wrong_function" : null, note: null, actioned_at: at, rank_at_action: rank, queue_size_at_action: 100, criteria_hash: "h", postings: { title, cleaned_title: null, company: "Acme" }, ...extra })
const ds = [
  d("1", "push", "Analyst", "2026-10-27T00:00:00Z", 3),
  d("2", "push", "Analyst", "2026-10-27T00:00:00Z", 9), // a copy of the same job
  d("3", "dismiss", "Sales Rep", "2026-10-28T00:00:00Z", 15),
  d("4", "dismiss", "Account Exec", "2026-10-29T00:00:00Z", 41),
]
const m = measureWeek(ds as any)
ok("copies count once: 1 fit, 2 not a fit", m.fits === 1 && m.not_fits === 2)
ok("fit at its best rank: top 20, percentile 0.02", m.top20_fits === 1 && m.fit_median_rank_pct === 0.02)
ok("not a fit: one in the top 20", m.top20_not_fits === 1 && m.reasons.wrong_function === 2)
const ex = snapshotExamples(ds as any)
ok("examples one per job, fits first, newest first within each", ex.length === 3 && ex[0].title === "Analyst" && ex[1].title === "Account Exec")

console.log(failures ? `\n${failures} FAILED` : "\nall passed")
process.exit(failures ? 1 : 0)
