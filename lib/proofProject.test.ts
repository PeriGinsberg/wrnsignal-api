#!/usr/bin/env tsx
// The Proof Project's derivations. tsx-script convention (pure logic), same as
// dashboardState.test.ts — vitest collects *.test.tsx only, deliberately.
//
// Run: npx tsx lib/proofProject.test.ts
//
// The rules worth pinning are the ones a reader would guess wrong: the unlock
// falls back when there is no coach step, the percentage refuses to round up to
// 100, the streak survives "nothing done yet today", and every date is parsed
// from parts so it cannot shift a day west of Greenwich.

import {
  computeStreak, daysUntil, finalDueDate, isSignedOff, monthGrid, nodeStates,
  progressOf, signOffActivity, wouldRelock,
  type ProofActivity, type ProofDeliverable,
} from "./proofProject"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) } else { fail++; console.error(`✗ ${label}`) }
}
function eq(label: string, got: unknown, want: unknown) {
  ok(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))
}

let seq = 0
function act(p: Partial<ProofActivity> = {}): ProofActivity {
  seq += 1
  return {
    id: `a${seq}`, name: `Activity ${seq}`, owner: "client", status: "not_started",
    due_date: null, sort_order: seq, created_at: `2026-01-0${(seq % 9) + 1}T00:00:00Z`,
    is_signoff: false,
    ...p,
  }
}
function deliv(activities: ProofActivity[], p: Partial<ProofDeliverable> = {}): ProofDeliverable {
  seq += 1
  return {
    id: `d${seq}`, name: `Deliverable ${seq}`, sort_order: seq,
    created_at: "2026-01-01T00:00:00Z", activities,
    speaking_point: null, has_speaking_point: false, why_this_matters: null,
    ...p,
  }
}

// ── The unlock rule ────────────────────────────────────────────────────────
console.log("\n— the unlock rule —")

{
  const activities = [
    act({ owner: "coach", status: "complete", sort_order: 1 }),
    act({ owner: "coach", status: "not_started", sort_order: 2, is_signoff: true }),
    act({ owner: "client", status: "complete", sort_order: 3 }),
  ]
  eq("waits for the FLAGGED task", signOffActivity(activities)?.sort_order, 2)
  ok("…so it is not signed off", isSignedOff(activities) === false)
}

{
  // The sign-off IS the proof. Unfinished work after it must not hold the
  // reward back.
  const activities = [
    act({ owner: "coach", status: "complete", sort_order: 2, is_signoff: true }),
    act({ owner: "client", status: "not_started", sort_order: 3 }),
  ]
  ok("unlocks on sign-off even with other work outstanding", isSignedOff(activities) === true)
}

// THE REASON THE FLAG EXISTS. Under the old positional rule, reordering moved
// the trigger. It must not any more.
{
  const flagged = act({ owner: "coach", status: "complete", sort_order: 1, is_signoff: true })
  const other = act({ owner: "coach", status: "not_started", sort_order: 2 })
  ok("REORDER cannot move the trigger: flagged first", isSignedOff([flagged, other]) === true)
  // Same two rows, order swapped. The old rule flipped here; this one does not.
  ok("…still true with the flagged task dragged to the end",
    isSignedOff([{ ...other, sort_order: 1 }, { ...flagged, sort_order: 9 }]) === true)
}

// ADDING work after the sign-off must not re-lock: the proof already happened.
{
  const signed = [act({ owner: "coach", status: "complete", is_signoff: true })]
  const plusNew = [...signed, act({ owner: "client", status: "not_started" })]
  ok("ADDING an activity after sign-off does not re-lock", isSignedOff(plusNew) === true)
}

{
  // Otherwise such a deliverable could never unlock, by anyone, ever.
  const partly = [act({ owner: "client", status: "complete" }), act({ owner: "client", status: "not_started" })]
  ok("nothing flagged → no sign-off activity", signOffActivity(partly) === null)
  ok("nothing flagged, partly done → locked", isSignedOff(partly) === false)
  const all = [act({ owner: "client", status: "complete" }), act({ owner: "both", status: "complete" })]
  ok("nothing flagged, all done → unlocked (the fallback)", isSignedOff(all) === true)
}

// every() on [] is true, so this is the case a naive implementation gets wrong.
ok("an EMPTY deliverable is never signed off", isSignedOff([]) === false)

// ── Re-lock detection, which the coach-side confirms are built on ──
console.log("\n— re-lock detection —")
{
  const signed = [act({ owner: "coach", status: "complete", is_signoff: true }), act({ status: "not_started" })]
  // Deleting the sign-off drops to the fallback, and the rest is unfinished.
  const deleted = signed.slice(1)
  ok("deleting the sign-off re-locks", wouldRelock(signed, deleted) === true)

  // Moving the flag to an unfinished task.
  const moved = [{ ...signed[0], is_signoff: false }, { ...signed[1], is_signoff: true }]
  ok("moving the flag to an unfinished task re-locks", wouldRelock(signed, moved) === true)

  // Reopening the sign-off itself.
  const reopened = [{ ...signed[0], status: "in_progress" as const }, signed[1]]
  ok("reopening the sign-off re-locks", wouldRelock(signed, reopened) === true)

  // A harmless edit: renaming an unrelated task.
  const renamed = [signed[0], { ...signed[1], name: "Renamed" }]
  ok("an unrelated edit does NOT re-lock", wouldRelock(signed, renamed) === false)

  // Deleting the sign-off when everything ELSE is done falls through to the
  // fallback and stays unlocked — so the confirm must not cry wolf here.
  const allDone = [act({ owner: "coach", status: "complete", is_signoff: true }), act({ status: "complete" })]
  ok("deleting the sign-off does NOT re-lock when the rest is complete",
    wouldRelock(allDone, allDone.slice(1)) === false)

  // Locked → locked is not a re-lock; there was nothing to take away.
  const neverSigned = [act({ status: "not_started" })]
  ok("a locked deliverable cannot re-lock", wouldRelock(neverSigned, []) === false)
}

