"use client"

// Pipeline control on the contact record. Two stacked elements:
//
//   1. PHASE BAR — 7 segments, one per phase group, full width, never scrolls.
//      Display only. Shows where the contact is at a glance.
//   2. STAGE DROPDOWN — all 11 stages by plain-English label in a coloured pill.
//      Shows and sets the current stage. Every stage selectable, any direction.
//
// This replaces an 11-node horizontal stepper that did not fit: it scrolled
// sideways on any normal viewport and clipped its longest label ("Keeping in
// touch"). Eleven fixed-width nodes cannot be made to fit; seven flexible
// segments can, and the precise stage moves into a control that is already
// the pattern everywhere else (spreadsheet, company board).
//
// The bar's grouping and colours BOTH come from the shared 7-group map
// (STAGE_PHASE → PHASE), the same source the stage pills read, so the bar and
// the pill can never disagree about which phase a stage belongs to.
//
// Dormant stages are folded INTO the dropdown rather than kept as side buttons:
// the spec is "every stage selectable, any direction", the dropdown already
// lists all 11, and "Resting" is the 7th segment on the bar — so a separate
// pair of buttons would be a second control for a state already reachable and
// already visible.

import { useState } from "react"
import { T, PHASE, fieldLabel, select as selectStyle, selectOption } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { STAGE_LABELS, STAGE_PHASE, PHASE_ORDER, PHASE_LABELS, FIELD_LABELS, stagePillStyle } from "../../vocab"

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

export function PhaseBar({ stage }: { stage: string }) {
  const current = STAGE_PHASE[stage] ?? "idle"
  return (
    <div
      role="group"
      aria-label={`Phase: ${PHASE_LABELS[current]}`}
      style={{ display: "flex", gap: 4, width: "100%" }}
    >
      {PHASE_ORDER.map((p) => {
        const on = p === current
        return (
          <div
            key={p}
            data-phase={p}
            data-active={on ? "true" : "false"}
            aria-current={on ? "step" : undefined}
            // flex:1 + minWidth:0 is what keeps seven segments inside the
            // container at any width instead of overflowing into a scroller.
            style={{ flex: 1, minWidth: 0 }}
          >
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: on ? PHASE[p].fg : T.BORDER_SOFT,
                transition: "background 160ms ease",
              }}
            />
            <div
              style={{
                marginTop: 5,
                fontSize: 9.5,
                fontWeight: on ? 800 : 600,
                letterSpacing: 0.2,
                textAlign: "center",
                color: on ? PHASE[p].fg : T.DIM,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {PHASE_LABELS[p]}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PipelineStepper({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Requesting an intro is how a contact becomes Referred. Suggest, don't force.
  const [suggestReferred, setSuggestReferred] = useState(false)

  const relationship = contact.relationship ?? ""
  const isDormant = contact.stage === "dormant_no_answer" || contact.stage === "dormant_declined"

  async function setStage(patch: { stage?: string; outcome_type?: string }, key: string) {
    setBusy(key)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    setBusy("suggest")
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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

  return (
    <div>
      <PhaseBar stage={contact.stage} />

      <div style={{ marginTop: 16, display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={fieldLabel}>{FIELD_LABELS.stage}</span>
          <select
            value={contact.stage}
            onChange={(e) => setStage({ stage: e.target.value }, e.target.value)}
            disabled={busy !== null}
            aria-label={FIELD_LABELS.stage}
            style={{
              ...selectStyle,
              ...stagePillStyle(contact.stage),
              height: 36, padding: "0 12px", fontSize: 12.5, width: 210,
              fontWeight: 700, borderRadius: 999,
              opacity: busy !== null ? 0.55 : 1,
            }}
          >
            {Object.entries(STAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k} style={selectOption}>{v}</option>
            ))}
          </select>
        </label>
        <span style={{ color: T.DIM, fontSize: 11, paddingBottom: 10 }}>
          {busy !== null ? "Saving…" : isDormant ? "Will resurface automatically." : "Any stage, any direction."}
        </span>
      </div>

      {suggestReferred && (
        <div
          style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 12,
            background: "rgba(81,173,229,0.10)", border: `1px solid rgba(81,173,229,0.35)`,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}
        >
          <span style={{ color: T.TEXT, fontSize: 12, flex: "1 1 240px" }}>
            Requesting an intro usually turns a contact into a <strong>Referred</strong> one. Update the relationship?
          </span>
          <button
            onClick={applyReferred}
            disabled={busy === "suggest"}
            style={{
              background: T.GRAD_PRIMARY, color: "#04060F", fontWeight: 900, fontSize: 12,
              border: "none", borderRadius: 10, padding: "8px 14px", cursor: "pointer",
            }}
          >
            {busy === "suggest" ? "Saving…" : "Set to Referred"}
          </button>
          <button
            onClick={() => setSuggestReferred(false)}
            style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            Not now
          </button>
        </div>
      )}

      {/* Sub-attribute: outcome type on the outcome stage */}
      {contact.stage === "outcome" && (
        <div style={{ marginTop: 14, padding: "12px 14px", background: T.GLASS, borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}` }}>
          <div style={{ ...fieldLabel, marginBottom: 8 }}>Outcome type</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {OUTCOME_TYPES.map((o) => {
              const on = contact.outcome_type === o.key
              return (
                <button
                  key={o.key}
                  onClick={() => setStage({ outcome_type: o.key }, `outcome:${o.key}`)}
                  disabled={busy !== null}
                  style={{
                    background: on ? "rgba(81,173,229,0.15)" : T.NAV_DEFAULT_BG,
                    color: on ? T.WRN_BLUE : T.TEXT,
                    border: `1px solid ${on ? "rgba(81,173,229,0.4)" : T.BORDER_SOFT}`,
                    borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {err && <div style={{ color: T.ERROR, fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  )
}
