#!/usr/bin/env tsx
// Pure-logic test in the repo's original tsx-script convention (npx tsx <file>).
//
// This is the assertion that a standalone note does not touch the pipeline. The
// route's inert branch is gated ENTIRELY on isPipelineAction(type) — if it
// returns true for 'note', the route falls through to computeNextDue(), writes
// last_action_at / next_due_at / next_due_reason, and clears reminder_override
// when the engine reports the snooze served. So this predicate IS the guarantee.
//
// The end-to-end claim (the DB row genuinely unchanged) needs a real database
// and is covered by the smoke, not here.

import { isPipelineAction, ACTION_TYPES, stageAfterAction } from "./action-semantics"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) }
  else { fail++; console.error(`✗ ${label}`) }
}

console.log("action-semantics: inert vs pipeline")

// The fix.
ok("'note' is INERT — no engine, no last_action_at, no override consumption",
  isPipelineAction("note") === false)

// The regression guard. If this ever flips, the worklist's "Log it" for reply /
// check-in / manual reminders stops clearing the due date and those contacts
// stay overdue forever.
ok("'note_logged' is STILL pipeline activity (worklist due reasons depend on it)",
  isPipelineAction("note_logged") === true)

// Everything else must remain pipeline activity — only 'note' was added as inert.
const shouldBePipeline = [
  "touch_1", "touch_2", "touch_3", "intro_request", "thank_you",
  "connection_request", "engage_on_post", "chat_scheduled", "chat_done",
  "ask", "note_logged", "other",
]
for (const t of shouldBePipeline) {
  ok(`'${t}' is pipeline activity`, isPipelineAction(t) === true)
}

// Exactly one inert type — catches a careless addition to INERT_TYPES.
const inert = [...ACTION_TYPES].filter((t) => !isPipelineAction(t))
ok(`exactly one inert type, and it is 'note' (got: ${JSON.stringify(inert)})`,
  inert.length === 1 && inert[0] === "note")

// The new type must be accepted by the route's validator, or the POST 400s
// before it ever reaches the branch.
ok("'note' is an accepted action type", ACTION_TYPES.has("note"))
ok("'note_logged' is still an accepted action type", ACTION_TYPES.has("note_logged"))

// ─── stageAfterAction — the one place an action moves the stage ──────────────
// The reminder engine never ADVANCES a stage; its only stage write is the
// sequence_active -> dormant_no_answer flip. Without this rule a contact at
// `identified` had no due reason, so the send box had no action to log, so the
// screen built for sending could not send the first message.

ok("first outreach from 'identified' advances to 'sequence_active'",
  stageAfterAction("identified", "touch_1") === "sequence_active")

// Only from identified. A touch_1 logged against a contact who has already
// replied or talked must never drag them backwards down the pipeline.
for (const stage of ["sequence_active", "replied", "chat_done", "nurture", "outcome", "dormant_no_answer"]) {
  ok(`touch_1 at '${stage}' leaves the stage alone`, stageAfterAction(stage, "touch_1") === null)
}

// Only touch_1. Nothing else at `identified` means "I sent the first message" —
// and 'note' especially must not, since recording an observation is not acting.
for (const type of ["touch_2", "touch_3", "note", "note_logged", "chat_done", "ask", "other"]) {
  ok(`'${type}' at 'identified' implies no stage move`, stageAfterAction("identified", type) === null)
}

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
