"use client"

// The tracker's form furniture, in the light theme.
//
// The old page styled every input inline against the dark tokens and shipped a
// `<style>{'option { background: #0F1F38 }'}</style>` global to force native
// dropdown popups dark. On light, `colorScheme: "light"` does that job properly
// and the global goes away.

import type React from "react"
import { LIGHT as S } from "../../../lib/theme/surfaces"

export const fieldLabel: React.CSSProperties = {
  display: "block",
  color: S.text.muted,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  marginBottom: 6,
}

export const control: React.CSSProperties = {
  background: S.well,
  border: `1px solid ${S.border}`,
  borderRadius: 10,
  height: 40,
  padding: "0 12px",
  fontSize: 14,
  color: S.text.primary,
  fontFamily: "inherit",
  boxSizing: "border-box",
  width: "100%",
  colorScheme: "light",
}

export const areaControl: React.CSSProperties = {
  ...control,
  height: "auto",
  minHeight: 76,
  padding: "10px 12px",
  lineHeight: "21px",
  resize: "vertical",
}

export function Field({
  label, children, span = 1,
}: {
  label: string
  children: React.ReactNode
  /** 2 makes the field take the full width of the two-column grid. */
  span?: 1 | 2
}) {
  return (
    <label style={{ display: "block", gridColumn: span === 2 ? "1 / -1" : undefined }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

export function Select({
  value, options, onChange, ariaLabel,
}: {
  value: string
  /** A bare string is its own label; a tuple carries one that cannot be derived. */
  options: readonly (string | { value: string; label: string })[]
  onChange: (v: string) => void
  ariaLabel?: string
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      style={control}
    >
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value
        const lbl = typeof o === "string" ? o : o.label
        return <option key={val} value={val}>{lbl}</option>
      })}
    </select>
  )
}

/** The two-column grid both the add form and the detail editor lay out on. */
export const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
}
