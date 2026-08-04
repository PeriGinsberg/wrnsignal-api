"use client"

// "Your next message, ready to send" — the primary surface of the contact record.
//
// The screen's job is one question: what do I do with this person, and let me
// do it. Everything below this box is reference.
//
// Redesign step 4: it is a NAVY hero now rather than an accent-bordered card.
// On the dark theme an orange border was how one surface said "act here". On
// light, navy is structure and the peach button inside is the only action colour
// on the page, so the hero can carry the weight without a border trick.
//
// It is a frame, not new behaviour: SendPanel is unchanged underneath, including
// the copy-first-then-log ordering and the ephemeral per-contact scratchpad.

import { LIGHT as S } from "../../../../../lib/theme/surfaces"
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
    <>
      <section
        data-testid="action-box"
        style={{
          marginTop: 20,
          borderRadius: 18,
          padding: "22px 24px",
          background: S.hero.background,
          boxShadow: S.shadow.raised,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: S.hero.muted,
            marginBottom: 14,
          }}
        >
          Your next message, ready to send
        </div>
        <SendPanel contact={contact as never} onLogged={onLogged} />
      </section>

      {/* Teaches the one thing that is not obvious: the draft is not a fixed
          template, it tracks the moment. Sits outside the hero so the hero stays
          purely the thing you act on. */}
      <p
        style={{
          margin: "12px 0 0",
          padding: "14px 18px",
          borderRadius: 12,
          background: S.meaning.sequence.fill,
          color: S.meaning.sequence.ink,
          fontSize: 14,
          lineHeight: "21px",
        }}
      >
        <strong style={{ fontWeight: 800 }}>The message changes to fit the moment.</strong>{" "}
        First hello, a follow-up, a thank-you after you talk. You will always see the right one,
        already written. No setup needed.
      </p>
    </>
  )
}
