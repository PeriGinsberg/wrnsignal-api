// lib/networking-plan/planData.ts
// The Outreach Messages tab, as structured plan content.
//
// The tab holds two different kinds of row and tells them apart by shape rather
// than by a type column:
//
//   a TOUCH   has a Channel, a Touch, a When, and a Message
//   a NOTE    has prose in the Channel cell and nothing else
//
// The notes are the "how the sequence works" bullets a coach writes at the
// bottom of the tab; the first of them is a heading the template already
// supplies, so it is dropped rather than repeated.
//
// Pure, so every mapping decision below is testable without a spreadsheet, a
// browser, or Drive.

export type Touch = {
  channel: string        // "Email" | "LinkedIn" | "Either" | anything a coach types
  touch: string          // "1" | "2" | "Thank you"
  when: string           // "Day 7 (reply to your own first email...)"
  subject: string | null
  message: string
  howToUse: string | null
}

export type PlanContent = {
  emailTouches: Touch[]
  linkedinTouches: Touch[]
  otherTouches: Touch[]   // "Either", thank-you, anything not the two sequences
  notes: string[]         // the bullets for "How the sequence works"
  cadence: { day: string; what: string }[]
}

const cell = (row: string[], i: number) => (row[i] ?? "").toString().trim()

/** The leading "Day N" of a When, which is what the cadence strip shows. */
export function dayOf(when: string): string | null {
  const m = when.match(/^\s*(day\s*\d+)/i)
  return m ? m[1].replace(/\s+/g, " ").replace(/^day/i, "Day") : null
}

/**
 * Group the touches into the cadence strip at the top of the plan: one stop per
 * distinct Day, in the order they first appear, labelled with the touches that
 * happen then. Derived rather than hardcoded, so a four-touch plan gets a
 * four-stop strip without anyone editing the template.
 */
export function buildCadence(touches: Touch[]): { day: string; what: string }[] {
  const byDay = new Map<string, string[]>()
  for (const t of touches) {
    const day = dayOf(t.when)
    if (!day) continue
    const label = `${t.channel} ${t.touch}`.trim()
    const list = byDay.get(day) ?? []
    if (!list.includes(label)) list.push(label)
    byDay.set(day, list)
  }
  return [...byDay.entries()].map(([day, labels]) => ({ day, what: labels.join(" + ") }))
}

/**
 * Turn the tab's data rows into plan content.
 *
 * `rows` are the rows under the header, in sheet order, as the import parser
 * already produces them.
 */
export function buildPlanContent(rows: string[][]): PlanContent {
  const touches: Touch[] = []
  const notes: string[] = []

  for (const row of rows) {
    const channel = cell(row, 0)
    const touch = cell(row, 1)
    const when = cell(row, 2)
    const subject = cell(row, 3)
    const message = cell(row, 4)
    const howToUse = cell(row, 5)

    if (!channel) continue

    // A touch is a row that actually carries a message to send.
    if (message) {
      touches.push({
        channel,
        touch,
        when,
        subject: subject || null,
        message,
        howToUse: howToUse || null,
      })
      continue
    }

    // Otherwise it is prose. A short one that matches the section heading the
    // template already prints is a duplicate of it, not a bullet.
    if (!touch && !when) notes.push(channel)
  }

  // The first prose row is the heading for the ones under it ("How the sequence
  // works"), which section 1 of the template already renders as its <h2>.
  const bullets = notes.length > 1 && notes[0].length < 60 ? notes.slice(1) : notes

  const isEmail = (t: Touch) => /^email$/i.test(t.channel)
  const isLinkedIn = (t: Touch) => /^linkedin$/i.test(t.channel)

  return {
    emailTouches: touches.filter(isEmail),
    linkedinTouches: touches.filter(isLinkedIn),
    otherTouches: touches.filter((t) => !isEmail(t) && !isLinkedIn(t)),
    notes: bullets,
    // Only the two real sequences drive the strip; a thank-you note has no day.
    cadence: buildCadence(touches.filter((t) => isEmail(t) || isLinkedIn(t))),
  }
}
