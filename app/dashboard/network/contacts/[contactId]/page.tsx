"use client"

// Network Tracker — CONTACT RECORD.
//
// The screen answers two questions in order: where does this stand, and what do
// I do about it. So the reading order is identity, then position, then the
// message you are about to send, then everything else folded into drawers that
// say what is inside them while shut.
//
// Redesign step 4 (2026-08-04): light theme, to the locked language, and a
// rework of the top half to remove three statements of one fact. Before this,
// the stage was said as a pill, again as a sentence under the name, and a third
// time as "Next: Send a reply" in the reminder row. Now:
//   - status is ONE treatment: the labelled stepper in "Where things stand".
//     Each circle names its stage and the current one is marked, so the position
//     IS the label. The header no longer repeats it in words.
//   - identity (role, employer, relationship, email, LinkedIn) is one run beside
//     the name, not a row of cards competing with the message
//   - the reminder row keeps only WHEN. The reason named what the status and the
//     hero button already say; the date and the overdue count are what nothing
//     else carries.
//
// Colour carries meaning in three registers and nothing else:
//   peach = act here   (one element: "Copy and mark as sent", inside the hero)
//   phase = status     (the header dot + text, and the progress bar)
//   quiet = reference  (drawers, reminder line, secondary buttons)

import { use as usePromise, useCallback, useEffect, useState } from "react"
import { LIGHT as S, PHASE_MEANING, action as actionStyle, tile, tileIdle } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { WhereThingsStand } from "./WhereThingsStand"
import { Collapsible } from "./Collapsible"
import { ActionLog } from "./ActionLog"
import { MessageComposer, type Message } from "./MessageComposer"
import { NotesLog } from "./NotesLog"
import { AppliedHere } from "./AppliedHere"
import { readBackTarget, DEFAULT_BACK } from "../../backTarget"
import {
  FIELD_LABELS, RELATIONSHIP_LABELS, RELATIONSHIPS, PRIORITIES, STAGE_PHASE,
} from "../../vocab"
import { NotesIcon, HistoryIcon, ProfileIcon, SignOutIcon } from "../../../../../components/icons"

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
  // `id` is what AppliedHere queries on. The endpoint already returns it
  // (network_companies(id, name, tier, status)); only this type omitted it.
  network_companies?: { id: string; name: string } | null
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
  // The draft the composer edits. Derived rather than fetched: drafts arrive in
  // the same `actions` payload as everything else, because they are the same
  // table. The newest is the one offered; a second open draft is possible in
  // the data and would need a picker nobody has asked for.
  const draft: Message | null = (actions as unknown as Message[])
    .filter((a) => a.status === "draft")
    .sort((a, b) => (b.action_date || "").localeCompare(a.action_date || ""))[0] ?? null
  /**
   * The action type just logged, if any — the input to the stage offer.
   *
   * Held HERE rather than in the log surfaces because the offer belongs at the
   * stage tracker, not next to the log: the whole confusion was that the two
   * systems looked unrelated, so the consequence of logging has to appear where
   * the stage is stated. Cleared when the offer is taken or dismissed.
   */
  const [justLogged, setJustLogged] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (loggedType?: string) => {
    if (loggedType) setJustLogged(loggedType)
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

  if (loading) return <main style={wrap}><p style={{ color: S.text.muted }}>Loading…</p></main>
  if (error || !contact)
    return (
      <main style={wrap}>
        <a href={backHref} style={backLink}>← Back to contacts</a>
        <div style={{ ...cardBase, marginTop: 18, padding: 22, borderColor: S.meaning.error.accent }}>
          <div style={{ color: S.meaning.error.ink, fontSize: 14.5 }}>{error || "Contact not found."}</div>
        </div>
      </main>
    )

  const company = contact.network_companies?.name
  const notes = actions.filter((a) => a.type === "note")
  const touches = actions.filter((a) => a.type !== "note")

  const phaseKey = PHASE_MEANING[STAGE_PHASE[contact.stage] ?? "idle"]
  const idle = phaseKey === "idle"
  const initials = `${(contact.first_name || "").charAt(0)}${(contact.last_name || "").charAt(0)}`.toUpperCase() || "?"

  // Drawer summaries. Each answers, while shut, the question that would
  // otherwise cost a click: is there anything in here?
  const detailBits = [
    contact.relationship ? RELATIONSHIP_LABELS[contact.relationship] : null,
    contact.priority ? `Priority ${contact.priority}` : null,
    contact.segment || null,
  ].filter(Boolean) as string[]
  // Relationship gets its own summary line when unset, rather than being one
  // absent item among three. It is not just another field: pickTemplate routes
  // on it, so an unset relationship means the hero above has no suggestion to
  // make, and the summary has to say why.
  const detailsSummary = !contact.relationship
    ? "Relationship not set, it drives which template is suggested"
    : detailBits.join(" · ")

  return (
    <main style={wrap}>
      <a href={backHref} style={backLink}>← Back to contacts</a>

      {/* ── Header ─────────────────────────────────────────────────
          Context BEFORE action. You should know who this is and where it
          stands before your eye reaches the message you are about to send,
          so the header carries three lines in decreasing permanence:
          who they are, where this stands, and how you know them. */}
      <header style={{ marginTop: 16, display: "flex", alignItems: "flex-start", gap: 16 }}>
        <span
          aria-hidden="true"
          style={{
            ...(idle ? tileIdle(S) : tile(S, phaseKey)),
            width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            display: "grid", placeItems: "center", fontSize: 17, fontWeight: 800, letterSpacing: 0.5,
          }}
        >
          {initials}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0 }}>
            {contact.first_name} {contact.last_name}
          </h1>
          {/* Identity, one run. Role, employer, how you know them and how to
              reach them are all properties of the PERSON, so they read as one
              line rather than as a row of cards competing with the message. */}
          <div
            style={{
              display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
              marginTop: 4, fontSize: 14.5, color: S.text.muted,
            }}
          >
            <span>{[contact.title, company].filter(Boolean).join(" · ") || "No title or company"}</span>
            <span style={{ color: S.text.dim }}>·</span>
            <span>
              {contact.relationship
                ? RELATIONSHIP_LABELS[contact.relationship]
                : <span style={{ color: S.meaning.attention.ink, fontWeight: 700 }}>Relationship not set</span>}
            </span>
            {contact.email && (
              <>
                <span style={{ color: S.text.dim }}>·</span>
                <a href={`mailto:${contact.email}`} style={identityLink}>{contact.email}</a>
              </>
            )}
            {contact.linkedin_url && (
              <>
                <span style={{ color: S.text.dim }}>·</span>
                <a href={contact.linkedin_url} target="_blank" rel="noreferrer" style={identityLink}>
                  LinkedIn ↗
                </a>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Where things stand ─────────────────────────────────
          Context BEFORE action: position and the moves sit directly under the
          identity, so you know where this is before your eye reaches the
          message you are about to send. */}
      <WhereThingsStand
        contact={contact}
        onChanged={load}
        actions={actions}
        justLogged={justLogged}
        onOfferSettled={() => setJustLogged(null)}
      />

      {/* ── What you've already applied to here ─────────────────
          Directly above the send panel, because it changes the message. A
          contact with no company, or a company with no linked applications,
          renders nothing at all. */}
      {contact.network_companies?.id && (
        <AppliedHere
          companyId={contact.network_companies.id}
          companyName={contact.network_companies.name}
        />
      )}

      {/* ── The thing you came here to do ──────────────────────── */}
      {/* WRITE THE MESSAGE. The action box and SendPanel stood here; that pair
          rendered a template from a library and asked you to copy it, and both
          went when the library did. This keeps what you write instead.

          A draft and a sent message are the same row in network_actions, so
          they arrive in `actions` with everything else and the timeline below
          shows one sequence rather than two. */}
      <MessageComposer
        contactId={contact.id}
        companyId={contact.network_companies?.id ?? null}
        companyName={contact.network_companies?.name ?? null}
        firstName={contact.first_name}
        draft={draft}
        onSaved={load}
      />

      {/* ── Reminder, one line ─────────────────────────────────── */}
      <ReminderLine contact={contact} onChanged={load} />

      {/* ── Reference, folded away ─────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        {/* Details opens for a contact with NO relationship set, because that
            single field drives the whole template engine (pickTemplate routes on
            it), so a new user lands on the setup step already open. Once it is
            set, this is reference and shuts. */}
        <Collapsible
          icon={<ProfileIcon size={20} />}
          title="Details" testId="details"
          defaultOpen={!contact.relationship}
          summary={detailsSummary}
        >
          <DetailsEditor contact={contact} onSaved={load} />
          <div style={{ marginTop: 22 }}>
            <div style={{ ...factLabel, marginBottom: 8 }}>Additional info</div>
            <TextFieldEditor
              contactId={contact.id} field="additional_info" value={contact.additional_info}
              placeholder="Context for this person: a hand-written opening line, why they're worth reaching, a shared connection…"
              onSaved={load}
            />
          </div>
        </Collapsible>

        <Collapsible
          icon={<HistoryIcon size={20} />}
          title="History" testId="history"
          defaultOpen={touches.length > 0}
          summary={touches.length ? `${touches.length} touch${touches.length === 1 ? "" : "es"} logged` : "Nothing yet"}
        >
          <ActionLog contactId={contact.id} actions={actions} onChanged={load} />
        </Collapsible>

        <Collapsible
          icon={<NotesIcon size={20} />}
          title="Notes" testId="notes"
          defaultOpen={notes.length > 0}
          summary={notes.length ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Nothing yet"}
        >
          {/* "About this person" is durable context, not a dated event, so it is
              pinned above the running log rather than being a fourth text area
              somewhere else on the page. */}
          <div style={{ ...factLabel, marginBottom: 8 }}>About this person</div>
          <TextFieldEditor
            contactId={contact.id} field="notes" value={contact.notes}
            placeholder="Durable context: how you met, what they care about…"
            onSaved={load}
          />
          {/* THE LOG GETS A HEADING TOO, as a peer of "About this person".
              Two textareas under one "Notes" drawer, only one of them labelled,
              read as the same box rendered twice — a tester reported them as a
              duplicate and typed into the wrong one. They are different things:
              durable context on the contact row above, dated log entries below.
              Naming both is what makes that legible. */}
          <div style={{ marginTop: 22 }}>
            <div style={{ ...factLabel, marginBottom: 8 }}>Add a note</div>
            <NotesLog contactId={contact.id} notes={notes} onSaved={load} />
          </div>
        </Collapsible>

        <Collapsible icon={<SignOutIcon size={20} />} title="Close out this contact" testId="danger" summary="Remove them and their history">
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
        style={{
          background: S.card, border: `1px solid ${S.meaning.error.accent}`, color: S.meaning.error.ink,
          borderRadius: 10, padding: "10px 18px", fontSize: 13.5, fontWeight: 800,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        Delete contact
      </button>
    )
  }
  return (
    <div style={{ padding: "16px 18px", borderRadius: 12, background: S.meaning.error.fill, border: `1px solid ${S.meaning.error.accent}` }}>
      <div style={{ color: S.text.primary, fontSize: 14.5, lineHeight: "22px" }}>
        Delete <strong>{name}</strong>? This removes {her} action log and notes. This can&apos;t be undone.
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
        <button
          onClick={del}
          disabled={busy}
          style={{
            background: S.meaning.error.accent, color: "#FFFFFF", border: "none", borderRadius: 10,
            padding: "10px 18px", fontSize: 13.5, fontWeight: 800, fontFamily: "inherit",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          style={{ background: "none", border: "none", color: S.text.muted, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          Cancel
        </button>
      </div>
      {err && <div style={{ color: S.meaning.error.ink, fontSize: 13, marginTop: 10 }}>{err}</div>}
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
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={factLabel}>{FIELD_LABELS.relationship}</span>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)} aria-label={FIELD_LABELS.relationship} style={{ ...control, width: 190 }}>
            <option value="">—</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={factLabel}>{FIELD_LABELS.priority}</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={FIELD_LABELS.priority} style={{ ...control, width: 100 }}>
            <option value="">—</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 180px" }}>
          <span style={factLabel}>Segment (target list)</span>
          <input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="e.g. Spring PM alumni" style={control} />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button
          onClick={save}
          disabled={busy || !dirty}
          style={
            dirty
              ? { ...actionStyle(S, "primary"), ...saveSize, opacity: busy ? 0.6 : 1 }
              : { ...saveSize, background: S.card, color: S.text.dim, border: `1px solid ${S.border}`, cursor: "default" }
          }
        >
          {busy ? "Saving…" : "Save details"}
        </button>
        {savedTick && <span style={{ color: S.text.muted, fontSize: 13.5 }}>Saved</span>}
        {err && <span style={{ color: S.meaning.error.ink, fontSize: 13.5 }}>{err}</span>}
      </div>
    </div>
  )
}

// The reminder state, one quiet row. Same control, same POSTs: it is reference,
// not the action, so it recedes.
function ReminderLine({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const snoozed = Boolean(contact.reminder_override)

  // Whole days late, measured from the start of each day so a reminder set this
  // morning is not "overdue" by lunchtime.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const overdueDays = contact.next_due_at
    ? Math.max(0, Math.round((startOfDay(new Date()) - startOfDay(new Date(contact.next_due_at))) / 86400000))
    : 0

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
      data-testid="reminder-line"
      style={{
        marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        fontSize: 14, color: S.text.muted, padding: "14px 20px",
        ...cardBase,
      }}
    >
      {/* WHEN, not what. The reason ("Send a reply") named the same thing the
          status above and the hero's button already say, so it was the third
          statement of one fact. The date is the part nothing else carries, and
          overdue is the part that changes behaviour, so those are what is left. */}
      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        {contact.next_due_at ? (
          <>
            {overdueDays > 0 ? (
              <strong style={{ color: S.meaning.attention.ink, fontWeight: 700 }}>
                Overdue by {overdueDays} day{overdueDays === 1 ? "" : "s"}
              </strong>
            ) : (
              <>Due <strong style={{ color: S.text.primary, fontWeight: 700 }}>{fmt(contact.next_due_at)}</strong></>
            )}
            {snoozed && (
              <span style={{ color: S.text.dim, marginLeft: 8 }}>
                snoozed, overrides the stage cadence
              </span>
            )}
          </>
        ) : "No reminder set."}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 7, flex: "0 0 auto" }}>
        <span style={{ color: S.text.dim, fontSize: 12.5, fontWeight: 700 }}>Snooze</span>
        {[3, 7, 14].map((d) => (
          <button
            key={d}
            onClick={() => snooze(d)}
            disabled={busy}
            title={`Snooze ${d} days`}
            style={{
              background: S.card, color: S.text.secondary, border: `1px solid ${S.border}`,
              borderRadius: 8, padding: "5px 11px", fontSize: 12.5, fontWeight: 800,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, fontFamily: "inherit",
            }}
          >
            {d}d
          </button>
        ))}
        {snoozed && (
          <button
            onClick={clearReminder}
            disabled={busy}
            style={{ background: "none", color: S.action.quietInk, border: "none", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", textDecoration: "underline", fontFamily: "inherit" }}
          >
            {busy ? "…" : "Clear"}
          </button>
        )}
      </span>
      {err && <div style={{ flexBasis: "100%", color: S.meaning.error.ink, fontSize: 13 }}>{err}</div>}
    </div>
  )
}

// Generic single-textarea PATCH editor, used for both notes and additional_info.
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

  /**
   * RESEED WHEN THE ROW CHANGES UNDER US. `draft` was seeded once at mount and
   * never resynced, so anything that updated the contact elsewhere left this box
   * showing stale text with no sign of it.
   *
   * Adjusting state during render, rather than in an effect, is the sanctioned
   * React pattern for "a prop changed and some state derives from it" — it
   * re-renders before paint instead of after, so the stale value is never shown.
   * Local typing does not change `value`, so this cannot clobber what someone is
   * in the middle of writing.
   */
  const [seenValue, setSeenValue] = useState(value)
  if (value !== seenValue) {
    setSeenValue(value)
    setDraft(value ?? "")
  }

  /**
   * COMMITS ON BLUR. There is no Save button any more, and that is the fix.
   *
   * This box sat directly above the note log's own textarea, under one "Notes"
   * heading, and the log's "Save note" was the visually dominant button in the
   * drawer. A tester typed here, reached for that button, and it did nothing at
   * all — it is disabled while the log's own box is empty. No error, no
   * feedback; her text then died when the drawer unmounted. The write path was
   * never broken. The second click was.
   *
   * Blur covers the ways out of the field that matter: clicking the drawer
   * toggle, tabbing on, or clicking into the note log all fire it before the
   * unmount. A disabled button that gives no feedback is indistinguishable from
   * a broken one, so the button is gone rather than restyled.
   */
  async function commit() {
    if (!dirty || busy) return
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
        onBlur={() => void commit()}
        placeholder={placeholder}
        aria-label={field === "notes" ? "About this person" : "Additional info"}
        rows={4}
        style={{
          display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
          background: S.well, border: `1px solid ${S.border}`, borderRadius: 10,
          padding: "12px 14px", fontSize: 14.5, lineHeight: "22px", minHeight: 96,
          color: S.text.primary, fontFamily: "inherit", outline: "none",
        }}
      />
      {/* A status line, not a control. It has to say something in the unsaved
          state too: silence next to typed text is exactly what made the old
          version read as broken. */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, minHeight: 20, fontSize: 13 }}
        aria-live="polite"
      >
        {err ? (
          <span style={{ color: S.meaning.error.ink }}>{err}</span>
        ) : busy ? (
          <span style={{ color: S.text.muted }}>Saving…</span>
        ) : savedTick ? (
          <span style={{ color: S.text.muted }}>Saved</span>
        ) : dirty ? (
          <span style={{ color: S.text.dim }}>Saves when you click away</span>
        ) : null}
      </div>
    </div>
  )
}

// Matches the contacts list. Was 820, a reading measure for the draft, but the
// stepper needs 950px to show all nine stages (9 x 86px columns + 8 x 22px
// connectors) and was clipping from about step seven. Seeing the whole path at
// once is worth more than the narrower column: the stepper is the thing that
// makes position self-evident, and a path you have to scroll to read is not.
const wrap: React.CSSProperties = { maxWidth: 1080 }
const backLink: React.CSSProperties = {
  color: S.action.quietInk, fontSize: 14, fontWeight: 700, textDecoration: "none",
}
const cardBase: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.borderSoft}`, borderRadius: 14, boxShadow: S.shadow.card,
}
const identityLink: React.CSSProperties = {
  color: S.action.quietInk, textDecoration: "none", fontWeight: 600,
}
const factLabel: React.CSSProperties = {
  color: S.text.muted, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
}
const control: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, borderRadius: 10,
  height: 42, padding: "0 12px", fontSize: 14, color: S.text.primary,
  fontFamily: "inherit", boxSizing: "border-box",
}
const saveSize: React.CSSProperties = {
  borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 800, fontFamily: "inherit",
}
