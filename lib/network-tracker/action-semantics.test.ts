#!/usr/bin/env tsx
// Which stage an action implies, and when it may be offered. tsx-script
// convention (pure logic), same as dashboardState.test.ts.
//
// Run: npx tsx lib/network-tracker/action-semantics.test.ts
//
// The model: a stage is a fact you ASSERT, not a function of what got logged —
// people under-log, and a coach has to be able to park a contact with nothing
// logged at all. So an action never moves a stage on its own; it only proposes.
// The one exception is touch_1 from `identified`, which stays automatic because
// a dismissal there would leave the contact with no due date, silently.

import {
  IMPLIED_STAGE, STAGE_PATH, impliedStageAhead, stageIndex, stageAfterAction,
  ACTION_TYPES, isPipelineAction,
} from "./action-semantics"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) } else { fail++; console.error(`✗ ${label}`) }
}
function eq(label: string, got: unknown, want: unknown) {
  ok(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))
}

// ── The table ──────────────────────────────────────────────────────────────
console.log("\n— the implied-stage table —")

eq("touch_1 implies sequence_active", IMPLIED_STAGE.touch_1, "sequence_active")
eq("touch_2 implies sequence_active", IMPLIED_STAGE.touch_2, "sequence_active")
eq("touch_3 implies sequence_active", IMPLIED_STAGE.touch_3, "sequence_active")
eq("intro_request implies intro_requested", IMPLIED_STAGE.intro_request, "intro_requested")
eq("chat_scheduled implies chat_scheduled", IMPLIED_STAGE.chat_scheduled, "chat_scheduled")
eq("chat_done implies chat_done", IMPLIED_STAGE.chat_done, "chat_done")
eq("ask implies ask_made", IMPLIED_STAGE.ask, "ask_made")

// The six that imply nothing, each pinned by name so removing one is a decision
// rather than an accident.
for (const t of ["thank_you", "connection_request", "engage_on_post", "note_logged", "note", "other"]) {
  ok(`${t} implies NOTHING`, IMPLIED_STAGE[t] === undefined)
}

// Every key in the table must be a real action type, or the offer can never fire.
for (const k of Object.keys(IMPLIED_STAGE)) {
  ok(`${k} is a real action type`, ACTION_TYPES.has(k))
}
// …and every implied value must be a real stage ON THE PATH, or "ahead" is
// undefined for it.
for (const [k, v] of Object.entries(IMPLIED_STAGE)) {
  ok(`${k} implies an on-path stage`, stageIndex(v) >= 0)
}

// ── Stages nothing implies ─────────────────────────────────────────────────
console.log("\n— stages that can only be set by hand —")
{
  const implied = new Set(Object.values(IMPLIED_STAGE))
  // `replied` is the notable one: a reply is something THEY do and there is no
  // action type for it. Recorded so the manual path is never treated as a
  // fallback that could be removed.
  for (const stage of ["replied", "nurture", "outcome"]) {
    ok(`${stage} is implied by nothing`, !implied.has(stage))
  }
  for (const stage of ["dormant_no_answer", "dormant_declined"]) {
    ok(`${stage} is off the path entirely`, stageIndex(stage) === -1)
  }
}

// ── When the offer may fire ────────────────────────────────────────────────
console.log("\n— impliedStageAhead —")

eq("offers the move she reported: chat logged at sequence_active",
  impliedStageAhead("sequence_active", "chat_done"), "chat_done")
eq("offers intro_requested from identified",
  impliedStageAhead("identified", "intro_request"), "intro_requested")

// NEVER BACKWARDS. A backdated chat logged from nurture must not drag the stage
// back — the most likely way a naive implementation loses someone's data.
ok("never offers a move BACKWARDS", impliedStageAhead("nurture", "chat_done") === null)
ok("never offers where you already are", impliedStageAhead("chat_done", "chat_done") === null)
ok("never offers from a dormant contact — resurfacing is a decision",
  impliedStageAhead("dormant_no_answer", "chat_done") === null)
ok("never offers from an unknown stage", impliedStageAhead("nonsense", "chat_done") === null)
ok("an action that implies nothing offers nothing",
  impliedStageAhead("identified", "note_logged") === null)
ok("the inert note offers nothing", impliedStageAhead("identified", "note") === null)

// ── The one automatic case, unchanged ──────────────────────────────────────
console.log("\n— touch_1 stays automatic —")

eq("touch_1 from identified still auto-applies", stageAfterAction("identified", "touch_1"), "sequence_active")
ok("…and nothing else auto-applies", stageAfterAction("sequence_active", "chat_done") === null)
ok("touch_1 from elsewhere does not auto-apply", stageAfterAction("replied", "touch_1") === null)
// It is BOTH automatic and in the table: the auto path fires server-side from
// `identified`, and the table covers the case where a touch_1 is logged from
// intro_requested, where nothing is automatic.
eq("touch_1 is also offerable from intro_requested",
  impliedStageAhead("intro_requested", "touch_1"), "sequence_active")

// ── The path itself ────────────────────────────────────────────────────────
console.log("\n— the shared path —")
eq("nine stages, in order", STAGE_PATH.length, 9)
eq("starts at identified", STAGE_PATH[0], "identified")
eq("ends at outcome", STAGE_PATH[STAGE_PATH.length - 1], "outcome")
ok("note is the only inert type", !isPipelineAction("note") && isPipelineAction("note_logged"))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
