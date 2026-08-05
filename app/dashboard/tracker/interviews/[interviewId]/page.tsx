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
import { daysUntil, formatLong } from "../../../../../lib/localDate"
import { openInSignal, JOBFIT_URL } from "../../openInSignal"
import {
  groupedItems, PREP_GROUP_LABELS, isImminent, scheduledAt,
  isChecked, progressFor, safeState,
  groupState, orderedGroups, type PrepGroup,
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

/**
 * The four countdown states, all off the existing daysUntil — no new parsing.
 * A past interview says so plainly rather than showing a negative number.
 */
function countdown(when: string | null): string {
  if (!when) return "No date set"
  const days = daysUntil(when)
  if (days === null) return "No date set"
  if (days < 0) return "This has passed"
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
  const past = (daysUntil(when) ?? 0) < 0

  const formatKnown = interview.interview_format === "in_person" || interview.interview_format === "virtual"

  /**
   * One time-group, as its own card.
   *
   * The three states are the whole point of the pass: at any moment ONE group
   * is the one to act on, and the page should say which without the reader
   * working it out from the date. Colour carries it, using the rail shape that
   * COLOR-SYSTEM section 2 already reserves for group identity — no new shape.
   *
   *   live      coral rail + coral heading. "This is the one, now."
   *   complete  teal rail + teal heading. Positive, and it OUTRANKS live:
   *             a finished list does not need you, so a coral rail on it would
   *             be saying something false.
   *   receded   transparent rail, muted heading, flat card. De-emphasis, never
   *             disablement — still readable, still tickable.
   */
  function GroupCard({ group }: { group: PrepGroup }) {
    const items = groupedItems(interview!.interview_format).find((g) => g.group === group)?.items ?? []
    if (items.length === 0) return null
    const state = groupState(group, checklist, interview!.interview_format, when)
    const live = state === "live"
    const complete = state === "complete"

    const railColour = complete ? S.meaning.replied.accent : live ? S.meaning.attention.accent : "transparent"
    const headingColour = complete ? S.meaning.replied.ink : live ? S.meaning.attention.ink : S.text.muted

    return (
      <section
        data-testid={`prep-group-${group}`}
        data-state={state}
        style={{
          background: live || complete ? S.card : "#FBFDFE",
          border: `1px solid ${S.borderSoft}`,
          // Transparent rather than absent, so every heading stays on the same
          // vertical line whatever state its card is in.
          borderLeft: `3px solid ${railColour}`,
          borderRadius: 14,
          boxShadow: live || complete ? S.shadow.card : "none",
          padding: "18px 22px",
          marginTop: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span
            style={{
              fontSize: 12, fontWeight: 800, letterSpacing: 1.4,
              textTransform: "uppercase", color: headingColour,
            }}
          >
            {PREP_GROUP_LABELS[group]}
          </span>
          {complete && <StepCompleteIcon size={16} />}
          {live && !complete && (
            <span style={{ fontSize: 13, fontWeight: 700, color: S.meaning.attention.ink }}>
              · do this now
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((item, i) => {
            const done = isChecked(checklist, item.id)
            // With an unknown format the two branch items are one either-or
            // slot, so the second one is prefixed with "or". Without this the
            // count reads "0 of 8" against nine visible boxes and looks wrong.
            const showOr = !formatKnown && Boolean(item.onlyFor) && Boolean(items[i - 1]?.onlyFor)
            return (
              <div key={item.id}>
                {showOr && (
                  <div style={{ fontSize: 13, color: S.text.dim, padding: "2px 0 2px 45px", fontStyle: "italic" }}>
                    or
                  </div>
                )}
                <button
                  onClick={() => void toggle(item.id)}
                  aria-pressed={done}
                  data-testid={`prep-item-${item.id}`}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 13, width: "100%",
                    textAlign: "left", background: "none", border: "none",
                    padding: "10px 8px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {/* The empty circle is a CONTROL, so it has to clear 3:1. It
                      was S.border, which measures 1.26 on a white card and was
                      effectively invisible; text.muted measures 5.45. Ticked is
                      the drawn teal mark, same as the contact record's stepper. */}
                  <span aria-hidden style={{ flexShrink: 0, marginTop: 1, display: "inline-flex" }}>
                    {done ? (
                      <StepCompleteIcon size={24} />
                    ) : (
                      <span
                        style={{
                          width: 24, height: 24, borderRadius: 999,
                          border: `2px solid ${S.text.muted}`, display: "inline-block",
                        }}
                      />
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: 15, lineHeight: "24px",
                      color: done ? S.text.dim : S.text.secondary,
                      textDecoration: done ? "line-through" : "none",
                    }}
                  >
                    {item.label}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  const checklistBlock = (
    <section style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: S.text.primary, margin: 0 }}>
          Before your interview
        </h2>
      </div>

      {/* One line, stated once, and NOT an instruction. The format column
          exists but nothing writes it yet, so this is every interview today.
          Telling someone to go and set a field they cannot set would be worse
          than showing them both branches. */}
      {!formatKnown && (
        <p style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", margin: "8px 0 0" }}>
          Some of this depends on whether you&apos;re going in person or joining a call. Both are here.
        </p>
      )}

      {orderedGroups(when).map((g) => <GroupCard key={g} group={g} />)}
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

      {/* COUNTDOWN HERO. Navy is structure, so the one time-critical fact on
          the page gets the structural surface. The countdown itself goes coral
          only inside 24 hours — coral means "needs you", and "in 12 days" does
          not. It reads the DARK attention ink because the light coral #F26B52
          measures 3.82 against this gradient's lightest stop, under the bar for
          text; #FF9B80 measures 5.60. Same fix as the send panel. */}
      <section
        style={{
          background: S.hero.background, borderRadius: 16,
          padding: "26px 28px", marginTop: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 38, fontWeight: 800, letterSpacing: -1, lineHeight: 1.05,
                color: past ? S.hero.muted : imminent ? DARK.meaning.attention.ink : S.hero.ink,
              }}
            >
              {countdown(when)}
            </div>
            <div style={{ color: S.hero.ink, fontSize: 18, fontWeight: 700, marginTop: 12 }}>
              {interview.job_title || "Your interview"}
              {interview.company_name ? ` · ${interview.company_name}` : ""}
            </div>
            <div style={{ color: S.hero.muted, fontSize: 14.5, marginTop: 4 }}>
              {[when ? formatLong(when) : null, interviewStageLabel(interview.interview_stage)]
                .filter(Boolean).join(" · ")}
            </div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ ...st.dot, background: S.hero.muted }} />
            <span style={{ color: S.hero.muted, fontSize: 14.5, fontWeight: 700 }}>
              {interviewStatusLabel(interview.status)}
            </span>
          </span>
        </div>

        {/* PROGRESS. Peach fill on a navy hero is the pattern the Dashboard's
            new-student bar and My Profile's completeness bar already use, so
            this is the third instance rather than an exception to the
            action rule: a meter, inside navy, never a button. */}
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                  height: "100%", borderRadius: 999, background: S.hero.accent,
                  transition: "width 220ms ease",
                }}
              />
            </div>
            <span
              style={{ color: S.hero.muted, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
              data-testid="prep-progress"
            >
              {progress.done} of {progress.total} done
            </span>
          </div>
        </div>
      </section>

      {/* Inside 24 hours the checklist comes first. */}
      {imminent && checklistBlock}

      {/* One fact card, not two. The countdown hero above now states the
          when — date, stage and how long — so a "When" card here would be the
          same sentence twice, which is the redundancy the contact record was
          reworked to remove. Only who-you-are-meeting is left, and it is the
          one thing the hero does not carry. */}
      <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "16px 20px", marginTop: 12 }}>
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
