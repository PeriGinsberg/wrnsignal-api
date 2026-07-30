"use client"

// One contact as a designed row-object, on the light surface.
//
// The organising question is "who needs me": a row with something due today or
// overdue LIFTS onto the raised white surface with a firmer edge, and a row with
// nothing due recedes into the card surface with quieter text. Nothing is
// re-sorted to achieve that. The list order is a deliberate frozen snapshot
// (see page.tsx), so urgency is expressed by weight, not by moving rows under
// someone mid-scan.
//
// Extracted from page.tsx so a test can render it in isolation: a Next
// `page.tsx` may only export route members.
//
// Owns its own busy/error state and both inline actions: change stage (the stage
// pill is the control) and log the due touch.

import { useState } from "react"
import { select as selectStyle, selectOption } from "../../../../lib/dashboard-theme"
import { LIGHT, PHASE_MEANING, pill, rowBackground, type MeaningKey } from "../../../../lib/theme/surfaces"
import { authFetch } from "../authFetch"
import { STAGE_LABELS, REASON_LABELS, REASON_TO_ACTION, RELATIONSHIP_LABELS, STAGE_PHASE } from "../vocab"

const S = LIGHT

export type Contact = {
  id: string
  first_name: string
  last_name: string
  title: string | null
  email?: string | null   // not rendered in the row; searched by the spreadsheet
  stage: string
  relationship: string | null
  priority: string | null
  segment: string | null
  next_due_at: string | null
  next_due_reason: string | null
  last_action_at: string | null
  company_id: string | null
  network_companies?: { name: string } | null
  // Milestone stamps + outcome, used by the dashboard. Optional because the row
  // itself never reads them and older callers do not send them.
  first_touch_at?: string | null
  first_replied_at?: string | null
  first_chat_at?: string | null
  outcome_type?: string | null
}

