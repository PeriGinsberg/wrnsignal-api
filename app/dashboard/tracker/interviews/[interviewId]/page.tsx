"use client"

// Prep Now — one interview, and what to do before it.
//
// The first surface in the tracker that hangs off an INTERVIEW rather than an
// application. Both "Prep now" buttons used to land on the application, which
// answered a different question: the application page is about the job, this is
// about the conversation.
//
// STATIC IN THIS COMMIT. No LLM, no generated content. The playbook is the same
// for everyone, which is exactly what makes it shippable standalone — it works
// for an interview with no JobFit run behind it, and roughly a third of scored
// applications have no run to reach.
//
// ORDER, and the one rule that bends it: header → the two facts → checklist →
// the generated zone → the playbook line. INSIDE 24 HOURS the checklist jumps
// to the top, because at that point there is nothing left to read and
// everything left to do. See isImminent() in prepChecklist.ts.
//
// AUTH: GET /api/interviews already returns only the caller's own rows, filtered
// server-side by profile_id. Selecting this interview out of that list IS the
// ownership check — another profile's interview is simply never in the list.
// Same pattern as the application detail page.

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  LIGHT as S, DARK, action as actionStyle, status as statusStyle,
  surfaceCard, tileStructural,
} from "../../../../../lib/theme/surfaces"
import { InterviewIcon, ScoreAJobIcon, StepCompleteIcon } from "../../../../../components/icons"
import { authFetch } from "../../../network/authFetch"
import { daysUntil, formatLong, formatShort } from "../../../../../lib/localDate"
import { openInSignal, JOBFIT_URL } from "../../openInSignal"
import {
  groupedItems, PREP_GROUP_LABELS, isImminent, scheduledAt,
  isChecked, progressFor, safeState,
} from "../../prepChecklist"
import { interviewStageLabel, interviewStatusLabel, interviewStatusMeaning } from "../../vocab"

/** TODO(playbook-url): swap for the real Ultimate Interview Playbook link. */
const PLAYBOOK_URL = "#"

type Interview = {
  id: string
  application_id: string
  company_name: string | null
  job_title: string | null
  interview_stage: string
  interview_date: string | null
  interview_at?: string | null
  interview_format?: string | null
  status: string
  interviewer_names: string | null
}

type App = {
  id: string
  company_name: string
  job_title: string
  jobfit_run_id: string | null
  signal_score: number | null
  signal_decision: string | null
}

function countdown(when: string): string {
  const days = daysUntil(when) ?? 0
  if (days < 0) return "Already happened"
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `In ${days} days`
}

