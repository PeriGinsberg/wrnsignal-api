#!/usr/bin/env tsx
// Pure-logic test for per-field state and the "enough to start sending"
// threshold, in the repo's tsx-script convention. No DOM needed — these are
// product rules, and the rendering of them is covered in ProfileForm.test.tsx.

import { fieldState, sendReadiness, groupProgress, OPTIONAL_FIELDS, MUST_HAVE } from "./fieldState"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.error(`✗ ${label}`) }
}

// ─── field state ────────────────────────────────────────────────────────────

ok("a filled field reads filled", fieldState("city", "Chicago") === "filled")
ok("an empty required field reads required-empty", fieldState("city", "") === "required-empty")
ok("null is empty", fieldState("city", null) === "required-empty")

// Whitespace is not a value. Saving a space into a field must not tick it off,
// or the meter counts progress the templates cannot use.
ok("whitespace only is still empty", fieldState("city", "   ") === "required-empty")

// The four skippable ones, and only those four.
for (const k of ["grad_year", "degree", "resume_link", "calendar_link"]) {
  ok(`'${k}' empty reads optional-empty`, fieldState(k, "") === "optional-empty")
  ok(`'${k}' filled still reads filled`, fieldState(k, "x") === "filled")
}
ok("exactly four optional fields", OPTIONAL_FIELDS.size === 4)
for (const k of ["client_first", "city", "school", "target_role", "affinity_1", "elevator_pitch"]) {
  ok(`'${k}' is NOT optional`, fieldState(k, "") === "required-empty")
}

// An optional field must never gate the threshold — that is the whole point of
// marking it skippable.
for (const k of OPTIONAL_FIELDS) {
  ok(`optional '${k}' is not a must-have`, !(MUST_HAVE as readonly string[]).includes(k))
}

// ─── the threshold ──────────────────────────────────────────────────────────

const READY = { client_first: "Jordan", target_role: "Analytics", target_field: "Marketing", elevator_pitch: "I'm a…" }

ok("all four must-haves filled is ready", sendReadiness(READY).ready === true)
ok("ready means nothing remaining", sendReadiness(READY).remaining === 0)

// Ready does NOT mean complete: a profile with the four but nothing else must
// still say it can send, which is the case the threshold exists for.
ok("ready on the four alone, with 13 fields empty", sendReadiness(READY).missing.length === 0)

ok("an empty profile is not ready", sendReadiness({}).ready === false)
ok("an empty profile needs all four", sendReadiness({}).remaining === 4)
ok("null profile is not ready", sendReadiness(null).ready === false)

// Each must-have genuinely gates on its own — drop one at a time.
for (const k of MUST_HAVE) {
  const short = { ...READY, [k]: "" }
  const r = sendReadiness(short)
  ok(`missing '${k}' alone blocks the threshold`, r.ready === false && r.remaining === 1)
  ok(`missing '${k}' is named in the gap`, r.missing[0] === k)
}

// Filling everything EXCEPT the must-haves must not cross it — otherwise the
// signal would fire off sheer volume rather than off usefulness.
const BULK = { school: "UIUC", city: "Chicago", grad_year: "2020", degree: "BS", timeframe: "Now",
  affinity_1: "a", affinity_2: "b", affinity_3: "c", resume_link: "r", calendar_link: "c",
  current_role_title: "x", current_employer: "y", key_strength: "z" }
ok("13 non-must-have fields filled is still not ready", sendReadiness(BULK).ready === false)
ok("…and still needs all four", sendReadiness(BULK).remaining === 4)

// Missing order follows MUST_HAVE, so the "2 more" line reads the same every time.
const two = sendReadiness({ client_first: "J", target_field: "Marketing" })
ok("gaps are listed in a stable order", JSON.stringify(two.missing) === JSON.stringify(["target_role", "elevator_pitch"]))

// ─── section counts ─────────────────────────────────────────────────────────

ok("group progress counts filled against total",
  JSON.stringify(groupProgress(["a", "b", "c"], { a: "x", b: "", c: "y" })) === JSON.stringify({ filled: 2, total: 3 }))
ok("group progress on an empty profile is 0 of n",
  groupProgress(["a", "b"], {}).filled === 0)
ok("group progress counts whitespace as empty",
  groupProgress(["a"], { a: "  " }).filled === 0)

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
