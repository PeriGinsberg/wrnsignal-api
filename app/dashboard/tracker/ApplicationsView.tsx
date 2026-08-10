"use client"

// Applications: the jobs a student is actually pursuing.
//
// ORDER IS THE POINT. The API returns newest-created first, which stacks every
// receded saved card above every live one and buries the job with an interview
// on Thursday. The default sort here is NEED (see applicationOrder.ts), the same
// principle the contacts list uses. "Newest" is still in the sort menu, because
// filing order is a legitimate thing to want; it is just not what a tracker
// should open on.
//
// Ordering is computed once per load and frozen, so a save cannot reshuffle the
// list under a pointer mid-click.
//
// The status chips carry their COUNTS, which is where the old seven-tile metrics
// bar went. Those tiles (total / analyzed / applied / interviewing / rejected /
// offers / interview rate) were student-facing metrics, which the build plan
// moves to the coach side; but the counts themselves are navigation, not
// scorekeeping, so they survive inside the thing they filter.

import { useMemo, useState } from "react"
import {
  LIGHT as S, action as actionStyle, status as statusStyle, type MeaningKey,
} from "../../../lib/theme/surfaces"
import { SearchIcon } from "../../../components/icons"
import { ApplicationCard, type Application } from "./ApplicationCard"
import { AddJobForm } from "./AddJobForm"
import { sortForNeed } from "./applicationOrder"
import { STATUS_FILTERS, statusLabel, statusMeaning } from "./vocab"
import {
  COACH_SOURCED_FILTER, COACH_SOURCED_LABEL, COACH_SOURCED_MEANING,
} from "../../../lib/coachRecommendations"
import { control } from "./controls"

export type SortKey = "need" | "newest" | "oldest" | "company"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "need", label: "What needs you" },
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "company", label: "Company A–Z" },
]

