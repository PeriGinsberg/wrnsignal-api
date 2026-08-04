"use client"

// "Where things stand" — the state of this relationship, in one card.
//
// Replaces QuickActions, which was a row of stage buttons under the heading
// "Something happened?". Same capability, better question: the card ANSWERS
// where you are before it offers to change it.
//
// The position is a LABELLED STEP-CIRCLE STEPPER, the same pattern as the
// Coaches Center prospects pipeline: completed steps filled and ticked, the
// current step marked, every circle labelled with its stage. A plain progress
// bar showed how far along you were but never said what any segment MEANT, so
// the position was only legible next to a separate status label. With the
// stepper the position is self-evident, which is why the header no longer
// repeats the stage in words.
//
// COLOUR, mapped into light and kept inside the exclusivity rule:
//   done     teal, our positive colour (light has no green)
//   current  attention AMBER, the darkened ink, never the peach accent
//   ahead    muted, a hairline circle
// Peach stays action-only. The current step is attention ink on its pale fill,
// which is the documented status pairing, so no saturated peach appears outside
// a button. See COLOR-SYSTEM.md section 6.9.
//
// THE CIRCLES ARE THE CONTROL, same as the prospects pipeline. The pair of
// "They replied" / "We talked" buttons underneath said the same thing the
// circles already said, so the circles absorbed them: clicking a step ahead of
// you advances to it. Everything those buttons could do still can be done.
//   forward   click the circle. "They replied" and "Chat happened" are the same
//             two moves those buttons made, by the same words.
//   backward  Change, which offers all eleven stages in any direction. The
//             buttons could go backward too, so this is where that went.
//   terminal  Change. `outcome` sits on the path so you can SEE it coming, but
//             it is not clickable: a rare irreversible-feeling move should not
//             be one accidental tap away on a screen built for someone with no
//             coach to undo it for them. The dormant stages are off the path
//             entirely and were never one tap.
// No circle is peach. Advancing a stage is bookkeeping; peach belongs to the
// message.

import { Fragment, useState } from "react"
import { LIGHT as S } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { ChangeStage } from "./ChangeStage"
import { STAGE_LABELS } from "../../vocab"
import { StepCompleteIcon, StepRestingIcon } from "../../../../../components/icons"

type Contact = {
  id: string
  stage: string
  outcome_type: string | null
  relationship: string | null
}

/**
 * The linear path, in order. The two dormant stages are deliberately absent:
 * "No answer" and "Declined" are not steps forward, they are where a thread
 * stops, so putting them on the path would imply progress toward them. A
 * contact sitting in one is handled below the stepper instead.
 */
const PATH = [
  "identified",
  "intro_requested",
  "sequence_active",
  "replied",
  "chat_scheduled",
  "chat_done",
  "nurture",
  "ask_made",
  "outcome",
] as const

const RESTING = new Set(["dormant_no_answer", "dormant_declined"])

/** On the path so you can see it coming, but never one tap. Set it from Change. */
const NOT_ONE_TAP = new Set(["outcome"])

