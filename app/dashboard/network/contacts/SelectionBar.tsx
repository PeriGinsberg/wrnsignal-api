"use client"

// The bulk bar, shown only in select mode.
//
// It sits at page level rather than inside either world because selection spans
// both: select-all still means the whole FILTERED set, hero and grid together,
// exactly as it did when the page was a table with a header checkbox.

import { LIGHT as S } from "../../../../lib/theme/surfaces"

export function SelectionBar({
  count, allSelected, onSelectAll, onClear, onDelete,
}: {
  count: number
  allSelected: boolean
  onSelectAll: () => void
  onClear: () => void
  onDelete: () => void
}) {
  return (
    <div data-testid="selection-bar" style={{
      position: "sticky", top: 8, zIndex: 20, marginTop: 14,
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      background: S.raised, border: `1px solid ${S.border}`, borderRadius: 12,
      padding: "9px 13px", boxShadow: "0 4px 14px rgba(4,10,22,0.18)",
    }}>
      <span data-testid="selected-count" style={{ color: S.text.primary, fontSize: 12.5, fontWeight: 900 }}>
        {count} selected
      </span>
      <button onClick={onSelectAll} data-testid="select-all" style={ghost}>
        {allSelected ? "Deselect all" : "Select all"}
      </button>
      {count > 0 && <button onClick={onClear} style={ghost}>Clear</button>}
      <span style={{ flex: 1 }} />
      <button onClick={onDelete} disabled={count === 0} data-testid="bulk-delete" style={{
        background: count === 0 ? S.well : S.meaning.error.fill,
        color: count === 0 ? S.text.dim : S.meaning.error.ink,
        border: `1px solid ${count === 0 ? S.borderSoft : S.meaning.error.ink}`,
        borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 900,
        cursor: count === 0 ? "default" : "pointer",
      }}>
        Delete{count > 0 ? ` ${count}` : ""}
      </button>
    </div>
  )
}

const ghost: React.CSSProperties = {
  background: "none", border: "none", color: S.text.muted,
  fontSize: 12, fontWeight: 800, cursor: "pointer", padding: 0,
}