function timeOf(a: Application): number {
  const t = new Date(a.applied_date || a.created_at).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function ApplicationsView({
  applications, nextInterviewFor, unanswered, coachLabel, coachSourcedIds, onCreated,
}: {
  applications: Application[]
  nextInterviewFor: (a: Application) => string | null
  /**
   * Coach-sourced jobs the client has not answered yet (client_status 'new').
   *
   * May contain rows with a null application_id; this component drops them
   * rather than trusting the caller to. See `answerable` below.
   */
  unanswered: { id: string; application_id: string | null; job_title?: string | null; company_name?: string | null }[]
  coachLabel: string
  /**
   * Application ids a coach sourced, ANSWERED OR NOT. Wider than `unanswered`
   * on purpose: answering "Interested" does not stop a job having come from
   * your coach, and a marker that vanished the moment you replied would be
   * telling you about your own reply rather than about the job.
   */
  coachSourcedIds: Set<string>
  onCreated: () => void
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("need")
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // Counts come from the UNFILTERED list, so a chip always says how many exist
  // rather than how many survive the current chip.
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of applications) m[a.application_status] = (m[a.application_status] || 0) + 1
    return m
  }, [applications])

  // ONLY the recommendations the client can actually answer.
  //
  // A recommendation whose application has been deleted keeps existing with a
  // null application_id — the foreign key is ON DELETE SET NULL — and there is
  // nowhere to send the client for it, because the response box lives on
  // /dashboard/tracker/[applicationId].
  //
  // Counting those produced a heading claiming more jobs than it listed, and
  // when every row was unlinked (the live case on dev: one client with three)
  // a heading over nothing at all. Under-reporting is the lesser wrong. Telling
  // somebody to answer three things they cannot reach is worse than not
  // mentioning them, and the count is not the point of the banner — getting to
  // the job is.
  //
  // Filtered HERE, not by the caller, so the invariant belongs to the component
  // that renders it and cannot be reintroduced by a future caller. The Coaching
  // Hub applies the same rule to its Required Actions.
  const answerable = useMemo(
    () => unanswered.filter((r) => r.application_id),
    [unanswered],
  )

  // Counted off the SAME list the chips count from, so the number on the chip
  // and the number of rows after clicking it cannot disagree.
  const coachSourcedCount = useMemo(
    () => applications.filter((a) => coachSourcedIds.has(a.id)).length,
    [applications, coachSourcedIds],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = applications
    // The coach chip is the one filter that is not a status. Its value is a
    // sentinel no application_status can equal, so the two branches can never
    // both match and the order of these two lines carries no meaning.
    if (statusFilter === COACH_SOURCED_FILTER) rows = rows.filter((a) => coachSourcedIds.has(a.id))
    else if (statusFilter) rows = rows.filter((a) => a.application_status === statusFilter)
    if (q) {
      rows = rows.filter(
        (a) =>
          (a.company_name || "").toLowerCase().includes(q) ||
          (a.job_title || "").toLowerCase().includes(q),
      )
    }
    if (sort === "need") return sortForNeed(rows, nextInterviewFor)
    if (sort === "newest") return [...rows].sort((a, b) => timeOf(b) - timeOf(a))
    if (sort === "oldest") return [...rows].sort((a, b) => timeOf(a) - timeOf(b))
    return [...rows].sort((a, b) => (a.company_name || "").localeCompare(b.company_name || ""))
  }, [applications, query, sort, statusFilter, nextInterviewFor, coachSourcedIds])

  const subtitle =
    applications.length === 0
      ? "Nothing here yet."
      : `${applications.length} ${applications.length === 1 ? "job" : "jobs"} you're pursuing.`

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0 }}>
            Your applications
          </h1>
          <p style={{ color: S.text.muted, fontSize: 15, margin: "6px 0 0" }}>{subtitle}</p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          style={{
            ...actionStyle(S, "primary"),
            borderRadius: 12, padding: "12px 20px", fontSize: 15, fontFamily: "inherit", flexShrink: 0,
          }}
        >
          + Add a job
        </button>
      </div>

      {adding && (
        <div style={{ marginTop: 18 }}>
          <AddJobForm onClose={() => setAdding(false)} onCreated={() => { setAdding(false); onCreated() }} />
        </div>
      )}

      {/* From your coach. INFORMATIONAL ONLY as of 2026-08-10 — it points at the
          jobs and carries no action of its own.
          
          It used to end in a "Mark all seen" text button. That button wrote
          client_status 'interested' for every unanswered job at once, which
          told the coach the client wanted roles they had never opened, under a
          label that promised only to clear a notification. It also failed at
          the one thing it claimed to do: the count included 'interested' as
          well as 'new', so marking everything seen left the number unchanged
          and the banner in place. Answering now happens per job, on the job,
          via CoachResponseBox. */}
      {answerable.length > 0 && (
        <div
          data-testid="coach-unanswered-banner"
          style={{
            marginTop: 18, padding: "13px 18px", borderRadius: 12,
            background: S.meaning.sequence.fill,
            borderLeft: `3px solid ${S.meaning.replied.accent}`,
          }}
        >
          <span style={{ color: S.meaning.sequence.ink, fontSize: 14.5, fontWeight: 700 }}>
            {coachLabel} sent {answerable.length}{" "}
            {answerable.length === 1 ? "job" : "jobs"} you haven&apos;t answered yet.
          </span>

          {/* Each row links to the job, where the answer is given. Capped at
              three: past that this stops being a prompt and becomes a second
              copy of the list directly underneath it. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
            {/* No null-guard on the href: `answerable` has already excluded
                every row without an application, so a row here always has
                somewhere to go. */}
            {answerable.slice(0, 3).map((r) => (
              <a
                key={r.id}
                href={`/dashboard/tracker/${r.application_id}`}
                style={{
                  color: S.meaning.sequence.ink, fontSize: 13.5, fontWeight: 700,
                  textDecoration: "underline", textUnderlineOffset: 3, width: "fit-content",
                }}
              >
                {[r.job_title || "Untitled role", r.company_name].filter(Boolean).join(" · ")}
              </a>
            ))}
            {answerable.length > 3 && (
              <span style={{ color: S.meaning.sequence.ink, fontSize: 13, opacity: 0.85 }}>
                + {answerable.length - 3} more below
              </span>
            )}
          </div>
        </div>
      )}

      {applications.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 320px", minWidth: 220 }}>
              <SearchIcon
                size={18}
                style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by company or job title"
                aria-label="Search applications"
                style={{ ...control, background: S.card, paddingLeft: 42, height: 44 }}
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort"
              style={{ ...control, background: S.card, width: "auto", height: 44, fontWeight: 700 }}
            >
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Chip
              label={`All ${applications.length}`}
              active={statusFilter === null}
              onClick={() => setStatusFilter(null)}
            />
            {STATUS_FILTERS.map((s) => (
              counts[s] ? (
                <Chip
                  key={s}
                  label={`${statusLabel(s)} ${counts[s]}`}
                  meaning={s}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                />
              ) : null
            ))}

            {/* Last, and hidden at zero like every other chip. Most students
                have no coach-sourced jobs at all — 126 of 1,039 applications
                on production — so for most accounts this row is unchanged. */}
            {coachSourcedCount > 0 && (
              <Chip
                label={`${COACH_SOURCED_LABEL} ${coachSourcedCount}`}
                meaningKey={COACH_SOURCED_MEANING}
                active={statusFilter === COACH_SOURCED_FILTER}
                onClick={() =>
                  setStatusFilter(statusFilter === COACH_SOURCED_FILTER ? null : COACH_SOURCED_FILTER)
                }
              />
            )}
          </div>
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        {visible.map((a) => (
          <ApplicationCard
            key={a.id}
            application={a}
            nextInterviewAt={nextInterviewFor(a)}
            fromCoach={coachSourcedIds.has(a.id)}
          />
        ))}
      </div>

      {applications.length === 0 && !adding && (
        <div
          style={{
            textAlign: "center", padding: "44px 24px", marginTop: 18, borderRadius: 14,
            border: `1px dashed ${S.border}`, background: "rgba(255,255,255,0.5)",
          }}
        >
          <div style={{ color: S.text.secondary, fontSize: 16, fontWeight: 700 }}>
            No jobs in your tracker yet.
          </div>
          <p style={{ color: S.text.muted, fontSize: 14.5, margin: "8px auto 18px", maxWidth: 420 }}>
            Score a job to see how strong a match you are, or add one here if you already know you
            want it.
          </p>
          <button
            onClick={() => setAdding(true)}
            style={{ ...actionStyle(S, "primary"), borderRadius: 10, padding: "11px 20px", fontSize: 14.5, fontFamily: "inherit" }}
          >
            + Add your first job
          </button>
        </div>
      )}

      {applications.length > 0 && visible.length === 0 && (
        <p style={{ color: S.text.muted, fontSize: 14.5, textAlign: "center", padding: "30px 0" }}>
          Nothing matches that. {query ? <button onClick={() => setQuery("")} style={linkBtn}>Clear the search</button> : null}
        </p>
      )}
    </>
  )
}

/**
 * A filter chip carries the meaning's DOT, not its fill. A filled coloured pill
 * is the status shape this system deliberately retired, and a row of them would
 * read as five buttons that set state rather than five filters.
 */
function Chip({
  label, active, onClick, meaning, meaningKey,
}: {
  label: string
  active: boolean
  onClick: () => void
  /** An application_status. Resolved through statusMeaning. */
  meaning?: string
  /** A meaning directly, for the one chip whose filter is not a status. */
  meaningKey?: MeaningKey
}) {
  const resolved = meaningKey ?? (meaning ? statusMeaning(meaning) : null)
  const dot = resolved ? statusStyle(S, resolved).dot : null
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        background: active ? S.text.primary : S.card,
        color: active ? "#FFFFFF" : S.text.secondary,
        border: `1px solid ${active ? S.text.primary : S.borderSoft}`,
        borderRadius: 999, padding: "8px 16px", fontSize: 13.5, fontWeight: 700,
        cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        boxShadow: active ? "none" : S.shadow.card,
      }}
    >
      {dot && <span style={{ ...dot, ...(active ? { background: "#FFFFFF" } : null) }} />}
      {label}
    </button>
  )
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: S.action.quietInk,
  fontSize: 14.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0,
}
