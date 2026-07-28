"use client"

// Network Tracker — CONTACT RECORD.
// Pipeline stepper + dated action log + notes + the reminder state (with a
// visible "clear reminder" control, since an override left alone persists as
// 'manual' indefinitely). All writes are owner-only and re-fetch the bundle;
// no due-date math lives here. The coach comment thread is a deliberate,
// unwired placeholder — the Coach Layer is a separate thread.

import { use as usePromise, useCallback, useEffect, useState } from "react"
import { T, card, eyebrow, headline, input as inputStyle, select as selectStyle, selectOption, textarea as textareaStyle } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { PipelineStepper } from "./PipelineStepper"
import { ActionLog } from "./ActionLog"
import { NotesLog } from "./NotesLog"
import { SendPanel } from "./SendPanel"
import { readBackTarget, DEFAULT_BACK } from "../../backTarget"
import { FIELD_LABELS, REASON_LABELS, RELATIONSHIP_LABEL, RELATIONSHIPS, PRIORITIES } from "../../vocab"

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

  useEffect(() => {
    void load()
  }, [load])

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

  return (
    <main style={wrap}>
      <a href={backHref} style={backLink}>← Back</a>

      {/* header */}
      <div style={{ marginTop: 14 }}>
        <div style={eyebrow}>CONTACT</div>
        <h1 style={{ ...headline, marginTop: 6 }}>
          {contact.first_name} {contact.last_name}
        </h1>
        <div style={{ color: T.MUTED, fontSize: 14, marginTop: 4 }}>
          {[contact.title, company].filter(Boolean).join(" · ") || "No title or company"}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
          {contact.email && (
            <a href={`mailto:${contact.email}`} style={metaLink}>{contact.email}</a>
          )}
          {contact.linkedin_url && (
            <a href={contact.linkedin_url} target="_blank" rel="noreferrer" style={metaLink}>LinkedIn ↗</a>
          )}
        </div>
      </div>

      {/* reminder state + clear control */}
      <ReminderBanner contact={contact} onChanged={load} />

      {/* details — relationship / priority / segment (the v3 fields) */}
      <Section title="Details">
        <DetailsEditor contact={contact} onSaved={load} />
      </Section>

      {/* additional info — per-contact context (opening lines, why-this-person);
          feeds Phase 8 templates as [ADDITIONAL_INFO]. Detail-page only. */}
      <Section title="Additional info">
        <TextFieldEditor
          contactId={contact.id}
          field="additional_info"
          value={contact.additional_info}
          placeholder="Context for this person — a hand-written opening line, why they're worth reaching, a shared connection…"
          onSaved={load}
        />
      </Section>

      {/* pipeline */}
      <Section title="Pipeline">
        <PipelineStepper contact={contact} onChanged={load} />
      </Section>

      {/* 8d — the payoff: the suggested message, ready to copy and log in one
          action. Sits ABOVE the action log: composing is what the user came to
          do; the log is the record of having done it. */}
      <Section title="Message">
        <SendPanel contact={contact as never} onLogged={load} />
      </Section>

      {/* action log */}
      <Section title="Action log">
        <ActionLog contactId={contact.id} actions={actions} onChanged={load} />
      </Section>

      {/* Pinned summary — durable facts about the person (how you met, what they
          care about), NOT dated events. Kept as the network_contacts.notes
          column; only the label changed. Sits above the running log. */}
      <Section title="About this person">
        <TextFieldEditor
          contactId={contact.id}
          field="notes"
          value={contact.notes}
          placeholder="Durable context — how you met, what they care about…"
          onSaved={load}
        />
      </Section>

      {/* Running notes log — type='note' rows from the same actions the log
          above renders. One source, two views. */}
      <Section title="Notes">
        <NotesLog
          contactId={contact.id}
          notes={actions.filter((a) => a.type === "note")}
          onSaved={load}
        />
      </Section>

      {/* coach comments — placeholder surface, intentionally unwired (Coach Layer) */}
      <Section title="Coach comments">
        <div
          style={{
            padding: "16px",
            borderRadius: 12,
            border: `1px dashed ${T.BORDER_SOFT}`,
            color: T.DIM,
            fontSize: 13,
          }}
        >
          Coach comments arrive with the Coach Layer. Nothing to show yet.
        </div>
      </Section>

      {/* delete — hard delete; on success navigate back to Contacts with a confirmation */}
      <Section title="Danger zone">
        <DeleteContactControl contact={contact} />
      </Section>
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
          style={{ background: T.ERROR, color: "#1a0505", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 12, fontWeight: 900, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
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
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)} style={{ ...selectStyle, width: 180, height: 40 }}>
            <option value="" style={selectOption}>—</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r} style={selectOption}>{RELATIONSHIP_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>{FIELD_LABELS.priority}</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ ...selectStyle, width: 90, height: 40 }}>
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
            color: dirty ? "#04060F" : T.DIM,
            fontWeight: 900, fontSize: 12, border: dirty ? "none" : `1px solid ${T.BORDER_SOFT}`,
            borderRadius: 11, padding: "9px 16px", cursor: busy || !dirty ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Saving…" : "Save details"}
        </button>
        {savedTick && <span style={{ color: T.SUCCESS, fontSize: 12 }}>Saved</span>}
        {err && <span style={{ color: T.ERROR, fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  )
}

function ReminderBanner({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
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
    <div
      style={{
        marginTop: 18,
        padding: "12px 16px",
        borderRadius: 12,
        background: snoozed ? T.WARNING_BG : T.GLASS,
        border: `1px solid ${snoozed ? "rgba(254,176,106,0.30)" : T.BORDER_SOFT}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        {contact.next_due_at ? (
          <span style={{ color: T.TEXT, fontSize: 13 }}>
            Next: <strong>{REASON_LABELS[contact.next_due_reason ?? ""] ?? contact.next_due_reason ?? "—"}</strong>
            {" · "}
            <span style={{ color: T.MUTED }}>{fmt(contact.next_due_at)}</span>
          </span>
        ) : (
          <span style={{ color: T.MUTED, fontSize: 13 }}>No reminder scheduled.</span>
        )}
        {snoozed && (
          <span style={{ color: T.WRN_ORANGE, fontSize: 12, marginLeft: 8 }}>
            (manual reminder — overrides the stage cadence)
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <span style={{ color: T.MUTED, fontSize: 11, fontWeight: 700 }}>Snooze</span>
        {[3, 7, 14].map((d) => (
          <button
            key={d}
            onClick={() => snooze(d)}
            disabled={busy}
            title={`Snooze ${d} days`}
            style={{
              background: T.GLASS, color: T.TEXT, border: `1px solid ${T.BORDER}`,
              borderRadius: 9, padding: "6px 10px", fontSize: 12, fontWeight: 800,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {d}d
          </button>
        ))}
        {snoozed && (
          <button
            onClick={clearReminder}
            disabled={busy}
            style={{
              background: "none", color: T.DIM, border: "none",
              fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer",
              textDecoration: "underline", marginLeft: 2,
            }}
          >
            {busy ? "…" : "Clear"}
          </button>
        )}
      </div>
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
        rows={4}
        style={{ ...textareaStyle, minHeight: 96 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button
          onClick={save}
          disabled={busy || !dirty}
          style={{
            background: dirty ? T.GRAD_PRIMARY : T.GLASS,
            color: dirty ? "#04060F" : T.DIM,
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
        {savedTick && <span style={{ color: T.SUCCESS, fontSize: 12 }}>Saved</span>}
        {err && <span style={{ color: T.ERROR, fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 12 }}>{title}</div>
      {children}
    </section>
  )
}

const wrap: React.CSSProperties = { padding: "28px 24px", maxWidth: 820, margin: "0 auto" }
const backLink: React.CSSProperties = { color: T.MUTED, fontSize: 12, fontWeight: 700, textDecoration: "none" }
const metaLink: React.CSSProperties = { color: T.WRN_BLUE, fontSize: 13, textDecoration: "none" }
