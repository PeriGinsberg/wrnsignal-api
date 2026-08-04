// Run: npx tsx app/dashboard/tracker/applicationOrder.test.ts
//
// A tsx script with hand-rolled assertions, not a vitest file. `vitest.config.ts`
// scopes `include` to *.test.tsx (components); pure logic runs under
// `npm run test:engine`, which globs *.test.ts. Same convention as
// contactOrder.test.ts and dashboardState.test.ts.

import {
  needOf, needRank, sortForNeed, daysSinceApplied, FOLLOW_UP_AFTER_DAYS,
  type TrackedApp,
} from "./applicationOrder"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const NOW = new Date("2026-08-04T10:00:00Z")
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString()
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString()

function app(over: Partial<TrackedApp> & { id: string }): TrackedApp {
  return {
    application_status: "saved",
    applied_date: null,
    created_at: daysAgo(1),
    ...over,
  }
}

console.log("\ndaysSinceApplied")
ok("uses applied_date when present",
  daysSinceApplied(app({ id: "a", applied_date: daysAgo(20), created_at: daysAgo(2) }), NOW) === 20)
ok("falls back to created_at when applied_date is blank",
  daysSinceApplied(app({ id: "a", applied_date: null, created_at: daysAgo(9) }), NOW) === 9)
ok("counts whole days, so this morning is 0",
  daysSinceApplied(app({ id: "a", applied_date: NOW.toISOString() }), NOW) === 0)

console.log("\nneedOf")
ok("saved wants an apply",
  needOf(app({ id: "a", application_status: "saved" }), null, NOW) === "apply")
ok("applied yesterday wants nothing",
  needOf(app({ id: "a", application_status: "applied", applied_date: daysAgo(1) }), null, NOW) === "none")
ok(`applied ${FOLLOW_UP_AFTER_DAYS} days ago wants a follow-up`,
  needOf(app({ id: "a", application_status: "applied", applied_date: daysAgo(FOLLOW_UP_AFTER_DAYS) }), null, NOW) === "followup")
ok("one day under the threshold still wants nothing",
  needOf(app({ id: "a", application_status: "applied", applied_date: daysAgo(FOLLOW_UP_AFTER_DAYS - 1) }), null, NOW) === "none")
ok("an interview ahead wants prep",
  needOf(app({ id: "a", application_status: "interviewing" }), daysAhead(3), NOW) === "prep")
ok("an interview TODAY still wants prep",
  needOf(app({ id: "a", application_status: "interviewing" }), NOW.toISOString(), NOW) === "prep")
ok("a past interview does not want prep",
  needOf(app({ id: "a", application_status: "interviewing" }), daysAgo(2), NOW) === "none")
ok("a dated interview outranks a stale applied status",
  needOf(app({ id: "a", application_status: "applied", applied_date: daysAgo(40) }), daysAhead(2), NOW) === "prep")
ok("offer wants nothing: it is waiting on them",
  needOf(app({ id: "a", application_status: "offer" }), null, NOW) === "none")
ok("rejected wants nothing even with a stale date",
  needOf(app({ id: "a", application_status: "rejected", applied_date: daysAgo(90) }), null, NOW) === "none")
ok("a closed job never wants prep, even with an interview on the books",
  needOf(app({ id: "a", application_status: "withdrawn" }), daysAhead(3), NOW) === "none")
ok("an unparseable interview date does not crash into prep",
  needOf(app({ id: "a", application_status: "interviewing" }), "not-a-date", NOW) === "none")

console.log("\nneedRank")
ok("upcoming interview ranks first",
  needRank(app({ id: "a", application_status: "interviewing" }), daysAhead(2), NOW) === 0)
ok("stale applied ranks second",
  needRank(app({ id: "a", application_status: "applied", applied_date: daysAgo(30) }), null, NOW) === 1)
ok("interviewing with no date ranks third",
  needRank(app({ id: "a", application_status: "interviewing" }), null, NOW) === 2)
ok("offer ranks below follow-up: it waits on them, not on the student",
  needRank(app({ id: "a", application_status: "offer" }), null, NOW) === 3)
ok("saved ranks below offer",
  needRank(app({ id: "a", application_status: "saved" }), null, NOW) === 4)
ok("recently applied ranks below saved",
  needRank(app({ id: "a", application_status: "applied", applied_date: daysAgo(2) }), null, NOW) === 5)
ok("closed ranks last",
  needRank(app({ id: "a", application_status: "rejected" }), null, NOW) === 6)

console.log("\nsortForNeed")
{
  const rows = [
    app({ id: "closed", application_status: "rejected" }),
    app({ id: "fresh", application_status: "applied", applied_date: daysAgo(2) }),
    app({ id: "saved", application_status: "saved" }),
    app({ id: "offer", application_status: "offer" }),
    app({ id: "stale", application_status: "applied", applied_date: daysAgo(30) }),
    app({ id: "interview", application_status: "interviewing" }),
  ]
  const order = sortForNeed(rows, (a) => (a.id === "interview" ? daysAhead(3) : null), NOW).map((a) => a.id)
  ok("orders interview, follow-up, offer, saved, waiting, closed",
    JSON.stringify(order) === JSON.stringify(["interview", "stale", "offer", "saved", "fresh", "closed"]))
}
{
  // Three jobs, all equally idle. Server order must survive untouched.
  const rows = [app({ id: "first" }), app({ id: "second" }), app({ id: "third" })]
  const order = sortForNeed(rows, () => null, NOW).map((a) => a.id)
  ok("is stable within a band, so equal cards keep the server's order",
    JSON.stringify(order) === JSON.stringify(["first", "second", "third"]))
}
{
  const rows = [app({ id: "a" })]
  const sorted = sortForNeed(rows, () => null, NOW)
  ok("does not mutate the input array", rows[0].id === "a" && sorted !== rows)
}
ok("an empty list is an empty list", sortForNeed([], () => null, NOW).length === 0)

console.log(failures === 0 ? "\nall applicationOrder assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
