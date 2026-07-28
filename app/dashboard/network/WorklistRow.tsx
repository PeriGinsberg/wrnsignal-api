"use client"

import { useState } from "react"
import { T } from "../../../lib/dashboard-theme"
import { authFetch } from "./authFetch"
import { REASON_TO_ACTION, REASON_LABELS, STAGE_LABELS } from "./vocab"

// One due contact. Two quick moves only — "Logged it" (writes the action the
// engine is asking for) and "Snooze" (a manual reminder override). Neither
// computes a due date: the API route runs computeNextDue() and returns the
// contact, and we just re-fetch. No interval math lives in this file.

export type WorklistContact = {
  id: string
  first_name: string
  last_name: string
  stage: string
  next_due_at: string | null
  next_due_reason: string | null
  company_id: string | null
  network_companies?: { name: string } | null
}

// Whole-day lateness, measured off calendar days rather than elapsed ms — a
// contact due yesterday evening reads "1 day overdue", not "0".
function daysOverdue(dueAt: string | null): number {
  if (!dueAt) return 0
  const due = new Date(dueAt)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = startOfDay(new Date()) - startOfDay(due)
  return Math.max(0, Math.round(diff / 86400000))
}

export function WorklistRow({
  contact,
  onChanged,
}: {
  contact: WorklistContact
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<null | "log" | "snooze">(null)
  const [err, setErr] = useState<string | null>(null)
  const [snoozeOpen, setSnoozeOpen] = useState(false)

  const late = daysOverdue(contact.next_due_at)
  const reason = contact.next_due_reason ?? "manual"
  const company = contact.network_companies?.name

  async function post(url: string, body: unknown, mode: "log" | "snooze") {
    setBusy(mode)
    setErr(null)
    try {
      const res = await authFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Request failed (${res.status})`)
      setSnoozeOpen(false)
      onChanged()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  function loggedIt() {
    void post(
      `/api/network/contacts/${contact.id}/actions`,
      { type: REASON_TO_ACTION[reason] ?? "note_logged", action_date: new Date().toISOString() },
      "log",
    )
  }

  function snooze(days: number) {
    const until = new Date(Date.now() + days * 86400000)
    void post(`/api/network/contacts/${contact.id}/reminder`, { reminder_override: until.toISOString() }, "snooze")
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 14,
        background: late > 0 ? T.WARNING_BG : T.GLASS,
        border: `1px solid ${late > 0 ? "rgba(254,176,106,0.30)" : T.BORDER_SOFT}`,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <a
          href={`/dashboard/network/contacts/${contact.id}`}
          style={{ color: T.TEXT, fontSize: 14, fontWeight: 800, textDecoration: "none" }}
        >
          {contact.first_name} {contact.last_name}
        </a>
        <div style={{ color: T.MUTED, fontSize: 12, marginTop: 3 }}>
          {company || "No company"} · {STAGE_LABELS[contact.stage] ?? contact.stage}
        </div>
      </div>

      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            background: "rgba(81,173,229,0.12)",
            color: T.WRN_BLUE,
            fontSize: 10,
            fontWeight: 900,
            padding: "3px 10px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          {REASON_LABELS[reason] ?? reason}
        </span>
        <span style={{ color: late > 0 ? T.WRN_ORANGE : T.DIM, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
          {late > 0 ? `${late} day${late === 1 ? "" : "s"} overdue` : "Due today"}
        </span>
      </div>

      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={loggedIt}
          disabled={busy !== null}
          style={{
            background: T.GRAD_PRIMARY,
            color: "#04060F",
            fontWeight: 900,
            fontSize: 12,
            border: "none",
            borderRadius: 11,
            padding: "9px 14px",
            cursor: busy ? "default" : "pointer",
            opacity: busy === "log" ? 0.6 : 1,
          }}
        >
          {busy === "log" ? "Saving…" : "Logged it"}
        </button>

        {snoozeOpen ? (
          <>
            {[3, 7, 14].map((d) => (
              <button
                key={d}
                onClick={() => snooze(d)}
                disabled={busy !== null}
                style={{
                  background: T.GLASS,
                  color: T.TEXT,
                  border: `1px solid ${T.BORDER}`,
                  borderRadius: 11,
                  padding: "9px 11px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {d}d
              </button>
            ))}
            <button
              onClick={() => setSnoozeOpen(false)}
              style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, cursor: "pointer" }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setSnoozeOpen(true)}
            disabled={busy !== null}
            style={{
              background: T.GLASS,
              color: T.TEXT,
              border: `1px solid ${T.BORDER}`,
              borderRadius: 11,
              padding: "9px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Snooze
          </button>
        )}
      </div>

      {err && <div style={{ flexBasis: "100%", color: T.ERROR, fontSize: 12 }}>{err}</div>}
    </div>
  )
}
