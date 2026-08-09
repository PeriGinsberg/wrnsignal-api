"use client"

// One contact, as a designed card. Replaces the spreadsheet row for the
// Contacts list (the row component in ContactRow.tsx is still the source of the
// shared Contact type and dueOf, and is still used nowhere else yet; it goes
// when the Companies board is redesigned).
//
// The card is the locked language on one object:
//   tile     phase-coloured for a worked contact, flat grey for one nobody has
//            touched, so the eye lands on what is alive
//   status   a dot plus text, both the meaning's ink. Never a button, because
//            status is information and the only tappable-looking thing on a card
//            is allowed to be the action
//   action   filled peach when something is genuinely due, outline when it is
//            available but not urgent (Start, on a contact never contacted),
//            and nothing at all when the ball is in their court. "waiting" is a
//            word, not a disabled button
//
// The whole card opens the record. The action button is a SEPARATE click target
// that also opens the record, at the point where the draft is ready to send.

import { useState } from "react"
import {
  LIGHT as S,
  PHASE_MEANING,
  status as statusStyle,
  action as actionStyle,
  tile,
  tileIdle,
  type MeaningKey,
} from "../../../../lib/theme/surfaces"
import { STAGE_LABELS, STAGE_PHASE, REASON_LABELS } from "../vocab"
import { timeAgo } from "../../../../lib/relativeTime"
import { dueOf, type Contact } from "./ContactRow"

function initials(c: Contact): string {
  const a = (c.first_name || "").trim().charAt(0)
  const b = (c.last_name || "").trim().charAt(0)
  return (a + b).toUpperCase() || "?"
}

function meaningFor(stage: string): MeaningKey {
  return PHASE_MEANING[STAGE_PHASE[stage] ?? "idle"]
}

/** Title and company, joined only when both are there, so no stray separator. */
function subtitle(c: Contact): string {
  const company = c.network_companies?.name ?? null
  return [c.title, company].filter(Boolean).join(" · ")
}

