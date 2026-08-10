#!/usr/bin/env tsx
// How a client's answer to a coach-sourced job reads on the History timeline.
//
// WHY THE WORDING IS TESTED AT ALL. The first answer and a later one are
// DIFFERENT EVENTS, and the difference is the whole reason the append-only
// coach_recommendation_responses table exists. Before it, a second answer
// UPDATEd the first in place: the timeline showed only the latest, and "changed
// their mind" — the part a coach most needs — was not hidden but never
// recorded. Now that both rows survive, the labels have to distinguish them, or
// two entries reading "Told your coach…" look like two separate conversations
// about the same job rather than one reversal.
//
// tsx-script convention (pure logic), same as contactOrder.test.ts.

import { responseEventLabel, describeClientStatus, hasResponded } from "../../lib/coachRecommendations"

let pass = 0, fail = 0
function eq(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`) }
}
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) } else { fail++; console.error(`✗ ${label}`) }
}

console.log("— first answer —")
eq("interested", responseEventLabel("interested", false), "Told your coach you're interested")
eq("not_for_me", responseEventLabel("not_for_me", false), "Told your coach this one isn't for you")

console.log("\n— a later answer is a change of mind, not a second announcement —")
eq("interested after declining", responseEventLabel("interested", true), "Changed your mind — interested after all")
eq("not_for_me after accepting", responseEventLabel("not_for_me", true), "Changed your mind — not interested after all")

console.log("\n— the two are never phrased the same —")
for (const s of ["interested", "not_for_me"]) {
  ok(
    `${s}: first and subsequent read differently`,
    responseEventLabel(s, false) !== responseEventLabel(s, true),
  )
}

console.log("\n— a decline never reads like an acceptance —")
for (const change of [false, true]) {
  ok(
    `isChange=${change}: interested and not_for_me differ`,
    responseEventLabel("interested", change) !== responseEventLabel("not_for_me", change),
  )
}

console.log("\n— statuses the box cannot send still produce something sane —")
// 'applying' and 'applied' are valid on the column and reachable through the
// API even though the box offers only two choices. They must not fall through
// to the decline wording just because they are not the string "not_for_me" —
// they are accepting-shaped, so the affirmative branch is correct.
eq("applying", responseEventLabel("applying", false), "Told your coach you're interested")
ok("nothing returns an empty label", ["interested", "not_for_me", "applying", "applied", "archived"]
  .every((s) => responseEventLabel(s, false).length > 0 && responseEventLabel(s, true).length > 0))

console.log("\n— prose for coaches, never the raw enum —")
eq("not_for_me", describeClientStatus("not_for_me"), "Not interested")
eq("new", describeClientStatus("new"), "No answer yet")
eq("null", describeClientStatus(null), "No answer yet")
ok("an unknown value is de-underscored rather than shown raw",
  !describeClientStatus("some_new_status").includes("_"))

console.log("\n— hasResponded —")
ok("'new' is the only non-answer", !hasResponded("new") && !hasResponded(null) && hasResponded("not_for_me"))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
