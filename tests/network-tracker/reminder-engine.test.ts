// tests/network-tracker/reminder-engine.test.ts
// Run: npx tsx --test tests/network-tracker/reminder-engine.test.ts
//
// v3 engine: three-touch rule, two dormant kinds, revised intervals
// (reconciliation §1-§4). Rewritten from the four-touch baseline, not patched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNextDue, type EngineInput } from "../../lib/network-tracker/reminder-engine";

const DAY = 24 * 60 * 60 * 1000;
const LAST = new Date("2026-07-01T00:00:00.000Z");
const plus = (n: number) => new Date(LAST.getTime() + n * DAY).getTime();

function input(over: Partial<EngineInput>): EngineInput {
  return {
    stage: "identified",
    createdAt: LAST,
    lastActionAt: LAST,
    reminderOverride: null,
    dormantSince: null,
    pokeEnabled: false,
    actions: [],
    cycleStartedAt: null,
    ...over,
  };
}
// A touch dated relative to LAST, for cycle-scoping tests.
const touch = (type: string, dayOffset: number) => ({ type, action_date: new Date(plus(dayOffset)) });

// ---- identified: optional poke ----
test("identified: poke OFF by default -> no due", () => {
  const r = computeNextDue(input({ stage: "identified", pokeEnabled: false }));
  assert.equal(r.nextDueAt, null);
  assert.equal(r.nextDueReason, null);
});

test("identified: poke ON -> +7d", () => {
  const r = computeNextDue(input({ stage: "identified", pokeEnabled: true }));
  assert.equal(r.nextDueReason, "poke");
  assert.equal(r.nextDueAt?.getTime(), plus(7));
});

// ---- intro_requested ----
test("intro_requested -> intro_chase +7d", () => {
  const r = computeNextDue(input({ stage: "intro_requested" }));
  assert.equal(r.nextDueReason, "intro_chase");
  assert.equal(r.nextDueAt?.getTime(), plus(7));
});

// ---- sequence_active: the three-touch ladder ----
test("sequence_active: 0 follow-up touches -> touch_2 at +7d", () => {
  const r = computeNextDue(input({ stage: "sequence_active", actions: [] }));
  assert.equal(r.nextDueReason, "touch_2");
  assert.equal(r.nextDueAt?.getTime(), plus(7));
  assert.equal(r.stage, undefined); // no stage write yet
});

test("sequence_active: 1 follow-up touch (touch_2) -> touch_3 at +5d", () => {
  const r = computeNextDue(input({ stage: "sequence_active", actions: [{ type: "touch_2" }] }));
  assert.equal(r.nextDueReason, "touch_3");
  assert.equal(r.nextDueAt?.getTime(), plus(5));
});

test("sequence_active: 2 follow-up touches -> flip to dormant_no_answer, resurface +35d", () => {
  const r = computeNextDue(input({ stage: "sequence_active", actions: [{ type: "touch_2" }, { type: "touch_3" }] }));
  assert.equal(r.stage, "dormant_no_answer"); // the ONLY stage write the engine makes
  assert.equal(r.dormantSince?.getTime(), LAST.getTime());
  assert.equal(r.nextDueReason, "resurface_no_answer");
  assert.equal(r.nextDueAt?.getTime(), plus(35));
});

test("sequence_active: touch_1 does NOT count toward the ladder", () => {
  const r = computeNextDue(input({ stage: "sequence_active", actions: [{ type: "touch_1" }] }));
  assert.equal(r.nextDueReason, "touch_2"); // still expecting touch_2
});

// ---- replied / chat / nurture / ask / outcome ----
test("replied -> reply +1d (same-day rule)", () => {
  const r = computeNextDue(input({ stage: "replied" }));
  assert.equal(r.nextDueReason, "reply");
  assert.equal(r.nextDueAt?.getTime(), plus(1));
});

test("chat_scheduled -> no due (null) until the chat happens", () => {
  const r = computeNextDue(input({ stage: "chat_scheduled" }));
  assert.equal(r.nextDueAt, null);
  assert.equal(r.nextDueReason, null);
});

test("chat_done -> thank_you +1d", () => {
  const r = computeNextDue(input({ stage: "chat_done" }));
  assert.equal(r.nextDueReason, "thank_you");
  assert.equal(r.nextDueAt?.getTime(), plus(1));
});

test("nurture -> nurture_recurring +42d", () => {
  const r = computeNextDue(input({ stage: "nurture" }));
  assert.equal(r.nextDueReason, "nurture_recurring");
  assert.equal(r.nextDueAt?.getTime(), plus(42));
});

test("ask_made -> ask_followup +14d", () => {
  const r = computeNextDue(input({ stage: "ask_made" }));
  assert.equal(r.nextDueReason, "ask_followup");
  assert.equal(r.nextDueAt?.getTime(), plus(14));
});

test("outcome -> no due (null)", () => {
  const r = computeNextDue(input({ stage: "outcome" }));
  assert.equal(r.nextDueAt, null);
  assert.equal(r.nextDueReason, null);
});

