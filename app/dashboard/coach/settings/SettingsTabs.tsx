"use client"

// Reusable horizontal tab bar for the My Settings domains (spec §5).
// Presentational + controlled: the parent owns active state + URL sync and
// passes activeKey/onSelect. Supports disabled "Soon" tabs (greyed, non-
// clickable) — same treatment as the Step-1 nav disabled items, in the
// client-detail tab pill styling (orange active treatment) so it feels native.

import { T } from "../../../../lib/dashboard-theme"

export type SettingsTab = { key: string; label: string; disabled?: boolean }

export function SettingsTabs({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: SettingsTab[]
  activeKey: string
  onSelect: (key: string) => void
}) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 28, borderBottom: `1px solid ${T.BORDER_SOFT}`, paddingBottom: 12 }}>
      {tabs.map((t) => {
        const base: React.CSSProperties = { fontSize: 12, fontWeight: 900, padding: "8px 16px", borderRadius: 10, fontFamily: "inherit" }
        if (t.disabled) {
          return (
            <div
              key={t.key}
              style={{ ...base, border: `1px solid ${T.BORDER_SOFT}`, background: "transparent", color: T.DIM, cursor: "default", display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <span>{t.label}</span>
              <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.DIM }}>Soon</span>
            </div>
          )
        }
        const active = t.key === activeKey
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            style={{
              ...base,
              cursor: "pointer",
              border: active ? `1px solid rgba(254,176,106,0.35)` : `1px solid ${T.BORDER_SOFT}`,
              background: active ? "rgba(254,176,106,0.08)" : "rgba(255,255,255,0.04)",
              color: active ? T.WRN_ORANGE : T.MUTED,
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
