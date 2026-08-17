"use client"

// Lane results review queue.
//
// One row per unactioned job. Two decisions: push it (optionally with a note)
// or dismiss it with a reason from a closed list. Either way the row leaves the
// queue, because the queue IS "results with no decision yet" — there is no
// separate reviewed flag that could disagree with the action column.
//
// Rows are removed optimistically and restored if the write fails. A queue that
// re-renders the row you just judged is the fastest way to lose your place in a
// list of seventy, so the removal has to happen on click, not on response.

import { useCallback, useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, card, eyebrow, textarea, select, selectOption } from "../../../lib/dashboard-theme"

type LaneSummary = {
  id: string
  name: string
  active: boolean
  titles: string[]
  unreviewed: number
}

type Result = {
  id: string
  job_id: string
  matched_title: string | null
  title: string | null
  company: string | null
  apply_url: string | null
  location: string | null
  workplace_type: string | null
  seniority: string | null
  min_yoe: number | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  tools: string[] | null
  requirements_summary: string | null
  posted_at: string | null
}

// Mirrors lane_results_reason_valid in 20260817_lane_result_actions.sql.
// Slugs are stored; labels are for reading. Order is roughly how often each
// one gets used, so the common calls are the shortest travel.
const REASONS: Array<{ value: string; label: string }> = [
  { value: "too_senior", label: "Too senior" },
  { value: "wrong_function", label: "Wrong function" },
  { value: "wrong_location", label: "Wrong location" },
  { value: "wrong_employer", label: "Wrong employer" },
  { value: "right_employer_wrong_level", label: "Right employer, wrong level" },
  { value: "doesnt_meet_requirements", label: "Doesn't meet requirements" },
]

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
    },
  })
}

function money(r: Result): string | null {
  if (r.salary_min == null && r.salary_max == null) return null
  const k = (n: number) => `${Math.round(n / 1000)}k`
  const cur = r.salary_currency === "USD" || !r.salary_currency ? "$" : `${r.salary_currency} `
  if (r.salary_min != null && r.salary_max != null) {
    return r.salary_min === r.salary_max ? `${cur}${k(r.salary_min)}` : `${cur}${k(r.salary_min)}–${k(r.salary_max)}`
  }
  return `${cur}${k((r.salary_min ?? r.salary_max)!)}`
}

function daysAgo(iso: string | null): string {
  if (!iso) return "—"
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d <= 0) return "today"
  if (d === 1) return "yesterday"
  return `${d}d ago`
}

