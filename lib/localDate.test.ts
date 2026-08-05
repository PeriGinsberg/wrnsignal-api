// Run: npx tsx lib/localDate.test.ts
//
// The regression these assertions lock down only reproduces west of UTC, which
// is why it survived in the old tracker: it is invisible in a UTC CI container
// and obvious on a laptop in New York. So the date-only cases assert on the
// CALENDAR FIELDS of the parsed value rather than on a formatted string, which
// makes them true in every zone.

import { parseLocalDate, daysSince, daysUntil, formatShort, startOfDay, composeLocalInstant, splitLocalInstant } from "./localDate"

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

console.log("\ncomposeLocalInstant")
{
  // Asserted against the LOCAL constructor rather than a hardcoded UTC string,
  // so these hold in every timezone rather than only in mine.
  const iso = composeLocalInstant("2026-08-07", "14:00")!
  ok("an afternoon time becomes the instant it names locally",
    iso === new Date(2026, 7, 7, 14, 0, 0, 0).toISOString())
  ok("it round-trips back through splitLocalInstant",
    JSON.stringify(splitLocalInstant(iso)) === JSON.stringify({ date: "2026-08-07", time: "14:00" }))
  ok("midnight is representable when explicitly given",
    composeLocalInstant("2026-08-07", "00:00") === new Date(2026, 7, 7, 0, 0, 0, 0).toISOString())
  ok("seconds in the time field are accepted",
    composeLocalInstant("2026-08-07", "14:00:00") === new Date(2026, 7, 7, 14, 0, 0, 0).toISOString())

  // THE RULE: never guess an instant from a date alone.
  ok("date with no time is null, NOT midnight", composeLocalInstant("2026-08-07", "") === null)
  ok("date with null time is null", composeLocalInstant("2026-08-07", null) === null)
  ok("time with no date is null", composeLocalInstant("", "14:00") === null)
  ok("both absent is null", composeLocalInstant(null, null) === null)

  ok("garbage date is null", composeLocalInstant("not-a-date", "14:00") === null)
  ok("garbage time is null", composeLocalInstant("2026-08-07", "half two") === null)
  ok("a 25th hour is rejected", composeLocalInstant("2026-08-07", "25:00") === null)
  ok("a 60th minute is rejected", composeLocalInstant("2026-08-07", "12:60") === null)
  ok("month 13 is rejected", composeLocalInstant("2026-13-01", "12:00") === null)
  // The Date constructor silently rolls Feb 31 into March. Caught, not stored.
  ok("Feb 31 is rejected rather than rolled into March",
    composeLocalInstant("2026-02-31", "12:00") === null)

  // DST. In US zones the spring-forward gap is 02:00–03:00 on the second
  // Sunday in March; the autumn fallback repeats 01:00–02:00 in November.
  // Neither may produce a NaN or a wrong calendar day.
  const springGap = composeLocalInstant("2026-03-08", "02:30")
  ok("a spring-forward gap time still yields a valid instant", springGap !== null && !Number.isNaN(Date.parse(springGap)))
  const fallBack = composeLocalInstant("2026-11-01", "01:30")
  ok("an autumn fallback repeated hour still yields a valid instant", fallBack !== null && !Number.isNaN(Date.parse(fallBack)))
  ok("a DST-boundary instant keeps its calendar day when split back",
    splitLocalInstant(fallBack)!.date === "2026-11-01")
  ok("the day AFTER a spring-forward is unaffected",
    splitLocalInstant(composeLocalInstant("2026-03-09", "09:00")!)!.date === "2026-03-09")
}

console.log("\nsplitLocalInstant")
ok("null in, null out", splitLocalInstant(null) === null)
ok("garbage in, null out", splitLocalInstant("not-a-date") === null)
ok("a date-only value splits at local midnight",
  JSON.stringify(splitLocalInstant("2026-08-07")) === JSON.stringify({ date: "2026-08-07", time: "00:00" }))
ok("single-digit hours and months are zero-padded",
  JSON.stringify(splitLocalInstant(new Date(2026, 0, 5, 9, 5).toISOString()))
    === JSON.stringify({ date: "2026-01-05", time: "09:05" }))

console.log(failures === 0 ? "\nall localDate assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
