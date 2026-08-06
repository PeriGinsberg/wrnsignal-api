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
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {applications.map((a) => {
        const st = statusStyle(S, statusMeaning(a.application_status))
        // applied_date is the honest date and is null until they actually
        // applied. created_at is when our row appeared, which is a fact about
        // us rather than about them, so it is never shown here.
        const when = a.applied_date ? formatShort(a.applied_date) : null
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <a
              href={`/dashboard/tracker/${a.id}`}
              style={{
                fontSize: 14.5, fontWeight: 700, color: S.action.quietInk,
                textDecoration: "none", minWidth: 0,
              }}
            >
              {a.job_title || "Untitled role"}
            </a>
            {/* Status is a dot plus text, never a button, and the words come
                from the tracker's own vocabulary so they cannot say one thing
                here and another on the tracker itself. */}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
              <span style={st.dot} />
              <span style={{ ...st.text, fontSize: 13.5, whiteSpace: "nowrap" }}>
                {statusLabel(a.application_status)}
              </span>
            </span>
            {when && <span style={{ fontSize: 13, color: S.text.muted, whiteSpace: "nowrap" }}>{when}</span>}
          </div>
        )
      })}
    </div>
  )
}

/** "a job" reads better than "1 jobs", and the count is the point of the line. */
export function appliedHeadline(count: number, companyName: string): string {
  return count === 1
    ? `You've applied to a job at ${companyName}.`
    : `You've applied to ${count} jobs at ${companyName}.`
}
