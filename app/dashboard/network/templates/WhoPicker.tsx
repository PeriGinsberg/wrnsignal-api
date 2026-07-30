"use client"

// "Who are you messaging?" — the five relationships in plain language, which is
// how the screen replaces a 24-item codebook with one question.

import { T } from "../../../../lib/dashboard-theme"
import { RELATIONSHIPS, RELATIONSHIP_LABELS } from "../vocab"

export function WhoPicker({
  value, onChange,
}: { value: string; onChange: (relationship: string) => void }) {
  return (
    <div role="tablist" aria-label="Who are you messaging?" data-testid="who-picker"
      style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
      {RELATIONSHIPS.map((rel) => {
        const on = rel === value
        return (
          <button
            key={rel}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(rel)}
            data-testid={`who-${rel}`}
            style={{
              background: on ? T.GRAD_PRIMARY : T.GLASS,
              color: on ? "#04060F" : T.MUTED,
              border: `1px solid ${on ? "transparent" : T.BORDER_SOFT}`,
              borderRadius: 999, padding: "8px 15px", cursor: "pointer",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 900 : 700,
            }}
          >
            {RELATIONSHIP_LABELS[rel]}
          </button>
        )
      })}
    </div>
  )
}
