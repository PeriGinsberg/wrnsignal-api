#!/usr/bin/env tsx
// Relative time in the student register. tsx-script convention (pure logic),
// same as dashboardMetrics.test.ts.
//
// The boundaries are the point: "yesterday" has to mean the previous CALENDAR
// day, not 24 hours, or something logged at 9pm reads "today" at 8am the next
// morning and the student cannot tell whether they already followed up.

import { timeAgo } from "./relativeTime"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) } else { fail++; console.error(`✗ ${label}`) }
}
function eq(label: string, got: unknown, want: unknown) {
  ok(`${label} (got ${JSON.stringify(got)})`, got === want)
}

// A Tuesday afternoon.
const NOW = new Date(2026, 7, 4, 14, 0, 0)
const at = (dayOffset: number, hour = 14) => new Date(2026, 7, 4 + dayOffset, hour, 0, 0).toISOString()

eq("no timestamp returns null, not an empty string", timeAgo(null, NOW), null)
eq("undefined returns null", timeAgo(undefined, NOW), null)
eq("garbage returns null", timeAgo("not-a-date", NOW), null)

eq("seconds ago", timeAgo(new Date(NOW.getTime() - 5_000).toISOString(), NOW), "just now")
eq("this morning reads in hours", timeAgo(at(0, 9), NOW), "5 hours ago")
eq("one hour is singular", timeAgo(at(0, 13), NOW), "an hour ago")

eq("yesterday", timeAgo(at(-1), NOW), "yesterday")
eq("three days", timeAgo(at(-3), NOW), "3 days ago")
eq("six days", timeAgo(at(-6), NOW), "6 days ago")

eq("seven days is a week", timeAgo(at(-7), NOW), "a week ago")
eq("two weeks", timeAgo(at(-14), NOW), "2 weeks ago")
eq("a month", timeAgo(at(-31), NOW), "a month ago")
eq("several months", timeAgo(at(-90), NOW), "3 months ago")
eq("a year", timeAgo(at(-400), NOW), "a year ago")

// The boundary that matters: 9pm yesterday is "yesterday" at 8am, even though
// it is only 11 hours earlier.
const lateLastNight = new Date(2026, 7, 3, 21, 0, 0).toISOString()
const earlyToday = new Date(2026, 7, 4, 8, 0, 0)
eq("last night reads as yesterday, not today", timeAgo(lateLastNight, earlyToday), "yesterday")

// A future timestamp must never render as negative days.
eq("a future date does not go negative", timeAgo(at(3), NOW), "just now")

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
