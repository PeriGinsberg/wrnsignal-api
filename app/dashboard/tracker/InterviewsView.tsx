"use client"

// Interviews: every round across every job, gathered.
//
// THE VIEW SPLITS ITSELF — no filter row. The original had one (all / scheduled
// / awaiting feedback / offer extended) which asked the student to pick a status
// before it would tell them anything, and that was right to remove.
//
// It was replaced by a split on DATE ALONE, and that went too far the other way.
// Status is still an editable control on every card, so when a tester set a
// round to "Awaiting feedback" she reasonably expected it to move. It could not:
// membership was decided purely by whether the date had passed, and nothing said
// so. A control that looks consequential and is not is its own bug.
//
// So the split is now date AND status, in three groups:
//
//   Coming up      not yet happened — a future date, or no date set yet
//   Waiting to hear it happened, or you said you are awaiting feedback, and
//                  there is no outcome recorded
//   Completed      a terminal status: offer, no offer, or no answer
//
// Terminal status wins over the date: a rejection is finished whether or not the
// interview date has passed. And an interview with NO DATE is "coming up", not
// completed — it used to file under Completed because daysUntil(null) is null,
// so a round whose status was literally not_scheduled showed as done.
//
// The soonest upcoming round takes the navy hero with the peach frame, the same
// treatment the Dashboard and the application detail page give an interview.
// One interview treatment, three places, so a student recognises it instantly.

import { LIGHT as S, action as actionStyle, status as statusStyle, surfaceCard } from "../../../lib/theme/surfaces"
import { InterviewIcon } from "../../../components/icons"
import { daysUntil, formatMedium, parseLocalDate } from "../../../lib/localDate"
import { INTERVIEW_STATUSES, interviewStageLabel, interviewStatusLabel, interviewStatusMeaning } from "./vocab"
import { authFetch } from "../network/authFetch"
import { useState } from "react"

export type Interview = {
  id: string
  application_id: string
  company_name: string | null
  job_title: string | null
  interview_stage: string
  interview_date: string | null
  status: string
  interviewer_names: string | null
  notes: string | null
  thank_you_sent: boolean | null
}

export type InterviewGroup = "coming_up" | "waiting" | "completed"

/** Statuses that END a round. An outcome is an outcome whatever the date says. */
const TERMINAL: ReadonlySet<string> = new Set(["offer_extended", "rejected", "ghosted"])

/**
 * Which of the three groups a round belongs to.
 *
 * Order of the checks is the whole logic, so it is written as one function
 * rather than three filters that could drift apart:
 *
 *   1. terminal status beats everything, including a future date
 *   2. awaiting_feedback is the student SAYING it happened — believe them over
 *      the calendar. This is the case that produced the bug report
 *   3. no date at all is "coming up": it has not happened, it just is not booked
 *   4. otherwise the date decides, today inclusive
 */
export function groupOf(iv: Interview, now: Date = new Date()): InterviewGroup {
  if (TERMINAL.has(iv.status)) return "completed"
  if (iv.status === "awaiting_feedback") return "waiting"
  const until = daysUntil(iv.interview_date, now)
  if (until === null) return "coming_up"
  return until >= 0 ? "coming_up" : "waiting"
}

/**
 * SET THE STATUS WHERE THE STATUS IS SHOWN.
 *
 * This screen is called "Your interviews", groups itself by status, and until
 * now could only DISPLAY it — the control lived two levels down on the job
 * page, behind a row whose label said "Edit". A tester looked for "Awaiting
 * feedback" here, did not find it, and both interview tests were blocked on a
 * field that exists.
 *
 * DUPLICATION, DELIBERATELY, and of the right kind: one full editor on the job
 * page (date, time, interviewer, format, confidence — none of which belong on a
 * summary card) and one inline control here, both writing signal_interviews
 * .status through the same PUT. That mirrors application_status, which already
 * appears on the tracker row and in the job detail. The kind worth avoiding is
 * two controls that BEHAVE differently — which is what "one screen shows it and
 * another sets it" already was.
 */
