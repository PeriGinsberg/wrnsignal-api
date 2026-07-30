"use client"

// A contact in the TODAY panel: a white action-card raised on the navy hero.
//
// This is the page's primary action surface, so it carries the machinery the
// grid card deliberately does not: the stage control and the button that logs
// the due touch.
//
// It also has to survive its own success. The hero/grid partition is frozen for
// the session, so acting on a card leaves it HERE rather than teleporting it to
// the grid. When its live due state stops needing anyone, the card says so and
// goes quiet instead of vanishing.

import { useState } from "react"
import { select as selectStyle, selectOption } from "../../../../lib/dashboard-theme"
import { LIGHT as S, PHASE_MEANING, pill, tile } from "../../../../lib/theme/surfaces"
import { authFetch } from "../authFetch"
import { STAGE_LABELS, REASON_LABELS, REASON_TO_ACTION, STAGE_PHASE } from "../vocab"
import { dueOf, needsMe, initialsOf, type Contact } from "./contactModel"

export function DueCard({
  contact: c, onChanged, selectMode, checked, onToggle, flash = false,
}: {
  contact: Contact
  onChanged: () => void
  selectMode: boolean
  checked: boolean
  onToggle: () => void
  flash?: boolean
}) {
  const [busy, setBusy] = useState<null | string>(null)
  const [err, setErr] = useState<string | null>(null)
  const due = dueOf(c.next_due_at)
  const reason = c.next_due_reason
  const phase = PHASE_MEANING[STAGE_PHASE[c.stage] ?? "idle"]
  const settled = !needsMe(due)   // acted on this session, still held in the hero

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
      // MUST be finally. Clearing busy only on failure left every control in the
      // card dead after the first SUCCESSFUL action until a reload.
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
      data-testid={`card-${c.id}`}
      data-world="hero"
      data-settled={settled ? "true" : "false"}
      onClick={selectMode ? onToggle : undefined}
      style={{
        flex: "1 1 232px", maxWidth: 300, minWidth: 210,
        display: "flex", flexDirection: "column", gap: 10,
        background: S.raised, borderRadius: 14, padding: "14px 15px",
        border: `1px solid ${checked ? S.meaning.progress.ink : "transparent"}`,
        boxShadow: flash
          ? `0 0 0 3px ${S.meaning.progress.fill}, 0 6px 18px rgba(4,10,22,0.28)`
          : "0 6px 18px rgba(4,10,22,0.28)",
        opacity: settled ? 0.72 : 1,
        cursor: selectMode ? "pointer" : "default",
        transition: "box-shadow 400ms ease-out, opacity 400ms ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {selectMode && (
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label="Select contact"
            onClick={(e) => e.stopPropagation()} style={{ cursor: "pointer", flex: "0 0 auto" }} />
        )}
        <span aria-hidden data-testid={`tile-${c.id}`} style={{
          ...tile(S, phase), flex: "0 0 auto", width: 40, height: 40, borderRadius: 11,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 900, letterSpacing: 0.3,
        }}>{initialsOf(c)}</span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <a href={`/dashboard/network/contacts/${c.id}`}
            onClick={selectMode ? (e) => e.preventDefault() : undefined}
            style={{
              color: S.text.primary, fontWeight: 900, fontSize: 13.5, textDecoration: "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
            {c.first_name} {c.last_name}
          </a>
          <span style={{ color: S.text.muted, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.network_companies?.name ?? "Standalone"}
          </span>
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <select
          value={c.stage}
          onChange={(e) => changeStage(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          disabled={busy !== null}
          aria-label="Stage"
          style={{
            ...selectStyle, ...pill(S, phase),
            height: 26, padding: "0 8px", fontSize: 11, width: "auto", minWidth: 128,
            fontWeight: 800, borderRadius: 999, opacity: busy !== null ? 0.55 : 1,
          }}
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
        </select>
        <span data-testid={`due-${c.id}`} style={{
          ...pill(S, settled ? "replied" : due.meaning), borderRadius: 999,
          padding: "3px 9px", fontSize: 10.5, fontWeight: 900, whiteSpace: "nowrap",
        }}>
          {settled ? "Done for now" : due.label}
        </span>
      </div>

      {reason ? (
        <button onClick={(e) => { e.stopPropagation(); void logDue() }} disabled={busy !== null}
          data-testid={`act-${c.id}`}
          style={{
            width: "100%", background: S.gradient.warmAction, color: "#FFFFFF",
            border: "none", borderRadius: 10, padding: "9px 12px",
            fontSize: 12, fontWeight: 900, cursor: "pointer",
            opacity: busy !== null ? 0.6 : 1,
          }}>
          {busy === "log" ? "Saving…" : `${REASON_LABELS[reason] ?? "Log"} →`}
        </button>
      ) : (
        <span data-testid={`act-${c.id}`} style={{
          textAlign: "center", color: S.text.muted, fontSize: 11.5, fontWeight: 700,
          padding: "9px 12px", background: S.well, borderRadius: 10,
        }}>
          Nothing to send
        </span>
      )}

      {err && <div style={{ color: S.meaning.error.ink, fontSize: 10.5 }}>{err}</div>}
    </div>
  )
}
