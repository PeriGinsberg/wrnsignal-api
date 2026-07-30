"use client"

// "Insert field ▾": one dropdown in place of the twenty-odd chips that used to
// sit under the editor as a wall.
//
// The grouping is NOT re-derived here. classifyVariable() is the same authority
// that colours a bracket in the body and the preview, so the menu's three
// sections and the two bracket colours cannot disagree about what a variable is.
//
// Custom popup rather than a native <select> with <optgroup>: the warm colour on
// the "You fill this in" items is the point, since the menu teaches the same lesson
// the message body does, and per-<option> colour is not reliably honoured.

import { useEffect, useMemo, useRef, useState } from "react"
import { T, card } from "../../../../lib/dashboard-theme"
import { DEFAULTS_BY_ID, extractVariables, classifyVariable } from "../../../../lib/network-tracker/templates"

// Friendlier names for the auto-resolving tokens. The INSERTED text is always
// the real bracket. This is a label, never a rename.
//
// Every profile and contact variable is listed, none left bare: three rows
// showing a naked [TOKEN] beside rows with a name read as a rendering bug, not
// as "these three needed no explanation".
const FRIENDLY: Record<string, string> = {
  // About you
  AFFINITY_1: "Something you share",
  CURRENT_ROLE: "Your current role",
  KEY_STRENGTH: "Your strength",
  CURRENT_EMPLOYER: "Your current employer",
  TARGET_FIELD: "Field you're moving into",
  TARGET_ROLE: "Role you're targeting",
  CITY: "Your city",
  // About them
  NAME: "Their name",
  FIRM: "Their company",
}

/** What the menu shows for a token. Exported for the test that pins the mapping. */
export function menuLabel(token: string): string {
  return FRIENDLY[token] ?? `[${token}]`
}

// Two registers, not three: the split that matters is auto-fill vs you-fill,
// and the headers say it before any item is read. "About you" and "About them"
// share ice blue because they are the same KIND of thing, and their own words keep
// them apart, and giving them separate colours would imply a difference the
// renderer does not make.
const SECTIONS = [
  { key: "profile" as const, heading: "About you", tone: T.ICE_BLUE },
  { key: "contact" as const, heading: "About them", tone: T.ICE_BLUE },
  { key: "fill" as const, heading: "You fill this in", tone: T.WRN_ORANGE },
]

export function InsertFieldMenu({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const groups = useMemo(() => {
    // Derived from the DEFAULTS, so a variable a template actually uses can
    // never be missing from the menu that is supposed to offer it.
    const all = new Set<string>()
    for (const d of Object.values(DEFAULTS_BY_ID)) extractVariables(d.body).forEach((v) => all.add(v))
    const out: Record<"profile" | "contact" | "fill", string[]> = { profile: [], contact: [], fill: [] }
    for (const v of all) out[classifyVariable(v)].push(v)
    for (const k of Object.keys(out) as (keyof typeof out)[]) {
      out[k].sort((a, b) => menuLabel(a).localeCompare(menuLabel(b)))
    }
    return out
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: "relative", marginTop: 12 }} data-testid="insert-field">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="insert-field-button"
        style={{
          background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 9,
          padding: "7px 12px", fontSize: 12, fontWeight: 800, color: T.TEXT,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        Insert field ▾
      </button>

      {open && (
        <div
          role="menu"
          data-testid="insert-field-menu"
          style={{
            ...card, position: "absolute", zIndex: 20, top: "calc(100% + 6px)", left: 0,
            minWidth: 260, maxHeight: 320, overflowY: "auto", padding: "8px 0",
            boxShadow: T.SHADOW_POPUP,
          }}
        >
          {SECTIONS.map(({ key, heading, tone }) => (
            <div key={key} data-testid={`menu-group-${key}`}>
              <div data-testid={`menu-heading-${key}`} style={{
                color: tone, fontSize: 10, fontWeight: 900, letterSpacing: 0.6,
                textTransform: "uppercase", padding: "8px 12px 4px",
              }}>
                {heading}
              </div>
              {groups[key].map((token) => (
                <button
                  key={token}
                  role="menuitem"
                  data-testid={`insert-${token}`}
                  // preventDefault on mousedown keeps focus in the textarea, so
                  // the caret the insert is aiming at is still the live one.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onInsert(token); setOpen(false) }}
                  style={{
                    display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left",
                    background: "none", border: "none", padding: "6px 12px", cursor: "pointer",
                    fontFamily: "inherit", fontSize: 12.5,
                    // The same two colours the bracket takes in the body, so the
                    // menu teaches the split rather than just listing it.
                    color: key === "fill" ? T.WRN_ORANGE : T.MUTED,
                    fontWeight: key === "fill" ? 700 : 500,
                  }}
                >
                  <span style={{ flex: 1 }}>{menuLabel(token)}</span>
                  {/* Show the real token beside a friendly label, so the menu
                      teaches what it inserts instead of hiding it. */}
                  {FRIENDLY[token] && (
                    <span style={{ color: T.DIM, fontSize: 11 }}>[{token}]</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
