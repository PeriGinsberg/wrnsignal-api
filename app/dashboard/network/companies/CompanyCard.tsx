"use client"

// One company on the board: a header row (initials, name, domain, status,
// contact count) that expands to reveal its contacts and an edit panel.
//
// Contacts are LAZY-LOADED, fetched on first expand and then kept. The board can
// hold a lot of companies and most are never opened, so fetching every roster up
// front would be a large amount of work thrown away. Collapsing does not discard
// what was loaded, and re-expanding does NOT refetch; `loaded` is the guard, and
// it is separate from `contacts.length` so a company with genuinely zero
// contacts is not re-fetched forever.
//
// Redesign step 5 (2026-08-04): light theme, and the expanded contacts are the
// SAME ContactCard the roster uses. A person should not look like a card in one
// place and a table row in another, and reusing it means the tile, the status
// dot and the last-activity line stay in sync for free.
//
// A zero-contact company keeps a calm, persistent "No contacts yet" badge and
// offers the one peach action on the card. That is the part of the designed
// empty-company state that works today; the guidance and the LinkedIn searches
// beside it in the mockup come from the JobFit merge and land in Phase B.
//
// The initials tile is NAVY, not the peach in the mockup. Peach is the action
// colour and appears only on buttons; a company tile is structure, exactly like
// a contact tile. Confirmed as a mockup oversight rather than an exception.

