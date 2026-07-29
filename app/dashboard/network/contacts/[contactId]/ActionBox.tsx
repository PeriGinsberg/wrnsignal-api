"use client"

// "Your next move" — the primary surface of the contact record.
//
// The screen's job is one question: what do I do with this person, and let me
// do it. Everything below this box is reference. So this is the only element
// with an accent border, it sits directly under the header, and the one warm
// button on the screen lives inside it (SendPanel's "Copy and mark as sent").
//
// It is a frame, not new behaviour: SendPanel is unchanged underneath, including
// the 8d copy-first-then-log ordering and the ephemeral per-contact scratchpad.

import { T } from "../../../../../lib/dashboard-theme"
import { SendPanel } from "./SendPanel"

type Contact = {
  id: string
  first_name: string
  relationship?: string | null
  stage?: string | null
  next_due_reason?: string | null
  additional_info?: string | null
  network_companies?: { name: string } | null
}

export function ActionBox({ contact, onLogged }: { contact: Contact; onLogged: () => void }) {
  return (
    <section
      data-testid="action-box"
      style={{
        marginTop: 16, borderRadius: 18, padding: "16px 18px",
        background: T.CARD,
        // The accent border is the whole signal: one surface on the page reads
        // as "act here", and it is this one.
        border: `1px solid rgba(254,176,106,0.38)`,
        boxShadow: "0 0 0 3px rgba(254,176,106,0.05)",
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase",
        color: T.WRN_ORANGE, marginBottom: 12,
      }}>
        Your next move
      </div>
      <SendPanel contact={contact as never} onLogged={onLogged} />
    </section>
  )
}