export function WhereThingsStand({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const resting = RESTING.has(contact.stage)
  // -1 when resting or unrecognised: nothing on the path is current, so nothing
  // is filled, and the caption below carries the state instead.
  const currentIndex = resting ? -1 : PATH.indexOf(contact.stage as (typeof PATH)[number])
  const nextStage = currentIndex >= 0 ? PATH[currentIndex + 1] ?? null : null

  async function move(stage: string) {
    setBusy(stage); setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Update failed (${res.status})`)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      style={{
        marginTop: 14, padding: "20px 22px", borderRadius: 14,
        background: S.card, border: `1px solid ${S.borderSoft}`, boxShadow: S.shadow.card,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span
          style={{
            fontSize: 12, fontWeight: 800, letterSpacing: 1.4,
            textTransform: "uppercase", color: S.text.muted,
          }}
        >
          Where things stand
        </span>
        <ChangeStage contact={contact} onChanged={onChanged} />
      </div>

      {/* Horizontal band. Overflow-x keeps the connectors continuous and the
          labels readable rather than wrapping nine columns into a grid. */}
      <div style={{ overflowX: "auto", padding: "16px 0 4px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", minWidth: "min-content" }}>
          {PATH.map((stageKey, i) => {
            const done = currentIndex >= 0 && i < currentIndex
            const isCurrent = i === currentIndex
            const circleInk = isCurrent ? S.meaning.attention.ink : done ? S.meaning.replied.ink : S.text.dim
            const circleBg = isCurrent ? S.meaning.attention.fill : done ? S.meaning.replied.fill : "transparent"
            const circleBorder = isCurrent ? S.meaning.attention.ink : done ? S.meaning.replied.accent : S.border
            // Only steps AHEAD of you advance. Behind is history and is changed
            // through Change; the terminal step is never one tap.
            const advanceable =
              currentIndex >= 0 && i > currentIndex && !NOT_ONE_TAP.has(stageKey) && busy === null

            return (
              <Fragment key={stageKey}>
                {/* Connector to the previous step, filled once this step is
                    reached, so the completed path reads as one run. */}
                {i > 0 && (
                  <div
                    aria-hidden
                    style={{
                      flex: "0 0 22px", height: 2, marginTop: 13,
                      background: done || isCurrent ? S.meaning.replied.accent : S.borderSoft,
                    }}
                  />
                )}
                <button
                  type="button"
                  data-testid={`step-${stageKey}`}
                  onClick={() => { if (advanceable) void move(stageKey) }}
                  disabled={!advanceable}
                  title={
                    advanceable ? `Advance to ${STAGE_LABELS[stageKey]}`
                      : NOT_ONE_TAP.has(stageKey) ? "Set this from Change"
                      : isCurrent ? "Where this stands now"
                      : done ? "Already past this"
                      : undefined
                  }
                  style={{
                    flex: "0 0 auto", width: 86,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                    padding: "0 3px", background: "none", border: "none", fontFamily: "inherit",
                    cursor: advanceable ? "pointer" : "default",
                    opacity: busy === stageKey ? 0.55 : 1,
                  }}
                >
                  {done ? (
                    // The drawn tick, teal, matching the stepper's done state.
                    <StepCompleteIcon size={28} />
                  ) : (
                    <span
                      aria-hidden
                      style={{
                        width: 28, height: 28, borderRadius: 999, flexShrink: 0,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 900,
                        border: `1.5px solid ${circleBorder}`,
                        background: circleBg,
                        color: circleInk,
                      }}
                    >
                      {i + 1}
                    </span>
                  )}
                  {/* The CURRENT step's label is the screen's statement of the
                      stage, which is why it carries the stage-pill hook: the
                      header used to say it in words and no longer needs to. */}
                  <span
                    {...(isCurrent ? { "data-testid": "stage-pill" } : {})}
                    style={{
                      fontSize: 11.5, lineHeight: "15px", textAlign: "center",
                      color: isCurrent ? S.meaning.attention.ink : done ? S.text.secondary : S.text.dim,
                      fontWeight: isCurrent ? 800 : done ? 700 : 500,
                    }}
                  >
                    {STAGE_LABELS[stageKey]}
                  </span>
                </button>
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* Off the path. A resting contact has no position to mark, so it is
          stated rather than drawn, and it carries the stage hook in that case. */}
      {resting && (
        <div
          data-testid="stage-pill"
          style={{ marginTop: 6, color: S.meaning.dormant.ink, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}
        >
          <StepRestingIcon size={26} />
          {STAGE_LABELS[contact.stage] ?? contact.stage}
        </div>
      )}

      {/* Plain text, not a button. The advance lives on the circle above; saying
          it twice is what we just removed. This only names what comes next. */}
      {nextStage && (
        <p style={{ margin: "14px 0 0", color: S.text.muted, fontSize: 14 }}>
          Next step: <strong style={{ color: S.text.secondary, fontWeight: 700 }}>{STAGE_LABELS[nextStage]}</strong>
        </p>
      )}

      {err && (
        <div style={{ color: S.meaning.error.ink, fontSize: 13, marginTop: 10 }} data-testid="quick-error">
          {err}
        </div>
      )}
    </section>
  )
}
