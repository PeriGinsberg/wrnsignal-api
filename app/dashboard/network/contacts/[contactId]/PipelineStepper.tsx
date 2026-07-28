"use client"

import { Fragment, useState } from "react"
import { T } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { STAGE_LABELS } from "../../vocab"

// The v3 contact pipeline, rendered as a horizontal numbered stepper adapted
// from the prospect StageTracker (app/dashboard/coach/prospects/[id]/page.tsx).
// Differences from that source, by design:
//   • a contact has ONE current stage (no reached-history) — "reached" is derived
//     as the spine stages before the current one, purely to fill the path;
//   • EVERY stage stays clickable in any direction — no stage is illegal, so the
//     engine never has to guess (relationship shapes emphasis, never legality);
//   • the two dormant stages are side-states below the band, not nodes 10/11.
//
// Setting a stage POSTs to .../stage; the engine computes the due date once. The
// engine's only stage write is sequence_active → dormant_no_answer.

// The linear spine (9 live stages). dormant_* are handled separately below.
const SPINE = [
  "identified", "intro_requested", "sequence_active", "replied", "chat_scheduled",
  "chat_done", "nurture", "ask_made", "outcome",
] as const

// Labels come from STAGE_LABELS (the shared map) — keys only here.
const DORMANT = ["dormant_no_answer", "dormant_declined"] as const

const OUTCOME_TYPES = [
  { key: "referral", label: "Referral" },
  { key: "intro", label: "Intro" },
  { key: "lead", label: "Lead" },
] as const

// Presentation only (#3): stages a relationship TYPICALLY SKIPS are greyed but
// stay clickable. This never filters legality — every stage is still settable.
// referred uses intro_requested; recruiter skips it AND usually ask_made;
// personal/affinity/cold skip intro_requested unless a mutual turns up.
const SKIPPED_BY_RELATIONSHIP: Record<string, string[]> = {
  personal: ["intro_requested"],
  affinity: ["intro_requested"],
  cold: ["intro_requested"],
  referred: [],
  recruiter: ["intro_requested", "ask_made"],
}

type Contact = {
  id: string
  stage: string
  outcome_type: string | null
  relationship: string | null
}

export function PipelineStepper({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  // #3 suggestion: after moving a non-referred contact to intro_requested,
  // offer (don't force) to set relationship = referred.
  const [suggestReferred, setSuggestReferred] = useState(false)

  const relationship = contact.relationship ?? ""
  const skipped = new Set(SKIPPED_BY_RELATIONSHIP[relationship] ?? [])
  const currentIndex = SPINE.indexOf(contact.stage as (typeof SPINE)[number])
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
      // Intro request on a non-referred contact → suggest becoming Referred.
      if (patch.stage === "intro_requested" && relationship !== "referred") setSuggestReferred(true)
      onChanged()
    } catch (e: any) {
      setErr(e?.message || String(e))
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
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p style={{ fontSize: 11, color: T.DIM, margin: "0 0 12px" }}>
        Click a stage to set it — any stage, any direction.
      </p>

      {/* Horizontal stepper band. overflow-x scroll keeps the connected stepper
          one continuous row on narrow viewports; min-content stops it squashing. */}
      <div style={{ overflowX: "auto", paddingBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "flex-start", minWidth: "min-content" }}>
          {SPINE.map((s, i) => {
            const isCurrent = contact.stage === s
            const reached = currentIndex >= 0 && i < currentIndex
            const isSkipped = skipped.has(s) && !reached && !isCurrent
            const isBusy = busy === s
            const isHover = hoveredKey === s && !isCurrent && !isBusy

            const circleColor = isCurrent ? T.WRN_ORANGE : reached ? T.SUCCESS : isHover ? T.TEXT : T.DIM
            const circleBorder = isCurrent ? T.WRN_ORANGE : reached ? "rgba(74,222,128,0.5)" : isHover ? T.MUTED : T.BORDER
            const circleBg = isCurrent ? T.NAV_ACTIVE_BG : reached ? "rgba(74,222,128,0.18)" : isHover ? T.GLASS : "transparent"
            const labelColor = isCurrent ? T.WRN_ORANGE : reached ? T.TEXT : isHover ? T.TEXT : T.MUTED

            return (
              <Fragment key={s}>
                {/* connector to the previous node — green once the path reaches here */}
                {i > 0 && (
                  <div
                    aria-hidden
                    style={{
                      flex: "0 0 28px",
                      height: 2,
                      marginTop: 13,
                      background: currentIndex >= 0 && i <= currentIndex ? "rgba(74,222,128,0.5)" : T.BORDER_SOFT,
                    }}
                  />
                )}
                <button
                  onClick={() => { if (!isCurrent && !isBusy) setStage({ stage: s }, s) }}
                  onMouseEnter={() => { if (!isCurrent && !isBusy) setHoveredKey(s) }}
                  onMouseLeave={() => setHoveredKey(null)}
                  disabled={isBusy || isCurrent}
                  title={isSkipped ? `${STAGE_LABELS[s]} — unusual for a ${relationship} contact, but allowed` : `Set to ${STAGE_LABELS[s]}`}
                  style={{
                    flex: "0 0 auto",
                    width: 92,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    background: "transparent",
                    border: "none",
                    padding: "0 4px",
                    fontFamily: "inherit",
                    cursor: isCurrent || isBusy ? "default" : "pointer",
                    // #3: skipped-for-this-relationship stages are greyed but clickable.
                    opacity: isSkipped ? 0.38 : 1,
                    transition: "opacity 120ms ease",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 28, height: 28, borderRadius: 999, flexShrink: 0,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 900,
                      border: `1px solid ${circleBorder}`,
                      background: circleBg,
                      color: circleColor,
                      transition: "all 120ms ease",
                    }}
                  >
                    {isBusy ? "…" : reached ? "✓" : i + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 11, lineHeight: "14px", textAlign: "center",
                      color: labelColor,
                      fontWeight: isCurrent ? 800 : reached ? 700 : 500,
                      transition: "color 120ms ease",
                    }}
                  >
                    {STAGE_LABELS[s]}
                  </span>
                </button>
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* Two dormant side-states. no-answer is usually engine-set; declined is a
          manual "they said no / not now" move that starts the 90-day clock. */}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {DORMANT.map((key) => {
          const on = contact.stage === key
          const dBusy = busy === key
          return (
            <button
              key={key}
              onClick={() => { if (!on && !dBusy) setStage({ stage: key }, key) }}
              disabled={dBusy || on}
              style={{
                background: on ? "rgba(255,255,255,0.10)" : "none",
                color: on ? T.TEXT : T.DIM,
                border: `1px solid ${on ? T.BORDER : T.BORDER_SOFT}`,
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 700,
                cursor: on || dBusy ? "default" : "pointer",
              }}
            >
              {dBusy ? "…" : STAGE_LABELS[key]}
            </button>
          )
        })}
        {isDormant && <span style={{ color: T.MUTED, fontSize: 11 }}>Will resurface automatically.</span>}
      </div>

      {/* #3 suggestion — requesting an intro is how a contact becomes Referred.
          Suggest, don't force: the stage change already succeeded. */}
      {suggestReferred && (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(81,173,229,0.10)",
            border: `1px solid rgba(81,173,229,0.35)`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
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
          <div style={{ color: T.MUTED, fontSize: 11, fontWeight: 800, marginBottom: 8 }}>Outcome type</div>
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
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
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