export default function PrepNowPage({ params }: { params: Promise<{ interviewId: string }> }) {
  const { interviewId } = use(params)

  const [interview, setInterview] = useState<Interview | null>(null)
  const [app, setApp] = useState<App | null>(null)
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /** Always the newest checklist — see toggle() for why state alone is not enough. */
  const stateRef = useRef<Record<string, boolean>>({})
  /** Serialises PATCHes so a slow write cannot land after a newer one. */
  const writeChain = useRef<Promise<void>>(Promise.resolve())

  const load = useCallback(async () => {
    setErr(null)
    // Three INDEPENDENT reads. A failure in one degrades that section rather
    // than blanking the page — the same shape the application detail uses.
    const [iRes, aRes, pRes] = await Promise.allSettled([
      authFetch("/api/interviews"),
      authFetch("/api/applications"),
      authFetch(`/api/interviews/${interviewId}/prep`),
    ])

    let found: Interview | null = null
    if (iRes.status === "fulfilled" && iRes.value.ok) {
      const j = await iRes.value.json().catch(() => null)
      found = (j?.interviews || []).find((x: Interview) => x.id === interviewId) ?? null
      if (found) setInterview(found)
      else setNotFound(true)
    } else {
      setErr("We couldn't load this interview. Refresh to try again.")
    }

    if (found && aRes.status === "fulfilled" && aRes.value.ok) {
      const j = await aRes.value.json().catch(() => null)
      setApp((j?.applications || []).find((x: App) => x.id === found!.application_id) ?? null)
    }

    if (pRes.status === "fulfilled" && pRes.value.ok) {
      const j = await pRes.value.json().catch(() => null)
      const loaded = safeState(j?.prep?.checklist_state)
      stateRef.current = loaded
      setChecklist(loaded)
    }

    setLoading(false)
  }, [interviewId])

  useEffect(() => { void load() }, [load])

  const when = useMemo(() => (interview ? scheduledAt(interview) : null), [interview])
  const imminent = useMemo(() => isImminent(when), [when])
  const groups = useMemo(() => groupedItems(interview?.interview_format), [interview])
  const progress = useMemo(() => progressFor(checklist, interview?.interview_format), [checklist, interview])

  /**
   * Optimistic, and deliberately so: a checkbox that waits on a round trip
   * feels broken. The write creates the prep run on FIRST tick — never on page
   * view — so an interview nobody has worked on leaves no row behind.
   *
   * TWO RACES TO AVOID, both found by ticking two boxes quickly and watching
   * only one survive:
   *
   *   STALE READ. Building `next` from the `checklist` state variable reads a
   *   snapshot captured when this callback was created. Two ticks in the same
   *   React batch both start from the same snapshot, so the second forgets the
   *   first. `stateRef` always holds the newest value, so each toggle builds on
   *   the real current state.
   *
   *   OUT-OF-ORDER WRITES. Each PATCH sends the WHOLE blob, so if two are in
   *   flight the slower one can land last and resurrect a stale state. The
   *   requests are chained instead: each waits for the previous to settle, so
   *   the last write on the wire is always the last tick made.
   */
  async function toggle(id: string) {
    const next = { ...stateRef.current }
    if (next[id]) delete next[id]
    else next[id] = true
    stateRef.current = next
    setChecklist(next)

    writeChain.current = writeChain.current
      .catch(() => {})
      .then(async () => {
        const res = await authFetch(`/api/interviews/${interviewId}/prep`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checklist_state: stateRef.current }),
        })
        if (!res.ok) {
          setErr("That didn't save. Your ticks may not stick.")
          void load()
        }
      })
  }

  if (loading) return <p style={{ color: S.text.muted, fontSize: 14.5 }}>Loading…</p>

  if (notFound || !interview) {
    return (
      <main style={{ maxWidth: 1080 }}>
        <a href="/dashboard/tracker?view=interviews" style={backLink}>← Back to your interviews</a>
        <p style={{ color: S.text.secondary, fontSize: 16, marginTop: 24 }}>
          We couldn&apos;t find that interview. It may have been removed.
        </p>
      </main>
    )
  }

  const st = statusStyle(S, interviewStatusMeaning(interview.status))
  const hasRun = Boolean(app?.jobfit_run_id)

  const checklistBlock = (
    <section style={{ ...surfaceCard(S), borderRadius: 16, padding: "24px 26px", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: S.text.primary, margin: 0 }}>
          Before your interview
        </h2>
        <span style={{ fontSize: 14, color: S.text.muted, fontVariantNumeric: "tabular-nums" }}>
          {progress.done} of {progress.total} done
        </span>
      </div>

      {/* One line, stated once, and NOT an instruction. The format column
          exists but nothing writes it yet, so this is every interview today.
          Telling someone to go and set a field they cannot set would be worse
          than showing them both branches. */}
      {interview.interview_format !== "in_person" && interview.interview_format !== "virtual" && (
        <p style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", margin: "10px 0 0" }}>
          Some of this depends on whether you&apos;re going in person or joining a call. Both are here.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.group} style={{ marginTop: 24 }}>
          <div
            style={{
              fontSize: 12, fontWeight: 800, letterSpacing: 1.4,
              textTransform: "uppercase", color: S.text.muted, marginBottom: 12,
            }}
          >
            {PREP_GROUP_LABELS[g.group]}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {g.items.map((item) => {
              const done = isChecked(checklist, item.id)
              return (
                <button
                  key={item.id}
                  onClick={() => void toggle(item.id)}
                  aria-pressed={done}
                  data-testid={`prep-item-${item.id}`}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 13, width: "100%",
                    textAlign: "left", background: "none", border: "none",
                    padding: "10px 8px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {/* The tick is the drawn teal mark, the same one the contact
                      record's stepper uses for a completed step. An unticked box
                      is a hairline circle, not an empty checkbox: it reads as
                      "not yet" rather than as a form field. */}
                  <span aria-hidden style={{ flexShrink: 0, marginTop: 1, display: "inline-flex" }}>
                    {done ? (
                      <StepCompleteIcon size={22} />
                    ) : (
                      <span
                        style={{
                          width: 22, height: 22, borderRadius: 999,
                          border: `1.5px solid ${S.border}`, display: "inline-block",
                        }}
                      />
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: 15, lineHeight: "22px",
                      color: done ? S.text.dim : S.text.secondary,
                      textDecoration: done ? "line-through" : "none",
                    }}
                  >
                    {item.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )

  return (
    <main style={{ maxWidth: 1080 }}>
      <a href="/dashboard/tracker?view=interviews" style={backLink}>← Back to your interviews</a>

      {err && (
        <div
          style={{
            margin: "14px 0 0", padding: "12px 16px", borderRadius: 12,
            background: S.meaning.error.fill, color: S.meaning.error.ink, fontSize: 14, fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      <header style={{ display: "flex", alignItems: "center", gap: 18, margin: "18px 0 4px", flexWrap: "wrap" }}>
        <span
          aria-hidden
          style={{
            ...tileStructural(S), width: 56, height: 56, borderRadius: 14, flexShrink: 0,
            display: "grid", placeItems: "center",
          }}
        >
          <InterviewIcon size={28} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0 }}>
            {interview.job_title || "Your interview"}
          </h1>
          <p style={{ color: S.text.muted, fontSize: 15, margin: "4px 0 0" }}>
            {[
              interview.company_name,
              interviewStageLabel(interview.interview_stage),
              when ? formatLong(when) : "No date set",
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={st.dot} />
          <span style={{ ...st.text, fontSize: 16 }}>{interviewStatusLabel(interview.status)}</span>
        </span>
      </header>

      {/* Inside 24 hours the checklist comes first. */}
      {imminent && checklistBlock}

      {/* The two facts. Countdown carries the urgency; coral only when it is
          genuinely close, since coral means "this needs you". */}
      <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "16px 20px", flex: "1 1 260px" }}>
          <div style={factLabel}>When</div>
          {when ? (
            <>
              <div
                style={{
                  fontSize: 22, fontWeight: 800,
                  color: imminent ? S.meaning.attention.ink : S.text.primary,
                }}
              >
                {countdown(when)}
              </div>
              <div style={{ fontSize: 14, color: S.text.muted, marginTop: 3 }}>{formatShort(when)}</div>
            </>
          ) : (
            <div style={{ fontSize: 14.5, color: S.text.muted, paddingTop: 6 }}>No date set yet.</div>
          )}
        </div>

        <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "16px 20px", flex: "1 1 260px" }}>
          <div style={factLabel}>Who you&apos;re meeting</div>
          <div style={{ fontSize: 15.5, color: interview.interviewer_names ? S.text.primary : S.text.muted, paddingTop: 4 }}>
            {interview.interviewer_names || "Not recorded"}
          </div>
          <a
            href={`/dashboard/tracker/${interview.application_id}`}
            style={{ display: "inline-block", marginTop: 10, color: S.action.quietInk, fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            See the job →
          </a>
        </div>
      </div>

      {!imminent && checklistBlock}

      {/* Where commit 3's generated read lands. Two states, and the second is a
          real conversion surface rather than an apology for missing data. */}
      {hasRun ? (
        <section
          style={{
            ...surfaceCard(S), borderRadius: 16, padding: "22px 26px", marginTop: 14,
            borderLeft: `3px solid ${S.meaning.sequence.accent}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 800, color: S.text.primary }}>
            Your read on this role is coming.
          </div>
          <p style={{ fontSize: 14.5, color: S.text.muted, lineHeight: "22px", margin: "8px 0 0", maxWidth: 620 }}>
            We&apos;ll pull what SIGNAL already knows about this job into the questions you&apos;re most
            likely to get, and the answers worth having ready.
          </p>
          <button
            onClick={() => void openInSignal(app!.jobfit_run_id!)}
            style={{
              background: "none", border: "none", padding: "12px 0 0",
              color: S.action.quietInk, fontSize: 14, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            See your full analysis →
          </button>
        </section>
      ) : (
        <section
          style={{
            background: S.hero.background, borderRadius: 16,
            padding: "24px 26px", marginTop: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <span
              aria-hidden
              style={{
                width: 46, height: 46, borderRadius: 13, flexShrink: 0,
                background: "rgba(255,255,255,0.10)", display: "grid", placeItems: "center",
              }}
            >
              <ScoreAJobIcon size={26} />
            </span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ color: S.hero.ink, fontSize: 19, fontWeight: 800 }}>
                Unlock your read on this role
              </div>
              <p style={{ color: S.hero.muted, fontSize: 14.5, lineHeight: "22px", margin: "8px 0 0", maxWidth: 560 }}>
                Score it and we&apos;ll turn the analysis into the questions you&apos;re likely to face
                here, and what to say about them.
              </p>
              <a
                href={JOBFIT_URL}
                style={{
                  ...actionStyle(S, "primary"), textDecoration: "none", display: "inline-block",
                  marginTop: 18, borderRadius: 11, padding: "11px 20px", fontSize: 14.5,
                }}
              >
                Score this job →
              </a>
            </div>
          </div>
        </section>
      )}

      {/* Plain text, not a button. The one action on this page is the gate's
          peach button; a second peach thing here would compete with it. */}
      <p style={{ fontSize: 14.5, color: S.text.muted, margin: "22px 0 0", lineHeight: "22px" }}>
        Want the full method?{" "}
        <a href={PLAYBOOK_URL} style={{ color: S.action.quietInk, fontWeight: 700, textDecoration: "none" }}>
          The Ultimate Interview Playbook
        </a>
        .
      </p>
    </main>
  )
}

const backLink: React.CSSProperties = {
  color: S.action.quietInk, fontSize: 14, fontWeight: 700, textDecoration: "none",
}
const factLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase",
  color: S.text.muted, marginBottom: 10,
}
