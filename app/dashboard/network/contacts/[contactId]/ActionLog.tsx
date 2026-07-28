"use client"

import { useState } from "react"
import { T, input as inputStyle, select as selectStyle, selectOption } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { ACTION_TYPE_OPTIONS, ACTION_TYPE_LABEL } from "../../vocab"

// The dated action log + an "add action" form. Actions may be BACKDATED (the
// route accepts action_date and the engine measures intervals from it), so the
// date input defaults to today but is freely editable to the past. Logging runs
// the engine in the route — this component never computes a due date.

type Action = {
  id: string
  type: string
  action_date: string
  note: string | null
  author_role: string
}

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
  onChanged: () => void
}) {
  const [type, setType] = useState("touch_1")
  const [date, setDate] = useState(toDateInput(new Date()))
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
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
      onChanged()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* add form */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>ACTION</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={{ ...selectStyle, width: 190, height: 40 }}
          >
            {ACTION_TYPES.map((t) => (
              <option key={t.key} value={t.key} style={selectOption}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>DATE (backdatable)</span>
          <input
            type="date"
            value={date}
            max={toDateInput(new Date())}
            onChange={(e) => setDate(e.target.value)}
            style={{ ...inputStyle, width: 160, height: 40 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px" }}>
          <span style={{ color: T.MUTED, fontSize: 10, fontWeight: 800 }}>NOTE (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened?"
            style={{ ...inputStyle, height: 40 }}
          />
        </label>
        <button
          onClick={add}
          disabled={busy}
          style={{
            background: T.GRAD_PRIMARY,
            color: "#04060F",
            fontWeight: 900,
            fontSize: 12,
            border: "none",
            borderRadius: 11,
            padding: "0 16px",
            height: 40,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Logging…" : "Log it"}
        </button>
      </div>
      {err && <div style={{ color: T.ERROR, fontSize: 12, marginTop: 8 }}>{err}</div>}

      {/* the log */}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.length === 0 ? (
          <div style={{ color: T.DIM, fontSize: 13 }}>No actions logged yet.</div>
        ) : (
          actions.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                padding: "10px 12px",
                background: T.GLASS,
                borderRadius: 10,
                border: `1px solid ${T.BORDER_SOFT}`,
              }}
            >
              <span style={{ color: T.DIM, fontSize: 11, fontWeight: 700, flex: "0 0 96px" }}>{fmt(a.action_date)}</span>
              <span style={{ color: T.TEXT, fontSize: 13, fontWeight: 700, flex: "0 0 auto" }}>
                {TYPE_LABEL[a.type] ?? a.type}
              </span>
              {a.note && <span style={{ color: T.MUTED, fontSize: 13 }}>{a.note}</span>}
              {a.author_role === "coach" && (
                <span style={{ marginLeft: "auto", color: T.WRN_TEAL, fontSize: 10, fontWeight: 800 }}>COACH</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
