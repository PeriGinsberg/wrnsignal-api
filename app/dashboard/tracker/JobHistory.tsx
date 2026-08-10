"use client"

// The running log for one job: what happened, when, and who did it.
//
// Reads GET /api/applications/[id]/history, which merges six existing sources
// into one timeline. Nothing new is tracked; see that route for the sources and
// for the one honest gap (jobs created before the transition log existed).
//
// SHAPE: a vertical rail with a dot per event, newest at the TOP. The contact
// record's History lists newest-first for the same reason — you open a log to
// see what just happened, not to read a biography from the beginning.
//
// Colour carries the KIND, not the recency: a status move is blue, an interview
// teal, a coach note teal-filled, an offer gold, a closed outcome grey. That is
// the same meaning vocabulary the cards use, so nothing new has to be learned.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S, type MeaningKey } from "../../../lib/theme/surfaces"
import { authFetch } from "../network/authFetch"
import { parseLocalDate } from "../../../lib/localDate"

type Actor = "you" | "coach" | "system"

// DECLARED TWICE, ON PURPOSE AND DANGEROUSLY. The same union lives in
// app/api/applications/[id]/history/route.ts. A kind added there but not here
// does not break the build: `meaningOf()` below falls through to "idle" and the
// event renders as a grey dot that looks deliberate. Keep them in step.
// tests/tracker/job-history-kinds.test.ts pins the two lists against each other.
export const JOB_EVENT_KINDS = [
  "added",
  "status",
  "applied",
  "scored",
  "interview_added",
  "interview_held",
  "coach_note",
  "coach_rec_response",
] as const

type JobEvent = {
  kind: (typeof JOB_EVENT_KINDS)[number]
  at: string
  actor: Actor
  label: string
  detail?: string | null
  from_status?: string | null
  to_status?: string | null
}

/** Kind → meaning. `status` defers to the status it moved TO. */
function meaningOf(e: JobEvent): MeaningKey {
  if (e.kind === "status") {
    if (e.to_status === "offer") return "done"
    if (e.to_status === "interviewing") return "replied"
    if (e.to_status === "rejected" || e.to_status === "withdrawn") return "dormant"
    return "progress"
  }
  // The client's answer to a sourced job. "Not interested" recedes the same way
  // a withdrawn status does — it is a closed door, not a failure, and colouring
  // it as attention would make declining a job look like a problem.
  if (e.kind === "coach_rec_response") {
    return e.to_status === "not_for_me" ? "dormant" : "progress"
  }
  if (e.kind === "interview_added" || e.kind === "interview_held") return "replied"
  if (e.kind === "coach_note") return "replied"
  if (e.kind === "scored") return "sequence"
  if (e.kind === "applied") return "progress"
  return "idle"
}

function stamp(iso: string): string {
  const d = parseLocalDate(iso)
  if (!d) return ""
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  })
}

/** "you" needs no attribution: it is the default voice of the student's own log. */
function actorNote(actor: Actor): string | null {
  return actor === "coach" ? "your coach" : null
}

export function JobHistory({ applicationId }: { applicationId: string }) {
  const [events, setEvents] = useState<JobEvent[] | null>(null)
  const [partial, setPartial] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await authFetch(`/api/applications/${applicationId}/history`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `We couldn't load the history (${res.status})`)
      setEvents(j.events ?? [])
      setPartial(!!j.partial)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [applicationId])

  useEffect(() => { void load() }, [load])

  if (err) {
    return (
      <div>
        <div style={{ fontSize: 14, color: S.meaning.error.ink }}>{err}</div>
        <button onClick={() => void load()} style={retry}>Try again</button>
      </div>
    )
  }

  if (events === null) {
    return <p style={{ fontSize: 14, color: S.text.muted, margin: 0 }}>Loading…</p>
  }

  // Newest first: a log answers "what just happened".
  const rows = [...events].reverse()

  return (
    <>
      {partial && (
        <p
          style={{
            fontSize: 13.5, color: S.text.muted, lineHeight: "20px",
            margin: "0 0 16px", paddingLeft: 12,
            borderLeft: `3px solid ${S.border}`,
          }}
        >
          This job is older than our activity log, so only the dates we can be sure of are shown.
        </p>
      )}

      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((e, i) => {
          const m = S.meaning[meaningOf(e)]
          const last = i === rows.length - 1
          const who = actorNote(e.actor)
          return (
            <li
              key={`${e.kind}-${e.at}-${i}`}
              // STRETCH, not flex-start. With flex-start the rail column is only
              // as tall as the dot plus its minimum line, so the connector ended
              // in mid-air a third of the way to the next event. Stretching lets
              // the line's flex:1 fill whatever height the text beside it takes.
              style={{ display: "flex", gap: 14, alignItems: "stretch" }}
            >
              {/* The rail. The dot is the event; the line joins it to the one
                  below, and stops at the last row so the log has a bottom. */}
              <span
                aria-hidden
                style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}
              >
                <span
                  style={{
                    width: 11, height: 11, borderRadius: 999, marginTop: 5, flexShrink: 0,
                    background: m.accent,
                    // A ring in the card colour keeps the dot from touching the
                    // line, which reads as a smear at this size.
                    boxShadow: `0 0 0 3px ${S.card}`,
                  }}
                />
                {/* `border`, not `borderSoft`: at 2px wide on white the softer
                    token measured as a rumour rather than a line. */}
                {!last && <span style={{ width: 2, flex: 1, minHeight: 18, background: S.border, marginTop: 3 }} />}
              </span>

              <span style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: S.text.primary }}>
                    {e.label}
                  </span>
                  <span style={{ fontSize: 13, color: S.text.dim, whiteSpace: "nowrap" }}>
                    {stamp(e.at)}
                  </span>
                </span>
                {(e.detail || who) && (
                  <span style={{ display: "block", fontSize: 13.5, color: S.text.muted, marginTop: 2 }}>
                    {[e.detail, who ? `by ${who}` : null].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </>
  )
}

const retry: React.CSSProperties = {
  background: "none", border: "none", padding: "8px 0 0", color: S.action.quietInk,
  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
}
