"use client"

// The full stage control, folded behind a toggle.
//
// It offers ALL ELEVEN stages, not just the ones the quick moves cover. Someone
// occasionally needs "Keeping in touch", or to undo a mistaken tap, and the
// alternative would be sending them to the list to fix a record they are already
// looking at.
//
// Two behaviours ride along with the dropdown and would have been lost with it:
// the outcome-type sub-attribute, and the "requesting an intro usually means
// Referral" suggestion.
//
// Redesign step 4: light theme, and it opens inside the "Where things stand"
// card. The trigger reads "OTHER MOVES", not "Change", because that is what it
// holds once the stepper circles took over forward progress. Everything the
// circles cannot reach is in here and nowhere else:
//   - the two off-path stages, "No answer" and "Declined"
//   - "Outcome", which is on the path but deliberately never one tap
//   - every BACKWARD move, since a circle behind you is disabled. This is the
//     only undo on the screen, which "Change" did not advertise.
//   - the outcome-type sub-attribute, whose only writer is this component
//   - the "an intro request usually means Referral" relationship prompt

import { useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { STAGE_LABELS, FIELD_LABELS, RELATIONSHIP_LABELS } from "../../vocab"

const OUTCOME_TYPES = [
  { key: "referral", label: "Referral" },
  { key: "intro", label: "Intro" },
  { key: "lead", label: "Lead" },
] as const

type Contact = {
  id: string
  stage: string
  outcome_type: string | null
  relationship: string | null
}

export function ChangeStage({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [suggestReferred, setSuggestReferred] = useState(false)

  const relationship = contact.relationship ?? ""
  const isDormant = contact.stage === "dormant_no_answer" || contact.stage === "dormant_declined"

  async function setStage(patch: { stage?: string; outcome_type?: string }, key: string) {
    setBusy(key); setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: contact.stage, ...patch }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Update failed (${res.status})`)
      if (patch.stage === "intro_requested" && relationship !== "referred") setSuggestReferred(true)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function applyReferred() {
    setBusy("suggest"); setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationship: "referred" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Update failed (${res.status})`)
      setSuggestReferred(false)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} data-testid="change-stage-open" style={quiet}>
        Other moves ▾
      </button>
    )
  }

  return (
    <div
      data-testid="change-stage-panel"
      style={{
        marginTop: 14, padding: "16px 18px", borderRadius: 12,
        background: S.well, border: `1px solid ${S.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={fieldLabelStyle}>{FIELD_LABELS.stage}</span>
          <select
            value={contact.stage}
            onChange={(e) => setStage({ stage: e.target.value }, e.target.value)}
            disabled={busy !== null}
            aria-label={FIELD_LABELS.stage}
            style={{
              background: S.card, color: S.text.primary, border: `1px solid ${S.border}`,
              height: 40, padding: "0 12px", fontSize: 14, width: 210,
              fontWeight: 700, borderRadius: 10, fontFamily: "inherit", cursor: "pointer",
              opacity: busy !== null ? 0.55 : 1,
            }}
          >
            {Object.entries(STAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <span style={{ color: S.text.muted, fontSize: 13, paddingBottom: 11, flex: 1 }}>
          {busy !== null ? "Saving…" : isDormant ? "Will resurface automatically." : "Any stage, any direction."}
        </span>
        <button onClick={() => setOpen(false)} style={{ ...quiet, paddingBottom: 11 }}>Done</button>
      </div>

      {contact.stage === "outcome" && (
        // The sub-attribute of the outcome stage. It lives with the control that
        // can reach that stage: orphaning it would make "Got the outcome" set a
        // state whose defining detail could never be filled in.
        <div style={{ marginTop: 16 }}>
          <div style={{ ...fieldLabelStyle, marginBottom: 8 }}>Outcome type</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} data-testid="outcome-types">
            {OUTCOME_TYPES.map((o) => {
              const on = contact.outcome_type === o.key
              return (
                <button
                  key={o.key}
                  onClick={() => setStage({ outcome_type: o.key }, `outcome:${o.key}`)}
                  disabled={busy !== null}
                  style={{
                    background: on ? S.meaning.progress.fill : S.card,
                    color: on ? S.meaning.progress.ink : S.text.secondary,
                    border: `1px solid ${on ? S.meaning.progress.accent : S.border}`,
                    borderRadius: 999, padding: "8px 15px", fontSize: 13.5, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {suggestReferred && (
        <div
          style={{
            marginTop: 16, padding: "14px 16px", borderRadius: 11,
            background: S.meaning.progress.fill, border: `1px solid ${S.meaning.progress.accent}`,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}
        >
          <span style={{ color: S.meaning.progress.ink, fontSize: 13.5, flex: "1 1 220px", lineHeight: "20px" }}>
            Requesting an intro usually turns a contact into a{" "}
            <strong>{RELATIONSHIP_LABELS.referred}</strong> one. Update the relationship?
          </span>
          <button
            onClick={applyReferred}
            disabled={busy === "suggest"}
            style={{
              ...actionStyle(S, "primary"),
              borderRadius: 10, padding: "9px 15px", fontSize: 13.5, fontFamily: "inherit",
            }}
          >
            {busy === "suggest" ? "Saving…" : `Set to ${RELATIONSHIP_LABELS.referred}`}
          </button>
          <button onClick={() => setSuggestReferred(false)} style={quiet}>Not now</button>
        </div>
      )}

      {err && <div style={{ color: S.meaning.error.ink, fontSize: 13, marginTop: 10 }}>{err}</div>}
    </div>
  )
}

const quiet: React.CSSProperties = {
  background: "none", border: "none", color: S.action.quietInk, fontSize: 13.5, fontWeight: 700,
  cursor: "pointer", padding: 0, fontFamily: "inherit",
}
const fieldLabelStyle: React.CSSProperties = {
  color: S.text.muted, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
}