export default function LaneReviewPage() {
  const [lanes, setLanes] = useState<LaneSummary[] | null>(null)
  const [laneId, setLaneId] = useState<string | null>(null)
  const [results, setResults] = useState<Result[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const res = await authFetch("/api/lanes")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { setError(j.error || "Could not load lanes"); setLoading(false); return }
      setLanes(j.lanes || [])
      setLaneId((j.lanes || [])[0]?.id ?? null)
      setLoading(false)
    })()
  }, [])

  const loadQueue = useCallback(async (id: string) => {
    setResults(null)
    const res = await authFetch(`/api/lanes/results?lane_id=${encodeURIComponent(id)}`)
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.ok) { setError(j.error || "Could not load the queue"); return }
    setError(null)
    setResults(j.results || [])
  }, [])

  useEffect(() => { if (laneId) loadQueue(laneId) }, [laneId, loadQueue])

  const act = useCallback(
    async (row: Result, action: "push" | "dismiss", reason: string | null, note: string | null) => {
      const index = results?.findIndex((r) => r.id === row.id) ?? -1
      setResults((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev))
      setLanes((prev) =>
        prev ? prev.map((l) => (l.id === laneId ? { ...l, unreviewed: Math.max(0, l.unreviewed - 1) } : l)) : prev
      )

      const res = await authFetch("/api/lanes/results", {
        method: "PATCH",
        body: JSON.stringify({ id: row.id, action, reason, note }),
      })
      if (res.ok) return

      // Put it back exactly where it was — dropping it at the end would move
      // the row the reviewer is still looking at.
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Could not save that. The row is back in the queue.")
      setResults((prev) => {
        if (!prev) return prev
        const next = [...prev]
        next.splice(index < 0 ? next.length : index, 0, row)
        return next
      })
      setLanes((prev) =>
        prev ? prev.map((l) => (l.id === laneId ? { ...l, unreviewed: l.unreviewed + 1 } : l)) : prev
      )
    },
    [results, laneId]
  )

  if (loading) {
    return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading lanes…</p>
  }

  const lane = lanes?.find((l) => l.id === laneId) ?? null

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          Lane Review
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Every job a lane found that you haven&apos;t decided on yet.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            ...card, padding: "12px 16px", marginBottom: 16,
            background: T.ERROR_BG, borderColor: "rgba(255,120,120,0.35)",
            color: T.TEXT, fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {!lanes?.length ? (
        <div style={{ ...card, padding: 32 }}>
          <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
            No lanes yet. Create one and run it to fill this queue.
          </p>
        </div>
      ) : (
        <>
          {/* Lane picker. Tabs rather than a dropdown: the unreviewed count is
              the reason you'd switch, so it has to be visible before you do. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {lanes.map((l) => {
              const on = l.id === laneId
              return (
                <button
                  key={l.id}
                  onClick={() => setLaneId(l.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 14px", borderRadius: 12, cursor: "pointer",
                    fontSize: 13, fontWeight: 700,
                    background: on ? T.GLASS : "transparent",
                    border: `1px solid ${on ? T.ORANGE_BORDER : T.BORDER_SOFT}`,
                    color: on ? T.TEXT : T.MUTED,
                  }}
                >
                  {l.name}
                  <span
                    style={{
                      fontSize: 11, fontWeight: 900,
                      color: l.unreviewed ? T.WRN_ORANGE : T.DIM,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {l.unreviewed}
                  </span>
                </button>
              )
            })}
          </div>

          {results === null ? (
            <p style={{ color: T.MUTED, fontSize: 13 }}>Loading queue…</p>
          ) : results.length === 0 ? (
            <div style={{ ...card, padding: 32 }}>
              <div style={{ ...eyebrow, color: T.SUCCESS, marginBottom: 8 }}>Queue clear</div>
              <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
                Every job {lane?.name ? `in ${lane.name}` : "in this lane"} has been reviewed. Re-run the lane to
                pull in anything new.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {results.map((r) => (
                <ResultRow key={r.id} row={r} onAct={act} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ResultRow({
  row,
  onAct,
}: {
  row: Result
  onAct: (r: Result, a: "push" | "dismiss", reason: string | null, note: string | null) => void
}) {
  // Which panel is open, if any. Both actions can carry a note, so both open
  // the same drawer; dismiss additionally requires a reason before it commits.
  const [open, setOpen] = useState<null | "push" | "dismiss">(null)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")

  const pay = money(row)
  const yoe =
    row.min_yoe == null ? "Not stated" : row.min_yoe === 0 ? "0 yrs" : `${row.min_yoe}+ yrs`
  const tools = (row.tools ?? []).filter(Boolean)

  const commit = (action: "push" | "dismiss") => {
    if (action === "dismiss" && !reason) return
    onAct(row, action, action === "dismiss" ? reason : null, note.trim() || null)
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
        <Fact label="Experience" value={yoe} dim={row.min_yoe == null} />
        <Fact label="Salary" value={pay ?? "Not listed"} dim={!pay} />
        <Fact
          label="Location"
          value={[row.location, row.workplace_type].filter(Boolean).join(" · ") || "—"}
        />
        <Fact label="Posted" value={daysAgo(row.posted_at)} />
        {row.seniority && <Fact label="Level" value={row.seniority} />}
        {row.matched_title && <Fact label="Matched" value={row.matched_title} dim />}
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
      {open === null ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setOpen("push")}
            style={{
              background: T.WRN_ORANGE, color: T.INK_ON_ACCENT, border: "none",
              borderRadius: 11, padding: "9px 16px", fontSize: 13, fontWeight: 900, cursor: "pointer",
            }}
          >
            Push
          </button>
          <button
            onClick={() => setOpen("dismiss")}
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
          {open === "dismiss" && (
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
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={`note-${row.id}`} style={{ ...eyebrow, fontSize: 10, color: T.MUTED }}>
              Note (optional)
            </label>
            <textarea
              id={`note-${row.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={open === "push" ? "Why this one is worth a look…" : "Anything the reason list misses…"}
              style={{ ...textarea, minHeight: 58 }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => commit(open)}
              disabled={open === "dismiss" && !reason}
              style={{
                background: open === "push" ? T.WRN_ORANGE : T.GLASS,
                color: open === "push" ? T.INK_ON_ACCENT : T.TEXT,
                border: open === "push" ? "none" : `1px solid ${T.BORDER}`,
                borderRadius: 11, padding: "9px 16px", fontSize: 13, fontWeight: 900,
                cursor: open === "dismiss" && !reason ? "not-allowed" : "pointer",
                opacity: open === "dismiss" && !reason ? 0.45 : 1,
              }}
            >
              {open === "push" ? "Push" : "Dismiss"}
            </button>
            <button
              onClick={() => { setOpen(null); setReason(""); setNote("") }}
              style={{
                background: "transparent", border: "none", color: T.DIM,
                fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "9px 4px",
              }}
            >
              Cancel
            </button>
            {open === "dismiss" && !reason && (
              <span style={{ fontSize: 11, color: T.DIM }}>Pick a reason first</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value, dim = false }: { label: string; value: string; dim?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.4, color: T.DIM, textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: dim ? T.DIM : T.TEXT }}>{value}</span>
    </span>
  )
}
