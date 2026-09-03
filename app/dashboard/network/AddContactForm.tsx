"use client"

import { useEffect, useMemo, useState } from "react"
import { T, input as inputStyle, select as selectStyle, selectOption } from "../../../lib/dashboard-theme"
import { authFetch, withSubject } from "./authFetch"
import { RELATIONSHIPS, PRIORITIES, RELATIONSHIP_LABELS, STAGE_LABELS, FIELD_LABELS } from "./vocab"

// "Add a contact" — a small modal form. Company is OPTIONAL (leave it blank for a
// standalone contact). The new contact starts at not_contacted with no due date;
// this form never sets stage, dates, or reminders — the route does not read them.
// On success it shows a link to the new record, because a not_contacted contact
// has no due date and so will NOT appear on the worklist.

export function AddContactForm({
  onClose, onCreated, initialCompany = "", returnTo = null, returnLabel = null,
}: {
  onClose: () => void
  onCreated: () => void
  /** Prefills the company field. Set when the form is opened FROM a company, so
   *  "add your first contact here" does not ask which company "here" is. */
  initialCompany?: string
  /**
   * Where the user came from, when they came from outside networking. Renders
   * as the primary action on the success panel.
   *
   * NOT AN AUTO-REDIRECT. Navigating the instant the row is created would take
   * away "Add another", which is exactly what someone adding people at a
   * company they just linked is likely to want next, and it would discard the
   * note explaining that the contact will not appear on the worklist. The user
   * chooses to close the loop.
   *
   * Already validated by the caller via safeReturn(); this component renders
   * whatever it is given.
   */
  returnTo?: string | null
  /** What the return button says. Null falls back to generic wording. */
  returnLabel?: string | null
}) {
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [title, setTitle] = useState("")
  const [company, setCompany] = useState(initialCompany)
  const [email, setEmail] = useState("")
  const [linkedin, setLinkedin] = useState("")
  const [relationship, setRelationship] = useState("")
  const [priority, setPriority] = useState("")
  const [segment, setSegment] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)

  // THE COMPANIES ALREADY ON THIS BOARD, for the field below.
  //
  // Fetched here rather than passed in. This form is opened from the roster
  // header, from the empty-company strip and now from the company panel, and a
  // list threaded through three callers is a list one of them will forget. The
  // request is small, it only fires while the modal is open, and authFetch adds
  // the subject, so a coach sees the CLIENT'S companies rather than their own.
  //
  // A failure is silent on purpose: with no suggestions the field is exactly
  // the free-text box it has always been, which still works.
  const [knownCompanies, setKnownCompanies] = useState<string[]>([])
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await authFetch("/api/network/companies")
        const j = await res.json()
        if (live && res.ok && j?.ok !== false) {
          setKnownCompanies((j.companies ?? []).map((c: { name: string }) => c.name).filter(Boolean))
        }
      } catch { /* suggestions are an aid, not a dependency */ }
    })()
    return () => { live = false }
  }, [])

  // WHAT WILL HAPPEN TO WHAT YOU TYPED, said before you submit.
  //
  // The route matches a company name case-insensitively and CREATES one on no
  // match, which is the right behaviour and an invisible one: "Northwind
  // Frieght" silently becomes a second company sitting next to the real one,
  // and nothing on this form ever said so. Matching is done here exactly as
  // matchOrCreateCompany does it, lowercased and trimmed, so the hint cannot
  // disagree with what the server is about to do.
  const companyMatch = useMemo(() => {
    const typed = company.trim().toLowerCase()
    if (!typed) return null
    return knownCompanies.find((n) => n.toLowerCase() === typed) ?? null
  }, [company, knownCompanies])

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
            {/* When the user arrived from somewhere else, closing THAT loop is
                the primary action and "Open contact" steps down. The company
                is deliberately kept on "Add another": someone who came here to
                staff one company usually has a second person in mind. */}
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              {returnTo ? (
                <>
                  <a href={returnTo} style={primaryBtn} data-testid="return-to-origin">
                    {returnLabel ? `Back to ${returnLabel}` : "Back to where you were"}
                  </a>
                  <a href={withSubject(`/dashboard/network/contacts/${created.id}`)} style={secondaryBtn}>Open contact</a>
                </>
              ) : (
                <a href={withSubject(`/dashboard/network/contacts/${created.id}`)} style={primaryBtn}>Open contact</a>
              )}
              <button
                onClick={() => { setCreated(null); setFirstName(""); setLastName(""); setTitle(""); setCompany(initialCompany); setEmail(""); setLinkedin(""); setRelationship(""); setPriority(""); setSegment("") }}
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
              {/* A LIST, NOT A DROPDOWN, and the difference matters. A <select>
                  would make an existing company the only possible answer, and
                  adding someone at a company you have not tracked yet is the
                  normal case, not the exception. A datalist suggests without
                  constraining, and it is the browser's own control: keyboard
                  and screen-reader behaviour come for free, and there is no
                  blur-versus-click race to get wrong. */}
              <Field
                label="Company (optional — leave blank for a standalone contact)"
                value={company}
                onChange={setCompany}
                placeholder="Northwind Freight"
                listId="add-contact-companies"
                hint={
                  !company.trim() ? null
                    : companyMatch ? { text: `Adds to ${companyMatch}`, tone: "known" }
                    : { text: "New company. It will be created.", tone: "new" }
                }
              />
              <datalist id="add-contact-companies">
                {knownCompanies.map((n) => <option key={n} value={n} />)}
              </datalist>
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
                    <option key={r} value={r} style={selectOption}>{RELATIONSHIP_LABELS[r]}</option>
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
  listId,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Binds the input to a <datalist> rendered by the caller. */
  listId?: string
  /** One line under the field saying what the value will do. */
  hint?: { text: string; tone: "known" | "new" } | null
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
      <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        list={listId}
        style={{ ...inputStyle, height: 40 }}
      />
      {hint && (
        // Not a warning. Creating a company is a legitimate outcome and the
        // second half of what this field is for; the line reports which of the
        // two is about to happen, so a typo is visible before it is submitted.
        <span
          data-testid="company-hint"
          style={{ fontSize: 10.5, fontWeight: 700, color: hint.tone === "known" ? T.MUTED : T.WRN_ORANGE }}
        >
          {hint.text}
        </span>
      )}
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
  // ABOVE THE COMPANY PANEL (60), because this form can now be opened FROM it
  // and the panel is deliberately left standing behind: you came from a
  // company, and you should still be looking at it when you are done.
  zIndex: 70,
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
  color: T.INK_ON_ACCENT,
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
