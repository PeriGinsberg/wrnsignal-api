"use client"

// Interviews: every round across every job, gathered.
//
// SPLIT BY TIME, not by status filter. The old view had a filter row (all /
// scheduled / awaiting feedback / offer extended) which asked the student to
// pick a status before it would tell them anything. But there is only ever one
// question here, "what is coming up", and the answer is a date. So the view
// splits itself: what is ahead, then what has happened. The status still shows
// on every completed card, it just is not the organising idea.
//
// The soonest upcoming round takes the navy hero with the peach frame, the same
// treatment the Dashboard and the application detail page give an interview.
// One interview treatment, three places, so a student recognises it instantly.

import { LIGHT as S, action as actionStyle, status as statusStyle, surfaceCard } from "../../../lib/theme/surfaces"
import { InterviewIcon } from "../../../components/icons"
import { daysUntil, formatMedium, parseLocalDate } from "../../../lib/localDate"
import { interviewStageLabel, interviewStatusLabel, interviewStatusMeaning } from "./vocab"

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

/** Ahead of today, inclusive: an interview later today is still coming up. */
export function isUpcoming(iv: Interview, now: Date = new Date()): boolean {
  const until = daysUntil(iv.interview_date, now)
  return until !== null && until >= 0
}

function countdown(dateStr: string, now: Date = new Date()): string {
  const days = daysUntil(dateStr, now) ?? 0
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  return `In ${days} days`
}

/** Local-midnight parse, so a date-only value shows the day it says. */
const longDate = (d: string | null) => formatMedium(d)

export function InterviewsView({ interviews }: { interviews: Interview[] }) {
  const upcoming = interviews
    .filter((iv) => isUpcoming(iv))
    .sort((a, b) => (parseLocalDate(a.interview_date)?.getTime() ?? 0) - (parseLocalDate(b.interview_date)?.getTime() ?? 0))
  const past = interviews.filter((iv) => !isUpcoming(iv))

  const subtitle =
    interviews.length === 0
      ? "No interviews logged yet."
      : [
          upcoming.length ? `${upcoming.length} coming up` : null,
          past.length ? `${past.length} you've completed` : null,
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
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {upcoming.map((iv) => <UpcomingCard key={iv.id} interview={iv} />)}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <SectionLabel>Completed</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {past.map((iv) => <PastCard key={iv.id} interview={iv} />)}
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
function UpcomingCard({ interview: iv }: { interview: Interview }) {
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
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ color: S.hero.accent, fontSize: 17, fontWeight: 800 }}>
            {countdown(iv.interview_date!)}
          </div>
          <div style={{ color: S.hero.muted, fontSize: 13.5, marginTop: 2 }}>
            {longDate(iv.interview_date)}
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
      </div>
    </section>
  )
}

function PastCard({ interview: iv }: { interview: Interview }) {
  const st = statusStyle(S, interviewStatusMeaning(iv.status))
  return (
    <a
      href={`/dashboard/tracker/${iv.application_id}`}
      style={{
        ...surfaceCard(S),
        display: "flex", alignItems: "center", gap: 16,
        padding: "14px 18px", borderRadius: 14, textDecoration: "none",
      }}
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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
        <span style={st.dot} />
        <span style={{ ...st.text, fontSize: 14.5, whiteSpace: "nowrap" }}>
          {interviewStatusLabel(iv.status)}
        </span>
      </span>
    </a>
  )
}
