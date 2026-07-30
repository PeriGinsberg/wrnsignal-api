"use client"

// The groups that are not tied to a relationship: the replies you write once,
// and the LinkedIn notes. Compact cards that wrap, expanding in place to the
// same editor the sequence cards use.

import { T, fieldLabel } from "../../../../lib/dashboard-theme"
import { TemplateCard } from "./TemplateCard"
import { NAME_BY_ID } from "./templateNames"
import type { Accent } from "./accents"
import type { MergedTemplate } from "../../../../lib/network-tracker/templates"

export function LibraryGroup({
  heading, hint, ids, byId, profile, expandedId, onToggle, onReload, accent,
}: {
  heading: string
  hint?: string
  ids: readonly string[]
  byId: Record<string, MergedTemplate>
  profile: Record<string, string | null> | null
  expandedId: string | null
  onToggle: (id: string) => void
  onReload: () => Promise<void>
  accent: Accent
}) {
  return (
    <section style={{ ...groupSection, borderLeft: `3px solid ${accent.line}` }} data-testid={`group-${heading}`}>
      <div style={{ ...fieldLabel, textTransform: "uppercase", color: accent.line }}>{heading}</div>
      {hint && <p style={{ color: T.DIM, fontSize: 12, margin: "4px 0 0" }}>{hint}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
        {ids.map((id) => (
          <TemplateCard
            key={id}
            id={id}
            name={NAME_BY_ID[id]}
            template={byId[id] ?? null}
            profile={profile}
            expanded={expandedId === id}
            onToggle={() => onToggle(id)}
            onReload={onReload}
            accent={accent}
            compact
          />
        ))}
      </div>
    </section>
  )
}

// Shared by the sequence section in page.tsx, so the three rails sit on one
// vertical line rather than each choosing its own inset.
export const groupSection: React.CSSProperties = { marginTop: 26, paddingLeft: 14 }
