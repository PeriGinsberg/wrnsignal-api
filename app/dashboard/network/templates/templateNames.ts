// The one place a template ID becomes a word a person would say.
//
// The letter codes (IN, A2, S4, L1…) stay exactly what they are in storage, in
// the routes, and in ?id=, and are just never rendered. Everything the
// Templates screen puts on screen comes from here, which is what makes "no code
// on screen" a property one test can assert instead of a rule to remember.
//
// Two invariants, both asserted in the test rather than at runtime, because the
// failure they catch is a template that becomes invisible, not broken, which
// someone would notice, but absent, which nobody does:
//   unplacedIds():  every template has somewhere on screen to live
//   unnamedIds():   every template has a name to live under

import { RELATIONSHIPS, RELATIONSHIP_LABELS, RELATIONSHIP_TO_FAMILY } from "../vocab"
import { TEMPLATE_IDS } from "../../../../lib/network-tracker/templates"
import { STAGE_INTERVALS } from "../../../../lib/network-tracker/reminder-engine"

// Touch 1/2/3 named as the writer experiences them. "Last follow-up" rather
// than "Touch 3" says what the others do not: this is the end of the sequence,
// and the contact goes dormant after it.
export const TOUCH_NAMES = ["First outreach", "Follow-up", "Last follow-up"] as const

// Days DERIVED from the reminder engine, not restated. The engine schedules
// touch 2 at +7d from the first and touch 3 at +5d from THAT, so the cumulative
// day a card shows can never drift from the day the reminder actually fires.
export const TOUCH_DAYS: readonly number[] = [
  0,
  STAGE_INTERVALS.sequence_active.touch_2,
  STAGE_INTERVALS.sequence_active.touch_2 + STAGE_INTERVALS.sequence_active.touch_3,
]

export type Placement =
  | { kind: "sequence"; relationship: string; touch: 1 | 2 | 3 }
  | { kind: "reply" }
  | { kind: "linkedin" }

// Sequences are derived from RELATIONSHIP_TO_FAMILY for the same reason the old
// grouping was: pickTemplate (8c) routes a contact to a family through that map,
// so a card here can never claim a grouping the join does not use.
const SEQUENCE_PLACEMENTS: Record<string, Placement> = {}
for (const rel of RELATIONSHIPS) {
  const family = RELATIONSHIP_TO_FAMILY[rel]
  for (const touch of [1, 2, 3] as const) {
    const id = `${family}${touch}`
    if (TEMPLATE_IDS.includes(id)) SEQUENCE_PLACEMENTS[id] = { kind: "sequence", relationship: rel, touch }
  }
}

// The replies: written once, they work for anyone, so they are not tied to a
// relationship. IN sits here rather than in a sequence because asking a mutual
// for an introduction is a message to a THIRD person, not to the contact.
export const REPLY_IDS = ["IN", "S1", "S2", "S3", "S4", "S5"] as const

// LinkedIn's three are real, written defaults and reachable in the old rail, so
// they get a group rather than quietly disappearing in the redesign.
export const LINKEDIN_IDS = ["L1", "L2", "L3"] as const

export const PLACEMENT_BY_ID: Record<string, Placement> = {
  ...SEQUENCE_PLACEMENTS,
  ...Object.fromEntries(REPLY_IDS.map((id) => [id, { kind: "reply" } as Placement])),
  ...Object.fromEntries(LINKEDIN_IDS.map((id) => [id, { kind: "linkedin" } as Placement])),
}

// The reply and LinkedIn names. The defaults carry a `label` already, but they
// are terse and inconsistent ("The ask", "Nurture · every 4-8 weeks") because
// they were written as internal shorthand. These are what a person reads.
//
// L1/L2 pull their relationship word from RELATIONSHIP_LABELS so they track the
// who-picker: rename "Something in Common" once and the LinkedIn card follows,
// instead of the screen saying two different words for one relationship.
const LIBRARY_NAMES: Record<string, string> = {
  IN: "Intro request",
  S1: "Scheduling a call",
  S2: "Thank-you",
  S3: "Check-in",
  S4: "Ask for referral",
  S5: "Thanks for the intro",
  L1: `Connect note · ${RELATIONSHIP_LABELS.affinity}`,
  L2: `Connect note · ${RELATIONSHIP_LABELS.cold}`,
  L3: "First message after they accept",
}

export const NAME_BY_ID: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(SEQUENCE_PLACEMENTS).map(([id, p]) => [
      id,
      TOUCH_NAMES[(p as { touch: number }).touch - 1],
    ]),
  ),
  ...LIBRARY_NAMES,
}

/** Templates with nowhere on screen to live. Must be empty. */
export function unplacedIds(): string[] {
  return TEMPLATE_IDS.filter((id) => !PLACEMENT_BY_ID[id])
}

/** Templates that would render as a bare code. Must be empty. */
export function unnamedIds(): string[] {
  return TEMPLATE_IDS.filter((id) => !NAME_BY_ID[id])
}

/** The three sequence IDs for a relationship, in touch order. */
export function sequenceIds(relationship: string): string[] {
  const family = RELATIONSHIP_TO_FAMILY[relationship]
  if (!family) return []
  return [1, 2, 3].map((n) => `${family}${n}`).filter((id) => TEMPLATE_IDS.includes(id))
}
