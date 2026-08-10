"use client"

// One application, as a designed card. The same object language as ContactCard,
// applied to a job instead of a person, so a student reads both lists the same
// way without learning two visual systems:
//
//   rail     a 3px accent rail for a live job, none for a saved one. This is
//            the only place an application uses `accent` as structure
//   tile     structural navy for a live job, flat grey for a saved one
//   status   a dot plus text, both the meaning's ink. Never a button
//   action   filled peach when something is genuinely due (Prep / Follow up),
//            outline when it is available but not urgent (Apply on a saved
//            job), and nothing at all when the ball is in their court
//
// The whole card opens the application. The action is a SEPARATE click target
// that opens the same page; there is nothing an action does here that the
// detail page does not do better, and a card that half-acts is worse than one
// that takes you where the acting happens.
//
// NOT BUILT: the networking-presence indicator from the mockup (a contact count
// per card, or "none yet" when a student applied somewhere and networked nobody).
// It needs an application-to-company link that does not exist in the schema, and
// inventing one by matching company names would be guessing at the merge. That
// linkage is Phase B; the display drops in above the status once it lands.

import { useState } from "react"
import {
  LIGHT as S,
  status as statusStyle,
  action as actionStyle,
  tileIdle,
  tileStructural,
} from "../../../lib/theme/surfaces"
import { ProfileIcon } from "../../../components/icons"
import { formatShort } from "../../../lib/localDate"
import { statusLabel, statusMeaning, NEED_LABELS } from "./vocab"
import { COACH_SOURCED_LABEL, COACH_SOURCED_MEANING } from "../../../lib/coachRecommendations"
import { needOf, type TrackedApp } from "./applicationOrder"

export type Application = TrackedApp & {
  company_name: string
  job_title: string
  location: string | null
  signal_score: number | null
  signal_decision: string | null
  jobfit_run_id: string | null
  interview_count?: number
  /** People on the networking board at the linked company. 0 when unlinked. */
  contact_count?: number
  coach_annotations?: unknown[]
}

function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Via formatShort, which parses a bare date as LOCAL midnight. The naive
// `new Date("2026-07-21")` is UTC midnight and prints Jul 20 in the Americas.
const shortDate = (d: string | null) => formatShort(d) || null

/**
 * "Globex · applied Jul 28". The VERB changes with the status, because "applied"
 * on a job that was only ever saved is a small lie, and this line is the one
 * place the card says what happened rather than what state it is in.
 */
function subtitle(a: Application): string {
  const saved = a.application_status === "saved"
  const when = shortDate(saved ? a.created_at : a.applied_date || a.created_at)
  const verb = saved ? "saved" : "applied"
  return [a.company_name, when ? `${verb} ${when}` : null].filter(Boolean).join(" · ")
}