import { useState } from "react"
import { LIGHT as S, action as actionStyle, tileStructural, tileIdle } from "../../../../lib/theme/surfaces"
import { authFetch } from "../authFetch"
import { AddContactForm } from "../AddContactForm"
import { ContactCard } from "../contacts/ContactCard"
import { CompaniesIcon } from "../../../../components/icons"
import { TIER_LABELS, TIER_GROUP_LABELS, UNSORTED_TIER, STATUS_LABELS, FIELD_LABELS, statusLabel } from "../vocab"
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
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
  const [addOpen, setAddOpen] = useState(false)

  const empty = co.contact_count === 0

  async function loadContacts() {
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

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || loaded || loading) return // fetch ONCE, on first expand only
    await loadContacts()
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
    <div
      style={{
        background: S.card,
        border: `1px solid ${S.borderSoft}`,
        borderRadius: 14,
        boxShadow: S.shadow.card,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      {/* THE WHOLE ROW is the expand control, not just the chevron. A small
          chevron with an inert name beside it looks interactive everywhere and
          responds in one place, and clicking the company name is what a user
          actually does.

          It is a real <button>, so it is reachable by keyboard. Remove stays a
          SIBLING, outside it: nesting a button inside a button is invalid HTML,
          and keeping it out also means Remove cannot bubble into a toggle with
          no stopPropagation needed. Everything inside the button is phrasing
          content (span, not div) for the same validity reason. */}
      <div style={{ display: "flex", alignItems: "center", paddingRight: 18 }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${co.name}`}
          style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 14,
            padding: "14px 18px", background: "none", border: "none",
            cursor: "pointer", textAlign: "left", font: "inherit",
          }}
        >
          <span aria-hidden="true" style={{ color: S.text.dim, fontSize: 12, width: 12, flexShrink: 0 }}>
            {open ? "▾" : "▸"}
          </span>
          <span
            aria-hidden="true"
            style={{
              ...(empty ? tileIdle(S) : tileStructural(S)),
              width: 42, height: 42, borderRadius: 11, flexShrink: 0,
              display: "grid", placeItems: "center", fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
            }}
          >
            {initials(co.name)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", color: S.text.primary, fontWeight: 800, fontSize: 16 }}>
              {co.name}
            </span>
            <span style={{ display: "block", color: S.text.muted, fontSize: 13.5, marginTop: 2 }}>
              {[co.domain, statusLabel(co.status) !== "—" ? statusLabel(co.status) : null]
                .filter(Boolean)
                .join(" · ") || "No domain yet"}
            </span>
          </span>
          {/* Calm, and persistent until a contact exists. Not an alarm and not
              aged: a wishlist firm with nobody in it yet is a normal state, it
              just happens to be the one thing the card can tell you to fix. */}
          {empty ? (
            <span
              style={{
                background: S.meaning.attention.fill, color: S.meaning.attention.ink,
                fontSize: 12.5, fontWeight: 700, padding: "5px 12px", borderRadius: 999,
                whiteSpace: "nowrap",
              }}
            >
              No contacts yet
            </span>
          ) : (
            <span style={{ color: S.text.muted, fontSize: 13.5, whiteSpace: "nowrap" }}>
              {co.contact_count} contact{co.contact_count === 1 ? "" : "s"}
            </span>
          )}
        </button>
        <button
          onClick={onRequestDelete}
          style={{
            background: "none", border: "none", color: S.action.quietInk,
            fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Remove
        </button>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${S.borderSoft}`, padding: "18px" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
            <label style={fieldWrap}>
              <span style={fieldLabel}>{FIELD_LABELS.tier}</span>
              <select
                value={co.tier ?? ""}
                onChange={(e) => patch({ tier: e.target.value || null })}
                disabled={saving}
                aria-label="Tier"
                style={{ ...control, width: "auto" }}
              >
                <option value="">{TIER_GROUP_LABELS[UNSORTED_TIER]}</option>
                {Object.entries(TIER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={fieldWrap}>
              <span style={fieldLabel}>{FIELD_LABELS.status}</span>
              <select
                value={co.status ?? ""}
                onChange={(e) => patch({ status: e.target.value || null })}
                disabled={saving}
                aria-label="Status"
                style={{ ...control, width: "auto" }}
              >
                <option value="">—</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ ...fieldWrap, flex: "1 1 200px" }}>
              <span style={fieldLabel}>Domain</span>
              <input
                defaultValue={co.domain ?? ""}
                onBlur={(e) => e.target.value !== (co.domain ?? "") && patch({ domain: e.target.value || null })}
                placeholder="domain.com"
                aria-label="Domain"
                style={control}
              />
            </label>
          </div>

          <label style={{ ...fieldWrap, marginBottom: 18 }}>
            <span style={fieldLabel}>Notes</span>
            <textarea
              defaultValue={co.notes ?? ""}
              onBlur={(e) => e.target.value !== (co.notes ?? "") && patch({ notes: e.target.value || null })}
              placeholder="What you know about this company"
              aria-label="Notes"
              rows={2}
              style={{ ...control, height: "auto", padding: "10px 12px", lineHeight: "21px" }}
            />
          </label>

          {loading && <div style={{ color: S.text.muted, fontSize: 14 }}>Loading contacts…</div>}
          {err && <div style={{ color: S.meaning.error.ink, fontSize: 13 }}>{err}</div>}

          {loaded && contacts.length === 0 && !addOpen && (
            <div
              style={{
                textAlign: "center", padding: "26px 20px", borderRadius: 12,
                border: `1px dashed ${S.border}`, background: "rgba(255,255,255,0.5)",
              }}
            >
              <CompaniesIcon size={34} style={{ margin: "0 auto 12px" }} />
              <div style={{ color: S.text.muted, fontSize: 14.5 }}>
                No contacts here yet, a wishlist firm. Found someone? Add them and start your outreach.
              </div>
              <button
                onClick={() => setAddOpen(true)}
                style={{ ...actionStyle(S, "primary"), ...addBtn, marginTop: 16 }}
              >
                + Add your first contact
              </button>
            </div>
          )}

          {addOpen && (
            <AddContactForm
              initialCompany={co.name}
              onClose={() => setAddOpen(false)}
              onCreated={() => { setAddOpen(false); void loadContacts() }}
            />
          )}

          {contacts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {contacts.map((c) => <ContactCard key={c.id} contact={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const fieldWrap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 }
const fieldLabel: React.CSSProperties = {
  color: S.text.muted, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
}
const control: React.CSSProperties = {
  background: S.well, border: `1px solid ${S.border}`, borderRadius: 10,
  height: 40, padding: "0 12px", fontSize: 14, color: S.text.primary,
  fontFamily: "inherit", boxSizing: "border-box", width: "100%",
}
const addBtn: React.CSSProperties = {
  borderRadius: 10, padding: "11px 20px", fontSize: 14.5, fontFamily: "inherit",
}
