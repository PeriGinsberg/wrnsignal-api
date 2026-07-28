"use client"

// One company on the board: header row (name · domain · tier · status · contact
// count) that expands to reveal its contacts and an edit panel.
//
// Contacts are LAZY-LOADED — fetched on first expand and then kept. The board
// can hold a lot of companies and most are never opened, so fetching every
// company's roster up front would be a large amount of work thrown away.
// Collapsing does not discard what was loaded, and re-expanding does NOT refetch;
// `loaded` is the guard, and it is separate from `contacts.length` so a company
// with genuinely zero contacts is not re-fetched forever.

import { useState } from "react"
import { T, select as selectStyle, selectOption, input, fieldLabel, fieldWrap } from "../../../../lib/dashboard-theme"
import { authFetch } from "../authFetch"
import { STAGE_LABELS, TIER_LABELS, TIER_GROUP_LABELS, UNSORTED_TIER, STATUS_LABELS, FIELD_LABELS, statusLabel, stagePillStyle } from "../vocab"
import type { Contact } from "../contacts/ContactRow"

export type Company = {
  id: string
  name: string
  domain: string | null
  tier: string | null
  status: string | null
  notes: string | null
  contact_count: number
}

export function CompanyCard({
  company: co, onChanged, onRequestDelete,
}: {
  company: Company
  onChanged: (patch: Partial<Company>) => void
  onRequestDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || loaded || loading) return // fetch ONCE, on first expand only
    setLoading(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts?company_id=${encodeURIComponent(co.id)}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load contacts (${res.status})`)
      setContacts(j.contacts ?? [])
      setLoaded(true)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function patch(body: Partial<Company>) {
    setSaving(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/companies/${co.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Save failed (${res.status})`)
      onChanged(body)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 12, marginBottom: 8, background: T.NAV_DEFAULT_BG }}>
      {/* THE WHOLE ROW is the expand control, not just the chevron. A 16px
          chevron with an inert name/status/count beside it looks interactive
          everywhere and responds in one place — clicking the company name, which
          is what a user actually does, did nothing at all.

          It is a real <button>, not a <div onClick>, so it is also reachable by
          keyboard; a div with a click handler would be the same "looks
          interactive, isn't" bug for anyone tabbing.

          Remove stays a SIBLING, outside this button. Nesting a button inside a
          button is invalid HTML and React warns; keeping it out also means
          Remove cannot bubble into a toggle, with no stopPropagation needed.
          Everything inside the button is phrasing content (span, not div) for
          the same validity reason. */}
      <div style={{ display: "flex", alignItems: "center", paddingRight: 14 }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${co.name}`}
          style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px", background: "none", border: "none",
            cursor: "pointer", textAlign: "left", font: "inherit",
          }}
        >
          <span aria-hidden="true" style={{ color: T.DIM, fontSize: 12, width: 16, flexShrink: 0 }}>
            {open ? "▾" : "▸"}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", color: T.TEXT, fontWeight: 800, fontSize: 13 }}>{co.name}</span>
            {co.domain && <span style={{ display: "block", color: T.DIM, fontSize: 11 }}>{co.domain}</span>}
          </span>
          <span style={{ color: T.MUTED, fontSize: 12, whiteSpace: "nowrap" }}>{statusLabel(co.status)}</span>
          <span style={{ color: T.DIM, fontSize: 11, whiteSpace: "nowrap" }}>
            {co.contact_count} contact{co.contact_count === 1 ? "" : "s"}
          </span>
        </button>
        <button
          onClick={onRequestDelete}
          style={{ background: "none", border: "none", color: T.DIM, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
        >
          Remove
        </button>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${T.BORDER_SOFT}`, padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <label style={fieldWrap}>
              <span style={fieldLabel}>{FIELD_LABELS.tier}</span>
            <select
              value={co.tier ?? ""}
              onChange={(e) => patch({ tier: e.target.value || null })}
              disabled={saving}
              aria-label="Tier"
              style={{ ...selectStyle, width: "auto", height: 32, fontSize: 12 }}
            >
              <option value="" style={selectOption}>{TIER_GROUP_LABELS[UNSORTED_TIER]}</option>
              {Object.entries(TIER_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
            </select>
            </label>
            <label style={fieldWrap}>
              <span style={fieldLabel}>{FIELD_LABELS.status}</span>
            <select
              value={co.status ?? ""}
              onChange={(e) => patch({ status: e.target.value || null })}
              disabled={saving}
              aria-label="Status"
              style={{ ...selectStyle, width: "auto", height: 32, fontSize: 12 }}
            >
              <option value="" style={selectOption}>—</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
            </select>
            </label>
            <input
              defaultValue={co.domain ?? ""}
              onBlur={(e) => e.target.value !== (co.domain ?? "") && patch({ domain: e.target.value || null })}
              placeholder="domain.com"
              aria-label="Domain"
              style={{ ...input, height: 32, fontSize: 12, width: 180 }}
            />
          </div>

          <textarea
            defaultValue={co.notes ?? ""}
            onBlur={(e) => e.target.value !== (co.notes ?? "") && patch({ notes: e.target.value || null })}
            placeholder="Notes"
            aria-label="Notes"
            rows={2}
            style={{ ...input, height: "auto", padding: "8px 12px", fontSize: 12, marginBottom: 12 }}
          />

          {loading && <div style={{ color: T.DIM, fontSize: 12 }}>Loading contacts…</div>}
          {err && <div style={{ color: T.ERROR, fontSize: 11 }}>{err}</div>}
          {loaded && contacts.length === 0 && (
            <div style={{ color: T.DIM, fontSize: 12 }}>No contacts here yet — a wishlist firm.</div>
          )}
          {contacts.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
              <a
                href={`/dashboard/network/contacts/${c.id}`}
                style={{ color: T.WRN_BLUE, fontWeight: 700, fontSize: 12, textDecoration: "none", flex: 1 }}
              >
                {c.first_name} {c.last_name}
              </a>
              <span style={{ color: T.MUTED, fontSize: 11, flex: 1 }}>{c.title ?? "—"}</span>
              {/* Same 7-group phase colours as the contacts spreadsheet. */}
              <span style={{ ...stagePillStyle(c.stage), fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
                {STAGE_LABELS[c.stage] ?? c.stage}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