export function ApplicationCard({
  application: a,
  nextInterviewAt = null,
  fromCoach = false,
}: {
  application: Application
  /** The soonest upcoming interview for this job, if any. Drives Prep. */
  nextInterviewAt?: string | null
  /**
   * A coach sourced this job. Passed in rather than derived here: the fact
   * lives in coach_job_recommendations, which this card never loads and the
   * tracker page already holds in memory for the banner.
   */
  fromCoach?: boolean
}) {
  const [hover, setHover] = useState(false)

  const meaning = statusMeaning(a.application_status)
  // Two different reasons to recede, one appearance. A SAVED job has not
  // started; a rejected or withdrawn one has finished. Neither is live, and a
  // dead job that still lifts off the page and carries a coloured rail competes
  // with the interview on Thursday, which is the exact failure this ordering
  // exists to fix.
  const closed = a.application_status === "rejected" || a.application_status === "withdrawn"
  const idle = a.application_status === "saved" || closed
  const st = statusStyle(S, meaning)
  const coachSt = statusStyle(S, COACH_SOURCED_MEANING)
  const href = `/dashboard/tracker/${a.id}`

  const need = needOf(a, nextInterviewAt)
  const label = NEED_LABELS[need] ?? null
  // Prep and Follow up are things that are DUE, so they take the filled tier.
  // Apply is a real next step on a job nobody has sent, which is the outline
  // tier, exactly as "Start" is on a contact nobody has written to.
  const tier: "primary" | "optional" | null =
    need === "prep" || need === "followup" ? "primary" : need === "apply" ? "optional" : null

  return (
    <div
      data-testid="application-card"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 18px",
        borderRadius: 14,
        background: idle ? "#FBFDFE" : S.card,
        border: `1px solid ${S.borderSoft}`,
        // The rail is the fastest read on the list: colour on the left edge
        // says "this one is live" before any word is parsed. A saved job keeps
        // the same inset through a transparent border so nothing shifts.
        borderLeft: `3px solid ${idle ? "transparent" : S.meaning[meaning].accent}`,
        boxShadow: idle ? "none" : hover ? S.shadow.raised : S.shadow.card,
        transition: "box-shadow 160ms ease",
      }}
    >
      <a
        href={href}
        aria-label={`${a.job_title} at ${a.company_name}`}
        style={{ display: "flex", alignItems: "center", gap: 16, flex: 1, minWidth: 0, textDecoration: "none" }}
      >
        <span
          aria-hidden="true"
          style={{
            ...(idle ? tileIdle(S) : tileStructural(S)),
            width: 46, height: 46, borderRadius: 12, flexShrink: 0,
            display: "grid", placeItems: "center",
            fontSize: 14, fontWeight: 800, letterSpacing: 0.5,
          }}
        >
          {initials(a.company_name)}
        </span>

        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block", fontSize: 16, fontWeight: 800,
              color: idle ? S.text.secondary : S.text.primary,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {a.job_title}
          </span>
          <span
            style={{
              display: "block", fontSize: 13.5, color: S.text.muted, marginTop: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {subtitle(a)}
          </span>

          {/* WHERE THIS JOB CAME FROM. Silent on every job the student added
              themselves, which is most of them — 126 of 1,039 on production.
              A marker that appears on nearly every row says nothing.

              ONE SIGNAL, deliberately. The pre-2026-08-04 tracker carried
              three for this same fact: a teal "⚡ From {coach}" pill, a teal
              row tint, and a left border coloured by the coach's priority.
              Three treatments for one bit of information, and the priority
              border in particular competed with the status colour beside it.

              Dot-and-text, the row's existing convention for state, in the
              coral `attention` meaning — a job your coach picked out is
              something to look at. NOT peach: peach is action and only
              action, and it is not reachable through `meaning` at all. It is
              also not the coach's NAME — that is on the response box and the
              banner, and repeating it on every row is noise once you know who
              your coach is. */}
          {fromCoach && (
            <span
              data-testid="from-coach"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 5 }}
            >
              <span style={coachSt.dot} />
              <span style={{ ...coachSt.text, fontSize: 13 }}>{COACH_SOURCED_LABEL}</span>
            </span>
          )}
        </span>
      </a>

      {/* PEOPLE AT THIS COMPANY. Silent unless there are some: no company_id
          on the application, or nobody at the company, and the row says
          nothing. On day one that is nearly every row, which is the point.
          A badge that appears on almost nothing means the ones carrying it
          are worth a look.

          Not a link and not a button. The whole row already opens the
          application, where the contacts are listed by name, and a nested
          control would compete with that. The row is a glance. */}
      {(a.contact_count ?? 0) > 0 && (
        <span
          data-testid="contact-count"
          title={`${a.contact_count} ${a.contact_count === 1 ? "person" : "people"} you know here`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
            fontSize: 13.5, fontWeight: 800, color: S.text.muted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {/* ProfileIcon, not NetworkIcon, and the browser check is why.
              NetworkIcon is a four-node graph with connecting lines on a 64
              viewBox; at row scale each node is about 2.5px and the whole mark
              reads as a coloured smudge, at 22px as much as at 18px.
              ProfileIcon is one figure on a disc and survives the reduction.
              It is also ALREADY the Contacts icon in the sidebar at 17px
              (app/dashboard/layout.tsx), so it already means "people" here and
              is proven at this size. */}
          <ProfileIcon size={18} />
          {a.contact_count}
        </span>
      )}

      {/* The score, when this job was scored. Quiet by design: it is a fact
          about the job, not a state of the application, so it sits before the
          status rather than competing with it. */}
      {a.signal_score != null && (
        <span
          title={a.signal_decision ? `SIGNAL: ${a.signal_decision}` : undefined}
          style={{
            fontSize: 14, fontWeight: 800, color: S.text.dim,
            flexShrink: 0, fontVariantNumeric: "tabular-nums",
          }}
        >
          {a.signal_score}
        </span>
      )}

      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
        <span style={st.dot} />
        <span style={{ ...st.text, fontSize: 14.5, whiteSpace: "nowrap" }}>
          {statusLabel(a.application_status)}
        </span>
      </span>

      {/* minWidth, not width. Same lesson the contact card learned: a fixed
          slot is narrower than "Follow up" plus padding, and a button that
          cannot wrap overflows leftwards onto the status text. */}
      <span style={{ minWidth: 108, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
        {tier && label ? (
          <a
            href={href}
            style={{
              ...actionStyle(S, tier),
              textDecoration: "none", fontSize: 13.5, padding: "9px 16px",
              borderRadius: 10, whiteSpace: "nowrap",
            }}
          >
            {label}
          </a>
        ) : (
          // No action means no button, never a disabled one. "waiting" is only
          // true of a live job whose ball is in the company's court. An OFFER
          // is not waiting, it arrived; a closed job is not waiting, it ended.
          // Both say nothing, which is the third tier working as designed.
          !closed && a.application_status !== "offer" && (
            <span style={{ fontSize: 13.5, color: S.text.dim, fontStyle: "italic" }}>waiting</span>
          )
        )}
      </span>
    </div>
  )
}
