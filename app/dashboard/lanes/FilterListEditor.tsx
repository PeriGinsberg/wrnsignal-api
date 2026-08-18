"use client"

// One editable list of strings, as chips.
//
// Used four times on the lane edit screen — industries, excluded industries,
// company keywords, excluded company keywords — because they are the same
// control with different labels, and four hand-rolled copies would drift.
//
// Values are sent to the board verbatim. Industry labels in particular are
// exact-match ("Education" and "Higher Education" are different values), so the
// input does not normalise case or punctuation beyond trimming; guessing at what
// a coach meant would produce a filter that matches nothing while looking right.

import { useState } from "react"
import { T, eyebrow, input } from "../../../lib/dashboard-theme"

export function FilterListEditor({
  label,
  hint,
  values,
  placeholder,
  tone = "neutral",
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  values: string[]
  placeholder?: string
  /** Excluded lists read as removals, so they are coloured as such. */
  tone?: "neutral" | "negative"
  disabled?: boolean
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")

  const add = () => {
    const v = draft.trim()
    if (!v) return
    // Case-insensitive dedupe, but the value stored is what was typed: the
    // board matches exactly, so the coach's capitalisation is the one that
    // counts.
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v])
    setDraft("")
  }

  const chipColor = tone === "negative" ? T.ERROR : T.ICE_BLUE
  const chipBg = tone === "negative" ? T.ERROR_BG : T.ICE_BLUE_BG
  const chipBorder = tone === "negative" ? T.ERROR : T.ICE_BLUE_BORDER

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 4 }}>{label}</div>
      {hint && <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 8px" }}>{hint}</p>}

      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {values.map((v) => (
            <span
              key={v}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 700, color: chipColor,
                background: chipBg, border: `1px solid ${chipBorder}`,
                borderRadius: 6, padding: "3px 8px",
              }}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                disabled={disabled}
                aria-label={`Remove ${v}`}
                style={{
                  background: "none", border: "none", padding: 0, lineHeight: 1,
                  color: chipColor, fontSize: 13, cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          style={{ ...input, flex: 1, height: 36 }}
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || !draft.trim()}
          style={{
            background: "transparent", border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 10,
            padding: "0 14px", fontSize: 12, fontWeight: 800, color: T.MUTED,
            cursor: disabled || !draft.trim() ? "not-allowed" : "pointer",
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}
