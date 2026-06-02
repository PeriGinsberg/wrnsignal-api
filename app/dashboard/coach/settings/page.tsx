"use client"

// My Settings — coach-level configuration surface (spec §0).
//
// Built as a SECTIONED surface (§0.3): a settings shell that holds multiple
// configuration sections so future methodology features (engagement templates,
// session structure, email templates, calendar, scoring preferences) drop in as
// new sections without a redesign.
//
// This commit establishes the shell with ONE section — "My Pipeline" — as a
// coming-next placeholder. The real configurable-pipeline UI is a later build
// step (spec §8.1); nothing pipeline-specific is built here.

import { T, card, eyebrow } from "../../../../lib/dashboard-theme"
import { BackToDashboard } from "../BackToDashboard"

// Section registry — each future settings section appends here. For this commit,
// only "My Pipeline" exists, rendered as a coming-next stub.
const SECTIONS: { key: string; title: string; blurb: string }[] = [
  {
    key: "pipeline",
    title: "My Pipeline",
    blurb:
      "Configure the prospect stages for your coaching practice — coming soon.",
  },
]

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

      {SECTIONS.map((section) => (
        <section
          key={section.key}
          style={{ ...card, padding: 22, marginBottom: 20, position: "relative" }}
        >
          {/* 2px orange top accent — matches the Coach Home / Required Actions
              section treatment so the visual language is consistent. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 2,
              background: T.WRN_ORANGE, borderTopLeftRadius: 18, borderTopRightRadius: 18,
            }}
          />
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 10 }}>
            {section.title}
          </div>
          <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>{section.blurb}</p>
        </section>
      ))}
    </div>
  )
}
