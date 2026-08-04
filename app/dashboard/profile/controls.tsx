"use client"

// Form furniture for My Profile, in the light theme.
//
// A near-twin of the tracker's controls.tsx. Kept separate rather than shared
// because these fields stack in a single column with a label above and more
// breathing room, and the tracker's sit in a dense two-column grid. Merging
// them would mean one component with a layout prop, which is more coupling than
// two small files are worth.

import type React from "react"
import { LIGHT as S } from "../../../lib/theme/surfaces"

export const control: React.CSSProperties = {
  background: S.well,
  border: `1px solid ${S.border}`,
  borderRadius: 10,
  height: 44,
  padding: "0 14px",
  fontSize: 15,
  color: S.text.primary,
  fontFamily: "inherit",
  boxSizing: "border-box",
  width: "100%",
  colorScheme: "light",
}

export const areaControl: React.CSSProperties = {
  ...control,
  height: "auto",
  padding: "12px 14px",
  lineHeight: "22px",
  resize: "vertical",
}

export function Field({
  label, hint, children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: "block", marginBottom: 20 }}>
      <span
        style={{
          display: "block", color: S.text.muted, fontSize: 11.5, fontWeight: 800,
          letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8,
        }}
      >
        {label}
      </span>
      {hint && (
        <span style={{ display: "block", color: S.text.muted, fontSize: 13.5, margin: "-4px 0 8px" }}>
          {hint}
        </span>
      )}
      {children}
    </label>
  )
}
