"use client"

// The prospect workflow's confirm dialogs. Every milestone shows the chain of
// events it will run and waits for Confirm (prospect workflow, Phase 1):
// marking lost, moving back a stage, booking the consult, and the consult's
// three outcomes all go through ChainConfirmDialog.

import { useEffect, useState, type ReactNode } from "react"
import { T, btnPrimary, btnSecondary, card, eyebrow, input, label, selectDarkInk, selectDarkOption, textarea } from "../../../../lib/dashboard-theme"
import { SavingSpinner } from "../SavingSpinner"
import { LOST_REASONS, LOST_REASON_LABEL, type LostReason } from "../../../../lib/prospects/model"

/**
 * A modal that lists what will happen, takes any inputs the step needs
 * (children), and runs only on Confirm. `canConfirm` false keeps Confirm off
 * until the inputs are valid. A refused save shows the server's sentence and
 * leaves the dialog open.
 */
export function ChainConfirmDialog(props: {
  title: string
  steps: string[]
  confirmLabel: string
  onConfirm: () => Promise<{ ok: true } | { ok: false; error: string }>
  onClose: () => void
  canConfirm?: boolean
  children?: ReactNode
  danger?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canConfirm = props.canConfirm !== false && !busy

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !busy) props.onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, props])

  async function confirm() {
    if (!canConfirm) return
    setBusy(true)
    setError(null)
    const r = await props.onConfirm()
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    props.onClose()
  }

  return (
    <div
      onClick={() => { if (!busy) props.onClose() }}
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
        style={{ ...card, padding: 24, width: 480, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto" }}
      >
        <div style={{ ...eyebrow, color: T.INK_EMPHASIS, marginBottom: 12 }}>{props.title.toUpperCase()}</div>
        <div style={{ ...label, color: T.INK_LINK, marginBottom: 6 }}>THIS WILL</div>
        <ol aria-label="What happens" style={{ margin: "0 0 16px", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
          {props.steps.map((s) => (
            <li key={s} style={{ fontSize: 13, color: T.TEXT, lineHeight: "18px" }}>{s}</li>
          ))}
        </ol>
        {props.children && <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>{props.children}</div>}
        {error && (
          <div style={{ marginBottom: 12, padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
            <span style={{ fontSize: 12, color: T.ERROR, fontWeight: 700 }}>{error}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={props.onClose} disabled={busy} style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px" }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            style={{
              ...btnPrimary,
              fontSize: 12,
              padding: "8px 16px",
              opacity: canConfirm ? 1 : 0.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              ...(props.danger ? { background: "rgba(248,113,113,0.9)", color: "#fff" } : {}),
            }}
          >
            {busy && <SavingSpinner size={10} />}
            {busy ? "Working…" : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const fieldLabel = { ...label, color: T.INK_LINK, display: "block", marginBottom: 6 } as const

export type LostInput = { lost_reason: LostReason | ""; lost_reason_detail: string; lost_notes: string }

/** Reason (required), its specify text for Other, and notes. */
export function LostReasonFields(props: {
  value: LostInput
  onChange: (v: LostInput) => void
  fixedReason?: LostReason
}) {
  const { value, onChange } = props
  return (
    <>
      {!props.fixedReason && (
        <label htmlFor="lost-reason" style={{ display: "block" }}>
          <span style={fieldLabel}>REASON</span>
          <select
            id="lost-reason"
            style={{ ...input, ...selectDarkInk }}
            value={value.lost_reason}
            onChange={(e) => onChange({ ...value, lost_reason: e.target.value as LostReason | "" })}
          >
            <option value="" style={selectDarkOption}>Select…</option>
            {LOST_REASONS.map((r) => <option key={r} value={r} style={selectDarkOption}>{LOST_REASON_LABEL[r]}</option>)}
          </select>
        </label>
      )}
      {value.lost_reason === "other" && !props.fixedReason && (
        <label htmlFor="lost-reason-detail" style={{ display: "block" }}>
          <span style={fieldLabel}>PLEASE SPECIFY</span>
          <input id="lost-reason-detail" type="text" style={input} maxLength={500}
            value={value.lost_reason_detail} onChange={(e) => onChange({ ...value, lost_reason_detail: e.target.value })} />
        </label>
      )}
      <label htmlFor="lost-notes" style={{ display: "block" }}>
        <span style={fieldLabel}>NOTES <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span></span>
        <textarea id="lost-notes" style={{ ...textarea, minHeight: 70 }} maxLength={5000}
          value={value.lost_notes} onChange={(e) => onChange({ ...value, lost_notes: e.target.value })} />
      </label>
    </>
  )
}

export function lostInputValid(v: LostInput): boolean {
  return v.lost_reason !== "" && (v.lost_reason !== "other" || v.lost_reason_detail.trim() !== "")
}

/** Today in the coach's own timezone, as a date input wants it. */
export function todayInput(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
