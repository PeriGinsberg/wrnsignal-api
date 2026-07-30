#!/usr/bin/env tsx
// Conversion maths over SYNTHETIC counts, in the tsx-script convention.
// Synthetic because the point is to pin the arithmetic and the edges — a fixture
// gives you one arrangement of numbers, and never the awkward ones.

import { funnel, conversion, splitBy, weeklyFirstTouches, needsAttention, isStalled, startOfWeek, pct, MIN_SPLIT_N } from "./dashboardMetrics"
import type { Contact } from "./contacts/contactModel"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) } else { fail++; console.error(`✗ ${label}`) }
}

const DAY = 86400000
const iso = (d: number) => new Date(d).toISOString()
const NOW = new Date("2026-07-15T12:00:00Z") // a Wednesday

let seq = 0
function c(over: Partial<Contact> = {}): Contact {
  seq++
  return {
    id: `c${seq}`, first_name: "A", last_name: `B${seq}`, title: null, stage: "identified",
    relationship: null, priority: null, segment: null, next_due_at: null, next_due_reason: null,
    last_action_at: null, company_id: null, network_companies: null,
    first_touch_at: null, first_replied_at: null, first_chat_at: null, outcome_type: null,
    ...over,
  }
}

console.log("dashboardMetrics — conversion over synthetic counts")

// ── conversion arithmetic ───────────────────────────────────────────────────
{
  // 10 reached, 4 replied, 2 chatted. Reply 40% of reached; chat 50% of REPLIED
  // (not of reached) — the denominators are the thing most easily got wrong.
  const list = [
    ...Array.from({ length: 6 }, () => c({ first_touch_at: iso(1) })),
    ...Array.from({ length: 2 }, () => c({ first_touch_at: iso(1), first_replied_at: iso(2) })),
    ...Array.from({ length: 2 }, () => c({ first_touch_at: iso(1), first_replied_at: iso(2), first_chat_at: iso(3) })),
    ...Array.from({ length: 5 }, () => c()), // never touched
  ]
  const k = conversion(list)
  ok("total counts every contact", k.total === 15)
  ok("reached counts first_touch_at", k.reached === 10)
  ok("replied counts first_replied_at", k.replied === 4)
  ok("chatted counts first_chat_at", k.chatted === 2)
  ok("reply rate is replied / REACHED (40%)", pct(k.replyRate) === "40%")
  ok("chat rate is chatted / REPLIED (50%), not of reached", pct(k.chatRate) === "50%")
  ok("benchmark shows at reached >= 10", k.showBenchmark === true)
}

// "or beyond": the stamps are permanent, so progress must not lower the rate.
{
  const k = conversion([
    c({ stage: "nurture", first_touch_at: iso(1), first_replied_at: iso(2) }),
    c({ stage: "outcome", first_touch_at: iso(1), first_replied_at: iso(2), first_chat_at: iso(3) }),
  ])
  ok("a contact now at nurture still counts as replied", k.replied === 2)
  ok("a contact now at outcome still counts as chatted", k.chatted === 1)
}

// Empty denominators are null, not 0 — "0%" and "nobody reached" differ.
{
  const k = conversion([c(), c()])
  ok("no one reached -> reply rate is null, not 0%", k.replyRate === null && pct(k.replyRate) === "—")
  ok("no one replied -> chat rate is null", k.chatRate === null)
  ok("benchmark hidden below 10 reached", k.showBenchmark === false)
}

// Benchmark boundary.
ok("benchmark hidden at 9 reached",
  conversion(Array.from({ length: 9 }, () => c({ first_touch_at: iso(1) }))).showBenchmark === false)
ok("benchmark shown at exactly 10 reached",
  conversion(Array.from({ length: 10 }, () => c({ first_touch_at: iso(1) }))).showBenchmark === true)

// Outcomes split by outcome_type, only for contacts AT outcome.
{
  const k = conversion([
    c({ stage: "outcome", outcome_type: "referral" }),
    c({ stage: "outcome", outcome_type: "referral" }),
    c({ stage: "outcome", outcome_type: "intro" }),
    c({ stage: "nurture", outcome_type: "lead" }), // not at outcome -> excluded
  ])
  ok("outcomes total counts only stage=outcome", k.outcomeTotal === 3)
  ok("outcomes are split by type, biggest first", k.outcomes[0].key === "referral" && k.outcomes[0].count === 2)
}

