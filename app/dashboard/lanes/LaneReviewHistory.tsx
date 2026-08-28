"use client"

// What this lane keeps getting wrong, according to the people reviewing it.
//
// The dismissal reasons were designed to be counted and then nothing counted
// them: every judgement went into a column no screen displayed. This is that
// screen. It is deliberately diagnostic rather than decorative, so each reason
// is followed by what you would actually change in response to it, and the
// panel is collapsed until asked for because it answers a question you have
// occasionally, not one you have while working a queue.
//
// MISSES ARE THE SIGNAL. A dismissal that indicts the lane's targeting is the
// thing worth acting on. "Already applied" means the lane found a real job the
// client had already found, which is the lane working, and "other" says nothing
// about targeting at all. Both are shown, and both are kept out of the miss
// total, because a well-aimed lane padded with those reads as a badly aimed one.
//
// Loads on expand rather than with the lane, and loads from the click rather
// than from an effect watching the open flag. A coach opening the editor to add
// a title should not pay for a query about dismissal history.
//
// Its caller keys it on the lane id, so switching lanes remounts it and the
// previous lane's counts cannot linger under the new lane's name. That is the
// same job a reset effect would do, minus the render it would cost.

import { useCallback, useState } from "react"
import { T, card, eyebrow } from "../../../lib/dashboard-theme"
import { authFetch, daysAgo } from "./laneApi"

type ReasonRow = { value: string; count: number; label: string; kind: string }
type NoteRow = {
  id: string
  reason: string | null
  label: string | null
  note: string | null
  actioned_at: string | null
  title: string | null
  company: string | null
}
type History = {
  totals: { actioned: number; dismissed: number; pushed: number; cleared: number }
  reasons: ReasonRow[]
  notes: NoteRow[]
  note_limit: number
}

/**
 * What to change when a reason keeps coming up.
 *
 * Written per reason rather than as one generic "review your lane", because the
 * whole argument for a closed taxonomy is that each value points at a different
 * control. A count with no next step is just a number.
 */
const WHAT_TO_CHANGE: Record<string, string> = {
  too_senior: "Titles reach above the client. Drop the senior-sounding ones, or turn off the Senior Level band.",
  too_junior: "Turn off the No Prior Experience and Entry Level bands, or drop titles that read as first jobs.",
  wrong_function: "The titles are pointing at the wrong work. Use Discover titles to find what the board calls it.",
  wrong_industry: "The keyword or the industry filters are too loose. Narrow industries, or exclude the ones recurring here.",
  wrong_location: "Check the lane's markets and radius. This one is not fixable from the titles.",
  right_employer_wrong_level: "The employers are right, so keep them and narrow the seniority band instead.",
  doesnt_meet_requirements: "Consider a years ceiling, though it only bites on postings that state a minimum.",
  already_applied: "Nothing to fix. The lane found a job the client had already found for themselves.",
  other: "Read the notes below. Anything recurring here probably wants a reason of its own.",
}

const KIND_LABEL: Record<string, string> = {
  miss: "targeting",
  hit: "lane worked",
  unclassified: "unclassified",
}

