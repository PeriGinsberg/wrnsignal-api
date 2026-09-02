// Run: npx tsx tests/network-tracker/message-drafts.test.ts
//
// A DRAFT IS NOT A TOUCH.
//
// network_actions holds messages now, and a draft carries a real type because
// it is the outreach it will become: a draft of the second follow-up is
// type touch_2, status draft. If the engine counted it, writing a message and
// not sending it would advance the sequence, and a contact would be flipped to
// dormant_no_answer for failing to reply to something nobody sent.
//
// The rule lives INSIDE computeNextDue rather than in the three routes that
// call it, so these assertions are about the function and not about a query.

import { computeNextDue } from "../../lib/network-tracker/reminder-engine"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const CREATED = "2026-01-01T00:00:00Z"
const CYCLE = "2026-01-10T00:00:00Z"
const LAST = "2026-01-20T00:00:00Z"

function due(actions: { type: string; action_date?: string; status?: string | null }[]) {
  return computeNextDue({
    stage: "sequence_active",
    createdAt: CREATED,
    lastActionAt: LAST,
    reminderOverride: null,
    dormantSince: null,
    pokeEnabled: false,
    actions,
    cycleStartedAt: CYCLE,
    pipelineActivity: false,
  })
}

const sentT2 = { type: "touch_2", action_date: "2026-01-15T00:00:00Z", status: "sent" }
const draftT2 = { type: "touch_2", action_date: "2026-01-15T00:00:00Z", status: "draft" }
const loggedT2 = { type: "touch_2", action_date: "2026-01-15T00:00:00Z" }   // pre-message row

function main() {
  console.log("\nthe baseline the drafts must not disturb")
  ok("no touches -> touch_2 is next", due([]).nextDueReason === "touch_2")
  ok("one SENT touch_2 -> touch_3 is next", due([sentT2]).nextDueReason === "touch_3")
  ok("a pre-message row with NO status still counts", due([loggedT2]).nextDueReason === "touch_3")

  console.log("\na draft counts for nothing")
  ok("one DRAFT touch_2 -> still touch_2 next", due([draftT2]).nextDueReason === "touch_2")
  ok("...i.e. identical to having logged nothing",
    due([draftT2]).nextDueReason === due([]).nextDueReason)
  ok("three drafts still count for nothing",
    due([draftT2, { ...draftT2, type: "touch_3" }, draftT2]).nextDueReason === "touch_2")

  console.log("\nthe failure this prevents: dormant for unanswered silence")
  const twoSent = due([sentT2, { ...sentT2, type: "touch_3" }])
  ok("two SENT touches exhaust the sequence", twoSent.stage === "dormant_no_answer" || twoSent.nextDueReason === "resurface_no_answer")
  const twoDrafts = due([draftT2, { ...draftT2, type: "touch_3" }])
  ok("two DRAFTS do NOT", twoDrafts.stage !== "dormant_no_answer")
  ok("...and leave the contact still owed a touch_2", twoDrafts.nextDueReason === "touch_2")

  console.log("\nmixed, which is the real board")
  ok("one sent and one draft counts as one",
    due([sentT2, { ...draftT2, type: "touch_3" }]).nextDueReason === "touch_3")

  console.log("\nstatus is orthogonal to the cycle window")
  const beforeCycle = { type: "touch_2", action_date: "2026-01-05T00:00:00Z", status: "sent" }
  ok("a SENT touch before the cycle start is still excluded by the cycle rule",
    due([beforeCycle]).nextDueReason === "touch_2")
}

main()
console.log(failures === 0 ? "\nall message-draft assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