// ── suppression, BOTH directions ────────────────────────────────────────────
{
  const mk = (rel: string, n: number, replies: number) =>
    Array.from({ length: n }, (_, i) =>
      c({ relationship: rel, first_touch_at: iso(1), first_replied_at: i < replies ? iso(2) : null }))

  const rows = splitBy([...mk("cold", 4, 1), ...mk("affinity", 5, 3)], "relationship")
  const cold = rows.find((r) => r.key === "cold")!
  const aff = rows.find((r) => r.key === "affinity")!

  ok(`4 reached is SUPPRESSED (below ${MIN_SPLIT_N})`, cold.suppressed === true)
  ok("a suppressed row exposes no rate at all", cold.rate === null)
  ok("a suppressed row still reports its count", cold.reached === 4 && cold.replied === 1)
  ok(`5 reached is NOT suppressed (at ${MIN_SPLIT_N})`, aff.suppressed === false)
  ok("an unsuppressed row reports its rate (3/5 = 60%)", pct(aff.rate) === "60%")
  ok("rows sort by reached, descending", rows[0].key === "affinity")
  ok("suppressed rows are kept, not dropped", rows.length === 2)
}

// Unset values are not a bucket — they are the needs-attention row instead.
ok("contacts with no relationship form no split row",
  splitBy([c({ relationship: null }), c({ relationship: "" })], "relationship").length === 0)

// ── funnel ─────────────────────────────────────────────────────────────────
{
  const f = funnel([
    c({ stage: "identified" }), c({ stage: "identified" }),
    c({ stage: "intro_requested" }), c({ stage: "sequence_active" }),
    c({ stage: "chat_done" }),
    c({ stage: "dormant_no_answer" }), c({ stage: "dormant_declined" }),
  ])
  const get = (p: string) => f.find((g) => g.phase === p)!.count
  ok("funnel has all seven groups", f.length === 7)
  ok("idle counts identified", get("idle") === 2)
  ok("active merges intro_requested + sequence_active", get("active") === 2)
  ok("momentum counts chat_done", get("momentum") === 1)
  ok("resting merges BOTH dormant stages", get("resting") === 2)
  ok("empty groups are kept with count 0", get("won") === 0)
  ok("every contact lands in exactly one group",
    f.reduce((s, g) => s + g.count, 0) === 7)
}

// ── weekly first touches ───────────────────────────────────────────────────
{
  const monday = startOfWeek(NOW).getTime()
  ok("week starts on Monday", new Date(monday).getDay() === 1)
  const n = weeklyFirstTouches([
    c({ first_touch_at: iso(monday + DAY) }),      // this week
    c({ first_touch_at: iso(monday) }),            // exactly Monday -> counts
    c({ first_touch_at: iso(monday - DAY) }),      // last week
    c({ first_touch_at: null }),
  ], NOW)
  ok("counts first touches since Monday inclusive", n === 2)
}

// ── needs attention ────────────────────────────────────────────────────────
{
  const t = NOW.getTime()
  const list = [
    c({ stage: "sequence_active", last_action_at: iso(t - 15 * DAY) }),  // stalled
    c({ stage: "sequence_active", last_action_at: iso(t - 13 * DAY) }),  // not yet
    c({ stage: "replied", last_action_at: iso(t - 40 * DAY) }),          // wrong stage
    c({ stage: "identified", priority: "A" }),                            // A + identified
    c({ stage: "identified", priority: "B" }),
    c({ stage: "dormant_no_answer", next_due_at: iso(t + 3 * DAY) }),     // resurfacing
    c({ stage: "dormant_declined", next_due_at: iso(t + 30 * DAY) }),     // too far out
    c({ relationship: "cold" }),
  ]
  const a = needsAttention(list, NOW)
  ok("stalled needs 14+ days AND sequence_active", a.stalled.length === 1)
  ok("13 days is not yet stalled (boundary)", isStalled(list[1], NOW) === false)
  ok("a stalled-looking contact in another stage does not count", isStalled(list[2], NOW) === false)
  ok("priority A at identified only", a.priorityAIdentified.length === 1)
  ok("resurfacing is within 7 days only", a.resurfacing.length === 1)
  ok("no-relationship counts every unset one", a.noRelationship.length === 7)
}

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
