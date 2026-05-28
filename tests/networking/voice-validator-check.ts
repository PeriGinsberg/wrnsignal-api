// tests/networking/voice-validator-check.ts
//
// Unit tests for lib/networking/voiceValidator. Five cases mandated by the
// v8 validator spec:
//   (a) known-good NW-DVP62ET3 v7 lean-voice output → passes
//   (b) synthetic 5-paragraph linkedin_message       → fails on length
//   (c) message containing "pick your brain"         → fails on banned phrase
//   (d) message containing [Company] unfilled        → fails on bracket leak
//   (e) message containing [Name]                    → PASSES (intended slot)
//
// Run: npx tsx tests/networking/voice-validator-check.ts
// Exit 1 on any assertion failure.

import {
  validatePlan,
  BANNED_PHRASES,
  LENGTH_CAPS,
} from "../../lib/networking/voiceValidator"

let failures = 0

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${label}`)
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

// ──────────────────────────────────────────────────────────────────────
// (a) Known-good v7 baseline: NW-DVP62ET3 (Josh Rosenblatt / SMS Intl)
// Verbatim from prod-dev networking_runs row 2026-05-28T13:04:18Z.
// All three moves should pass cleanly: only [Name] brackets, no banned
// phrases, lengths well under caps.
// ──────────────────────────────────────────────────────────────────────
const NW_DVP62ET3 = {
  framing: "...",
  strategy: "...",
  application_state: "applied_today",
  moves: [
    {
      move_id: "move_1",
      target_type: "Peer in scheduling role",
      linkedin_connection_request:
        "Hi [Name], I recently applied for the Scheduling Coordinator role at SMS International and noticed you're doing similar work in the travel/cruise space. Would love to connect and learn how you approach the role.",
      linkedin_message:
        "Hi [Name], I recently applied for the Scheduling Coordinator role at SMS International. I have a logistics and operations background, and I'm reaching out to learn what the hiring team actually prioritizes when evaluating candidates for this kind of role. Would you have 10 minutes for a quick call this week?\n\nBest,\nJosh",
      email_body: "",
      follow_up_message:
        "Hey [Name], following up on my message from a couple days ago. Would still love to grab 10 minutes if you have time this week. Thanks.",
    },
    {
      move_id: "move_2",
      target_type: "credibility bridge",
      linkedin_connection_request:
        "Hi [Name], I'm a recent UF grad applying for a Scheduling Coordinator role and noticed you also studied at Florida and moved into operations coordination. Would love to connect.",
      linkedin_message:
        "Hi [Name], I recently applied for a Scheduling Coordinator role at SMS International and noticed you also studied at UF and transitioned into operations work. I have a strong logistics and event coordination background, and I'm reaching out to learn how you positioned that experience for a scheduling or workforce planning role. Would you have 10 minutes for a quick call this week?\n\nBest,\nJosh",
      email_body: "",
      follow_up_message:
        "Hey [Name], following up on my message. Still hoping to grab 10 minutes to talk through the transition from logistics to scheduling. Thanks.",
    },
    {
      move_id: "move_3",
      target_type: "process owner",
      linkedin_connection_request:
        "Hi [Name], I recently applied for the Scheduling Coordinator role at SMS International and wanted to connect. Looking forward to learning more about the team.",
      linkedin_message:
        "Hi [Name], I recently applied for the Scheduling Coordinator role at SMS International. I'm reaching out to learn more about what the hiring team prioritizes when evaluating candidates for this position. Would you have 10 minutes for a quick call this week?\n\nBest,\nJosh",
      email_body:
        "Hi [Name],\n\nI recently applied for the Scheduling Coordinator role at SMS International. I'm reaching out to learn more about what the hiring team prioritizes when evaluating candidates for this position.\n\nWould you have 10 minutes for a quick call this week?\n\nBest,\nJosh Rosenblatt\n(561) 990-9298",
      follow_up_message:
        "Hi [Name], following up on my message from a couple days ago. Still interested in learning more about the role and the team's priorities. Thanks.",
    },
  ],
}

console.log("\n=== (a) known-good NW-DVP62ET3 v7 baseline → passes ===")
{
  const result = validatePlan(NW_DVP62ET3)
  assert(
    result.ok,
    "validatePlan returns ok=true",
    result.ok
      ? undefined
      : `violations: ${JSON.stringify(result.violations, null, 2)}`,
  )
  assert(
    result.violations.length === 0,
    "violations.length === 0",
    `got ${result.violations.length}`,
  )
}

// ──────────────────────────────────────────────────────────────────────
// (b) Synthetic 5-paragraph linkedin_message → length_chars violation
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== (b) 5-paragraph linkedin_message → fails on length ===")
{
  const longParagraph =
    "I built an Excel template that increased efficiency by 70% across job costing workflows. I coordinated 1,000+ projects through that system, working cross-functionally with project managers and field crews on every iteration."
  const bloatedMessage = [
    "Hi [Name], I recently applied for the Scheduling Coordinator role at SMS International.",
    longParagraph,
    longParagraph,
    longParagraph,
    longParagraph,
    "Would you have 10 minutes for a quick call this week?\n\nBest,\nJosh",
  ].join("\n\n")
  const plan = {
    moves: [
      {
        move_id: "move_1",
        linkedin_connection_request: "Hi [Name].",
        linkedin_message: bloatedMessage,
        email_body: "",
        follow_up_message: "Hey [Name], following up.",
      },
    ],
  }
  const result = validatePlan(plan)
  assert(!result.ok, "validatePlan returns ok=false")
  const hasLengthChars = result.violations.some(
    (v) => v.field === "linkedin_message" && v.reason === "length_chars",
  )
  assert(
    hasLengthChars,
    "fires length_chars on linkedin_message",
    `violations: ${JSON.stringify(result.violations.map((v) => `${v.field}:${v.reason}`))}`,
  )
  // bonus check: cap value referenced in detail
  const v = result.violations.find(
    (v) => v.field === "linkedin_message" && v.reason === "length_chars",
  )
  assert(
    Boolean(v && v.detail.includes("> 700 cap")),
    "detail references 700 cap",
    v?.detail,
  )
}

// ──────────────────────────────────────────────────────────────────────
// (c) "pick your brain" → banned_phrase violation
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== (c) 'pick your brain' → fails on banned_phrase ===")
{
  const plan = {
    moves: [
      {
        move_id: "move_1",
        linkedin_connection_request: "Hi [Name], can I pick your brain?",
        linkedin_message: "Hi [Name], short message.",
        email_body: "",
        follow_up_message: "Hey.",
      },
    ],
  }
  const result = validatePlan(plan)
  assert(!result.ok, "validatePlan returns ok=false")
  const hasBanned = result.violations.some(
    (v) =>
      v.field === "linkedin_connection_request" &&
      v.reason === "banned_phrase" &&
      v.detail.includes("pick your brain"),
  )
  assert(hasBanned, "fires banned_phrase on linkedin_connection_request")
  // case-insensitivity sanity
  const planUpper = {
    moves: [
      {
        move_id: "move_1",
        linkedin_message: "Hi [Name], can I PICK YOUR BRAIN about the role?",
      },
    ],
  }
  const upperResult = validatePlan(planUpper)
  assert(
    !upperResult.ok && upperResult.violations.some((v) => v.reason === "banned_phrase"),
    "case-insensitive match (PICK YOUR BRAIN)",
  )
}

// ──────────────────────────────────────────────────────────────────────
// (d) [Company] unfilled → bracket_leak violation
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== (d) [Company] unfilled → fails on bracket_leak ===")
{
  const plan = {
    moves: [
      {
        move_id: "move_1",
        linkedin_connection_request: "Hi [Name], I applied at [Company].",
        linkedin_message: "Hi [Name], short.",
        email_body: "",
        follow_up_message: "Hey.",
      },
    ],
  }
  const result = validatePlan(plan)
  assert(!result.ok, "validatePlan returns ok=false")
  const hasBracket = result.violations.some(
    (v) =>
      v.field === "linkedin_connection_request" &&
      v.reason === "bracket_leak" &&
      v.detail.includes("[Company]"),
  )
  assert(hasBracket, "fires bracket_leak on [Company]")
  // also check [Role], [Your Name] — all unfilled placeholders should fire
  const planMulti = {
    moves: [
      {
        move_id: "move_1",
        linkedin_message:
          "Hi [Name], I applied for the [Role] role at [Company]. Best, [Your Name]",
      },
    ],
  }
  const multiResult = validatePlan(planMulti)
  const leaks = multiResult.violations.filter((v) => v.reason === "bracket_leak")
  assert(
    leaks.length === 3,
    "3 leaks for [Role], [Company], [Your Name]",
    `got ${leaks.length}: ${JSON.stringify(leaks.map((v) => v.detail))}`,
  )
}

// ──────────────────────────────────────────────────────────────────────
// (e) [Name] alone → PASSES (intended recipient-fill slot)
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== (e) [Name] only → passes (intended slot) ===")
{
  const plan = {
    moves: [
      {
        move_id: "move_1",
        linkedin_connection_request:
          "Hi [Name], I recently applied for the Scheduling Coordinator role at SMS International.",
        linkedin_message:
          "Hi [Name], short message that mentions no other brackets. Best, Josh",
        email_body: "",
        follow_up_message: "Hey [Name], following up.",
      },
    ],
  }
  const result = validatePlan(plan)
  assert(result.ok, "validatePlan returns ok=true with [Name] present")
  assert(result.violations.length === 0, "no violations")
  // also confirm case-insensitive allow: [name] / [NAME]
  const planLower = {
    moves: [
      {
        move_id: "move_1",
        linkedin_message: "Hi [name], short. Hi [NAME], short. Best, Josh.",
      },
    ],
  }
  const lowerResult = validatePlan(planLower)
  assert(
    lowerResult.ok,
    "case-insensitive [name] / [NAME] both allowed",
    JSON.stringify(lowerResult.violations),
  )
}

// ──────────────────────────────────────────────────────────────────────
// Sanity: caps + banned constants exported as expected
// ──────────────────────────────────────────────────────────────────────
console.log("\n=== sanity: exports ===")
{
  assert(LENGTH_CAPS.linkedin_message.chars === 700, "lm char cap = 700")
  assert(LENGTH_CAPS.linkedin_message.sentences === 7, "lm sentence cap = 7")
  assert(LENGTH_CAPS.email_body.chars === 700, "email_body char cap = 700")
  assert(LENGTH_CAPS.email_body.sentences === 7, "email_body sentence cap = 7")
  assert(
    LENGTH_CAPS.linkedin_connection_request.chars === 300,
    "lk_connection char cap = 300",
  )
  assert(
    LENGTH_CAPS.linkedin_connection_request.sentences === null,
    "lk_connection sentence cap = null",
  )
  assert(
    LENGTH_CAPS.follow_up_message.chars === 300,
    "follow_up char cap = 300",
  )
  assert(
    LENGTH_CAPS.follow_up_message.sentences === 4,
    "follow_up sentence cap = 4",
  )
  assert(BANNED_PHRASES.length === 8, "8 banned phrases")
  assert(
    BANNED_PHRASES.includes("pick your brain") &&
      BANNED_PHRASES.includes("I'd value your perspective") &&
      BANNED_PHRASES.includes("would appreciate"),
    "expected banned phrases present",
  )
}

console.log(
  `\n=== ${failures === 0 ? "✅ all checks passed" : `❌ ${failures} failure(s)`} ===`,
)
process.exit(failures === 0 ? 0 : 1)
