// Run: npx tsx app/dashboard/network/contacts/activityWindow.test.ts

import { inActivityWindow, ACTIVITY_LABELS, type ActivityWindow } from "./activityWindow"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const NOW = new Date("2026-09-02T12:00:00Z")
const ago = (days: number, hours = 0) =>
  new Date(NOW.getTime() - days * 86400000 - hours * 3600000).toISOString()

function main() {
  console.log("\nan unset filter matches everything")
  ok("dated", inActivityWindow(ago(400), "", NOW))
  ok("undated", inActivityWindow(null, "", NOW))

  console.log("\nnever")
  ok("null is never", inActivityWindow(null, "never", NOW))
  ok("undefined is never", inActivityWindow(undefined, "never", NOW))
  ok("empty string is never", inActivityWindow("", "never", NOW))
  ok("an unparseable date reads as never", inActivityWindow("not-a-date", "never", NOW))
  ok("a real date is not never", !inActivityWindow(ago(1), "never", NOW))

  console.log("\n7d")
  ok("today is in", inActivityWindow(ago(0), "7d", NOW))
  ok("6 days is in", inActivityWindow(ago(6), "7d", NOW))
  ok("exactly 7 days is in (inclusive)", inActivityWindow(ago(7), "7d", NOW))
  ok("7 days and an hour is out", !inActivityWindow(ago(7, 1), "7d", NOW))
  ok("never is not 'active this week'", !inActivityWindow(null, "7d", NOW))

  console.log("\n30d")
  ok("29 days is in", inActivityWindow(ago(29), "30d", NOW))
  ok("exactly 30 days is in", inActivityWindow(ago(30), "30d", NOW))
  ok("31 days is out", !inActivityWindow(ago(31), "30d", NOW))
  ok("a recent contact is in both 7d and 30d", inActivityWindow(ago(3), "30d", NOW))

  console.log("\nstale30, and its boundary with 30d")
  ok("31 days is stale", inActivityWindow(ago(31), "stale30", NOW))
  ok("exactly 30 days is NOT stale", !inActivityWindow(ago(30), "stale30", NOW))
  ok("30d and stale30 never both match", (() => {
    for (const d of [0, 1, 29, 30, 31, 400]) {
      const at = ago(d)
      if (inActivityWindow(at, "30d", NOW) && inActivityWindow(at, "stale30", NOW)) return false
    }
    return true
  })())
  ok("never is NOT stale30 (it has its own bucket)", !inActivityWindow(null, "stale30", NOW))

  console.log("\nevery bucket has a label")
  const keys: Exclude<ActivityWindow, "">[] = ["7d", "30d", "stale30", "never"]
  ok("labels cover the buckets", keys.every((k) => typeof ACTIVITY_LABELS[k] === "string" && ACTIVITY_LABELS[k].length > 0))

  console.log("\na future date (backdating, clock skew) counts as recent")
  ok("tomorrow is within 7d", inActivityWindow(ago(-1), "7d", NOW))
  ok("...and is not stale", !inActivityWindow(ago(-1), "stale30", NOW))
}

main()
console.log(failures === 0 ? "\nall activityWindow assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
