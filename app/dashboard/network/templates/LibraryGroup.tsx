"use client"

// The groups that are not tied to a relationship: the replies you write once,
// and the LinkedIn notes. Compact cards that wrap, expanding in place to the
// same editor the sequence cards use.

import { T, fieldLabel } from "../../../../lib/dashboard-theme"
import { TemplateCard } from "./TemplateCard"
import { NAME_BY_ID } from "./templateNames"
import type { MergedTemplate } from "../../../../lib/network-tracker/templates"

export function LibraryGroup({
  heading, hint, ids, byId, profile, expandedId, onToggle, onReload,
}: {
  heading: string
  hint?: string
  ids: readonly string[]
  byId: Record<string, MergedTemplate>
  profile: Record<string, string | null> | null
  expandedId: string | null
  onToggle: (id: string) => void
  onReload: () => Promise<void>
}) {
  return (
    <section style={{ marginTop: 26 }} data-testid={`group-${heading}`}>
      <div style={{ ...fieldLabel, textTransform: "uppercase" }}>{heading}</div>
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
            compact
          />
        ))}
      </div>
    </section>
  )
}