// ── Progress ───────────────────────────────────────────────────────────────
console.log("\n— progress —")

eq("counts every task regardless of owner", progressOf([
  act({ owner: "coach", status: "complete" }),
  act({ owner: "client", status: "complete" }),
  act({ owner: "both", status: "not_started" }),
]), { completed: 2, total: 3, percent: 66 })

{
  // 999/1000 rounds to 100 under any rounding implementation. The cap is the guard.
  const many = Array.from({ length: 1000 }, (_, i) => act({ status: i < 999 ? "complete" : "not_started" }))
  eq("NEVER reads 100 until everything is done", progressOf(many).percent, 99)
}
eq("reads exactly 100 when everything is done",
  progressOf([act({ status: "complete" }), act({ status: "complete" })]).percent, 100)
eq("is 0, not NaN, with no tasks", progressOf([]), { completed: 0, total: 0, percent: 0 })

// ── Journey nodes ──────────────────────────────────────────────────────────
console.log("\n— journey nodes —")

{
  const done = [act({ owner: "coach", status: "complete", is_signoff: true })]
  const open = [act({ owner: "coach", status: "not_started", is_signoff: true })]
  eq("exactly one current node: the first unfinished",
    nodeStates([deliv(done), deliv(open), deliv(open)]), ["complete", "current", "future"])
  // Coaches DO sign off out of order. Hiding that would contradict the
  // percentage and put a locked node beside an unlocked speaking point.
  eq("a later signed-off deliverable reads complete, not future",
    nodeStates([deliv(open), deliv(done)]), ["current", "complete"])
  eq("…and the current node is still the first unfinished one",
    nodeStates([deliv(done), deliv(open), deliv(done), deliv(open)]),
    ["complete", "current", "complete", "future"])
  eq("no current node once everything is signed off",
    nodeStates([deliv(done), deliv(done)]), ["complete", "complete"])
}

// ── Dates ──────────────────────────────────────────────────────────────────
console.log("\n— dates —")

eq("final date is the latest due date",
  finalDueDate([deliv([act({ due_date: "2026-09-01" }), act({ due_date: "2026-12-25" }), act({ due_date: null })])]),
  "2026-12-25")
ok("no final date when the coach set none", finalDueDate([deliv([act(), act()])]) === null)

// new Date("2026-09-01") is UTC midnight = Aug 31 in the US. Parsing from parts
// is what keeps this 10 rather than 9.
eq("counts whole days without shifting west of Greenwich",
  daysUntil("2026-09-01", new Date(2026, 7, 22, 23, 30)), 10)
eq("goes negative once past", daysUntil("2026-08-01", new Date(2026, 7, 8)), -7)
ok("is null with no date", daysUntil(null, new Date()) === null)

// ── Streak ─────────────────────────────────────────────────────────────────
console.log("\n— streak —")

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString()
const NOW = new Date(2026, 7, 8, 9)

eq("counts consecutive days ending today",
  computeStreak([at(2026, 8, 8), at(2026, 8, 7), at(2026, 8, 6)], NOW), 3)
// The morning case: anchoring strictly on today would read as losing the streak.
eq("SURVIVES a day with nothing done yet, anchoring on yesterday",
  computeStreak([at(2026, 8, 7), at(2026, 8, 6)], NOW), 2)
eq("breaks once a full day passes empty",
  computeStreak([at(2026, 8, 6), at(2026, 8, 5)], NOW), 0)
eq("counts a day once however many tasks landed in it",
  computeStreak([at(2026, 8, 8, 9), at(2026, 8, 8, 14), at(2026, 8, 8, 21)], NOW), 1)
eq("is 0 with no completions", computeStreak([], NOW), 0)
eq("ignores garbage timestamps", computeStreak(["not a date"], NOW), 0)
// The whole reason raw timestamps go to the client instead of UTC buckets.
eq("groups a late-evening completion into that evening",
  computeStreak([at(2026, 8, 7, 23)], NOW), 1)

// ── Calendar ───────────────────────────────────────────────────────────────
console.log("\n— calendar —")

{
  // Aug 2026 starts on a Saturday, so six leading blanks.
  const cells = monthGrid([], 2026, 7)
  eq("pads to whole weeks", cells.length % 7, 0)
  eq("day 1 lands on its weekday", cells.findIndex((c) => c.dayOfMonth === 1), 6)
  eq("has every day of the month", cells.filter((c) => c.dayOfMonth !== null).length, 31)
}

{
  const d = deliv([
    act({ due_date: "2026-08-10", owner: "client" }),
    act({ due_date: "2026-08-10", owner: "client" }),
    act({ due_date: "2026-08-10", owner: "coach" }),
  ])
  const cell = monthGrid([d], 2026, 7).find((c) => c.dayKey === "2026-08-10")!
  eq("counts every task due that day", cell.count, 3)
  eq("collects DISTINCT owners, in legend order", cell.owners, ["client", "coach"])
}
eq("ignores activities with no due date",
  monthGrid([deliv([act({ due_date: null })])], 2026, 7).every((c) => c.count === 0), true)

// ── Result ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
