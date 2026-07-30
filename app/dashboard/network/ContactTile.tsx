"use client"

// The two-letter initial tile for a contact. ONE definition, shared by every
// surface that shows a person, so the record header and the list can never
// disagree about what colour someone is.
//
// The colour comes from stagePillStyle(), which is the exact function the stage
// pill already uses: STAGE_PHASE maps the stage to a phase group and the shared
// palette colours it. That is deliberate rather than convenient. A second
// derivation, however carefully copied, is a thing that drifts the first time
// someone edits one of them.
//
// The "not started" grey falls out of that same rule instead of being a special
// case: `identified` maps to the `idle` phase, whose colour IS the neutral. So a
// contact nobody has worked is grey because of what phase it is in, not because
// of an if-statement here.

import { stagePillStyle } from "./vocab"

export function initialsOf(c: { first_name?: string | null; last_name?: string | null }): string {
  const a = (c.first_name ?? "").trim().charAt(0)
  const b = (c.last_name ?? "").trim().charAt(0)
  return `${a}${b}`.toUpperCase() || "?"
}

export function ContactTile({
  contact, size = 34, testId,
}: {
  contact: { first_name?: string | null; last_name?: string | null; stage: string }
  /** Square edge in px. The header uses a larger tile than a list row would. */
  size?: number
  testId?: string
}) {
  return (
    <span
      aria-hidden
      data-testid={testId ?? "contact-tile"}
      data-stage={contact.stage}
      style={{
        ...stagePillStyle(contact.stage),
        flex: "0 0 auto",
        width: size,
        height: size,
        // Rounded square rather than a circle: a circle reads as an avatar
        // photo that failed to load, a tile reads as a deliberate mark.
        borderRadius: Math.round(size * 0.3),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.38),
        fontWeight: 900,
        letterSpacing: 0.3,
        lineHeight: 1,
      }}
    >
      {initialsOf(contact)}
    </span>
  )
}
