"use client"

// Network Tracker — CONTACT RECORD.
//
// Restructured per docs/network-tracker/network-tracker-ux-contact-record.md.
// Nothing was removed: every capability the old ten-section stack had is still
// reachable. What changed is order and prominence.
//
// The old screen put the thing the user came to do — send a message, record that
// they reached out — at the BOTTOM, under four near-identical navy text areas.
// Now the send box is the first thing under the header, accent-bordered, with
// the only warm button on the page; the stage moves that need no message sit
// under it in plain language; and everything else folds into drawers that say
// what is inside them while shut.
//
// Colour carries meaning in three registers and nothing else:
//   warm  = act here   (one element: "Copy and mark as sent")
//   phase = status     (the header stage pill, from the shared 7-group palette)
//   quiet = reference  (drawers, reminder line, secondary buttons)

import { use as usePromise, useCallback, useEffect, useState } from "react"
import { T, card, eyebrow, headline, input as inputStyle, select as selectStyle, selectOption, textarea as textareaStyle } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { ActionBox } from "./ActionBox"
import { QuickActions } from "./QuickActions"
import { Collapsible } from "./Collapsible"
import { ActionLog } from "./ActionLog"
import { NotesLog } from "./NotesLog"
import { readBackTarget, DEFAULT_BACK } from "../../backTarget"
import { ContactTile } from "../../ContactTile"
import {
  FIELD_LABELS, REASON_LABELS, RELATIONSHIP_LABELS, RELATIONSHIPS, PRIORITIES,
  STAGE_LABELS, stagePillStyle,
} from "../../vocab"

