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
import type { PrepGenerated } from "../../../../../lib/interviewPrep/validate"

/** Offsite, so it opens in a new tab rather than losing someone's prep page. */
const PLAYBOOK_URL = "https://www.youwerenevertold.com/interview-playbook"

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
 * What the generator stores, plus the frozen posting verdict.
 *
 * `jd_thin` is the SUPERSEDED boolean. Preps written before the three-state
 * signal still carry it, and they are not regenerated for a display-only
 * change — that would charge the user for new words to say the same thing. So
 * both shapes are read, and the old one maps onto the new.
 */
type Prep = PrepGenerated & { jd_state?: "absent" | "thin" | "ok"; jd_thin?: boolean }

function postingState(p: Prep): "absent" | "thin" | "ok" {
  if (p.jd_state) return p.jd_state
  return p.jd_thin ? "thin" : "ok"
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
  /** The job failed to load. Distinct from the job having no analysis. */
  const [appFailed, setAppFailed] = useState(false)
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The generated zone. `generating` drives the button; `genErr` is shown in
  // place of the blocks, because a failed generation must never leave the page
  // looking like it succeeded with nothing to say.
  const [generated, setGenerated] = useState<Prep | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr] = useState<string | null>(null)
  /** Why there was nothing to build from. Set only when the server says so. */
  const [noMaterial, setNoMaterial] = useState<"gated_pass" | "thin_run" | "no_run" | null>(null)
  /**
   * Seconds the current build has been running. REAL elapsed time, not a fake
   * progress bar: there is one request in flight and no way to know how far
   * through it is, so a bar creeping to 90% would be inventing a number. A
   * counter that is simply true still proves the page is alive.
   */
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!generating) { setElapsed(0); return }
    const started = Date.now()
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(t)
  }, [generating])

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
      setAppFailed(false)
    } else if (found) {
      // A FAILED LOAD IS NOT AN ABSENT RUN, and the two used to look identical
      // here: both left `app` null, `hasRun` false, and the page telling
      // someone to go and score a job they may well have scored already. The
      // three reads are independent so the rest of the page still works; this
      // just stops one of them lying on the other's behalf.
      setAppFailed(true)
    }

    if (pRes.status === "fulfilled" && pRes.value.ok) {
      const j = await pRes.value.json().catch(() => null)
      const loaded = safeState(j?.prep?.checklist_state)
      stateRef.current = loaded
      setChecklist(loaded)
      // A prep generated earlier renders straight away. GET never calls the
      // model and never creates a row, so this costs nothing.
      if (j?.prep?.generated) setGenerated(j.prep.generated as Prep)
    }

    setLoading(false)
  }, [interviewId])

  /**
   * A BUTTON, never automatic. Generation costs real money and the artifact is
   * cached on the inputs, so the second press is free but the first must be
   * asked for. Same rule as commit 2's "creation is an interaction, not a
   * visit" — a glance at an interview should not bill a generation.
   */
  async function generate() {
    if (generating) return
    setGenerating(true)
    setGenErr(null)
    setNoMaterial(null)
    try {
      const res = await authFetch(`/api/interviews/${interviewId}/prep/generate`, { method: "POST" })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) {
        setGenErr("We couldn't build this one. Try again.")
        return
      }
      if (j.generated) {
        setGenerated(j.generated as Prep)
        return
      }
      // ok:true with generated:null means there was nothing to work from.
      //
      // THIS BRANCH USED TO DO NOTHING, and the button looked broken. The
      // client cannot tell the difference itself: `hasRun` only knows an id
      // exists, and both a seeded stub and a gate-Passed run carry one. Only
      // the server can tell, so it says which, and this says so out loud.
      setNoMaterial(j.reason === "gated_pass" || j.reason === "no_run" ? j.reason : "thin_run")
    } catch {
      // A thrown fetch must not strand the button on "Building…" forever.
      setGenErr("We couldn't build this one. Try again.")
    } finally {
      setGenerating(false)
    }
  }

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

  /**
   * The three blocks, in the order the brief fixed: where you're exposed, what
   * they'll ask, what you say. Everything rendered here came back through the
   * validator, so every answer already carries the resume lines behind it.
   */
  const questionGroups: Array<{ key: string; label: string; items: Array<{ ref: string; question: string }> }> =
    generated
      ? [
          { key: "certain", label: "They will ask about these", items: generated.questions.certain },
          { key: "probes", label: "Where they'll push", items: generated.questions.probes },
          { key: "always", label: "The two that always come", items: generated.questions.always },
        ].filter((g) => g.items.length > 0)
      : []

  const orderedQuestions = questionGroups.flatMap((g) => g.items)
  const answerFor = (ref: string) => generated?.answers.find((a) => a.question_ref === ref) ?? null

  const generatedZone = generated ? (
    <section data-testid="prep-generated" style={{ marginTop: 18 }}>
      {/* 1 — WHERE YOU'RE EXPOSED. The same verdict SIGNAL already gave, wearing
          an interview hat. Teal for what you prove, coral for what they push
          on: the meanings the rest of the app already uses, not new ones. */}
      {(generated.exposure.prove.length > 0 || generated.exposure.probe.length > 0) && (
        <div style={{ ...surfaceCard(S), borderRadius: 16, padding: "20px 24px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: S.text.primary, margin: 0 }}>
            Where you&apos;re exposed
          </h2>

          {generated.exposure.prove.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ ...zoneLabel, color: S.meaning.replied.ink }}>They&apos;ll want you to prove</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {generated.exposure.prove.map((p) => (
                  <div key={p.why_id} style={{ borderLeft: `3px solid ${S.meaning.replied.accent}`, paddingLeft: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: S.text.primary, lineHeight: "22px" }}>
                      {p.claim}
                    </div>
                    {p.how && (
                      <div style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", marginTop: 3 }}>{p.how}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {generated.exposure.probe.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ ...zoneLabel, color: S.meaning.attention.ink }}>They&apos;ll probe</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {generated.exposure.probe.map((p) => (
                  <div key={p.risk_id} style={{ borderLeft: `3px solid ${S.meaning.attention.accent}`, paddingLeft: 14 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: S.text.primary, lineHeight: "22px" }}>
                      {p.they_will_ask}
                    </div>
                    {p.how && (
                      <div style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", marginTop: 3 }}>{p.how}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2 — WHAT THEY'LL ASK. Questions only. The answers are the next block,
          because reading the question and reaching for your own answer first is
          the point of practising. */}
      {orderedQuestions.length > 0 && (
        <div style={{ ...surfaceCard(S), borderRadius: 16, padding: "20px 24px", marginTop: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: S.text.primary, margin: 0 }}>
            What they&apos;ll ask
          </h2>

          {/* Said once, plainly. The posting is what everything here was built
              from, so its absence or thinness is a fact the reader needs, not
              an apology.
              ABSENT AND THIN ARE DIFFERENT SENTENCES. Calling a posting that
              was never saved "short" is a false statement about someone's own
              data. Runs from before 2026-04-10 never stored the description,
              and those questions came from the engine's extracted requirements
              instead, which is worth saying rather than glossing. */}
          {postingState(generated) === "absent" && (
            <p style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", margin: "8px 0 0" }}>
              The posting itself wasn&apos;t saved with this scan, so these come from what SIGNAL
              extracted at the time. Scoring it again keeps the full description with it.
            </p>
          )}
          {postingState(generated) === "thin" && (
            <p style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", margin: "8px 0 0" }}>
              This posting is short, so these lean general. Rescoring with the full description sharpens them.
            </p>
          )}

          {/* The certain group comes entirely from the engine's extracted core
              requirements, and 28% of usable runs on dev have none. Its silent
              absence would read as us having nothing to say about the job, when
              the truth is narrower and worth stating. */}
          {generated.questions.certain.length === 0 && (
            <p style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", margin: "8px 0 0" }}>
              No specific requirements came out of this posting, so what follows is about you and
              the gaps rather than the job&apos;s own checklist.
            </p>
          )}

          {questionGroups.map((g) => (
            <div key={g.key} style={{ marginTop: 16 }}>
              <div style={{ ...zoneLabel, color: S.text.muted }}>{g.label}</div>
              <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {g.items.map((q) => (
                  <li key={q.ref} style={{ fontSize: 15.5, color: S.text.secondary, lineHeight: "23px" }}>
                    {q.question}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {/* 3 — WHAT YOU SAY. Every answer shows the resume line it rests on,
          VISIBLY: not on hover, not behind a disclosure. Someone about to walk
          into a room has to be able to see what their answer stands on, and a
          claim whose source is one click away is a claim nobody checks. */}
      {generated.answers.length > 0 && (
        <div style={{ ...surfaceCard(S), borderRadius: 16, padding: "20px 24px", marginTop: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: S.text.primary, margin: 0 }}>
            What you say
          </h2>
          <p style={{ fontSize: 14, color: S.text.muted, lineHeight: "21px", margin: "8px 0 0" }}>
            Drafted from your own experience, never beyond it. What each answer rests on is underneath it.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 18 }}>
            {orderedQuestions.map((q) => {
              const a = answerFor(q.ref)
              if (!a) return null
              return (
                <div key={q.ref} data-testid={`prep-answer-${q.ref}`}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: S.text.primary, lineHeight: "22px" }}>
                    {q.question}
                  </div>
                  <p style={{ fontSize: 15.5, color: S.text.secondary, lineHeight: "24px", margin: "8px 0 0" }}>
                    {a.answer}
                  </p>
                  <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: `2px solid ${S.borderSoft}` }}>
                    <div
                      style={{
                        fontSize: 11, fontWeight: 800, letterSpacing: 0.8,
                        textTransform: "uppercase", color: S.text.dim, marginBottom: 4,
                      }}
                    >
                      From your resume
                    </div>
                    {a.evidence.map((e) => (
                      <div key={e.id} style={{ fontSize: 13.5, color: S.text.muted, lineHeight: "20px" }}>
                        {e.text}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* The way back to the reasoning. It lived on the entry card, which this
          zone replaces once a prep exists, so without this it would vanish at
          exactly the moment someone starts wondering where any of this came
          from. Quiet, because the reading is the point and this is the source. */}
      {app?.jobfit_run_id && (
        <button
          onClick={() => void openInSignal(app.jobfit_run_id!)}
          style={{
            background: "none", border: "none", padding: "14px 0 0",
            color: S.action.quietInk, fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          See your full analysis →
        </button>
      )}
    </section>
  ) : null

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

      {/* ORDER. The generated read sits ABOVE the checklist, because it is what
          you think about before you start ticking. Inside 24 hours the existing
          imminent rule already put the checklist first and this falls in behind
          it: at that point there is nothing left to read and everything left
          to do. */}
      {generatedZone}

      {!imminent && checklistBlock}

      {/* The three states of the generated zone's entry point: already built
          (nothing here, the blocks are above), buildable, or nothing to build
          from — and that last one is a real conversion surface rather than an
          apology for missing data. */}
      {generated ? null : appFailed ? (
        /* Neither the build card nor the score gate. We do not know which is
           right, and guessing wrong sends someone to rescan a job that is
           already scored. */
        <section style={{ ...surfaceCard(S), borderRadius: 16, padding: "22px 26px", marginTop: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: S.text.primary }}>
            We couldn&apos;t load this job
          </div>
          <p style={{ fontSize: 14.5, color: S.text.muted, lineHeight: "22px", margin: "8px 0 0", maxWidth: 620 }}>
            Your checklist above is fine. Refresh to try the rest again.
          </p>
          <button
            onClick={() => void load()}
            style={{
              ...actionStyle(S, "primary"), borderRadius: 11, padding: "11px 20px",
              fontSize: 14.5, fontFamily: "inherit", cursor: "pointer", marginTop: 18,
            }}
          >
            Try again
          </button>
        </section>
      ) : hasRun ? (
        <section
          style={{
            ...surfaceCard(S), borderRadius: 16, padding: "22px 26px", marginTop: 14,
            borderLeft: `3px solid ${generating ? S.meaning.attention.accent : S.meaning.sequence.accent}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 800, color: S.text.primary }}>
            {generating ? "Building your prep" : "Your read on this role"}
          </div>

          {/* THE WAITING STATE. One request, several seconds, and nothing to
              look at was the complaint. The three lines below are the real
              steps in order and they are not timed to fake progress: they are
              a description of the work, shown all at once, so nothing on
              screen can claim to be further along than it is. The counter is
              the only moving part and it is simply true. */}
          {generating ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span
                  data-testid="prep-elapsed"
                  style={{
                    fontSize: 15, fontWeight: 800, color: S.meaning.attention.ink,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {elapsed}s
                </span>
                <span style={{ fontSize: 14.5, color: S.text.muted }}>
                  This takes a few seconds. Leaving the page will lose it.
                </span>
              </div>
              <ul
                style={{
                  margin: "14px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6,
                  fontSize: 14.5, color: S.text.secondary, lineHeight: "21px",
                }}
              >
                <li>Reading the posting and what SIGNAL found</li>
                <li>Working out what they&apos;ll push on</li>
                <li>Drafting answers from your own experience, and nothing else</li>
              </ul>
            </div>
          ) : (
            <p style={{ fontSize: 14.5, color: S.text.muted, lineHeight: "22px", margin: "8px 0 0", maxWidth: 620 }}>
              We&apos;ll turn what SIGNAL already knows about this job into the questions you&apos;re most
              likely to get, and what to say about them, drawn from your own experience.
            </p>
          )}

          {genErr && (
            <p style={{ fontSize: 14, fontWeight: 700, color: S.meaning.error.ink, margin: "12px 0 0" }}>
              {genErr}
            </p>
          )}

          {/* WHY NOTHING CAME BACK, in the reader's terms. Two different causes
              that both leave no material, and they need different advice:
              telling someone with a gate-Passed run to rescore would be false,
              and telling someone with an empty saved analysis that they were
              Passed would be equally false. */}
          {noMaterial && (
            <p
              data-testid={`prep-no-material-${noMaterial}`}
              style={{ fontSize: 14.5, color: S.text.secondary, lineHeight: "22px", margin: "12px 0 0", maxWidth: 620 }}
            >
              {noMaterial === "gated_pass"
                ? "SIGNAL scored this one a Pass, so it saved no match evidence, and answers built on nothing would be worse than none. The checklist above still applies, and so does the playbook."
                : "The analysis saved for this job doesn't have the detail we build from. Score it again with the full posting and we'll have the material."}
            </p>
          )}

          {/* Every control goes while the build runs. A greyed-out button
              beside a live counter is two things saying the same thing, and the
              one action left is to wait. */}
          {!generating && (
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 18, flexWrap: "wrap" }}>
            {/* Once we know there is nothing to build from, the build button
                goes. Leaving it would invite a second press with a known
                outcome, which is how a button teaches someone it is broken. */}
            {!noMaterial && (
              <button
                onClick={() => void generate()}
                data-testid="prep-generate"
                style={{
                  ...actionStyle(S, "primary"), borderRadius: 11, padding: "11px 20px",
                  fontSize: 14.5, fontFamily: "inherit", cursor: "pointer",
                }}
              >
                Build my prep for this interview →
              </button>
            )}
            {noMaterial === "thin_run" && (
              <a
                href={JOBFIT_URL}
                style={{
                  ...actionStyle(S, "primary"), textDecoration: "none", display: "inline-block",
                  borderRadius: 11, padding: "11px 20px", fontSize: 14.5,
                }}
              >
                Score this job →
              </a>
            )}
            <button
              onClick={() => void openInSignal(app!.jobfit_run_id!)}
              style={{
                background: "none", border: "none", padding: 0,
                color: S.action.quietInk, fontSize: 14, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              See your full analysis →
            </button>
          </div>
          )}
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
        <a
          href={PLAYBOOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: S.action.quietInk, fontWeight: 700, textDecoration: "none" }}
        >
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
/** The sub-heading inside a generated block. Colour is set per use. */
const zoneLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase",
  marginBottom: 10,
}
