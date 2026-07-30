"use client"

// EVERYONE: the calm half of the page. A responsive grid rather than a ledger,
// because columns of aligned cells is the shape that read as "spreadsheet".

import { LIGHT as S } from "../../../../lib/theme/surfaces"
import { GridCard } from "./GridCard"
import type { Contact } from "./contactModel"

export function ContactGrid({
  contacts, total, onChanged, selectMode, onToggleSelectMode, selectedIds, onToggle, flashId, emptyNote,
}: {
  contacts: Contact[]
  /** Unfiltered roster size, so the header can say what is being hidden. */
  total: number
  onChanged: (id: string) => void
  selectMode: boolean
  onToggleSelectMode: () => void
  selectedIds: Set<string>
  onToggle: (id: string) => void
  flashId: string | null
  emptyNote: string
}) {
  return (
    <section id="everyone" data-testid="everyone" style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 11 }}>
        <span style={{
          color: S.text.secondary, fontSize: 10.5, fontWeight: 900,
          letterSpacing: 1.1, textTransform: "uppercase",
        }}>
          Everyone
        </span>
        <span data-testid="everyone-count" style={{ color: S.text.muted, fontSize: 12, fontWeight: 800 }}>
          {contacts.length}
          {contacts.length !== total ? ` of ${total}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onToggleSelectMode} data-testid="select-mode" style={{
          background: selectMode ? S.meaning.progress.fill : "transparent",
          color: selectMode ? S.meaning.progress.ink : S.text.muted,
          border: `1px solid ${selectMode ? S.meaning.progress.ink : S.border}`,
          borderRadius: 999, padding: "5px 12px", fontSize: 11.5, fontWeight: 800, cursor: "pointer",
        }}>
          {selectMode ? "Done selecting" : "Select"}
        </button>
      </div>

      {contacts.length === 0 ? (
        <div data-testid="grid-empty" style={{
          padding: "28px 22px", textAlign: "center", borderRadius: 14,
          border: `1px dashed ${S.border}`, background: S.card,
          color: S.text.muted, fontSize: 12.5,
        }}>
          {emptyNote}
        </div>
      ) : (
        <div data-testid="grid" style={{
          display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
        }}>
          {contacts.map((c) => (
            <GridCard
              key={c.id}
              contact={c}
              onChanged={() => onChanged(c.id)}
              selectMode={selectMode}
              checked={selectedIds.has(c.id)}
              onToggle={() => onToggle(c.id)}
              flash={flashId === c.id}
            />
          ))}
        </div>
      )}
    </section>
  )
}
