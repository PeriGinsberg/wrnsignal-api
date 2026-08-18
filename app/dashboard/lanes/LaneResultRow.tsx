"use client"

// One reviewable job: score it, or dismiss it with a reason.
//
// Score does NOT decide anything. It carries the job to the Source a Job tab to
// be scored against the client's profile, and the row stays in this queue until
// something is actually sent to the client's tracker. That is why only Dismiss
// opens a drawer here — the note that accompanies a recommendation belongs on
// the scoring screen, next to the score it is about.
//
// Score needs full coach access, because sending is what it leads to. The button
// is disabled without it rather than failing after a job description has been
// pasted.

import { useState } from "react"
import { T, card, eyebrow, textarea, select, selectOption } from "../../../lib/dashboard-theme"
import { REASONS, money, daysAgo, type Result } from "./laneApi"

export function LaneResultRow({
  row,
  canSend,
  onScore,
  onDismiss,
}: {
  row: Result
  canSend: boolean
  onScore: (r: Result) => void
  onDismiss: (r: Result, reason: string, note: string | null) => void
}) {
  // Only dismiss has a drawer, and only because its reason is required.
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")

  const pay = money(row)
  const yoe =
    row.min_yoe == null ? "Not stated" : row.min_yoe === 0 ? "0 yrs" : `${row.min_yoe}+ yrs`
  const tools = (row.tools ?? []).filter(Boolean)

  const commitDismiss = () => {
    if (!reason) return
    onDismiss(row, reason, note.trim() || null)
  }

  return (
    <div style={{ ...card, padding: 18 }}>
      {/* Header: what the job is and where to apply */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.TEXT, lineHeight: 1.3 }}>
            {row.title ?? "Untitled role"}
          </div>
          <div style={{ fontSize: 13, color: T.MUTED, marginTop: 3 }}>{row.company ?? "Unknown company"}</div>
        </div>
        {row.apply_url && (
          <a
            href={row.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12, fontWeight: 800, color: T.WRN_BLUE,
              textDecoration: "none", borderBottom: `1px solid ${T.WRN_BLUE}`,
              paddingBottom: 1, flexShrink: 0,
            }}
          >
            Open posting ↗
          </a>
        )}
      </div>

      {/* Facts. Each is a decision input, so they read as one line of chips
          rather than a table nobody scans. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", margin: "10px 0 12px" }}>
        <ResultFact label="Experience" value={yoe} dim={row.min_yoe == null} />
        <ResultFact label="Salary" value={pay ?? "Not listed"} dim={!pay} />
        <ResultFact
          label="Location"
          value={[row.location, row.workplace_type].filter(Boolean).join(" · ") || "—"}
        />
        <ResultFact label="Posted" value={daysAgo(row.posted_at)} />
        {row.seniority && <ResultFact label="Level" value={row.seniority} />}
        {row.matched_title && <ResultFact label="Matched" value={row.matched_title} dim />}
      </div>

      {row.requirements_summary && (
        <p style={{ fontSize: 13, lineHeight: 1.55, color: T.MUTED, margin: "0 0 12px" }}>
          {row.requirements_summary}
        </p>
      )}

      {tools.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {tools.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11, fontWeight: 700, color: T.ICE_BLUE,
                background: T.ICE_BLUE_BG, border: `1px solid ${T.ICE_BLUE_BORDER}`,
                borderRadius: 6, padding: "3px 8px",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      {!open ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => onScore(row)}
            disabled={!canSend}
            title={canSend ? "Score this against the client's profile" : "Full coach access is required to score and send"}
            style={{
              background: T.WRN_ORANGE, color: T.INK_ON_ACCENT, border: "none",
              borderRadius: 11, padding: "9px 16px", fontSize: 13, fontWeight: 900,
              cursor: canSend ? "pointer" : "not-allowed", opacity: canSend ? 1 : 0.45,
            }}
          >
            Score
          </button>
          <button
            onClick={() => setOpen(true)}
            style={{
              background: "transparent", color: T.MUTED,
              border: `1px solid ${T.BORDER_SOFT}`,
              borderRadius: 11, padding: "9px 16px", fontSize: 13, fontWeight: 800, cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "flex", flexDirection: "column", gap: 10,
            borderTop: `1px solid ${T.BORDER_SOFT}`, paddingTop: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor={`reason-${row.id}`} style={{ ...eyebrow, fontSize: 10, color: T.MUTED }}>
                Reason
              </label>
              <select
                id={`reason-${row.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ ...select, maxWidth: 320 }}
              >
                <option value="" style={selectOption}>Choose a reason…</option>
                {REASONS.map((o) => (
                  <option key={o.value} value={o.value} style={selectOption}>{o.label}</option>
                ))}
              </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={`note-${row.id}`} style={{ ...eyebrow, fontSize: 10, color: T.MUTED }}>
              Note (optional)
            </label>
            <textarea
              id={`note-${row.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything the reason list misses…"
              style={{ ...textarea, minHeight: 58 }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={commitDismiss}
              disabled={!reason}
              style={{
                background: T.GLASS,
                color: T.TEXT,
                border: `1px solid ${T.BORDER}`,
                borderRadius: 11, padding: "9px 16px", fontSize: 13, fontWeight: 900,
                cursor: !reason ? "not-allowed" : "pointer",
                opacity: !reason ? 0.45 : 1,
              }}
            >
              Dismiss
            </button>
            <button
              onClick={() => { setOpen(false); setReason(""); setNote("") }}
              style={{
                background: "transparent", border: "none", color: T.DIM,
                fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "9px 4px",
              }}
            >
              Cancel
            </button>
            {!reason && <span style={{ fontSize: 11, color: T.DIM }}>Pick a reason first</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function ResultFact({ label, value, dim = false }: { label: string; value: string; dim?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.4, color: T.DIM, textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: dim ? T.DIM : T.TEXT }}>{value}</span>
    </span>
  )
}