// ---- two kinds of dormant ----
test("dormant_no_answer: resurface_no_answer at dormant_since +35d", () => {
  const dormantSince = new Date("2026-06-01T00:00:00.000Z");
  const r = computeNextDue(input({ stage: "dormant_no_answer", dormantSince, lastActionAt: LAST }));
  assert.equal(r.nextDueReason, "resurface_no_answer");
  assert.equal(r.nextDueAt?.getTime(), dormantSince.getTime() + 35 * DAY);
});

test("dormant_declined: resurface_declined at dormant_since +90d", () => {
  const dormantSince = new Date("2026-06-01T00:00:00.000Z");
  const r = computeNextDue(input({ stage: "dormant_declined", dormantSince, lastActionAt: LAST }));
  assert.equal(r.nextDueReason, "resurface_declined");
  assert.equal(r.nextDueAt?.getTime(), dormantSince.getTime() + 90 * DAY);
});

// ---- manual override ----
test("manual override beats stage logic (even outcome)", () => {
  const override = new Date("2026-08-15T09:30:00.000Z");
  const r = computeNextDue(input({ stage: "outcome", reminderOverride: override }));
  assert.equal(r.nextDueReason, "manual");
  assert.equal(r.nextDueAt?.getTime(), override.getTime());
  assert.equal(r.stage, undefined);
});

// ---- pipeline activity consumes the override ----
test("action logged: override is consumed, stage cadence resumes", () => {
  const past = new Date("2026-06-20T00:00:00.000Z"); // an elapsed snooze
  const r = computeNextDue(
    input({ stage: "sequence_active", reminderOverride: past, actions: [{ type: "touch_2" }], pipelineActivity: true }),
  );
  assert.equal(r.clearOverride, true);
  assert.equal(r.nextDueReason, "touch_3"); // back on the ladder, not 'manual'
  assert.equal(r.nextDueAt?.getTime(), plus(5));
});

test("action logged with NO override: nothing to clear", () => {
  const r = computeNextDue(input({ stage: "sequence_active", reminderOverride: null, pipelineActivity: true }));
  assert.equal(r.clearOverride, undefined);
  assert.equal(r.nextDueReason, "touch_2");
});

test("stage change consumes the override too (one rule, both write paths)", () => {
  const past = new Date("2026-06-20T00:00:00.000Z");
  const r = computeNextDue(input({ stage: "chat_done", reminderOverride: past, pipelineActivity: true }));
  assert.equal(r.clearOverride, true);
  assert.equal(r.nextDueReason, "thank_you");
  assert.equal(r.nextDueAt?.getTime(), plus(1));
});

test("override still wins when there is NO pipeline activity (the reminder route)", () => {
  const override = new Date("2026-08-15T09:30:00.000Z");
  const r = computeNextDue(input({ stage: "sequence_active", reminderOverride: override }));
  assert.equal(r.nextDueReason, "manual");
  assert.equal(r.clearOverride, undefined);
});

// ---- re-engagement: touches scoped to the current cycle ----
test("re-engagement: old cycle's touches do NOT count after cycle_started_at", () => {
  const r = computeNextDue(
    input({
      stage: "sequence_active",
      cycleStartedAt: new Date(plus(0)), // re-engaged at LAST
      actions: [touch("touch_2", -40), touch("touch_3", -30)], // all prior cycle
    }),
  );
  assert.equal(r.stage, undefined); // NOT flipped to dormant
  assert.equal(r.nextDueReason, "touch_2"); // ladder restarts
  assert.equal(r.nextDueAt?.getTime(), plus(7));
});

test("re-engagement: touches inside the new cycle DO count", () => {
  const r = computeNextDue(
    input({
      stage: "sequence_active",
      cycleStartedAt: new Date(plus(0)),
      actions: [touch("touch_2", -40), touch("touch_2", 1)], // one prior, one current
    }),
  );
  assert.equal(r.nextDueReason, "touch_3");
  assert.equal(r.nextDueAt?.getTime(), plus(5));
});

test("re-engagement: a fresh cycle can still exhaust and flip to dormant_no_answer", () => {
  const r = computeNextDue(
    input({
      stage: "sequence_active",
      cycleStartedAt: new Date(plus(0)),
      actions: [touch("touch_3", -20), touch("touch_2", 1), touch("touch_3", 2)],
    }),
  );
  assert.equal(r.stage, "dormant_no_answer");
  assert.equal(r.nextDueReason, "resurface_no_answer");
});

test("null cycle_started_at falls back to counting ALL touches", () => {
  const r = computeNextDue(
    input({ stage: "sequence_active", cycleStartedAt: null, actions: [touch("touch_2", -40), touch("touch_3", -30)] }),
  );
  assert.equal(r.stage, "dormant_no_answer"); // pre-cycle behavior preserved
  assert.equal(r.nextDueReason, "resurface_no_answer");
});

test("with a cycle stamp, an UNDATED touch is excluded (never over-counts)", () => {
  const r = computeNextDue(
    input({ stage: "sequence_active", cycleStartedAt: new Date(plus(0)), actions: [{ type: "touch_2" }, { type: "touch_3" }] }),
  );
  assert.equal(r.stage, undefined);
  assert.equal(r.nextDueReason, "touch_2");
});