type Contact = {
  id: string
  first_name: string
  last_name: string
  title: string | null
  email: string | null
  linkedin_url: string | null
  stage: string
  outcome_type: string | null
  relationship: string | null
  priority: string | null
  segment: string | null
  additional_info: string | null
  next_due_at: string | null
  next_due_reason: string | null
  reminder_override: string | null
  notes: string | null
  network_companies?: { name: string } | null
}
type Action = { id: string; type: string; action_date: string; note: string | null; author_role: string }

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export default function ContactRecordPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = usePromise(params)
  // Resolved in an effect: sessionStorage does not exist during SSR, so the
  // first paint uses the default and swaps to the recorded origin on mount.
  const [backHref, setBackHref] = useState(DEFAULT_BACK)
  useEffect(() => { setBackHref(readBackTarget()) }, [])

  const [contact, setContact] = useState<Contact | null>(null)
  const [actions, setActions] = useState<Action[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contactId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load this contact (${res.status})`)
      setContact(j.contact)
      setActions(j.actions ?? [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [contactId])

  useEffect(() => { void load() }, [load])

  if (loading) return <main style={wrap}><p style={{ color: T.MUTED }}>Loading…</p></main>
  if (error || !contact)
    return (
      <main style={wrap}>
        <a href={backHref} style={backLink}>← Back</a>
        <div style={{ ...card, marginTop: 16, padding: 20, background: T.ERROR_BG, borderColor: "rgba(255,120,120,0.35)" }}>
          <div style={{ color: T.ERROR, fontSize: 13 }}>{error || "Contact not found."}</div>
        </div>
      </main>
    )

  const company = contact.network_companies?.name
  const notes = actions.filter((a) => a.type === "note")
  const touches = actions.filter((a) => a.type !== "note")

  // Drawer summaries. Each answers, while shut, the question that would
  // otherwise cost a click: is there anything in here?
  const detailBits = [
    contact.relationship ? RELATIONSHIP_LABELS[contact.relationship] : null,
    contact.priority ? `Priority ${contact.priority}` : null,
    contact.segment || null,
  ].filter(Boolean) as string[]
  // Relationship gets its own summary line when unset, rather than being one
  // absent item among three. It is not just another field: pickTemplate routes
  // on it, so an unset relationship means the action box above has no suggestion
  // to make — the summary has to say why.
  const detailsSummary = !contact.relationship
    ? "Relationship not set — it drives which template is suggested"
    : detailBits.join(" · ")

  return (
    <main style={wrap}>
      <a href={backHref} style={backLink}>← Back</a>

      {/* ── 1. Header, compact ─────────────────────────────────── */}
      <header style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* Same tile, same colour rule as everywhere else a person appears. */}
          <ContactTile contact={contact} size={46} />
          <h1 style={{ ...headline, margin: 0 }}>{contact.first_name} {contact.last_name}</h1>
          {/* Phase colour as STATUS. This one pill replaced the seven-segment
              phase bar: same information, same shared palette, one element. */}
          <span data-testid="stage-pill" style={{ ...stagePillStyle(contact.stage), fontSize: 11.5, fontWeight: 800, padding: "4px 11px", borderRadius: 999 }}>
            {STAGE_LABELS[contact.stage] ?? contact.stage}
          </span>
        </div>
        <div style={{ color: T.MUTED, fontSize: 13, marginTop: 5, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <span>{[contact.title, company].filter(Boolean).join(" · ") || "No title or company"}</span>
          {contact.email && <a href={`mailto:${contact.email}`} style={metaLink}>{contact.email}</a>}
          {contact.linkedin_url && <a href={contact.linkedin_url} target="_blank" rel="noreferrer" style={metaLink}>LinkedIn ↗</a>}
        </div>
      </header>

      {/* ── 2. Your next move ──────────────────────────────────── */}
      <ActionBox contact={contact as never} onLogged={load} />

      {/* ── 3. Something happened (+ the full stage control) ───── */}
      <QuickActions contact={contact} onChanged={load} />

      {/* ── 4. Reminder, one line ──────────────────────────────── */}
      <ReminderLine contact={contact} onChanged={load} />

      {/* ── 5. Reference, folded away ──────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        {/* Details opens for a contact with NO relationship set, because that
            single field drives the whole template engine (pickTemplate routes on
            it) — a new user should land on the setup step already open. Once it
            is set, this is reference and shuts. */}
        <Collapsible
          title="Details" testId="details"
          defaultOpen={!contact.relationship}
          summary={detailsSummary}
        >
          <DetailsEditor contact={contact} onSaved={load} />
          <div style={{ marginTop: 18 }}>
            <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 8 }}>Additional info</div>
            <TextFieldEditor
              contactId={contact.id} field="additional_info" value={contact.additional_info}
              placeholder="Context for this person — a hand-written opening line, why they're worth reaching, a shared connection…"
              onSaved={load}
            />
          </div>
        </Collapsible>

        <Collapsible
          title="History" testId="history"
          defaultOpen={touches.length > 0}
          summary={touches.length ? `${touches.length} touch${touches.length === 1 ? "" : "es"} logged` : "Nothing yet"}
        >
          <ActionLog contactId={contact.id} actions={actions} onChanged={load} />
        </Collapsible>

        <Collapsible
          title="Notes" testId="notes"
          defaultOpen={notes.length > 0}
          summary={notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Nothing yet"}
        >
          {/* "About this person" is durable context, not a dated event, so it is
              pinned above the running log rather than being a fourth text area
              somewhere else on the page. */}
          <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 8 }}>About this person</div>
          <TextFieldEditor
            contactId={contact.id} field="notes" value={contact.notes}
            placeholder="Durable context — how you met, what they care about…"
            onSaved={load}
          />
          <div style={{ marginTop: 18 }}>
            <NotesLog contactId={contact.id} notes={notes} onSaved={load} />
          </div>
        </Collapsible>

        <Collapsible title="Danger zone" testId="danger" summary="Delete this contact">
          <DeleteContactControl contact={contact} />
        </Collapsible>
      </div>
    </main>
  )
}

function DeleteContactControl({ contact }: { contact: Contact }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const name = `${contact.first_name} ${contact.last_name}`.trim()
  const her = contact.first_name ? "their" : "its"

  async function del() {
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Delete failed (${res.status})`)
      // Leave the (now-gone) record; land on Contacts with a confirmation.
      window.location.assign(`/dashboard/network/contacts?deleted=${encodeURIComponent(name)}`)
    } catch (e: any) {
      setErr(e?.message || String(e))
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        style={{ background: "none", border: `1px solid rgba(255,120,120,0.35)`, color: T.ERROR, borderRadius: 11, padding: "9px 16px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
      >
        Delete contact
      </button>
    )
  }
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, background: T.ERROR_BG, border: `1px solid rgba(255,120,120,0.35)` }}>
      <div style={{ color: T.TEXT, fontSize: 13, lineHeight: "20px" }}>
        Delete <strong>{name}</strong>? This removes {her} action log and notes. This can&apos;t be undone.
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button onClick={del} disabled={busy}
          style={{ background: T.ERROR, color: T.INK_ON_ERROR, border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 12, fontWeight: 900, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button onClick={() => setConfirming(false)} disabled={busy}
          style={{ background: "none", border: "none", color: T.MUTED, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
      {err && <div style={{ color: T.ERROR, fontSize: 12, marginTop: 8 }}>{err}</div>}
    </div>
  )
}

function DetailsEditor({ contact, onSaved }: { contact: Contact; onSaved: () => void }) {
  const [relationship, setRelationship] = useState(contact.relationship ?? "")
  const [priority, setPriority] = useState(contact.priority ?? "")
  const [segment, setSegment] = useState(contact.segment ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState(false)
  const dirty =
    relationship !== (contact.relationship ?? "") ||
    priority !== (contact.priority ?? "") ||
    segment !== (contact.segment ?? "")

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relationship, priority, segment }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Save failed (${res.status})`)
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1500)
      onSaved()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>{FIELD_LABELS.relationship}</span>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)} aria-label={FIELD_LABELS.relationship} style={{ ...selectStyle, width: 180, height: 40 }}>
            <option value="" style={selectOption}>—</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r} style={selectOption}>{RELATIONSHIP_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>{FIELD_LABELS.priority}</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={FIELD_LABELS.priority} style={{ ...selectStyle, width: 90, height: 40 }}>
            <option value="" style={selectOption}>—</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p} style={selectOption}>{p}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px" }}>
          <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>SEGMENT (target list)</span>
          <input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="e.g. Spring PM alumni" style={{ ...inputStyle, height: 40 }} />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <button
          onClick={save}
          disabled={busy || !dirty}
          style={{
            background: dirty ? T.GRAD_PRIMARY : T.GLASS,
            color: dirty ? T.INK_ON_ACCENT : T.DIM,
            fontWeight: 900, fontSize: 12, border: dirty ? "none" : `1px solid ${T.BORDER_SOFT}`,
            borderRadius: 11, padding: "9px 16px", cursor: busy || !dirty ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Saving…" : "Save details"}
        </button>
        {savedTick && <span style={{ color: T.MUTED, fontSize: 12 }}>Saved</span>}
        {err && <span style={{ color: T.ERROR, fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  )
}

// The reminder state, condensed from a full banner to one quiet row. Same
// control, same POSTs — it is reference, not the action, so it recedes.
function ReminderLine({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const snoozed = Boolean(contact.reminder_override)

  async function setReminder(body: unknown, label: string) {
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `${label} failed (${res.status})`)
      onChanged()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }
  // Snooze is a deliberate decision, so it lives here (not in the scan view).
  const snooze = (days: number) =>
    setReminder({ reminder_override: new Date(Date.now() + days * 86400000).toISOString() }, "Snooze")
  // Clearing folds the contact back onto its stage cadence (reason no longer 'manual').
  const clearReminder = () => setReminder({ reminder_override: null }, "Clear")

  return (
    <div data-testid="reminder-line" style={{
      marginTop: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      fontSize: 12.5, color: T.MUTED,
    }}>
      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        {contact.next_due_at ? (
          <>
            Next: <strong style={{ color: T.TEXT, fontWeight: 700 }}>
              {REASON_LABELS[contact.next_due_reason ?? ""] ?? contact.next_due_reason ?? "—"}
            </strong>
            {" · "}{fmt(contact.next_due_at)}
            {snoozed && <span style={{ color: T.WRN_ORANGE, marginLeft: 8 }}>manual — overrides the stage cadence</span>}
          </>
        ) : "No reminder set."}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
        <span style={{ color: T.DIM, fontSize: 11, fontWeight: 700 }}>Snooze</span>
        {[3, 7, 14].map((d) => (
          <button key={d} onClick={() => snooze(d)} disabled={busy} title={`Snooze ${d} days`}
            style={{
              background: "none", color: T.MUTED, border: `1px solid ${T.BORDER_SOFT}`,
              borderRadius: 8, padding: "3px 8px", fontSize: 11.5, fontWeight: 800,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "inherit",
            }}>
            {d}d
          </button>
        ))}
        {snoozed && (
          <button onClick={clearReminder} disabled={busy}
            style={{ background: "none", color: T.DIM, border: "none", fontSize: 11.5, fontWeight: 700, cursor: busy ? "default" : "pointer", textDecoration: "underline" }}>
            {busy ? "…" : "Clear"}
          </button>
        )}
      </span>
      {err && <div style={{ flexBasis: "100%", color: T.ERROR, fontSize: 12 }}>{err}</div>}
    </div>
  )
}

// Generic single-textarea PATCH editor — used for both notes and additional_info.
// The field name is the PATCH key (only present keys are touched by the route).
function TextFieldEditor({
  contactId, field, value, placeholder, onSaved,
}: {
  contactId: string
  field: "notes" | "additional_info"
  value: string | null
  placeholder: string
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(value ?? "")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState(false)
  const dirty = draft !== (value ?? "")

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: draft }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Save failed (${res.status})`)
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1500)
      onSaved()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={field === "notes" ? "About this person" : "Additional info"}
        rows={4}
        style={{ ...textareaStyle, minHeight: 96 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button
          onClick={save}
          disabled={busy || !dirty}
          style={{
            background: dirty ? T.GRAD_PRIMARY : T.GLASS,
            color: dirty ? T.INK_ON_ACCENT : T.DIM,
            fontWeight: 900,
            fontSize: 12,
            border: dirty ? "none" : `1px solid ${T.BORDER_SOFT}`,
            borderRadius: 11,
            padding: "9px 16px",
            cursor: busy || !dirty ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {savedTick && <span style={{ color: T.MUTED, fontSize: 12 }}>Saved</span>}
        {err && <span style={{ color: T.ERROR, fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { padding: "28px 24px", maxWidth: 820, margin: "0 auto" }
const backLink: React.CSSProperties = { color: T.MUTED, fontSize: 12, fontWeight: 700, textDecoration: "none" }
const metaLink: React.CSSProperties = { color: T.WRN_BLUE, fontSize: 12.5, textDecoration: "none" }
