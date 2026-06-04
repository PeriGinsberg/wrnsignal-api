// Shared settings card block — a titled card with the orange 2px top accent,
// used across the My Settings domains (Prospects pipeline, Services
// deliverables, …). Extracted from ProspectsTabs so multiple domains share one
// source (mirrors the SettingsTabs extraction). Presentational only — no state.

import { T, card, eyebrow } from "../../../../lib/dashboard-theme"

export function SettingsBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, padding: 22, marginBottom: 20, position: "relative" }}>
      <div aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: T.WRN_ORANGE, borderTopLeftRadius: 18, borderTopRightRadius: 18 }} />
      <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 14 }}>{title}</div>
      {children}
    </section>
  )
}
