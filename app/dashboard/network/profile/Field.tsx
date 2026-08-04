"use client"

// One profile field, carrying its own state.
//
// This is the change the restructure turns on. Before, 17 identical boxes meant
// finding what was left required READING every field; the done ones and the
// empty ones looked the same. Now each field says which it is, so a rushing
// user scans instead of reads.
//
// The marks are load-bearing, not decoration: they are the only thing that
// makes the scan possible at a glance.
//
// Redesign step 8 (2026-08-04): light theme. The three states, the testids and
// the copy are all unchanged — this form now lives inside My Profile, and the
// only thing that moved is the palette. The tick uses the drawn StepComplete
// mark rather than a text glyph, matching the contact record's stepper.

import { LIGHT as S } from "../../../../lib/theme/surfaces"
import { StepCompleteIcon } from "../../../../components/icons"
import { fieldState, type FieldState } from "./fieldState"

export type FieldDef = {
  key: string
  label: string
  placeholder: string
  multiline?: boolean
  seededFrom?: string
}

const BORDER: Record<FieldState, string> = {
  filled: S.border,
  // The attention colour on the border ONLY, never as a fill: seventeen tinted
  // boxes on a fresh profile would read as seventeen errors rather than
  // seventeen invitations.
  "required-empty": S.meaning.attention.accent,
  "optional-empty": S.border,
}

const labelStyle: React.CSSProperties = {
  color: S.text.muted, fontSize: 11.5, fontWeight: 800,
  letterSpacing: 0.6, textTransform: "uppercase",
}

const inputStyle: React.CSSProperties = {
  background: S.well, borderRadius: 10, padding: "0 12px",
  fontSize: 14, color: S.text.primary, fontFamily: "inherit",
  boxSizing: "border-box", width: "100%", colorScheme: "light",
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
  const border = featured ? S.action.outlineBorder : BORDER[state]

  return (
    <label style={{
      display: "flex", flexDirection: "column", gap: 6,
      gridColumn: def.multiline || featured ? "1 / -1" : undefined,
    }} data-testid={`field-${def.key}`} data-state={state}>
      <span style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
        {state === "filled" && (
          <span data-testid={`check-${def.key}`} aria-label="filled" style={{ display: "inline-flex" }}>
            <StepCompleteIcon size={14} />
          </span>
        )}
        {state === "required-empty" && (
          <span data-testid={`needed-${def.key}`} aria-label="still needed"
            style={{ color: S.meaning.attention.ink, fontSize: 15, lineHeight: "11px" }}>•</span>
        )}
        {def.label}
        {state === "optional-empty" && (
          <span data-testid={`optional-${def.key}`} style={{ color: S.text.dim, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}> · optional</span>
        )}
        {featured && (
          <span data-testid="pitch-badge" style={{
            color: S.action.outlineInk, fontWeight: 800, fontSize: 9.5, letterSpacing: 0.6,
            border: `1px solid ${S.action.outlineBorder}`, borderRadius: 999, padding: "2px 8px",
          }}>
            MOST USEFUL
          </span>
        )}
        {/* Only worth saying while the box is empty — once there is a value, the
            value itself is the answer to "why is this already full?". */}
        {def.seededFrom && !value && (
          <span style={{ color: S.text.dim, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}> · from {def.seededFrom}</span>
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
          style={{
            ...inputStyle, padding: "10px 12px", lineHeight: "21px", resize: "vertical",
            border: `${featured ? 2 : 1}px solid ${border}`,
          }}
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
          style={{ ...inputStyle, height: 42, opacity: pending ? 0.6 : 1, border: `1px solid ${border}` }}
        />
      )}
      {saving && <span style={{ color: S.text.dim, fontSize: 11.5 }}>Saving…</span>}
    </label>
  )
}
