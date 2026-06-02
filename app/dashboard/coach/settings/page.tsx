"use client"

// My Settings — coach-level configuration surface (spec §0).
//
// Built as a SECTIONED surface (§0.3): a settings shell that holds multiple
// configuration sections so future methodology features (engagement templates,
// session structure, email templates, calendar, scoring preferences) drop in as
// new sections without a redesign.
//
// The "My Pipeline" section is now live — the configurable prospect-pipeline UI
// (spec §8.1), rendered by <MyPipelineSection/>. Future sections append to the
// shell below as their own cards.

import { T, card, eyebrow } from "../../../../lib/dashboard-theme"
import { BackToDashboard } from "../BackToDashboard"
import { MyPipelineSection } from "./MyPipelineSection"

export default function CoachSettingsPage() {
  return (
    <div>
      <BackToDashboard />

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          My Settings
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Configure how you work — independent of any one client or prospect.
        </p>
      </div>

      {/* My Pipeline section. Same card + 2px orange top-accent treatment as the
          Coach Home / Required Actions sections so the visual language stays
          consistent. Future settings sections add their own <section> cards. */}
      <section style={{ ...card, padding: 22, marginBottom: 20, position: "relative" }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 2,
            background: T.WRN_ORANGE, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          }}
        />
        <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 14 }}>
          My Pipeline
        </div>
        <MyPipelineSection />
      </section>
    </div>
  )
}
