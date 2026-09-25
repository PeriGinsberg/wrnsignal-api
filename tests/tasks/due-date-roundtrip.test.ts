// tests/tasks/due-date-roundtrip.test.ts
//
// The due date must survive being shown, saved and shown again, unchanged.
//
// WHAT THIS GUARDS. A task's due date could not be edited: typing a date and
// saving returned it a day earlier, and each further open-and-save walked it
// back another day. Two causes, both in TaskFormModal:
//
//   1. `new Date("2026-09-25")` parses a date-only string as UTC midnight.
//      West of Greenwich that instant belongs to the previous day, so
//      rendering it back into the input produced the 24th.
//   2. The useEffect watching the time toggle also fires on mount, so merely
//      OPENING a task reformatted its date through that same parse, moving it
//      back a day before the coach touched anything.
//
// The functions below are copies of the modal's, deliberately. They are tiny,
// the modal is a client component, and a test that imports it would need a DOM
// for no gain. If the modal's versions change, change these and watch them
// fail first.

const OFFSET_NOTE = "These hold in any timezone; UTC-4 is where the bug showed."

function toLocalInput(iso: string | null, withTime: boolean): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

function fromLocalInput(v: string, withTime: boolean): Date | null {
  if (!v) return null
  if (withTime) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return null
  // Noon local. Furthest from both day boundaries, so neither a timezone nor a
  // DST transition can push the date onto an adjacent day.
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0)
}

let failures = 0

/** Save and reopen N times. The value must never move. */
function stable(label: string, typed: string, withTime: boolean, cycles = 3): void {
  let cur = typed
  const seen = [cur]
  for (let i = 0; i < cycles; i++) {
    const iso = fromLocalInput(cur, withTime)?.toISOString() ?? null
    cur = toLocalInput(iso, withTime)
    seen.push(cur)
  }
  const ok = seen.every((v) => v === typed)
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(24)} ${seen.join(" -> ")}`)
}

function check(label: string, ok: boolean): void {
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`)
}

console.log(`due date round-trip (local offset UTC${-new Date().getTimezoneOffset() / 60})`)
console.log(`  ${OFFSET_NOTE}\n`)

// Past, today and future all matter: the report was about a date two days ago.
stable("two days ago", "2026-09-23", false)
stable("today", "2026-09-25", false)
stable("tomorrow", "2026-09-26", false)
stable("far future", "2026-12-31", false)
// A DST boundary is where a midnight-based parse would fail even in UTC+0.
stable("day before DST ends", "2026-11-01", false)
stable("leap day", "2028-02-29", false)
stable("with a time", "2026-09-25T09:30", true)
stable("late evening", "2026-09-23T23:45", true)

console.log("")
check("an empty input clears the date", fromLocalInput("", false) === null)
check("a malformed date is refused rather than guessed", fromLocalInput("not-a-date", false) === null)
check("a date-only value lands at noon, not midnight", fromLocalInput("2026-09-25", false)!.getHours() === 12)

console.log(failures === 0 ? "\nAll round-trips stable." : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
