"use client"

import { useState } from "react"
import { T, input as inputStyle, select as selectStyle, selectOption } from "../../../lib/dashboard-theme"
import { authFetch } from "./authFetch"
import { RELATIONSHIPS, PRIORITIES, RELATIONSHIP_LABEL, STAGE_LABELS, FIELD_LABELS } from "./vocab"

// "Add a contact" — a small modal form. Company is OPTIONAL (leave it blank for a
// standalone contact). The new contact starts at not_contacted with no due date;
// this form never sets stage, dates, or reminders — the route does not read them.
// On success it shows a link to the new record, because a not_contacted contact
// has no due date and so will NOT appear on the worklist.

export function AddContactForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [title, setTitle] = useState("")
  const [company, setCompany] = useState("")
  const [email, setEmail] = useState("")
  const [linkedin, setLinkedin] = useState("")
  const [relationship, setRelationship] = useState("")
  const [priority, setPriority] = useState("")
  const [segment, setSegment] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)

  const canSubmit = firstName.trim() && lastName.trim() && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch("/api/network/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          title: title || undefined,
          company_name: company || undefined, // omitted → standalone contact
          email: email || undefined,
          linkedin_url: linkedin || undefined,
          relationship: relationship || undefined,
          priority: priority || undefined,
          segment: segment || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        // 409 duplicate arrives here as a clean, human message from the route.
        throw new Error(j?.error || `Could not add contact (${res.status})`)
      }
      setCreated({ id: j.contact.id, name: `${j.contact.first_name} ${j.contact.last_name}` })
      onCreated() // let the worklist re-fetch (won't show a not_contacted contact, but keeps state fresh)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {created ? (
          <div>
            <div style={{ color: T.TEXT, fontSize: 15, fontWeight: 800 }}>Added {created.name}.</div>
            <div style={{ color: T.MUTED, fontSize: 13, marginTop: 8, lineHeight: "20px" }}>
              They start as <strong>{STAGE_LABELS.identified}</strong> with no reminder, so they won&apos;t appear on
              today&apos;s worklist until you reach out and log it.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <a href={`/dashboard/network/contacts/${created.id}`} style={primaryBtn}>Open contact</a>
              <button
                onClick={() => { setCreated(null); setFirstName(""); setLastName(""); setTitle(""); setCompany(""); setEmail(""); setLinkedin(""); setRelationship(""); setPriority(""); setSegment("") }}
                style={secondaryBtn}
              >
                Add another
              </button>
              <button onClick={onClose} style={{ ...secondaryBtn, marginLeft: "auto" }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h2 style={{ color: T.TEXT, fontSize: 17, fontWeight: 900, margin: 0 }}>Add a contact</h2>
              <button onClick={onClose} style={{ background: "none", border: "none", color: T.DIM, fontSize: 18, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <Field label="First name *" value={firstName} onChange={setFirstName} autoFocus />
              <Field label="Last name *" value={lastName} onChange={setLastName} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Title" value={title} onChange={setTitle} placeholder="VP Operations" />
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Company (optional — leave blank for a standalone contact)" value={company} onChange={setCompany} placeholder="Northwind Freight" />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <Field label="Email" value={email} onChange={setEmail} placeholder="name@company.com" />
              <Field label="LinkedIn URL" value={linkedin} onChange={setLinkedin} placeholder="https://linkedin.com/in/…" />
            </div>

            {/* v3 fields. Relationship picks the template sequence — the field
                the product treats as most important — so it leads this row. */}
            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>{FIELD_LABELS.relationship} (picks the sequence)</span>
                <select value={relationship} onChange={(e) => setRelationship(e.target.value)} style={{ ...selectStyle, height: 40 }}>
                  <option value="" style={selectOption}>—</option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r} style={selectOption}>{RELATIONSHIP_LABEL[r]}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 90 }}>
                <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>{FIELD_LABELS.priority}</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ ...selectStyle, height: 40 }}>
                  <option value="" style={selectOption}>—</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p} style={selectOption}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Segment (target list — optional)" value={segment} onChange={setSegment} placeholder="e.g. Spring PM alumni" />
            </div>

            {err && <div style={{ color: T.ERROR, fontSize: 12, marginTop: 12 }}>{err}</div>}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={submit} disabled={!canSubmit} style={{ ...primaryBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}>
                {busy ? "Adding…" : "Add contact"}
              </button>
              <button onClick={onClose} style={secondaryBtn}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ ...inputStyle, height: 40 }}
      />
    </label>
  )
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(4,6,15,0.6)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "10vh 16px",
  zIndex: 50,
}
const panel: React.CSSProperties = {
  background: T.CARD,
  border: `1px solid ${T.BORDER}`,
  borderRadius: 18,
  padding: 24,
  width: "100%",
  maxWidth: 520,
}
const primaryBtn: React.CSSProperties = {
  background: T.GRAD_PRIMARY,
  color: "#04060F",
  fontWeight: 900,
  fontSize: 13,
  border: "none",
  borderRadius: 12,
  padding: "11px 18px",
  textDecoration: "none",
  cursor: "pointer",
}
const secondaryBtn: React.CSSProperties = {
  background: T.GLASS,
  color: T.TEXT,
  border: `1px solid ${T.BORDER}`,
  fontWeight: 800,
  fontSize: 13,
  borderRadius: 12,
  padding: "11px 18px",
  cursor: "pointer",
}
