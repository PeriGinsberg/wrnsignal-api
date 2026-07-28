#!/usr/bin/env tsx
// Phase 8c — the join. Every relationship family, every touch number, the S/IN
// cases, and the three ways null is the right answer.
//
// Contacts here mirror the shapes seed-network-fixture.ts produces, so the cases
// are the ones a real board actually contains.

import { pickTemplate, touchNumber, RELATIONSHIP_TO_FAMILY, REASON_TO_TEMPLATE } from "./vocab"
import { isKnownTemplateId } from "../../../lib/network-tracker/templates"

let pass = 0, fail = 0
const ok = (l: string, c: boolean) => { c ? (pass++, console.log(`✓ ${l}`)) : (fail++, console.error(`✗ ${l}`)) }

const c = (over: Record<string, unknown> = {}) =>
  ({ relationship: null, stage: "identified", next_due_reason: null, ...over })

console.log("pickTemplate — 8c")

// ── every family, first outreach ────────────────────────────────────────────
for (const [rel, fam] of Object.entries(RELATIONSHIP_TO_FAMILY)) {
  ok(`${rel} + first outreach -> ${fam}1`,
    pickTemplate(c({ relationship: rel })) === `${fam}1`)
}

// ── every family, every touch number ────────────────────────────────────────
for (const [rel, fam] of Object.entries(RELATIONSHIP_TO_FAMILY)) {
  ok(`${rel} + touch_2 -> ${fam}2`,
    pickTemplate(c({ relationship: rel, stage: "sequence_active", next_due_reason: "touch_2" })) === `${fam}2`)
  ok(`${rel} + touch_3 -> ${fam}3`,
    pickTemplate(c({ relationship: rel, stage: "sequence_active", next_due_reason: "touch_3" })) === `${fam}3`)
}

// The spec's worked example.
ok("a cold contact due touch 2 -> C2",
  pickTemplate(c({ relationship: "cold", stage: "sequence_active", next_due_reason: "touch_2" })) === "C2")

// Every id the join can emit must actually exist.
{
  const emitted = new Set<string>()
  for (const rel of Object.keys(RELATIONSHIP_TO_FAMILY)) {
    for (const r of [null, "touch_2", "touch_3"]) {
      const id = pickTemplate(c({ relationship: rel, next_due_reason: r }))
      if (id) emitted.add(id)
    }
  }
  ok(`every family/number id the join emits is a real template (${emitted.size} of them)`,
    [...emitted].every(isKnownTemplateId))
  ok("that is 5 families x 3 touches = 15 ids", emitted.size === 15)
}

// ── touch numbering ─────────────────────────────────────────────────────────
ok("touch_2 -> 2", touchNumber("touch_2") === 2)
ok("touch_3 -> 3", touchNumber("touch_3") === 3)
ok("no reason -> first outreach", touchNumber(null) === 1)
// A resurfaced dormant contact is being approached fresh, not chased.
ok("resurface_no_answer -> first outreach", touchNumber("resurface_no_answer") === 1)
ok("resurface_declined -> first outreach", touchNumber("resurface_declined") === 1)
ok("poke -> first outreach", touchNumber("poke") === 1)

// ── S family, from the due reason ───────────────────────────────────────────
ok("thank_you -> S2", pickTemplate(c({ relationship: "cold", next_due_reason: "thank_you" })) === "S2")
ok("nurture_recurring -> S3", pickTemplate(c({ relationship: "personal", next_due_reason: "nurture_recurring" })) === "S3")
ok("ask_followup -> S4", pickTemplate(c({ relationship: "referred", next_due_reason: "ask_followup" })) === "S4")

// An S reply outranks the family sequence — a thank-you reads the same whoever
// it is going to, so it must not be overridden by "cold contact, touch 1".
ok("an S reply beats the family sequence",
  pickTemplate(c({ relationship: "cold", stage: "sequence_active", next_due_reason: "thank_you" })) === "S2")

// THE DISCRIMINATING CASE for that ordering. With a relationship present both
// orderings give S2, so the test above proves nothing on its own — only a
// contact with NO relationship separates them. An S reply is the same text
// whoever it is addressed to, so it resolves without one.
ok("an S reply resolves even with NO relationship set",
  pickTemplate(c({ relationship: null, stage: "chat_done", next_due_reason: "thank_you" })) === "S2")
ok("…and so do the other two S replies",
  pickTemplate(c({ relationship: null, next_due_reason: "nurture_recurring" })) === "S3" &&
  pickTemplate(c({ relationship: null, next_due_reason: "ask_followup" })) === "S4")

// ── IN ──────────────────────────────────────────────────────────────────────
ok("stage intro_requested -> IN", pickTemplate(c({ stage: "intro_requested" })) === "IN")
ok("IN outranks the family sequence",
  pickTemplate(c({ relationship: "referred", stage: "intro_requested", next_due_reason: "touch_2" })) === "IN")
ok("IN does not require a relationship",
  pickTemplate(c({ relationship: null, stage: "intro_requested" })) === "IN")

// ── the three nulls, all intended ───────────────────────────────────────────
ok("no relationship -> null (UI asks the user to set one)",
  pickTemplate(c({ relationship: null, stage: "sequence_active", next_due_reason: "touch_2" })) === null)
ok("empty-string relationship is treated as unset", pickTemplate(c({ relationship: "" })) === null)

// S1 and S5 are manual-only: no due reason corresponds to them, so the join must
// not guess. These are the reasons closest to them.
ok("S1 (scheduling) is never auto-suggested",
  !Object.values(REASON_TO_TEMPLATE).includes("S1"))
ok("S5 (post-referral thanks) is never auto-suggested",
  !Object.values(REASON_TO_TEMPLATE).includes("S5"))
ok("a 'reply' reason does not guess S1",
  pickTemplate(c({ relationship: null, next_due_reason: "reply" })) === null)

// An unmapped reason falls through to the family path rather than erroring.
ok("an unmapped reason with a relationship still suggests the family template",
  pickTemplate(c({ relationship: "affinity", next_due_reason: "manual" })) === "A1")
ok("an unmapped reason with no relationship -> null",
  pickTemplate(c({ relationship: null, next_due_reason: "manual" })) === null)

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
