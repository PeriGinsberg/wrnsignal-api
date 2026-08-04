"use client"

// "Where things stand" — the state of this relationship, in one card.
//
// Replaces QuickActions, which was a row of stage buttons under the heading
// "Something happened?". Same capability, better question: the card now ANSWERS
// where you are before it offers to change it, which is what the mockup shows
// and what a student with no coach actually needs. A progress bar for position,
// a plain sentence for meaning, and the moves underneath.
//
// The two frequent forward moves stay prominent and the terminal ones stay
// behind Change, unchanged: on a screen built for someone with no coach, a rare
// irreversible-feeling move should not be one accidental tap away from the
// common one.
//
// The moves are NOT peach. Peach is the action colour and it belongs to the one
// thing you came here to do, which is send the message in the hero above.
// Recording that something happened is bookkeeping, so it takes the quiet
// secondary treatment.

import { useState } from "react"
import { LIGHT as S, PHASE_MEANING } from "../../../../../lib/theme/surfaces"
import type { PhaseKey } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { ChangeStage } from "./ChangeStage"
import { STAGE_PHASE, FUNNEL_PHASES } from "../../vocab"

type Contact = {
  id: string
  stage: string
  outcome_type: string | null
  relationship: string | null
}

const FREQUENT = [
  { stage: "replied", label: "They replied" },
  { stage: "chat_done", label: "We talked" },
] as const

/**
 * The state of play, in the student's words.
 *
 * DELIBERATELY NOT a stage label. `vocab.ts` owns the noun for a stage ("Message
 * sent"); this owns the sentence about it ("You sent a message. Waiting to hear
 * back."). Two registers, two jobs, so neither has to compromise: a label has to
 * fit in a pill on a list row, a sentence has room to say what it means.
 */
const STANDING: Record<string, string> = {
  identified: "You have not reached out yet. The first message is ready above.",
  intro_requested: "You asked someone for an introduction. Waiting on them.",
  sequence_active: "You sent a message. Waiting to hear back.",
  replied: "They replied. Your move.",
  chat_scheduled: "You have a conversation booked.",
  chat_done: "You talked. Worth a thank-you while it is fresh.",
  nurture: "Keeping this one warm. No rush.",
  ask_made: "You asked for a referral. Waiting to hear back.",
  outcome: "This one paid off.",
  dormant_no_answer: "No answer so far. It will resurface when it is worth another try.",
  dormant_declined: "They passed. Resting, not closed.",
}

export function WhereThingsStand({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const phase: PhaseKey = STAGE_PHASE[contact.stage] ?? "idle"
  const resting = phase === "resting"
  // `idle` is excluded from the bar. It is the ZERO state, not a step: a contact
  // nobody has written to has made no progress, and rendering it as a reached
  // segment was indistinguishable from an unreached one anyway, because idle's
  // accent is the same grey the empty segments use.
  const STEPS = FUNNEL_PHASES.filter((p) => p !== "idle")
  // How far along this contact is. Resting is not a step of progress, so it
  // fills nothing and says so in words instead.
  const reached = resting ? -1 : STEPS.indexOf(phase)

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

      {/* Position as a filled run of segments. Each reached phase takes its own
          meaning colour, so the bar and the status dot on the list agree. */}
      <div
        style={{ display: "flex", gap: 5, margin: "14px 0 12px" }}
        role="img"
        aria-label={resting ? "Resting" : `Step ${reached + 1} of ${STEPS.length}`}
      >
        {STEPS.map((p, i) => (
          <span
            key={p}
            style={{
              flex: 1, height: 6, borderRadius: 999,
              background: i <= reached ? S.meaning[PHASE_MEANING[p]].accent : S.meaning.idle.accent,
            }}
          />
        ))}
      </div>

      <p style={{ margin: 0, color: S.text.secondary, fontSize: 15, lineHeight: "23px" }}>
        {STANDING[contact.stage] ?? "Where this stands is not clear yet."}
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
        {FREQUENT.map((a) => {
          const on = contact.stage === a.stage
          return (
            <button
              key={a.stage}
              onClick={() => void move(a.stage)}
              disabled={busy !== null || on}
              data-testid={`quick-${a.stage}`}
              title={on ? "Already at this stage" : undefined}
              style={{
                background: S.card,
                color: on ? S.text.dim : S.text.secondary,
                border: `1px solid ${S.border}`,
                borderRadius: 999,
                padding: "9px 17px", fontSize: 13.5, fontWeight: 700, fontFamily: "inherit",
                cursor: busy !== null || on ? "default" : "pointer",
                opacity: busy === a.stage ? 0.6 : 1,
              }}
            >
              {busy === a.stage ? "Saving…" : a.label}
            </button>
          )
        })}
      </div>

      {err && (
        <div style={{ color: S.meaning.error.ink, fontSize: 13, marginTop: 10 }} data-testid="quick-error">
          {err}
        </div>
      )}
    </section>
  )
}
