"use client"

// "Create Networking Workbook": pick a contact, get a blank Networking Call
// workbook for them. The contact is required, so Create stays disabled until
// one is picked. One workbook per contact: a contact that already has one is
// shown with an Open link instead of being pickable.
//
// The client's own board only. NetworkLanding hides the button on a client's
// board viewed by a coach, and the route ignores the subject parameter anyway.

import { useMemo, useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../lib/theme/surfaces"
import { authFetch, networkingWorkbookHref } from "./authFetch"
import { matchesQuery } from "./contacts/search"
import type { Contact } from "./contacts/ContactRow"

export function CreateWorkbookModal({ contacts, onClose }: { contacts: Contact[]; onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const shown = useMemo(
    () => contacts
      .filter((c) => matchesQuery(c, query))
      .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [contacts, query],
  )

  async function create() {
    if (!picked) return
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch("/api/me/workbooks/networking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: picked }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok || !j.workbook?.id) throw new Error(j?.error || `Couldn't create the workbook (${res.status})`)
      window.location.href = networkingWorkbookHref(j.workbook.id)
    } catch (e: any) {
      setErr(e?.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="create-wb-title" style={panel} onClick={(e) => e.stopPropagation()}>
        <h2 id="create-wb-title" style={{ margin: 0, fontSize: 20, fontWeight: 800, color: S.text.primary }}>
          Create Networking Workbook
        </h2>
        <p style={{ margin: "6px 0 16px", fontSize: 14, lineHeight: "21px", color: S.text.muted }}>
          Who is the call with? Pick a contact from your board.
        </p>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your contacts"
          aria-label="Search your contacts"
          autoFocus
          style={search}
        />

        <ul role="listbox" aria-label="Contacts" style={list}>
          {shown.length === 0 && (
            <li style={{ padding: "14px 12px", fontSize: 14, color: S.text.muted }}>No contacts match.</li>
          )}
          {shown.map((c) => {
            const name = `${c.first_name} ${c.last_name}`.trim()
            const sub = [c.title, c.network_companies?.name].filter(Boolean).join(" · ")
            const has = !!c.workbook_id
            const on = picked === c.id
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={on}
                aria-disabled={has}
                onClick={has ? undefined : () => setPicked(c.id)}
                style={{
                  ...row,
                  cursor: has ? "default" : "pointer",
                  background: on ? S.meaning.progress.fill : "transparent",
                  outline: on ? `2px solid ${S.meaning.progress.accent}` : "none",
                }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: has ? S.text.muted : S.text.primary }}>{name}</span>
                  {sub && <span style={{ display: "block", fontSize: 13, color: S.text.muted, marginTop: 2 }}>{sub}</span>}
                </span>
                {has && (
                  <span style={{ fontSize: 13, color: S.text.muted, whiteSpace: "nowrap" }}>
                    Has a workbook ·{" "}
                    <a href={networkingWorkbookHref(c.workbook_id!)} style={{ color: S.action.quietInk, fontWeight: 700 }}>Open</a>
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        {err && <div role="alert" style={{ marginTop: 12, fontSize: 14, color: S.meaning.error.ink }}>{err}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={create}
            disabled={!picked || busy}
            style={{ ...actionStyle(S, "primary"), ...btn, opacity: !picked || busy ? 0.5 : 1, cursor: !picked || busy ? "default" : "pointer" }}
          >
            {busy ? "Creating…" : "Create workbook"}
          </button>
          <button type="button" onClick={onClose} disabled={busy} style={secondary}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(19,41,74,0.45)", display: "flex",
  alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px", zIndex: 70,
}
const panel: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.borderSoft}`, borderRadius: 18,
  padding: 26, width: "100%", maxWidth: 520, boxShadow: S.shadow.raised,
}
const search: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: S.card, border: `1px solid ${S.border}`,
  borderRadius: 10, padding: "11px 14px", fontSize: 14.5, color: S.text.primary,
  fontFamily: "inherit", outline: "none",
}
const list: React.CSSProperties = {
  listStyle: "none", margin: "12px 0 0", padding: 4, maxHeight: "40vh", overflowY: "auto",
  border: `1px solid ${S.borderSoft}`, borderRadius: 12, display: "flex", flexDirection: "column", gap: 2,
}
const row: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10,
}
const btn: React.CSSProperties = {
  borderRadius: 10, padding: "12px 20px", fontSize: 14.5, fontFamily: "inherit",
}
const secondary: React.CSSProperties = {
  background: S.card, color: S.text.primary, border: `1px solid ${S.border}`,
  borderRadius: 10, padding: "12px 20px", fontSize: 14.5, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
}
