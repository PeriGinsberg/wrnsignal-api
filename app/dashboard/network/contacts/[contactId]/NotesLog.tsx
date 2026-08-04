"use client"

// Running notes log on the contact record.
//
// A note is a network_actions row with type = 'note' — a first-class timeline
// entry, auto-dated to now, and deliberately INERT: the actions route stops
// before the engine for this type, so writing a note never consumes a snooze,
// never moves last_action_at, and never recomputes next_due_at. Observing
// someone is not working them.
//
// 'note' is a DIFFERENT type from 'note_logged'. The latter carries the four due
// reasons the worklist fires (reply / nurture_recurring / ask_followup / manual)
// and must stay pipeline-affecting. See 20260727_network_note_action_type.sql.
//
// Reads the SAME rows the Action Log renders — one source, two views. The action
// log shows everything in order; this shows only what you wrote about them.

import { useEffect, useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"

export type NoteEntry = {
  id: string
  type: string
  action_date: string
  note: string | null
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function NotesLog({
  contactId, notes, onSaved,
}: {
  contactId: string
  notes: NoteEntry[]
  onSaved?: () => void
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Locally-added entries appear immediately rather than waiting on the parent's
  // refetch. Cleared as soon as the refetched list grows, so the note is never
  // rendered twice.
  const [extra, setExtra] = useState<NoteEntry[]>([])
  useEffect(() => { setExtra([]) }, [notes.length])

  async function save() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contactId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No action_date: the route defaults to now. A note is always "now" —
        // backdating belongs to the Action Log, where it means something.
        body: JSON.stringify({ type: "note", note: body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not save note (${res.status})`)
      setExtra((prev) => [
        { id: `local-${prev.length}-${body.length}`, type: "note", action_date: new Date().toISOString(), note: body },
        ...prev,
      ])
      setText("")            // the box clears — that is the signal it saved
      onSaved?.()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Newest first. Server rows are already sorted by the record's fetch, but sort
  // defensively so this component is correct in isolation too.
  const items = [...extra, ...notes].sort(
    (a, b) => new Date(b.action_date).getTime() - new Date(a.action_date).getTime(),
  )

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note…"
        aria-label="Add a note"
        rows={3}
        style={noteBox}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button onClick={() => void save()} disabled={busy || !text.trim()} style={{ ...actionStyle(S, "primary"), borderRadius: 10, padding: "10px 18px", fontSize: 14, fontFamily: "inherit", opacity: busy || !text.trim() ? 0.5 : 1 }}>
          {busy ? "Saving…" : "Save note"}
        </button>
        {err && <span style={{ color: S.meaning.error.ink, fontSize: 13 }}>{err}</span>}
      </div>

      {items.length === 0 ? (
        <div style={{ color: S.text.muted, fontSize: 14, marginTop: 16 }}>No notes yet.</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
          {items.map((n) => (
            <li key={n.id} style={{ padding: "12px 0", borderTop: `1px solid ${S.borderSoft}` }}>
              <div style={{ color: S.text.muted, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, marginBottom: 4 }}>
                {fmtWhen(n.action_date)}
              </div>
              <div style={{ color: S.text.primary, fontSize: 14.5, lineHeight: "22px", whiteSpace: "pre-wrap" }}>{n.note}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const noteBox: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
  background: S.well, border: `1px solid ${S.border}`, borderRadius: 10,
  padding: "12px 14px", fontSize: 14.5, lineHeight: "22px",
  color: S.text.primary, fontFamily: "inherit", outline: "none",
}
