// Run: npx tsx lib/localDate.test.ts
//
// The regression these assertions lock down only reproduces west of UTC, which
// is why it survived in the old tracker: it is invisible in a UTC CI container
// and obvious on a laptop in New York. So the date-only cases assert on the
// CALENDAR FIELDS of the parsed value rather than on a formatted string, which
// makes them true in every zone.

import { parseLocalDate, daysSince, daysUntil, formatShort, startOfDay } from "./localDate"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

console.log("\nparseLocalDate")
{
  const d = parseLocalDate("2026-08-07")!
  ok("a date-only string keeps its calendar day", d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 7)
  ok("a date-only string lands on local midnight", d.getHours() === 0 && d.getMinutes() === 0)
  // The bug, stated directly: the naive parse is UTC midnight, so in any
  // negative-offset zone getDate() comes back as the 6th.
  const naive = new Date("2026-08-07")
  ok("and it differs from the naive parse exactly when the zone is behind UTC",
    (new Date().getTimezoneOffset() > 0) === (naive.getDate() !== d.getDate()))
}
ok("a full timestamp is left to the normal parser",
  parseLocalDate("2026-08-07T15:30:00Z")!.getTime() === new Date("2026-08-07T15:30:00Z").getTime())
ok("null is null", parseLocalDate(null) === null)
ok("an empty string is null", parseLocalDate("") === null)
ok("garbage is null, not an Invalid Date", parseLocalDate("not-a-date") === null)

console.log("\ndaysSince / daysUntil")
{
  const now = new Date(2026, 7, 4, 10, 0, 0) // Aug 4, local
  ok("counts a past date in whole days", daysSince("2026-07-21", now) === 14)
  ok("today is zero", daysSince("2026-08-04", now) === 0)
  ok("a future date is negative", daysSince("2026-08-07", now) === -3)
  ok("daysUntil is the mirror", daysUntil("2026-08-07", now) === 3)
  ok("daysUntil on today is zero", daysUntil("2026-08-04", now) === 0)
  ok("null input gives null", daysSince(null, now) === null)
  // Late in the evening, local, the answer must still be a calendar-day count
  // and not slip because the clock time crossed into UTC tomorrow.
  const evening = new Date(2026, 7, 4, 22, 30, 0)
  ok("a late-evening 'now' does not shift the day count", daysSince("2026-07-21", evening) === 14)
}

console.log("\nformatShort")
ok("formats the day that was stored, not the day before",
  formatShort("2026-08-07") === new Date(2026, 7, 7).toLocaleDateString("en-US", { month: "short", day: "numeric" }))
ok("an empty value formats to an empty string", formatShort(null) === "")

console.log("\nstartOfDay")
ok("collapses a time to local midnight",
  startOfDay(new Date(2026, 7, 4, 23, 59)) === new Date(2026, 7, 4).getTime())

console.log(failures === 0 ? "\nall localDate assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