export function LaneReviewHistory({ laneId }: { laneId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<History | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}/dismissals`)
    const j = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok || !j.ok) {
      setError(j.error || "Could not load the review history")
      return
    }
    setError(null)
    setData(j)
  }, [laneId])

  const toggle = () => {
    const next = !open
    setOpen(next)
    // Fetched once and kept: the counts move when someone reviews a row, not
    // while this panel is open, so re-reading on every expand would be traffic
    // for an answer that has not changed.
    if (next && !data && !loading) load()
  }

  const misses = (data?.reasons ?? []).filter((r) => r.kind === "miss")
  const missTotal = misses.reduce((n, r) => n + r.count, 0)

  return (
    <div style={{ marginBottom: 18 }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "transparent", border: `1px dashed ${T.BORDER_SOFT}`,
          borderRadius: 12, padding: "10px 14px", cursor: "pointer",
          color: T.MUTED, fontSize: 12, fontWeight: 800, textAlign: "left",
        }}
      >
        <span style={{ color: T.DIM }}>{open ? "▾" : "▸"}</span>
        Why this lane gets dismissed
        {data && (
          <span style={{ color: T.DIM, fontWeight: 600 }}>
            · {data.totals.dismissed} dismissed
            {missTotal > 0 ? `, ${missTotal} pointing at the lane` : ""}
          </span>
        )}
      </button>

      {open && (
        <div style={{ ...card, padding: "18px 20px", marginTop: 12 }}>
          {loading && <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Reading the queue&apos;s history…</p>}
          {error && <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{error}</p>}

          {data && data.totals.actioned === 0 && (
            <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
              Nothing has been reviewed on this lane yet, so there is nothing to learn from it. Dismissal reasons
              collect here as the queue gets worked.
            </p>
          )}

          {data && data.totals.actioned > 0 && (
            <>
              <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 16px" }}>
                {data.totals.dismissed} dismissed · {data.totals.pushed} scored · {data.totals.cleared} cleared
                without review
              </p>

              {data.reasons.length === 0 ? (
                <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
                  Nothing has been dismissed with a reason yet.
                </p>
              ) : (
                <>
                  {data.reasons.map((r) => {
                    const share = data.totals.dismissed ? Math.round((r.count / data.totals.dismissed) * 100) : 0
                    return (
                      <div key={r.value} style={{ padding: "10px 0", borderBottom: `1px solid ${T.BORDER_SOFT}` }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: T.TEXT }}>{r.label}</span>
                          <span
                            style={{
                              fontSize: 13, fontWeight: 900,
                              color: r.kind === "miss" ? T.WRN_ORANGE : T.MUTED,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {r.count}
                          </span>
                          <span style={{ fontSize: 11, color: T.DIM }}>
                            {share}% · {KIND_LABEL[r.kind] ?? r.kind}
                          </span>
                        </div>
                        {/* A bar, because relative size is the whole point and a
                            column of numbers hides it. */}
                        <div
                          style={{
                            height: 4, borderRadius: 999, marginTop: 6,
                            background: T.BORDER_SOFT, overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${share}%`, height: "100%",
                              background: r.kind === "miss" ? T.WRN_ORANGE : T.BORDER,
                            }}
                          />
                        </div>
                        {WHAT_TO_CHANGE[r.value] && (
                          <p style={{ fontSize: 12, color: T.MUTED, margin: "8px 0 0" }}>
                            {WHAT_TO_CHANGE[r.value]}
                          </p>
                        )}
                      </div>
                    )
                  })}

                  <p style={{ fontSize: 12, color: T.DIM, margin: "14px 0 0" }}>
                    These counts change nothing on their own. The nightly run searches on the titles, keyword,
                    location, window, seniority and filters above, and never looks at a past dismissal, so acting
                    on this means editing the lane.
                  </p>
                </>
              )}

              {data.notes.length > 0 && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
                  <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 10 }}>
                    Recent notes
                    {data.notes.length === data.note_limit && (
                      <span style={{ color: T.DIM, fontWeight: 500 }}> · newest {data.note_limit}</span>
                    )}
                  </div>
                  {data.notes.map((n) => (
                    <div key={n.id} style={{ padding: "8px 0", borderBottom: `1px solid ${T.BORDER_SOFT}` }}>
                      <div style={{ fontSize: 12, color: T.DIM, marginBottom: 3 }}>
                        {n.label ?? "No reason"}
                        {n.title ? ` · ${n.title}` : ""}
                        {n.company ? ` · ${n.company}` : ""}
                        {n.actioned_at ? ` · ${daysAgo(n.actioned_at)}` : ""}
                      </div>
                      <div style={{ fontSize: 13, color: T.TEXT, lineHeight: 1.5 }}>{n.note}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
