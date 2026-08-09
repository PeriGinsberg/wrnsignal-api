#!/usr/bin/env tsx
// The contacts list re-ranks by attention rather than rendering the server's
// no-activity-first order. Pinned here because getting it wrong is invisible in
// a screenshot until the list is long enough to scroll, which is exactly how it
// went unnoticed until a real 65-contact account was looked at.
//
// tsx-script convention (pure logic), same as dashboardMetrics.test.ts.

import { attentionRank, sortForAttention } from "./contactOrder"
import type { Contact } from "./ContactRow"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) } else { fail++; console.error(`✗ ${label}`) }
}

function eq(label: string, got: unknown, want: unknown) {
  ok(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want))
}

const NOW = new Date("2026-08-03T12:00:00Z")
const day = (offset: number) => new Date(Date.UTC(2026, 7, 3 + offset, 12, 0, 0)).toISOString()

let seq = 0
function c(over: Partial<Contact> = {}): Contact {
  seq++
  return {
    id: `c${seq}`,
    first_name: "A",
    last_name: `B${seq}`,
    title: null,
    stage: "sequence_active",
    relationship: null,
    priority: null,
    segment: null,
    next_due_at: null,
    next_due_reason: null,
    last_action_at: null,
    company_id: null,
    network_companies: null,
    ...over,
  } as Contact
}

// ── attentionRank ───────────────────────────────────────────────────────────

ok(
  "overdue ranks first",
  attentionRank(c({ next_due_at: day(-3), next_due_reason: "touch_2" }), NOW) === 0,
)

ok(
  "due today ranks above due later",
  attentionRank(c({ next_due_at: day(0), next_due_reason: "touch_2" }), NOW) <
    attentionRank(c({ next_due_at: day(5), next_due_reason: "touch_2" }), NOW),
)

ok(
  "a due reason with no date counts as due today, not as untouched",
  attentionRank(c({ next_due_reason: "reply" }), NOW) === 1,
)

ok(
  "worked with nothing due sits below anything due",
  attentionRank(c({ stage: "sequence_active" }), NOW) >
    attentionRank(c({ next_due_at: day(4), next_due_reason: "touch_2" }), NOW),
)

ok(
  "never started sits below worked",
  attentionRank(c({ stage: "identified" }), NOW) > attentionRank(c({ stage: "replied" }), NOW),
)

ok(
  "resting sits below never started: potential outranks closed",
  attentionRank(c({ stage: "dormant_declined" }), NOW) >
    attentionRank(c({ stage: "identified" }), NOW) &&
    attentionRank(c({ stage: "dormant_no_answer" }), NOW) >
      attentionRank(c({ stage: "identified" }), NOW),
)

ok(
  "resting stays resting even with a date attached",
  attentionRank(c({ stage: "dormant_declined", next_due_at: day(-9) }), NOW) === 5,
)

// ── sortForAttention ────────────────────────────────────────────────────────

{
  // The shape the real account had: untouched first from the server, the live
  // contact buried at the end.
  const rows = [
    c({ first_name: "Idle1", stage: "identified" }),
    c({ first_name: "Idle2", stage: "identified" }),
    c({ first_name: "Overdue", stage: "replied", next_due_at: day(-2), next_due_reason: "reply" }),
  ]
  const got = sortForAttention(rows, NOW).map((x) => x.first_name).join(",")
  ok("lifts what needs the student above the untouched wall", got === "Overdue,Idle1,Idle2")
}

{
  const rows = [
    c({ first_name: "First", stage: "identified" }),
    c({ first_name: "Second", stage: "identified" }),
    c({ first_name: "Third", stage: "identified" }),
  ]
  const got = sortForAttention(rows, NOW).map((x) => x.first_name).join(",")
  ok("is stable inside a band, so the server's order survives", got === "First,Second,Third")
}

{
  const rows = [
    c({ stage: "identified" }),
    c({ stage: "dormant_declined" }),
    c({ next_due_at: day(-1), next_due_reason: "touch_2" }),
    c({ stage: "chat_done" }),
  ]
  const out = sortForAttention(rows, NOW)
  ok(
    "never drops or duplicates anyone",
    out.length === rows.length && new Set(out.map((x) => x.id)).size === rows.length,
  )
}

// ── Order WITHIN a band ────────────────────────────────────────────────────
console.log("")
console.log("— within-band ordering —")

{
  // The top of Overdue is the single most useful row on the screen, and it used
  // to be whatever the server happened to return first.
  const rows = [
    c({ id: "five", stage: "sequence_active", next_due_at: day(-5), next_due_reason: "touch_2" }),
    c({ id: "ten", stage: "sequence_active", next_due_at: day(-10), next_due_reason: "touch_2" }),
    c({ id: "one", stage: "sequence_active", next_due_at: day(-1), next_due_reason: "touch_2" }),
  ]
  eq("Overdue: most overdue first", sortForAttention(rows, NOW).map((x) => x.id), ["ten", "five", "one"])
}

{
  // Future commitments: the NEXT one is the one you can act on.
  const rows = [
    c({ id: "far", stage: "nurture", next_due_at: day(30), next_due_reason: "nurture_recurring" }),
    c({ id: "near", stage: "nurture", next_due_at: day(3), next_due_reason: "nurture_recurring" }),
  ]
  eq("Due later: soonest first", sortForAttention(rows, NOW).map((x) => x.id), ["near", "far"])
}

{
  // You acted, they did not. The one that has sat longest is going cold.
  const rows = [
    c({ id: "recent", stage: "chat_scheduled", last_action_at: day(-2) }),
    c({ id: "stale", stage: "chat_scheduled", last_action_at: day(-40) }),
  ]
  eq("Waiting on them: longest wait first", sortForAttention(rows, NOW).map((x) => x.id), ["stale", "recent"])
}

{
  const rows = [
    c({ id: "later", stage: "dormant_no_answer", next_due_at: day(30) }),
    c({ id: "sooner", stage: "dormant_no_answer", next_due_at: day(4) }),
  ]
  eq("Resting: soonest to resurface first", sortForAttention(rows, NOW).map((x) => x.id), ["sooner", "later"])
}

{
  // Bands still win over the key: a due-later contact never outranks an overdue
  // one however much sooner its date is.
  const rows = [
    c({ id: "future", stage: "nurture", next_due_at: day(1), next_due_reason: "nurture_recurring" }),
    c({ id: "overdue", stage: "sequence_active", next_due_at: day(-1), next_due_reason: "touch_2" }),
  ]
  eq("band still beats the within-band key", sortForAttention(rows, NOW).map((x) => x.id), ["overdue", "future"])
}

{
  // Nothing to sort by: the incoming order survives, so the list does not
  // reshuffle under a pointer on every refetch.
  const rows = [
    c({ id: "b", stage: "identified" }),
    c({ id: "a", stage: "identified" }),
  ]
  eq("no key: stable, server order kept", sortForAttention(rows, NOW).map((x) => x.id), ["b", "a"])
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
