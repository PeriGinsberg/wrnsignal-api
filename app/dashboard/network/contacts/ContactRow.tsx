"use client"

// One row of the contacts spreadsheet, extracted from page.tsx so it can be
// rendered in isolation by a test (a Next `page.tsx` may only export route
// members, so the component could not live there and still be importable).
//
// Owns its own busy/error state and both inline actions: change stage (the
// Stage cell) and log the due touch.

import { useState } from "react"
import { T, select as selectStyle, selectOption } from "../../../../lib/dashboard-theme"
import { authFetch } from "../authFetch"
import { STAGE_LABELS, REASON_LABELS, REASON_TO_ACTION, RELATIONSHIP_LABELS, stagePillStyle } from "../vocab"

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

// The single computed, coloured "Due" column — merges what used to be Next due +
// Status (Status was just derived from the date, so showing both said it twice).
// Reads in words only, no raw date.
export type Due = { label: string; color: string; kind: "overdue" | "due_today" | "future" | "none" }
export function dueOf(nextDueAt: string | null): Due {
  if (!nextDueAt) return { label: "—", color: T.DIM, kind: "none" }
  const due = startOfDay(new Date(nextDueAt))
  const today = startOfDay(new Date())
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`
  if (due < today) return { label: `Overdue ${plural(Math.round((today - due) / DAY))}`, color: T.ERROR, kind: "overdue" }
  if (due === today) return { label: "Due today", color: T.WRN_ORANGE, kind: "due_today" }
  return { label: `Due in ${plural(Math.round((due - today) / DAY))}`, color: T.MUTED, kind: "future" }
}

const td: React.CSSProperties = { padding: "8px 12px", color: T.TEXT, verticalAlign: "middle" }
const logBtn: React.CSSProperties = {
  background: T.GRAD_PRIMARY, color: "#04060F", fontWeight: 900, fontSize: 11,
  border: "none", borderRadius: 8, padding: "5px 9px", cursor: "pointer", whiteSpace: "nowrap",
}

// Row background is COMPOSITED, not chosen. The zebra stripe is the base layer
// and the state tints are translucent overlays painted on top of it, so a
// flashed row reads identically whether it happens to be striped or not — the
// stripe sits under the highlight instead of competing with it.
//
// Overlay precedence, loudest first: flash (transient, just changed) > hover
// (transient, follows the pointer) > selected (persistent). Only one overlay is
// ever applied, so hover stays legible on a selected row and the flash stays
// legible on both.
function rowBackground(opts: { zebra: boolean; flash: boolean; hover: boolean; checked: boolean }): string | undefined {
  const base = opts.zebra ? T.ROW_STRIPE : "transparent"
  const overlay = opts.flash ? T.ROW_FLASH : opts.hover ? T.ROW_HOVER : opts.checked ? T.ROW_SELECTED : null
  if (!overlay) return opts.zebra ? base : undefined
  // Two colour stops of the same rgba give us a flat overlay layer that
  // composites over `base` — inline styles can't express a real stacking
  // context, and this keeps it to a single `background` value.
  return `linear-gradient(${overlay}, ${overlay}), ${base}`
}

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
      // `busy !== null` — so the first successful stage change or logged touch
      // permanently disabled the whole row until a reload. Matches the contact
      // record's setStage(), which has always used finally.
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
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderTop: `1px solid ${T.BORDER_SOFT}`,
        background: rowBackground({ zebra, flash, hover, checked }),
        transition: "background 600ms ease-out",
      }}
    >
      <td style={{ ...td, textAlign: "center" }}>
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Select contact" style={{ cursor: "pointer" }} />
      </td>
      <td style={td}>{c.network_companies?.name ?? <span style={{ color: T.DIM }}>Standalone</span>}</td>
      <td style={td}>
        <a href={`/dashboard/network/contacts/${c.id}`} style={{ color: T.WRN_BLUE, fontWeight: 700, textDecoration: "none" }}>
          {c.first_name} {c.last_name}
        </a>
      </td>
      <td style={{ ...td, color: T.MUTED }}>{c.title ?? "—"}</td>
      {/* Relationship stays the full word — clarity over width. */}
      <td style={td}>{c.relationship ? RELATIONSHIP_LABELS[c.relationship] : <span style={{ color: T.DIM }}>—</span>}</td>
      <td style={td}>{c.priority ?? <span style={{ color: T.DIM }}>—</span>}</td>
      <td style={td}>
        {/* Stage column doubles as the change-stage action (a spreadsheet cell). */}
        {/* The closed control IS the stage pill — phase-coloured via the shared
            STAGE_PHASE map. The open option list keeps `selectOption` (white on
            navy) because a native popup can't be relied on to render tints. */}
        <select
          value={c.stage}
          onChange={(e) => changeStage(e.target.value)}
          disabled={busy !== null}
          aria-label="Stage"
          style={{
            ...selectStyle,
            ...stagePillStyle(c.stage),
            height: 30, padding: "0 8px", fontSize: 12, width: 150,
            fontWeight: 700, borderRadius: 999,
            opacity: busy !== null ? 0.55 : 1,
          }}
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
        </select>
      </td>
      <td style={{ ...td, color: T.MUTED, whiteSpace: "nowrap" }}>{fmtDate(c.last_action_at)}</td>
      {/* Due — the merged Next due + Status: words only, coloured, no raw date. */}
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <span style={{ color: due.color, fontWeight: due.kind === "overdue" ? 900 : 700 }}>{due.label}</span>
      </td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {/* The one remaining inline action: log the due touch (change stage is the Stage cell). */}
        {reason ? (
          <button onClick={logDue} disabled={busy !== null} style={logBtn}>
            {busy === "log" ? "…" : REASON_LABELS[reason] ?? "Log"}
          </button>
        ) : (
          <span style={{ color: T.DIM, fontSize: 11 }}>nothing due</span>
        )}
        {err && <div style={{ color: T.ERROR, fontSize: 10, marginTop: 2 }}>{err}</div>}
      </td>
    </tr>
  )
}
