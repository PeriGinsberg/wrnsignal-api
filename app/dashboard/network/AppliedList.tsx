"use client"

// The applications at one company, as lines.
//
// SHARED PRESENTATION, TWO CALLERS. The contact record asks "have I applied
// here" right above the send panel; the company card asks the same thing while
// you are looking at the company. Same question, same answer, so the same
// component, because the two things that would otherwise drift are the ones
// that matter: which status vocabulary is used, and whether the date shown is
// applied_date or created_at.
//
// FETCHING IS THE CALLER'S JOB, deliberately. The contact record loads on
// mount because the answer changes what you are about to write. The company
// card loads on first EXPAND, folded into the pass that already fetches its
// contacts, because a board can hold many companies and most are never opened.
// One component with a fetch inside it could not do both.

import { LIGHT as S, status as statusStyle } from "../../../lib/theme/surfaces"
import { statusLabel, statusMeaning } from "../tracker/vocab"
import { formatShort } from "../../../lib/localDate"

/** Exactly the columns GET /api/applications?company_id= returns. */
export type ScopedApp = {
  id: string
  company_name: string
  job_title: string
  application_status: string
  applied_date: string | null
  signal_score: number | null
  signal_decision: string | null
  created_at: string
}

export function AppliedList({ applications }: { applications: ScopedApp[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {applications.map((a) => {
        const st = statusStyle(S, statusMeaning(a.application_status))
        // applied_date is the honest date and is null until they actually
        // applied. created_at is when our row appeared, which is a fact about
        // us rather than about them, so it is never shown here.
        const when = a.applied_date ? formatShort(a.applied_date) : null
        return (
          <div key={a.id} style={line}>
            {/* A LINK THAT LOOKS LIKE ONE. It was 14.5px bold with no underline,
                which at that weight reads as a heading you happen to be able to
                click; three of them stacked read as a list of records rather
                than as somewhere to go. Underlined, one size down, normal
                weight: this is reference, not the subject of the page. */}
            <a href={`/dashboard/tracker/${a.id}`} style={link}>
              {a.job_title || "Untitled role"}
            </a>
            {/* The status keeps its meaning colour and LOSES ITS DOT. The dot
                plus label is the tracker's treatment, where status is the thing
                being managed; here it is trailing context on a reference line,
                and at 12.5px a coloured disc beside it is just noise. The words
                still come from the tracker's own vocabulary so the two surfaces
                cannot disagree. */}
            <span style={{ ...meta, color: st.text.color }}>
              {statusLabel(a.application_status)}
            </span>
            {when && <span style={meta}>{when}</span>}
          </div>
        )
      })}
    </div>
  )
}

// Middots between the parts, so the row reads as one sentence rather than three
// columns that happen to be adjacent.
const line: React.CSSProperties = {
  display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap",
  fontSize: 13, lineHeight: "19px",
}
const link: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: S.action.quietInk,
  textDecoration: "underline", textUnderlineOffset: 2, minWidth: 0,
}
const meta: React.CSSProperties = {
  fontSize: 12.5, color: S.text.muted, whiteSpace: "nowrap",
}

/** "a job" reads better than "1 jobs", and the count is the point of the line. */
export function appliedHeadline(count: number, companyName: string): string {
  return count === 1
    ? `You've applied to a job at ${companyName}.`
    : `You've applied to ${count} jobs at ${companyName}.`
}
