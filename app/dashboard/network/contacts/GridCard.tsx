"use client"

// A contact in EVERYONE: calm, and quiet in proportion to how little is
// happening. An untouched contact shows a grey tile, a name, a company and the
// word "Not started" and nothing else. Colour literally marks who has been
// worked.
//
// Restraint has one deliberate exception. The stage control is revealed on hover
// or keyboard focus for EVERY card including idle ones, because moving a contact
// off "identified" is the commonest first action anyone takes, and hiding it
// behind the record would be a capability loss dressed up as restraint.

import { useState } from "react"
import { select as selectStyle, selectOption } from "../../../../lib/dashboard-theme"
import { LIGHT as S, PHASE_MEANING, pill, tile, tileIdle } from "../../../../lib/theme/surfaces"
import { authFetch } from "../authFetch"
import { STAGE_LABELS, RELATIONSHIP_LABELS, STAGE_PHASE } from "../vocab"
import { dueOf, needsMe, initialsOf, type Contact } from "./contactModel"

export function GridCard({
  contact: c, onChanged, selectMode, checked, onToggle, flash = false,
}: {
  contact: Contact
  onChanged: () => void
  selectMode: boolean
  checked: boolean
  onToggle: () => void
  flash?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)   // hover OR focus-within
  const idle = c.stage === "identified"
  const phase = PHASE_MEANING[STAGE_PHASE[c.stage] ?? "idle"]
  const due = dueOf(c.next_due_at)
  // Overflow from the capped hero lands here, so a grid card still has to be
  // able to say it is due.
  const showDue = needsMe(due)

  async function changeStage(stage: string) {
    setBusy(true)
    try {
      const res = await authFetch(`/api/network/contacts/${c.id}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid={`card-${c.id}`}
      data-world="grid"
      data-idle={idle ? "true" : "false"}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false) }}
      onClick={selectMode ? onToggle : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 11, padding: "12px 13px",
        background: flash ? S.raised : S.card, borderRadius: 12,
        border: `1px solid ${checked ? S.meaning.progress.ink : S.borderSoft}`,
        boxShadow: flash ? `0 0 0 3px ${S.meaning.progress.fill}` : "none",
        cursor: selectMode ? "pointer" : "default",
        transition: "box-shadow 400ms ease-out, background 400ms ease-out",
      }}
    >
      {selectMode && (
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Select contact"
          onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer", flex: "0 0 auto" }} />
      )}

      {/* Flat grey for a contact nobody has worked, so the ones in motion light
          up against them. */}
      <span aria-hidden data-testid={`tile-${c.id}`} style={{
        ...(idle ? tileIdle(S) : tile(S, phase)),
        flex: "0 0 auto", width: 36, height: 36, borderRadius: 10,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 12.5, fontWeight: 900,
      }}>{initialsOf(c)}</span>

      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <a href={`/dashboard/network/contacts/${c.id}`}
          onClick={selectMode ? (e) => e.preventDefault() : undefined}
          style={{
            color: idle ? S.text.secondary : S.text.primary, fontWeight: 800, fontSize: 13,
            textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
          {c.first_name} {c.last_name}
        </a>
        <span style={{ color: S.text.muted, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[c.title, c.network_companies?.name].filter(Boolean).join(" · ") || "No details yet"}
        </span>

        {/* The machinery appears only when there is something to say. */}
        <span style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
          {idle && !open && (
            <span data-testid={`whisper-${c.id}`} style={{ color: S.text.dim, fontSize: 10.5, fontWeight: 700 }}>
              Not started
            </span>
          )}
          {!idle && (
            <span data-testid={`stage-${c.id}`} style={{
              ...pill(S, phase), borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 800,
            }}>{STAGE_LABELS[c.stage] ?? c.stage}</span>
          )}
          {showDue && (
            <span data-testid={`due-${c.id}`} style={{
              ...pill(S, due.meaning), borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 900,
            }}>{due.label}</span>
          )}
          {c.relationship && (
            <span data-testid={`rel-${c.id}`} style={attrPill}>{RELATIONSHIP_LABELS[c.relationship]}</span>
          )}
          {c.priority && <span data-testid={`pri-${c.id}`} style={attrPill}>{c.priority}</span>}
        </span>
      </span>

      {/* Revealed on hover or focus, never permanently parked on the card. */}
      {open && !selectMode && (
        <select
          value={c.stage}
          onChange={(e) => void changeStage(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          disabled={busy}
          aria-label="Stage"
          data-testid={`set-stage-${c.id}`}
          style={{
            ...selectStyle, ...pill(S, phase),
            flex: "0 0 auto", height: 26, padding: "0 8px", fontSize: 10.5, width: 132,
            fontWeight: 800, borderRadius: 999, opacity: busy ? 0.55 : 1,
          }}
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
        </select>
      )}
    </div>
  )
}

const attrPill: React.CSSProperties = {
  color: S.text.muted, background: S.well, border: `1px solid ${S.borderSoft}`,
  borderRadius: 999, padding: "2px 8px", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap",
}
