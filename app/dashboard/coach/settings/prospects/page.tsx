// Prospects settings domain (Step 4c).
//
// This is the Prospects DOMAIN page within the My Settings area. The pipeline
// configuration is ONE block within it ("My Pipeline"). The page is structured
// as a stack of blocks so additional prospect-settings blocks (e.g. future
// configurable source categories, capture defaults) can be added alongside the
// pipeline without another restructure — add a new <SettingsBlock> below.

import { T, card, eyebrow } from "../../../../../lib/dashboard-theme"
import { MyPipelineSection } from "./MyPipelineSection"

// One configuration block within a domain. Same card + 2px orange top-accent
// treatment as the Coach Home / Required Actions sections so the visual
// language stays consistent across the app.
function SettingsBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ ...card, padding: 22, marginBottom: 20, position: "relative" }}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 2,
          background: T.WRN_ORANGE, borderTopLeftRadius: 18, borderTopRightRadius: 18,
        }}
      />
      <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 14 }}>{title}</div>
      {children}
    </section>
  )
}

export default function ProspectsSettingsPage() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: T.TEXT, margin: 0 }}>
          Prospects
        </h2>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 6 }}>
          How you track prospects from first contact through to becoming a client.
        </p>
      </div>

      <SettingsBlock title="My Pipeline">
        <MyPipelineSection />
      </SettingsBlock>

      {/* Future prospect-settings blocks (source categories, capture defaults,
          …) add here as additional <SettingsBlock> entries. */}
    </div>
  )
}
