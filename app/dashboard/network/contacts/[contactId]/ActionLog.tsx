"use client"

import { useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { ACTION_TYPE_OPTIONS, ACTION_TYPE_LABEL } from "../../vocab"

// The dated action log + an "add action" form. Actions may be BACKDATED (the
// route accepts action_date and the engine measures intervals from it), so the
// date input defaults to today but is freely editable to the past. Logging runs
// the engine in the route — this component never computes a due date.
//
// Redesign step 4: light theme. "Log it" keeps the peach action treatment
// because inside this drawer it IS the action; the peach-is-one-thing rule is
// about a screen at rest, and a drawer the user has deliberately opened to log
// something is its own context.

type Action = {
  id: string
  type: string
  action_date: string
  note: string | null
  author_role: string
  // MESSAGES SHARE THIS TABLE. A row with a body is a message; the rest are
  // logged actions, exactly as before. Optional because the pre-message rows
  // (78 in dev) have none of it and must keep rendering unchanged.
  body?: string | null
  channel?: string | null
  subject?: string | null
  status?: string | null
}

const CHANNEL_LABEL: Record<string, string> = { email: "Email", linkedin: "LinkedIn" }

// Action type vocabulary is shared (see ../../vocab).
const ACTION_TYPES = ACTION_TYPE_OPTIONS
const TYPE_LABEL = ACTION_TYPE_LABEL

// yyyy-mm-dd for a <input type="date">, from an ISO string or Date.
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function ActionLog({
  contactId,
  actions,
  onChanged,
}: {
  contactId: string
  actions: Action[]
  /** Carries the type just logged so the stage tracker can offer the move it
   *  implies. Optional arg: existing callers that ignore it still work. */
  onChanged: (loggedType?: string) => void
}) {
  // EMPTY, not "touch_1". A pre-selected first option is a default nobody
  // chose: the fastest path through this form logs a first outreach on a
  // contact you have written to five times, and it does it silently. Two
  // testers hit it. "" forces a choice and disables the button until one.
  const [type, setType] = useState("")
  const [date, setDate] = useState(toDateInput(new Date()))
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // SHUT BY DEFAULT. History mostly writes itself now: sending a message
  // logs one, and a stage change logs one. Leaving a form open above the
  // list made the drawer read as data entry, and made logging look like
  // something you were expected to do by hand.
  //
  // Kept rather than deleted, because the form is the ONLY way to record
  // what happened off SIGNAL: a phone call, a coffee, a reply that arrived
  // somewhere else, or anything at all from before this account existed.
  // The date input is backdatable for exactly that reason.
  const [manualOpen, setManualOpen] = useState(false)

  async function add() {
    if (!type) return   // the button is disabled, but a form must not depend on that
    setBusy(true)
    setErr(null)
    try {
      // Interpret the date input at local noon so the UTC action_date lands on
      // the intended calendar day regardless of timezone.
      const actionDate = new Date(`${date}T12:00:00`)
      const res = await authFetch(`/api/network/contacts/${contactId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, action_date: actionDate.toISOString(), note: note.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Log failed (${res.status})`)
      setNote("")
      setDate(toDateInput(new Date()))
      onChanged(type)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {!manualOpen && (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          data-testid="log-manual-open"
          style={{
            background: "none", border: "none", padding: 0, fontFamily: "inherit",
            fontSize: 13.5, fontWeight: 700, color: S.action.quietInk, cursor: "pointer",
          }}
        >
          Log something that happened elsewhere
        </button>
      )}

      {/* add form */}
      <div style={{ display: manualOpen ? "flex" : "none", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>Action</span>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...control, width: 200 }}>
            <option value="">Select action</option>
            {ACTION_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={label}>Date (backdatable)</span>
          <input
            type="date"
            value={date}
            max={toDateInput(new Date())}
            onChange={(e) => setDate(e.target.value)}
            style={{ ...control, width: 170 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
          <span style={label}>Details (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Context for this touch"
            style={control}
          />
        </label>
        <button
          onClick={add}
          disabled={busy || !type}
          style={{
            ...actionStyle(S, "primary"),
            borderRadius: 10, padding: "0 20px", height: 42, fontSize: 14,
            fontFamily: "inherit", opacity: busy || !type ? 0.5 : 1,
          }}
        >
          {busy ? "Logging…" : "Log it"}
        </button>
      </div>
      {err && <div style={{ color: S.meaning.error.ink, fontSize: 13, marginTop: 10 }}>{err}</div>}

      {/* the log */}
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.length === 0 ? (
          <div style={{ color: S.text.muted, fontSize: 14 }}>No actions logged yet.</div>
        ) : (
          actions.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 14,
                padding: "12px 14px",
                background: S.well,
                borderRadius: 10,
                border: `1px solid ${S.borderSoft}`,
              }}
            >
              <span style={{ color: S.text.muted, fontSize: 12.5, fontWeight: 700, flex: "0 0 104px" }}>
                {fmt(a.action_date)}
              </span>
              <span style={{ color: S.text.primary, fontSize: 14, fontWeight: 700, flex: "0 0 auto" }}>
                {TYPE_LABEL[a.type] ?? a.type}
              </span>
              {/* A MESSAGE RENDERS AS ITS TEXT, a logged action as its note.
                  One sequence, two shapes: the timeline is what you did AND
                  what you wrote, and collapsing a message to "Touch 1" would
                  throw away the only part of it worth re-reading.

                  A DRAFT SAYS SO, because an unsent message sitting in a log of
                  things that happened is otherwise a lie about the past. */}
              {a.body ? (
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {a.status === "draft" && (
                      <span style={draftPill} data-testid="timeline-draft">DRAFT</span>
                    )}
                    {a.channel && (
                      <span style={{ color: S.text.dim, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4 }}>
                        {(CHANNEL_LABEL[a.channel] ?? a.channel).toUpperCase()}
                      </span>
                    )}
                    {a.subject && (
                      <span style={{ color: S.text.primary, fontSize: 13.5, fontWeight: 700 }}>{a.subject}</span>
                    )}
                  </span>
                  <span style={{ color: S.text.secondary, fontSize: 14, lineHeight: "20px", whiteSpace: "pre-wrap" }}>
                    {a.body}
                  </span>
                </span>
              ) : (
                a.note && <span style={{ color: S.text.secondary, fontSize: 14 }}>{a.note}</span>
              )}
              {a.author_role === "coach" && (
                <span
                  style={{
                    marginLeft: "auto", color: S.meaning.replied.ink,
                    fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                  }}
                >
                  COACH
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const label: React.CSSProperties = {
  color: S.text.muted, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
}
const control: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, borderRadius: 10,
  height: 42, padding: "0 12px", fontSize: 14, color: S.text.primary,
  fontFamily: "inherit", boxSizing: "border-box",
}

// Amber-free: this is the ATTENTION meaning, "not done yet", which is what an
// unsent draft is. It is not an error and it is not a warning.
const draftPill: React.CSSProperties = {
  background: S.meaning.attention.fill,
  color: S.meaning.attention.ink,
  fontSize: 10.5,
  fontWeight: 900,
  letterSpacing: 0.6,
  borderRadius: 999,
  padding: "2px 8px",
}
