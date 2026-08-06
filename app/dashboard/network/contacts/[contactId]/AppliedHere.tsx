"use client"

// What you have already applied to at this contact's company.
//
// THE PAYOFF OF THE COMPANY LINK, and the reason it sits directly above the
// send panel rather than in a drawer. Someone about to write to a person at
// Globex needs to know they applied to two roles there last week, because it
// changes the message: it is the difference between "I am interested in your
// team" and "I applied for the Operations Analyst role on Tuesday". Learning
// that after sending is learning it too late.
//
// READ ONLY. No buttons. The one action on this screen is still sending the
// message, and a second action here would compete with it. Status is a dot
// plus text, per the colour rules; nothing here is clickable except the job
// title, which is a link back to the application.
//
// RENDERS NOTHING WHEN THERE ARE NO APPLICATIONS. Not having applied is the
// normal state, and often the whole reason for networking, so saying "you have
// not applied here" on every contact would be clutter that means nothing.
//
// BUT IT DOES SPEAK UP WHEN THE CHECK FAILS. A failed read looks identical to
// "no applications" if it is swallowed, and that silence would hide exactly the
// fact this component exists to surface. So a failure says so in one line.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { AppliedList, appliedHeadline, type ScopedApp } from "../../AppliedList"

export function AppliedHere({
  companyId, companyName,
}: {
  companyId: string
  companyName: string
}) {
  const [apps, setApps] = useState<ScopedApp[]>([])
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      // The scoped read: eight columns, not select("*") with the whole pasted
      // job description attached. See COMPANY_SCOPED_COLUMNS in
      // app/api/applications/route.ts.
      const res = await authFetch(`/api/applications?company_id=${encodeURIComponent(companyId)}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error("lookup failed")
      setApps(j.applications ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  // Nothing at all until the answer is known, so the panel does not appear and
  // then vanish under the reader's eye as they start writing.
  if (!loaded) return null

  if (failed) {
    return (
      <p style={{ fontSize: 13.5, color: S.text.muted, margin: "14px 0 0" }}>
        We couldn&apos;t check whether you&apos;ve applied at {companyName}.
      </p>
    )
  }

  if (apps.length === 0) return null

  return (
    <section
      data-testid="applied-here"
      style={{
        marginTop: 16, paddingLeft: 14,
        borderLeft: `3px solid ${S.meaning.replied.accent}`,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 800, color: S.text.primary, lineHeight: "22px" }}>
        {appliedHeadline(apps.length, companyName)}
      </div>

      <div style={{ marginTop: 9 }}>
        <AppliedList applications={apps} />
      </div>
    </section>
  )
}
