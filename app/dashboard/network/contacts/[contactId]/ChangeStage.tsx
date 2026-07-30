"use client"

// The full stage control, folded behind a toggle.
//
// Replaces PipelineStepper on this screen. The phase bar is gone — its job was
// "where is this person", which the header pill now does in one element instead
// of seven segments — and the dropdown moved behind "Change stage" because on a
// screen built for a user with no coach, the loud controls should be the frequent
// forward moves, not the terminal ones.
//
// It still offers ALL ELEVEN stages, not just the rare ones the quick actions
// leave out. Someone occasionally needs "Keeping in touch", or to undo a
// mistaken tap, and the alternative would be sending them to the spreadsheet to
// fix a record they are already looking at.
//
// Two behaviours ride along with the dropdown and would have been lost with it:
// the outcome-type sub-attribute, and the "requesting an intro usually means
// Referral" suggestion.

import { useState } from "react"
import { T, fieldLabel, select as selectStyle, selectOption } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { STAGE_LABELS, FIELD_LABELS, RELATIONSHIP_LABELS, stagePillStyle } from "../../vocab"

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
        Change stage →
      </button>
    )
  }

  return (
    <div data-testid="change-stage-panel" style={{
      marginTop: 4, padding: "12px 14px", borderRadius: 12,
      background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={fieldLabel}>{FIELD_LABELS.stage}</span>
          <select
            value={contact.stage}
            onChange={(e) => setStage({ stage: e.target.value }, e.target.value)}
            disabled={busy !== null}
            aria-label={FIELD_LABELS.stage}
            style={{
              ...selectStyle, ...stagePillStyle(contact.stage),
              height: 34, padding: "0 12px", fontSize: 12.5, width: 200,
              fontWeight: 700, borderRadius: 999, opacity: busy !== null ? 0.55 : 1,
            }}
          >
            {Object.entries(STAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k} style={selectOption}>{v}</option>
            ))}
          </select>
        </label>
        <span style={{ color: T.DIM, fontSize: 11, paddingBottom: 9, flex: 1 }}>
          {busy !== null ? "Saving…" : isDormant ? "Will resurface automatically." : "Any stage, any direction."}
        </span>
        <button onClick={() => setOpen(false)} style={{ ...quiet, paddingBottom: 9 }}>Done</button>
      </div>

      {contact.stage === "outcome" && (
        // The sub-attribute of the outcome stage. It lives with the control that
        // can reach that stage — orphaning it would make "Got the outcome"
        // set a state whose defining detail could never be filled in.
        <div style={{ marginTop: 12 }}>
          <div style={{ ...fieldLabel, marginBottom: 7 }}>Outcome type</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} data-testid="outcome-types">
            {OUTCOME_TYPES.map((o) => {
              const on = contact.outcome_type === o.key
              return (
                <button key={o.key} onClick={() => setStage({ outcome_type: o.key }, `outcome:${o.key}`)}
                  disabled={busy !== null}
                  style={{
                    background: on ? T.BLUE_BG_ON : T.NAV_DEFAULT_BG,
                    color: on ? T.WRN_BLUE : T.TEXT,
                    border: `1px solid ${on ? T.BLUE_BORDER_ON : T.BORDER_SOFT}`,
                    borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {suggestReferred && (
        <div style={{
          marginTop: 12, padding: "11px 13px", borderRadius: 11,
          background: T.BLUE_BG, border: `1px solid ${T.BLUE_BORDER}`,
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ color: T.TEXT, fontSize: 12, flex: "1 1 220px" }}>
            Requesting an intro usually turns a contact into a{" "}
            <strong>{RELATIONSHIP_LABELS.referred}</strong> one. Update the relationship?
          </span>
          <button onClick={applyReferred} disabled={busy === "suggest"}
            style={{
              background: T.GRAD_PRIMARY, color: T.INK_ON_ACCENT, fontWeight: 900, fontSize: 12,
              border: "none", borderRadius: 10, padding: "7px 13px", cursor: "pointer",
            }}>
            {busy === "suggest" ? "Saving…" : `Set to ${RELATIONSHIP_LABELS.referred}`}
          </button>
          <button onClick={() => setSuggestReferred(false)} style={quiet}>Not now</button>
        </div>
      )}

      {err && <div style={{ color: T.ERROR, fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  )
}

const quiet: React.CSSProperties = {
  background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700,
  cursor: "pointer", padding: 0, fontFamily: "inherit",
}
