"use client"

// One template as a card: collapsed it answers "what is this message and have I
// changed it?", expanded it becomes the editor in place.
//
// The sequence cards and the library cards are the same component with an
// optional step badge, because they differ only in whether a message has a
// position in a three-touch sequence, not in what editing one does.

import { T, card } from "../../../../lib/dashboard-theme"
import { TemplateEditor } from "./TemplateEditor"
import type { Accent } from "./accents"
import type { MergedTemplate } from "../../../../lib/network-tracker/templates"

export function TemplateCard({
  id, name, step, day, template, profile, expanded, onToggle, onReload, accent, compact,
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
  accent: Accent
  compact?: boolean
}) {
  const edited = template?.source === "override"
  // The uncoloured group still needs a visible "edited" marker and a visible
  // active edge. It falls back to plain white, which reads as clearly against
  // the quiet grey "Default" as any accent does.
  const mark = accent.line ?? T.TEXT
  const activeEdge = accent.line ?? T.BORDER

  return (
    <div
      data-testid={`card-${id}`}
      style={{
        ...card,
        padding: expanded ? "14px 16px 16px" : "12px 14px",
        // Three states, loudest first: the card being edited takes the full
        // accent edge, one you have customised takes the tinted one, everything
        // else stays quiet. A customised template used to be indistinguishable
        // in the stack, which made the one status that matters invisible.
        border: `1px solid ${expanded ? activeEdge : edited ? accent.border : T.BORDER_SOFT}`,
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
            background: accent.step, color: accent.stepInk,
            border: accent.line ? "none" : `1px solid ${T.BORDER}`,
            fontSize: 11, fontWeight: 900,
          }}>{step}</span>
        )}
        <span style={{ color: accent.onCard ?? T.TEXT, fontSize: 13, fontWeight: 800 }}>{name}</span>
        {day !== undefined && (
          <span style={{ color: T.DIM, fontSize: 11.5 }}>day {day}</span>
        )}
        <span style={{ flex: 1 }} />
        {edited ? (
          <span data-testid={`marker-${id}`} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: accent.bg, border: `1px solid ${accent.border}`, borderRadius: 999,
            padding: "3px 9px 3px 7px", color: mark,
            fontSize: 10.5, fontWeight: 900, letterSpacing: 0.3, textTransform: "uppercase",
          }}>
            {/* A drawn dot, not a "•" character, so the marker's text stays
                exactly the two words a reader (and the test) expects. */}
            <span aria-hidden style={{
              width: 6, height: 6, borderRadius: 999, background: mark, flex: "0 0 auto",
            }} />
            Edited by you
          </span>
        ) : (
          <span data-testid={`marker-${id}`} style={{
            color: T.DIM, fontSize: 10.5, fontWeight: 900, letterSpacing: 0.3, textTransform: "uppercase",
          }}>
            Default
          </span>
        )}
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