const DAY = 86400000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// The single computed "Due" state. Words only, never a raw date, and it carries
// a MEANING key rather than a colour so it reads correctly on either surface.
export type Due = { label: string; meaning: MeaningKey; kind: "overdue" | "due_today" | "future" | "none" }
export function dueOf(nextDueAt: string | null): Due {
  if (!nextDueAt) return { label: "Nothing due", meaning: "idle", kind: "none" }
  const due = startOfDay(new Date(nextDueAt))
  const today = startOfDay(new Date())
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`
  if (due < today) return { label: `Overdue ${plural(Math.round((today - due) / DAY))}`, meaning: "error", kind: "overdue" }
  if (due === today) return { label: "Due today", meaning: "attention", kind: "due_today" }
  return { label: `Due in ${plural(Math.round((due - today) / DAY))}`, meaning: "idle", kind: "future" }
}

/** Due today or overdue. The one distinction the whole row design turns on. */
export function needsMe(due: Due): boolean {
  return due.kind === "overdue" || due.kind === "due_today"
}

const initialsOf = (c: Contact) =>
  `${(c.first_name || "").charAt(0)}${(c.last_name || "").charAt(0)}`.toUpperCase() || "?"

export function Row({
  contact: c, onChanged, checked, onToggle, flash = false, zebra = false,
}: {
  contact: Contact
  onChanged: () => void
  checked: boolean
  onToggle: () => void
  flash?: boolean
  zebra?: boolean
}) {
  const [busy, setBusy] = useState<null | string>(null)
  const [err, setErr] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const due = dueOf(c.next_due_at)
  const reason = c.next_due_reason
  const lifted = needsMe(due)
  const phase = PHASE_MEANING[STAGE_PHASE[c.stage] ?? "idle"]

  async function post(url: string, body: unknown, key: string) {
    setBusy(key); setErr(null)
    try {
      const res = await authFetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      // MUST be `finally`, not the catch. Clearing busy only on failure left it
      // stuck after a SUCCESSFUL action, and both inline controls are gated on
      // `busy !== null`, so the first successful stage change or logged touch
      // permanently disabled the whole row until a reload.
      setBusy(null)
    }
  }

  const logDue = () => reason && post(
    `/api/network/contacts/${c.id}/actions`,
    { type: REASON_TO_ACTION[reason] ?? "note_logged", action_date: new Date().toISOString() },
    "log",
  )
  const changeStage = (stage: string) => post(`/api/network/contacts/${c.id}/stage`, { stage }, "stage")

  return (
    <div
      role="listitem"
      data-testid={`row-${c.id}`}
      data-lifted={lifted ? "true" : "false"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
        // Lifted rows sit on the raised surface with a firmer edge. Idle rows
        // stay on the card and recede. This is the whole "who needs me" signal.
        background: rowBackground(S, lifted ? S.raised : S.card, { zebra, flash, hover, checked }),
        border: `1px solid ${lifted ? S.border : "transparent"}`,
        borderBottom: `1px solid ${S.borderSoft}`,
        borderRadius: lifted ? 10 : 0,
        boxShadow: lifted ? "0 1px 2px rgba(19,41,74,0.06)" : "none",
        transition: "background 600ms ease-out",
      }}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Select contact"
        style={{ cursor: "pointer", flex: "0 0 auto" }} />

      {/* The initial carries the pipeline phase, so the left edge of the row
          already says where this person stands before anything is read. */}
      <span aria-hidden data-testid={`avatar-${c.id}`} style={{
        ...pill(S, phase), flex: "0 0 auto", width: 30, height: 30, borderRadius: 999,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 11.5, fontWeight: 900, letterSpacing: 0.2,
      }}>{initialsOf(c)}</span>

      <span style={{ flex: "1 1 210px", minWidth: 150, display: "flex", flexDirection: "column", gap: 2 }}>
        <a href={`/dashboard/network/contacts/${c.id}`} style={{
          color: lifted ? S.text.primary : S.text.secondary,
          fontWeight: 800, fontSize: 13, textDecoration: "none",
        }}>
          {c.first_name} {c.last_name}
        </a>
        <span style={{ color: S.text.muted, fontSize: 11.5 }}>
          {c.title ?? "No title"}
          {c.network_companies?.name ? ` · ${c.network_companies.name}` : ""}
        </span>
      </span>

      {/* Relationship and priority are attributes, not statuses: quiet, outlined,
          and deliberately in the neutral slate so they never compete with the
          stage pill for "what state is this person in". */}
      <span style={{ display: "flex", gap: 6, flex: "0 0 auto", flexWrap: "wrap" }}>
        {c.relationship && (
          <span data-testid={`rel-${c.id}`} style={{ ...attrPill }}>{RELATIONSHIP_LABELS[c.relationship]}</span>
        )}
        {c.priority && <span data-testid={`pri-${c.id}`} style={{ ...attrPill }}>{c.priority}</span>}
      </span>

      {/* The stage pill IS the change-stage control. Status shape: ink on fill. */}
      <select
        value={c.stage}
        onChange={(e) => changeStage(e.target.value)}
        disabled={busy !== null}
        aria-label="Stage"
        style={{
          ...selectStyle, ...pill(S, phase),
          flex: "0 0 auto", height: 28, padding: "0 9px", fontSize: 11.5, width: 148,
          fontWeight: 800, borderRadius: 999, opacity: busy !== null ? 0.55 : 1,
        }}
      >
        {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
      </select>

      <span data-testid={`due-${c.id}`} style={{
        ...pill(S, due.meaning), flex: "0 0 auto", minWidth: 96, textAlign: "center",
        borderRadius: 999, padding: "4px 10px", fontSize: 11,
        fontWeight: due.kind === "overdue" ? 900 : 700, whiteSpace: "nowrap",
      }}>{due.label}</span>

      <span style={{ flex: "0 0 auto", minWidth: 108, textAlign: "right" }}>
        {reason ? (
          <button onClick={logDue} disabled={busy !== null} data-testid={`log-${c.id}`} style={{
            background: S.primaryButton.background, color: S.primaryButton.color,
            fontWeight: 800, fontSize: 11, border: "none", borderRadius: 8,
            padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap",
            opacity: busy !== null ? 0.55 : 1,
          }}>
            {busy === "log" ? "…" : REASON_LABELS[reason] ?? "Log"}
          </button>
        ) : (
          <span style={{ color: S.text.dim, fontSize: 11 }}>nothing due</span>
        )}
        {err && <div style={{ color: S.meaning.error.ink, fontSize: 10, marginTop: 2 }}>{err}</div>}
      </span>
    </div>
  )
}

const attrPill: React.CSSProperties = {
  color: S.text.muted, background: S.well, border: `1px solid ${S.borderSoft}`,
  borderRadius: 999, padding: "3px 9px", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap",
}
