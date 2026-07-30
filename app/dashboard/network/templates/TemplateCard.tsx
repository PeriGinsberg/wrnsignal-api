"use client"

// One template as a card: collapsed it answers "what is this message and have I
// changed it?", expanded it becomes the editor in place.
//
// The sequence cards and the library cards are the same component with an
// optional step badge, because they differ only in whether a message has a
// position in a three-touch sequence — not in what editing one does.

import { T, card } from "../../../../lib/dashboard-theme"
import { TemplateEditor } from "./TemplateEditor"
import type { MergedTemplate } from "../../../../lib/network-tracker/templates"

export function TemplateCard({
  id, name, step, day, template, profile, expanded, onToggle, onReload, compact,
}: {
  id: string
  name: string
  step?: number
  day?: number
  template: MergedTemplate | null
  profile: Record<string, string | null> | null
  expanded: boolean
  onToggle: () => void
  onReload: () => Promise<void>
  compact?: boolean
}) {
  const edited = template?.source === "override"

  return (
    <div
      data-testid={`card-${id}`}
      style={{
        ...card,
        padding: expanded ? "14px 16px 16px" : "12px 14px",
        border: `1px solid ${expanded ? T.WRN_ORANGE : T.BORDER_SOFT}`,
        flex: compact && !expanded ? "1 1 210px" : "1 1 100%",
        minWidth: compact && !expanded ? 200 : undefined,
      }}
    >
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid={`open-${id}`}
        style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
          background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
        }}
      >
        {step !== undefined && (
          // A step number, not a template code: 1/2/3 is where this message sits
          // in the sequence, which is a thing the writer already believes.
          <span aria-hidden style={{
            flex: "0 0 auto", width: 22, height: 22, borderRadius: 999,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: expanded ? T.WRN_ORANGE : T.GLASS,
            color: expanded ? "#04060F" : T.MUTED,
            border: `1px solid ${expanded ? "transparent" : T.BORDER_SOFT}`,
            fontSize: 11, fontWeight: 900,
          }}>{step}</span>
        )}
        <span style={{ color: T.TEXT, fontSize: 13, fontWeight: 800 }}>{name}</span>
        {day !== undefined && (
          <span style={{ color: T.DIM, fontSize: 11.5 }}>day {day}</span>
        )}
        <span style={{ flex: 1 }} />
        <span data-testid={`marker-${id}`} style={{
          fontSize: 10.5, fontWeight: 900, letterSpacing: 0.3, textTransform: "uppercase",
          color: edited ? T.WRN_ORANGE : T.DIM,
        }}>
          {edited ? "Edited by you" : "Default"}
        </span>
      </button>

      {!expanded && (
        <p data-testid={`peek-${id}`} style={{
          color: T.MUTED, fontSize: 12, lineHeight: "18px", margin: "8px 0 0",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {template?.body ?? ""}
        </p>
      )}

      {expanded && (
        <TemplateEditor id={id} template={template} profile={profile} onReload={onReload} />
      )}
    </div>
  )
}
