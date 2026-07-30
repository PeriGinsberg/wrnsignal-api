"use client"

// One profile field, carrying its own state.
//
// This is the change the restructure turns on. Before, 17 identical navy boxes
// meant finding what was left required READING every field; the done ones and
// the empty ones looked the same. Now each field says which it is, so a rushing
// user scans instead of reads.
//
// The icons are load-bearing, not decoration: they are the only thing that makes
// the scan possible at a glance.

import { T, input as inputStyle, textarea as textareaStyle, fieldLabel } from "../../../../lib/dashboard-theme"
import { fieldState, type FieldState } from "./fieldState"

export type FieldDef = {
  key: string
  label: string
  placeholder: string
  multiline?: boolean
  seededFrom?: string
}

const BORDER: Record<FieldState, string> = {
  filled: T.BORDER_SOFT,
  // Amber only on the border, never a fill: seventeen tinted boxes on a fresh
  // profile would read as seventeen errors rather than seventeen invitations.
  "required-empty": T.ORANGE_BORDER_MED,
  "optional-empty": T.BORDER_SOFT,
}

export function Field({
  def, value, pending, saving, featured, onSave,
}: {
  def: FieldDef
  value: string
  pending?: boolean
  saving?: boolean
  /** The elevator pitch. One field on the screen gets this. */
  featured?: boolean
  onSave: (key: string, value: string) => void
}) {
  const state = fieldState(def.key, value)
  const border = featured ? T.ORANGE_BORDER_STRONG : BORDER[state]

  return (
    <label style={{
      display: "flex", flexDirection: "column", gap: 4,
      gridColumn: def.multiline || featured ? "1 / -1" : undefined,
    }} data-testid={`field-${def.key}`} data-state={state}>
      <span style={{ ...fieldLabel, display: "flex", alignItems: "center", gap: 6 }}>
        {state === "filled" && (
          <span data-testid={`check-${def.key}`} aria-label="filled"
            style={{ color: T.SUCCESS, fontSize: 11, lineHeight: "11px" }}>✓</span>
        )}
        {state === "required-empty" && (
          <span data-testid={`needed-${def.key}`} aria-label="still needed"
            style={{ color: T.WRN_ORANGE, fontSize: 13, lineHeight: "11px" }}>•</span>
        )}
        {def.label}
        {state === "optional-empty" && (
          <span data-testid={`optional-${def.key}`} style={{ color: T.DIM, fontWeight: 600 }}> · optional</span>
        )}
        {featured && (
          <span data-testid="pitch-badge" style={{
            color: T.WRN_ORANGE, fontWeight: 900, fontSize: 9, letterSpacing: 0.6,
            border: `1px solid ${T.ORANGE_BORDER_MED}`, borderRadius: 999, padding: "1px 7px",
          }}>
            MOST USEFUL
          </span>
        )}
        {/* Only worth saying while the box is empty — once there is a value, the
            value itself is the answer to "why is this already full?". */}
        {def.seededFrom && !value && (
          <span style={{ color: T.DIM, fontWeight: 600 }}> · from {def.seededFrom}</span>
        )}
      </span>

      {def.multiline ? (
        <textarea
          key={`${def.key}:${value}`}
          defaultValue={value}
          aria-label={def.label}
          placeholder={def.placeholder}
          rows={featured ? 4 : 3}
          onBlur={(e) => onSave(def.key, e.target.value)}
          style={{ ...textareaStyle, fontSize: 13, border: `${featured ? 2 : 1}px solid ${border}` }}
        />
      ) : (
        <input
          // Remount when the value changes so a phase-2 arrival is actually
          // shown — defaultValue alone would ignore it.
          key={`${def.key}:${value}`}
          defaultValue={value}
          aria-label={def.label}
          placeholder={pending ? "Reading your résumé…" : def.placeholder}
          // Disabled while pending: the field cannot be typed into, so the late
          // arrival has nothing of the user's to clobber.
          disabled={pending}
          onBlur={(e) => onSave(def.key, e.target.value)}
          style={{ ...inputStyle, height: 38, fontSize: 13, opacity: pending ? 0.6 : 1, border: `1px solid ${border}` }}
        />
      )}
      {saving && <span style={{ color: T.DIM, fontSize: 10 }}>Saving…</span>}
    </label>
  )
}