function StatusControl({ interview: iv, onChanged, tone }: {
  interview: Interview
  onChanged: () => void
  /** The hero card sits on navy; the compact card on white. */
  tone: "hero" | "plain"
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)

  async function set(status: string) {
    if (status === iv.status || busy) return
    setBusy(true); setErr(false)
    try {
      const res = await authFetch(`/api/interviews/${iv.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error("failed")
      // The whole LIST reloads, not this card: a status change can move a round
      // into a different group, and re-rendering one card in place would leave
      // it sitting under a heading that no longer describes it.
      onChanged()
    } catch {
      setErr(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <select
        value={iv.status}
        disabled={busy}
        aria-label={`Status for ${interviewStageLabel(iv.interview_stage)}${iv.company_name ? ` at ${iv.company_name}` : ""}`}
        onChange={(e) => void set(e.target.value)}
        style={{
          fontSize: 13, fontWeight: 700, fontFamily: "inherit", borderRadius: 8,
          padding: "5px 9px", cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          background: tone === "hero" ? "rgba(255,255,255,0.12)" : S.card,
          color: tone === "hero" ? S.hero.ink : S.text.primary,
          border: `1px solid ${tone === "hero" ? "rgba(255,255,255,0.28)" : S.border}`,
        }}
      >
        {INTERVIEW_STATUSES.map((v) => (
          <option key={v} value={v} style={{ color: S.text.primary }}>{interviewStatusLabel(v)}</option>
        ))}
      </select>
      {err && <span style={{ fontSize: 12, color: S.meaning.error.ink }}>Didn&apos;t save</span>}
    </span>
  )
}

function countdown(dateStr: string, now: Date = new Date()): string {
  const days = daysUntil(dateStr, now) ?? 0
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `In ${days} days`
}

/** Local-midnight parse, so a date-only value shows the day it says. */
const longDate = (d: string | null) => formatMedium(d)

export function InterviewsView({ interviews, onChanged }: {
  interviews: Interview[]
  /** Reload the whole list. A status change can move a round between groups. */
  onChanged: () => void
}) {
  // Soonest first. An undated round sorts LAST inside "Coming up" rather than
  // first: the hero treatment belongs to the next real interview, and a card
  // with no date has no countdown to put in it.
  const upcoming = interviews
    .filter((iv) => groupOf(iv) === "coming_up")
    .sort((a, b) => {
      const at = parseLocalDate(a.interview_date)?.getTime()
      const bt = parseLocalDate(b.interview_date)?.getTime()
      if (at === undefined) return bt === undefined ? 0 : 1
      if (bt === undefined) return -1
      return at - bt
    })
  // Most recent first: the round you are most likely chasing is the last one you
  // sat. Undated cannot reach this group, so the fallback is only a tiebreak.
  const waiting = interviews
    .filter((iv) => groupOf(iv) === "waiting")
    .sort((a, b) => (parseLocalDate(b.interview_date)?.getTime() ?? 0) - (parseLocalDate(a.interview_date)?.getTime() ?? 0))
  const completed = interviews.filter((iv) => groupOf(iv) === "completed")

  const subtitle =
    interviews.length === 0
      ? "No interviews logged yet."
      : [
          upcoming.length ? `${upcoming.length} coming up` : null,
          waiting.length ? `${waiting.length} waiting to hear` : null,
          completed.length ? `${completed.length} completed` : null,
        ].filter(Boolean).join(", ") + "."

  return (
    <>
      <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0 }}>
        Your interviews
      </h1>
      <p style={{ color: S.text.muted, fontSize: 15, margin: "6px 0 0" }}>{subtitle}</p>

      {upcoming.length > 0 && (
        <>
          <SectionLabel>Coming up</SectionLabel>
          <div data-testid="group-coming_up" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {upcoming.map((iv) => <UpcomingCard key={iv.id} interview={iv} onChanged={onChanged} />)}
          </div>
        </>
      )}

      {/* The group the bug report was really about: it happened, or you said it
          did, and there is no outcome yet. Same compact card as Completed —
          what differs is what it is claiming, not how it looks. */}
      {waiting.length > 0 && (
        <>
          <SectionLabel>Waiting to hear</SectionLabel>
          <div data-testid="group-waiting" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {waiting.map((iv) => <PastCard key={iv.id} interview={iv} onChanged={onChanged} />)}
          </div>
        </>
      )}

      {completed.length > 0 && (
        <>
          <SectionLabel>Completed</SectionLabel>
          <div data-testid="group-completed" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {completed.map((iv) => <PastCard key={iv.id} interview={iv} onChanged={onChanged} />)}
          </div>
        </>
      )}

      {interviews.length === 0 && (
        <div
          style={{
            textAlign: "center", padding: "44px 24px", marginTop: 20, borderRadius: 14,
            border: `1px dashed ${S.border}`, background: "rgba(255,255,255,0.5)",
          }}
        >
          <InterviewIcon size={34} style={{ margin: "0 auto 12px" }} />
          <div style={{ color: S.text.secondary, fontSize: 16, fontWeight: 700 }}>
            No interviews yet.
          </div>
          <p style={{ color: S.text.muted, fontSize: 14.5, margin: "8px auto 0", maxWidth: 440 }}>
            When you land one, add it from the job in your tracker and it will show up here with a
            countdown.
          </p>
        </div>
      )}
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
        color: S.text.muted, margin: "26px 0 12px",
      }}
    >
      {children}
    </div>
  )
}

/**
 * The navy hero with the peach frame. Peach as a BORDER, not a surface, is the
 * one place it appears outside a button: it reads as emphasis on something
 * time-bound rather than as a thing to press, and the only pressable object
 * inside is still the peach button.
 */
function UpcomingCard({ interview: iv, onChanged }: { interview: Interview; onChanged: () => void }) {
  return (
    <section
      style={{
        background: S.hero.background,
        border: `2px solid ${S.meaning.attention.accent}`,
        borderRadius: 16, padding: "22px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 48, height: 48, borderRadius: 13, flexShrink: 0,
              background: "rgba(255,255,255,0.10)", display: "grid", placeItems: "center",
            }}
          >
            <InterviewIcon size={26} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: S.hero.ink, fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>
              {iv.job_title || "Interview"}{iv.company_name ? ` at ${iv.company_name}` : ""}
            </div>
            <div style={{ color: S.hero.muted, fontSize: 14, marginTop: 3 }}>
              {interviewStageLabel(iv.interview_stage)}
              {iv.interviewer_names ? ` · with ${iv.interviewer_names}` : ""}
            </div>
          </div>
        </div>
        {/* A round with no date reaches this card now — it belongs in "Coming
            up" because it has not happened, and it used to file under Completed
            because daysUntil(null) is null. There is no countdown to show, so
            it says what is actually true and what to do about it.
            "NO DATE YET", not "Not scheduled yet". This slot is about the DATE,
            and the status control beside it owns the word "scheduled" — an
            interview can be status `scheduled` with no date agreed, and the two
            saying "Not scheduled yet" and "Scheduled" on one card is a
            contradiction the card cannot resolve. The collision only became
            visible once the status control moved onto this screen. */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ color: S.hero.accent, fontSize: 17, fontWeight: 800 }}>
            {iv.interview_date ? countdown(iv.interview_date) : "No date yet"}
          </div>
          <div style={{ color: S.hero.muted, fontSize: 13.5, marginTop: 2 }}>
            {iv.interview_date ? longDate(iv.interview_date) : "Add a date when you have one"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
        {/* Prep now goes to the INTERVIEW, not the application. The two answer
            different questions: the application page is about the job, Prep Now
            is about the conversation. "See the job" below still goes to the
            application, which is where it belongs. */}
        <a
          href={`/dashboard/tracker/interviews/${iv.id}`}
          style={{
            ...actionStyle(S, "primary"), textDecoration: "none",
            borderRadius: 11, padding: "11px 20px", fontSize: 14.5,
          }}
        >
          Prep now →
        </a>
        <a
          href={`/dashboard/tracker/${iv.application_id}`}
          style={{
            color: S.hero.link, fontSize: 14, fontWeight: 700, textDecoration: "none",
            padding: "11px 4px",
          }}
        >
          See the job
        </a>
        {/* The hero already carries a countdown and two links; the status sits
            at the end of that row rather than competing with the date above.
            It is the only control on this card that is not navigation. */}
        <span style={{ marginLeft: "auto" }}>
          <StatusControl interview={iv} onChanged={onChanged} tone="hero" />
        </span>
      </div>
    </section>
  )
}

function PastCard({ interview: iv, onChanged }: { interview: Interview; onChanged: () => void }) {
  const st = statusStyle(S, interviewStatusMeaning(iv.status))
  return (
    // THE CARD IS NO LONGER ONE BIG LINK. It was an <a> wrapping everything,
    // and a <select> inside a link navigates the moment you touch it — the
    // control would have been unusable rather than merely hidden. The anchor
    // now wraps only the part that IS a link, which is also the correct markup:
    // an interactive control nested inside an anchor is invalid HTML.
    <div
      style={{
        ...surfaceCard(S),
        display: "flex", alignItems: "center", gap: 16,
        padding: "14px 18px", borderRadius: 14,
      }}
    >
    <a
      href={`/dashboard/tracker/${iv.application_id}`}
      style={{ display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0, textDecoration: "none" }}
    >
      <span
        aria-hidden
        style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: S.meaning.idle.fill, display: "grid", placeItems: "center",
        }}
      >
        <InterviewIcon size={22} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block", fontSize: 15.5, fontWeight: 800, color: S.text.primary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {iv.job_title || "Interview"}{iv.company_name ? ` at ${iv.company_name}` : ""}
        </span>
        <span style={{ display: "block", fontSize: 13.5, color: S.text.muted, marginTop: 2 }}>
          {interviewStageLabel(iv.interview_stage)}
          {iv.interview_date ? ` · ${longDate(iv.interview_date)}` : ""}
        </span>
      </span>
    </a>
      {/* Outside the anchor: the status dot stays as the at-a-glance read, the
          select is the control. */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
        <span style={st.dot} />
        <StatusControl interview={iv} onChanged={onChanged} tone="plain" />
      </span>
    </div>
  )
}
