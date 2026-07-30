"use client"

// Layer 2 of the help: the callout a first-timer reads once and never sees
// again. Shown until dismissed, then replaced by a quiet "How this works" link
// so it can be reopened — dismissing help should never mean losing it.
//
// The last line is the part text teaches better than colour can: calm fills
// itself, amber is yours. It says out loud what the bracket colouring shows.

import { useState } from "react"
import { T, card } from "../../../../lib/dashboard-theme"

export function HowThisWorks({
  dismissed, onDismiss,
}: { dismissed: boolean; onDismiss: () => void }) {
  // Reopening is local: someone who wants a second look does not need that
  // written to the database, and persisting it would make "dismissed" mean two
  // different things.
  const [reopened, setReopened] = useState(false)
  const showing = !dismissed || reopened

  if (!showing) {
    return (
      <button
        onClick={() => setReopened(true)}
        data-testid="how-this-works-reopen"
        style={{
          background: "none", border: "none", padding: 0, marginTop: 10,
          color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer",
          textDecoration: "underline", fontFamily: "inherit",
        }}
      >
        How this works
      </button>
    )
  }

  return (
    <div data-testid="how-this-works" style={{
      ...card, marginTop: 14, padding: "14px 16px", maxWidth: 640,
      display: "flex", alignItems: "flex-start", gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: T.TEXT, fontSize: 13, fontWeight: 900, marginBottom: 8 }}>
          How this works
        </div>
        <ol style={{
          margin: 0, paddingLeft: 18, color: T.MUTED, fontSize: 12.5, lineHeight: "20px",
        }}>
          <li>Pick who you&apos;re messaging — the buttons up top.</li>
          <li>Your three messages for that kind of person appear, already written.</li>
          <li>Edit any of them to sound like you. Your version is saved and used from then on.</li>
        </ol>
        <p style={{ color: T.MUTED, fontSize: 12.5, lineHeight: "20px", margin: "9px 0 0" }}>
          The highlighted parts fill in for you: the calm ones come from your profile and the
          contact automatically; <strong style={{ color: T.WRN_ORANGE }}>the amber ones are
          yours to write</strong> when you send, like a specific question.
        </p>
      </div>
      <button
        onClick={() => { setReopened(false); onDismiss() }}
        aria-label="Dismiss"
        data-testid="how-this-works-dismiss"
        style={{
          background: "none", border: "none", color: T.DIM, fontSize: 17,
          lineHeight: "17px", cursor: "pointer", padding: 0, flex: "0 0 auto",
        }}
      >
        ×
      </button>
    </div>
  )
}