export function ContactCard({
  contact: c,
  selectMode = false,
  checked = false,
  onToggle,
  flash = false,
}: {
  contact: Contact
  selectMode?: boolean
  checked?: boolean
  onToggle?: () => void
  flash?: boolean
}) {
  const [hover, setHover] = useState(false)

  const key = meaningFor(c.stage)
  const idle = key === "idle"
  const st = statusStyle(S, key)
  const href = `/dashboard/network/contacts/${c.id}`

  // What this contact needs from the student, if anything. A due reason is the
  // engine saying "this one is on you now", so it earns the filled action. A
  // never-contacted contact earns the outline: worth doing, not overdue. Anything
  // else is waiting on them, and gets no button.
  // Null for a contact nobody has worked, which is what keeps the untouched
  // rows quiet on every axis at once.
  const lastActivity = timeAgo(c.last_action_at)

  /**
   * WHEN IT IS DUE, not just how long it has been.
   *
   * The card showed elapsed time and an action label and never once said when
   * anything was owed, which is why a tester on a correctly-ordered board could
   * not tell who to contact first. "Three weeks ago" is fine on a nurture
   * contact and alarming on someone who owed a reply on Tuesday, and the two
   * rows looked identical.
   *
   * dueOf is reused from ContactRow rather than reimplemented: two copies of
   * the same date maths is how the spreadsheet and the board end up disagreeing
   * about what is overdue. Its colours are the dark-theme tokens, so only the
   * label and `kind` cross over and the light palette is applied here.
   */
  const due = dueOf(c.next_due_at)
  const overdue = due.kind === "overdue"
  const dueTone =
    due.kind === "overdue" ? S.meaning.error.ink
      : due.kind === "due_today" ? S.meaning.progress.ink
      : S.text.dim

  const reason = c.next_due_reason
  const dueLabel = reason ? REASON_LABELS[reason] ?? "Reach out" : null
  const tier: "primary" | "optional" | null = dueLabel ? "primary" : idle ? "optional" : null

  return (
    <div
      data-testid="contact-card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 18px",
        borderRadius: 14,
        // Active lifts, idle recedes. The idle card keeps a hairline so the list
        // still reads as a list, but loses the shadow that makes a card float.
        background: idle ? "#FBFDFE" : S.card,
        border: `1px solid ${S.borderSoft}`,
        // OVERDUE HAS TO LOOK OVERDUE. Until now an overdue row and an idle one
        // were pixel-identical, so the sort put the urgent thing first and the
        // card gave the eye nothing to land on. A left rail rather than a tint:
        // it reads down a column at a glance and does not fight the flash
        // outline or the hover shadow for the same surface.
        borderLeft: overdue ? `3px solid ${S.meaning.error.accent}` : `1px solid ${S.borderSoft}`,
        boxShadow: idle ? "none" : hover ? S.shadow.raised : S.shadow.card,
        outline: flash ? `2px solid ${S.meaning.progress.accent}` : "none",
        outlineOffset: 1,
        transition: "box-shadow 160ms ease, outline-color 600ms ease-out",
      }}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${c.first_name} ${c.last_name}`}
          style={{ cursor: "pointer", flexShrink: 0, width: 16, height: 16 }}
        />
      )}

      <a
        href={href}
        aria-label={`${c.first_name} ${c.last_name}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flex: 1,
          minWidth: 0,
          textDecoration: "none",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            ...(idle ? tileIdle(S) : tile(S, key)),
            width: 46,
            height: 46,
            borderRadius: 12,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 0.5,
          }}
        >
          {initials(c)}
        </span>

        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 16,
              fontWeight: 800,
              color: idle ? S.text.secondary : S.text.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.first_name} {c.last_name}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 13.5,
              color: S.text.muted,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle(c) || "No title yet"}
          </span>
        </span>
      </a>

      {/* Status, and when it last moved. Recency sits with STATE rather than in
          the identity line, because "replied, three weeks ago" is one thought:
          the state means something different depending on how stale it is.

          Only rows with activity get the line. A contact nobody has written to
          has no "last" anything, and printing "never" on every untouched row
          would be noise on exactly the rows that are already quiet. */}
      <span
        style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end",
          gap: 3, flexShrink: 0,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span style={st.dot} />
          <span style={{ ...st.text, fontSize: 14.5, whiteSpace: "nowrap" }}>
            {STAGE_LABELS[c.stage] ?? c.stage}
          </span>
        </span>
        {/* The due phrase REPLACES elapsed time when something is actually due:
            two time facts on one line is worse than either alone, and the one
            that matters is the commitment, not the gap. Rows with nothing due
            keep the recency line they always had. */}
        {due.kind !== "none" ? (
          <span
            style={{ fontSize: 12.5, color: dueTone, fontWeight: overdue ? 800 : 600, whiteSpace: "nowrap" }}
          >
            {due.label}
          </span>
        ) : lastActivity ? (
          <span style={{ fontSize: 12.5, color: S.text.dim, whiteSpace: "nowrap" }}>
            {lastActivity}
          </span>
        ) : null}
      </span>

      {/* minWidth, not width. A fixed slot is narrower than the longest label
          ("Send final follow-up"), and because the button cannot wrap it
          overflowed leftwards and sat on top of the status text. Reserving a
          minimum keeps the buttons aligned down the list when labels are short,
          while letting the slot grow for the long ones. */}
      <span style={{ minWidth: 132, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
        {tier ? (
          <a
            href={href}
            style={{
              ...actionStyle(S, tier),
              textDecoration: "none",
              fontSize: 13.5,
              padding: "9px 16px",
              borderRadius: 10,
              whiteSpace: "nowrap",
            }}
          >
            {dueLabel ?? "Start"}
          </a>
        ) : (
          // No action means no button, never a disabled one.
          <span style={{ fontSize: 13.5, color: S.text.dim, fontStyle: "italic" }}>waiting</span>
        )}
      </span>
    </div>
  )
}
