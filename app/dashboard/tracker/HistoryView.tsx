"use client"

// History: every job the student has run through JobFit.
//
// This view had no data path at all before now. Runs were written to
// jobfit_runs on every score and then only ever read one at a time by id, or in
// bulk by a coach looking at someone else. A student could not see their own
// scoring history. GET /api/runs is the list endpoint that fixes it.
//
// THE MODEL, from the build plan: history is the complete automatic log; the
// tracker is the shortlist the student chose. Two different questions, so two
// different surfaces. History exists to stop someone re-scoring the same job
// and to keep the analysis for the ones they did not pursue.
//
// A note on what a tester will see today: every scoring run currently
// auto-creates a tracker entry, so nearly every row here will read "In your
// tracker" and "Add to tracker" will be rare. Removing that auto-create is the
// Phase B change that makes history and the tracker genuinely different lists.
// The button is wired for real regardless, so nothing has to be built twice.

import { useMemo, useState } from "react"
import { LIGHT as S, action as actionStyle, status as statusStyle } from "../../../lib/theme/surfaces"
import { SearchIcon, HistoryIcon } from "../../../components/icons"
import { authFetch } from "../network/authFetch"
import { decisionMeaning } from "./vocab"
import { control } from "./controls"

export type Run = {
  id: string
  created_at: string
  decision: string | null
  score: number | null
  company_name: string | null
  job_title: string | null
  application_id: string | null
}

function shortDate(d: string): string {
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return ""
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function HistoryView({
  runs, trackedRunIds, jobFitUrl, onView, onTracked,
}: {
  runs: Run[]
  /** jobfit_run_id values that already have a tracker entry. The authority. */
  trackedRunIds: Set<string>
  jobFitUrl: string
  /** Reopens a run in SIGNAL. A callback, not an href, because the jump has to
   *  carry the session across to Framer; see `openInSignal` in the shell. */
  onView: (runId: string) => void
  onTracked: () => void
}) {
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return runs
    return runs.filter(
      (r) =>
        (r.company_name || "").toLowerCase().includes(q) ||
        (r.job_title || "").toLowerCase().includes(q),
    )
  }, [runs, query])

  async function addToTracker(r: Run) {
    setBusy(r.id); setErr(null)
    try {
      const res = await authFetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: r.company_name || "Unknown company",
          job_title: r.job_title || "Untitled role",
          application_status: "saved",
          // Carried across so the tracker card can show the score without
          // going back to the run, and so History can see it is tracked.
          jobfit_run_id: r.id,
          signal_score: r.score,
          signal_decision: r.decision,
          signal_run_at: r.created_at,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not add it (${res.status})`)
      onTracked()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0 }}>
        Jobs you've scored
      </h1>
      <p style={{ color: S.text.muted, fontSize: 15, margin: "6px 0 0" }}>
        Everything you've run through JobFit. Add the ones you're serious about to your tracker.
      </p>

      {runs.length > 3 && (
        <div style={{ position: "relative", marginTop: 20 }}>
          <SearchIcon
            size={18}
            style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by company or title"
            aria-label="Search your scored jobs"
            style={{ ...control, background: S.card, paddingLeft: 42, height: 44 }}
          />
        </div>
      )}

      {err && <div style={{ color: S.meaning.error.ink, fontSize: 13.5, marginTop: 12 }}>{err}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        {visible.map((r) => (
          <RunRow
            key={r.id}
            run={r}
            tracked={trackedRunIds.has(r.id) || r.application_id !== null}
            busy={busy === r.id}
            onView={() => onView(r.id)}
            onAdd={() => addToTracker(r)}
          />
        ))}
      </div>

      {runs.length === 0 && (
        <div
          style={{
            textAlign: "center", padding: "44px 24px", marginTop: 18, borderRadius: 14,
            border: `1px dashed ${S.border}`, background: "rgba(255,255,255,0.5)",
          }}
        >
          <HistoryIcon size={34} style={{ margin: "0 auto 12px" }} />
          <div style={{ color: S.text.secondary, fontSize: 16, fontWeight: 700 }}>
            You haven't scored a job yet.
          </div>
          <p style={{ color: S.text.muted, fontSize: 14.5, margin: "8px auto 18px", maxWidth: 430 }}>
            Paste a job description into SIGNAL and it will tell you how strong a match you are, and
            what to say about it. Every one you score is kept here.
          </p>
          <a
            href={jobFitUrl}
            style={{ ...actionStyle(S, "primary"), textDecoration: "none", borderRadius: 10, padding: "11px 20px", fontSize: 14.5 }}
          >
            Score a job →
          </a>
        </div>
      )}

      {runs.length > 0 && visible.length === 0 && (
        <p style={{ color: S.text.muted, fontSize: 14.5, textAlign: "center", padding: "30px 0" }}>
          Nothing matches that.
        </p>
      )}

      {runs.length > 0 && (
        <p
          style={{
            marginTop: 20, padding: "13px 18px", borderRadius: 12,
            background: S.meaning.sequence.fill, color: S.meaning.sequence.ink,
            fontSize: 14, lineHeight: "20px",
          }}
        >
          Already scored a job here? You'll see it, so you don't run the same one twice.
        </p>
      )}
    </>
  )
}

function RunRow({
  run: r, tracked, busy, onView, onAdd,
}: {
  run: Run
  tracked: boolean
  busy: boolean
  onView: () => void
  onAdd: () => void
}) {
  const meaning = decisionMeaning(r.decision)
  const m = S.meaning[meaning]
  const st = statusStyle(S, "replied")
  // A Pass is not a failure, it is an answer. It recedes rather than turning red.
  const quiet = meaning === "idle"
  const title = [r.job_title, r.company_name].filter(Boolean).join(" · ") || "Untitled job"

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "12px 18px", borderRadius: 14,
        background: quiet ? "#FBFDFE" : S.card,
        border: `1px solid ${S.borderSoft}`,
        boxShadow: quiet ? "none" : S.shadow.card,
      }}
    >
      {/* The band tile: the score big, the decision small under it. One glance
          answers "was this worth it", which is the only thing a history row is
          for. */}
      <span
        aria-hidden
        style={{
          width: 62, height: 54, borderRadius: 12, flexShrink: 0,
          background: m.fill, color: m.ink,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {r.score ?? "—"}
        </span>
        {r.decision && (
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", marginTop: 3 }}>
            {r.decision === "Priority Apply" ? "Priority" : r.decision}
          </span>
        )}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block", fontSize: 15.5, fontWeight: 800,
            color: quiet ? S.text.secondary : S.text.primary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <span style={{ display: "block", fontSize: 13.5, color: S.text.muted, marginTop: 2 }}>
          Scored {shortDate(r.created_at)}
        </span>
      </span>

      {tracked ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          <span style={st.dot} />
          <span style={{ ...st.text, fontSize: 14, whiteSpace: "nowrap" }}>In your tracker</span>
        </span>
      ) : (
        <button
          onClick={onAdd}
          disabled={busy}
          style={{
            // A low scorer gets the OUTLINE tier, not a block: the student's
            // judgment beats the engine's, so "add anyway" stays available and
            // simply stops shouting. No gate.
            ...actionStyle(S, quiet ? "optional" : "primary"),
            borderRadius: 10, padding: "9px 16px", fontSize: 13.5,
            fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Adding…" : quiet ? "Add anyway" : "Add to tracker"}
        </button>
      )}

      <button
        onClick={onView}
        style={{
          background: "none", border: "none", padding: 0,
          color: S.action.quietInk, fontSize: 13.5, fontWeight: 700,
          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        View →
      </button>
    </div>
  )
}
