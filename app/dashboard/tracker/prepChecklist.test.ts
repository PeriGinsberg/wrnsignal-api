// Run: npx tsx app/dashboard/tracker/prepChecklist.test.ts
//
// tsx script with hand-rolled assertions, not vitest — vitest.config.ts scopes
// `include` to *.test.tsx. Same convention as applicationOrder.test.ts.

import {
  PREP_ITEMS, itemsFor, groupedItems, isImminent, scheduledAt,
  isChecked, progressFor, safeState,
} from "./prepChecklist"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const NOW = new Date(2026, 7, 5, 10, 0, 0) // Aug 5, local
const day = (n: number) => {
  const d = new Date(NOW.getTime() + n * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

console.log("\nitem ids")
{
  const ids = PREP_ITEMS.map((i) => i.id)
  ok("every id is unique — they are persistence keys", new Set(ids).size === ids.length)
  ok("no id is a bare number, which would behave like an index", ids.every((i) => !/^\d+$/.test(i)))
}

console.log("\nitemsFor / format branching")
ok("in_person keeps the route item, drops the tech item",
  itemsFor("in_person").some((i) => i.id === "before_route") &&
  !itemsFor("in_person").some((i) => i.id === "before_tech"))
ok("virtual keeps the tech item, drops the route item",
  itemsFor("virtual").some((i) => i.id === "before_tech") &&
  !itemsFor("virtual").some((i) => i.id === "before_route"))
ok("null keeps BOTH branches", itemsFor(null).length === PREP_ITEMS.length)
ok("undefined behaves like null", itemsFor(undefined).length === PREP_ITEMS.length)
ok("an unknown format is treated as unknown, not as empty",
  itemsFor("carrier_pigeon").length === PREP_ITEMS.length)
ok("a known format is exactly one item shorter than unknown",
  itemsFor("virtual").length === PREP_ITEMS.length - 1)

console.log("\ngroupedItems")
{
  const g = groupedItems(null)
  ok("three groups, in when-order", JSON.stringify(g.map((x) => x.group)) === JSON.stringify(["this_week", "day_before", "day_of"]))
  ok("no group is empty", g.every((x) => x.items.length > 0))
  ok("every item lands in exactly one group",
    g.reduce((n, x) => n + x.items.length, 0) === PREP_ITEMS.length)
  ok("day_of has both spoken-answer items",
    g[2].items.map((i) => i.id).join(",") === "day_why_job,day_why_you")
}

console.log("\nisImminent")
ok("today is imminent", isImminent(day(0), NOW) === true)
ok("tomorrow is imminent", isImminent(day(1), NOW) === true)
ok("in two days is NOT imminent", isImminent(day(2), NOW) === false)
ok("yesterday is not imminent — it has passed", isImminent(day(-1), NOW) === false)
ok("null is not imminent", isImminent(null, NOW) === false)
ok("garbage is not imminent, and does not throw", isImminent("not-a-date", NOW) === false)
{
  // The bug this whole codebase keeps re-learning: a date-only string parsed as
  // UTC lands a day early west of UTC. Via localDate it must not.
  const evening = new Date(2026, 7, 5, 23, 30, 0)
  ok("a late-evening 'now' does not shift the day window", isImminent(day(1), evening) === true)
}

console.log("\nscheduledAt")
ok("prefers interview_at when present",
  scheduledAt({ interview_at: "2026-08-07T14:00:00Z", interview_date: "2026-08-09" }) === "2026-08-07T14:00:00Z")
ok("falls back to interview_date", scheduledAt({ interview_at: null, interview_date: "2026-08-09" }) === "2026-08-09")
ok("null when neither is set", scheduledAt({ interview_at: null, interview_date: null }) === null)

console.log("\nchecklist state")
ok("a ticked id reads as checked", isChecked({ week_follow: true }, "week_follow") === true)
ok("an absent id reads as unchecked", isChecked({}, "week_follow") === false)
ok("null state is all-unchecked", isChecked(null, "week_follow") === false)
{
  const p = progressFor({ week_follow: true, before_outfit: true }, "virtual")
  ok("progress counts only applicable items", p.total === PREP_ITEMS.length - 1 && p.done === 2)
}
ok("progress on empty state is 0 of total", progressFor({}, "in_person").done === 0)

console.log("\nsafeState")
ok("drops non-true values", JSON.stringify(safeState({ a: true, b: false, c: "yes", d: 1 })) === '{"a":true}')
ok("an array is not a state", JSON.stringify(safeState([1, 2])) === "{}")
ok("null is an empty state", JSON.stringify(safeState(null)) === "{}")
ok("a string is an empty state", JSON.stringify(safeState("nope")) === "{}")

console.log(failures === 0 ? "\nall prepChecklist assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
