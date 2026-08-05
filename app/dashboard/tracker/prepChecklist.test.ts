// Run: npx tsx app/dashboard/tracker/prepChecklist.test.ts
//
// tsx script with hand-rolled assertions, not vitest — vitest.config.ts scopes
// `include` to *.test.tsx. Same convention as applicationOrder.test.ts.

import {
  PREP_ITEMS, itemsFor, groupedItems, isImminent, scheduledAt,
  isChecked, progressFor, safeState,
  slotsFor, isSlotDone, liveGroup, groupState, orderedGroups,
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

console.log("\nslotsFor — the either-or fix")
{
  const unknown = slotsFor(null)
  const known = slotsFor("virtual")
  ok("unknown format folds the two branch items into ONE slot",
    unknown.length === PREP_ITEMS.length - 1)
  ok("a known format gives one slot per item", known.length === itemsFor("virtual").length)
  const pair = unknown.find((s) => s.itemIds.length > 1)!
  ok("the folded slot holds exactly the two branch items",
    pair && pair.itemIds.slice().sort().join(",") === "before_route,before_tech")
  ok("the folded slot belongs to day_before", pair.group === "day_before")
  ok("the folded slot keeps its position in the sequence",
    unknown.findIndex((s) => s.id === pair.id) === unknown.findIndex((s) => s.id === "before_outfit") + 1)
  ok("no item is lost — every non-branch item still has its own slot",
    PREP_ITEMS.filter((i) => !i.onlyFor).every((i) => unknown.some((s) => s.id === i.id)))
}

console.log("\nthe day_before completion trap")
{
  // The bug: four visible items, two mutually exclusive, so the group could
  // never be completed and the total could never be reached.
  const tickAll: Record<string, boolean> = {}
  for (const i of itemsFor(null)) tickAll[i.id] = true
  ok("ticking every visible item completes the group",
    groupState("day_before", tickAll, null, day(3)) === "complete")

  const routeOnly = { before_connect: true, before_outfit: true, before_route: true }
  ok("ticking the IN-PERSON branch alone completes day_before",
    groupState("day_before", routeOnly, null, day(3)) === "complete")
  const techOnly = { before_connect: true, before_outfit: true, before_tech: true }
  ok("ticking the VIRTUAL branch alone completes day_before",
    groupState("day_before", techOnly, null, day(3)) === "complete")
  ok("neither branch ticked leaves it incomplete",
    groupState("day_before", { before_connect: true, before_outfit: true }, null, day(3)) !== "complete")

  ok("the total counts 8 slots, not 9 items", progressFor({}, null).total === PREP_ITEMS.length - 1)
  ok("one branch ticked advances the count by exactly one",
    progressFor({ before_route: true }, null).done === 1)
  ok("ticking BOTH branches still counts as one",
    progressFor({ before_route: true, before_tech: true }, null).done === 1)
  ok("a full tick-through reaches the total",
    progressFor(tickAll, null).done === progressFor(tickAll, null).total)
}

console.log("\nliveGroup")
ok("8 days out -> this_week", liveGroup(day(8), NOW) === "this_week")
ok("7 days out -> day_before (boundary is inclusive)", liveGroup(day(7), NOW) === "day_before")
ok("2 days out -> day_before", liveGroup(day(2), NOW) === "day_before")
ok("tomorrow -> day_of", liveGroup(day(1), NOW) === "day_of")
ok("today -> day_of", liveGroup(day(0), NOW) === "day_of")
ok("yesterday -> null, nothing needs you any more", liveGroup(day(-1), NOW) === null)
ok("no date -> this_week", liveGroup(null, NOW) === "this_week")

console.log("\ngroupState precedence")
{
  const weekDone = { week_research: true, week_find_interviewers: true, week_follow: true }
  ok("complete OUTRANKS live", groupState("this_week", weekDone, null, day(30), NOW) === "complete")
  ok("live when it is the live group and unfinished",
    groupState("this_week", {}, null, day(30), NOW) === "live")
  ok("receded when it is neither",
    groupState("day_of", {}, null, day(30), NOW) === "receded")
  ok("a past interview leaves an unfinished group receded, not live",
    groupState("day_of", {}, null, day(-2), NOW) === "receded")
  ok("a past interview still shows a finished group as complete",
    groupState("this_week", weekDone, null, day(-2), NOW) === "complete")
}

console.log("\norderedGroups")
ok("natural order when the interview is far off",
  JSON.stringify(orderedGroups(day(30), NOW)) === JSON.stringify(["this_week", "day_before", "day_of"]))
ok("day_of jumps to the front inside 24 hours",
  JSON.stringify(orderedGroups(day(1), NOW)) === JSON.stringify(["day_of", "this_week", "day_before"]))
ok("today reorders too",
  JSON.stringify(orderedGroups(day(0), NOW)) === JSON.stringify(["day_of", "this_week", "day_before"]))
ok("two days out does NOT reorder",
  JSON.stringify(orderedGroups(day(2), NOW)) === JSON.stringify(["this_week", "day_before", "day_of"]))
ok("reordering never drops or duplicates a group",
  new Set(orderedGroups(day(0), NOW)).size === 3 && new Set(orderedGroups(day(30), NOW)).size === 3)

console.log(failures === 0 ? "\nall prepChecklist assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
