"use client"

// Proof Project — the client-facing view of the engagement their coach flagged
// as the one that proves something.
//
// READ-ONLY, DELIBERATELY. There is no status control anywhere on this page.
// Completing a task stays in the Coaches Hub, and that separation is the reason
// this page can be built as a reward surface: if it could also be worked in, it
// would have to be honest about half-done things in a way that would flatten it
// back into a task list. You do the work there; you see what it added up to here.
//
// It sits on the DARK ground on purpose. The dashboard is mid-migration to the
// light theme route by route (LIGHT_ROUTES in ../../layout.tsx); this route is
// deliberately NOT added to that list, and should not be added later without
// redesigning the page — the whole visual idea is a lit surface in a dark room.
//
// Auth is the same client-bearer pattern as the rest of the hub. The real guard
// is /api/me/proof-project, which scopes to the caller's own profile: someone
// who guesses this URL sees the empty state, never an error and never another
// client's project.

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { T } from "../../../../lib/dashboard-theme"
import { ProofProjectKeyframes } from "./tokens"
import { Hero } from "./Hero"
import { JourneyMap } from "./JourneyMap"
import { Streak } from "./Streak"
import { DueCalendar } from "./DueCalendar"
import { PlanTree } from "./PlanTree"
import {
  allActivities, computeStreak, finalDueDate, progressOf, type ProofDeliverable,
} from "../../../../lib/proofProject"

type Project = {
  engagement_id: string
  name: string
  started_at: string
  deliverables: ProofDeliverable[]
  /** ISO timestamps of activity_completed events; the streak is derived here,
   *  in the viewer's own timezone. */
  completions: string[]
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

const wrap: React.CSSProperties = {
  maxWidth: 1080,
  margin: "0 auto",
  padding: "clamp(16px, 3vw, 30px)",
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div style={wrap}>
      <div
        style={{
          borderRadius: 16, padding: "28px 24px",
          background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: T.TEXT }}>{title}</h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: "21px", color: T.MUTED }}>{body}</p>
        <Link
          href="/dashboard/coaching-hub"
          style={{
            display: "inline-block", marginTop: 18, fontSize: 13.5, fontWeight: 800,
            color: T.WRN_ORANGE, textDecoration: "none",
          }}
        >
          ← Back to your Coaches Hub
        </Link>
      </div>
    </div>
  )
}

export default function ProofProjectPage() {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ONE `now` for the whole render tree, captured after mount. Reading
  // new Date() inside each child would let the countdown and the calendar
  // disagree across a midnight boundary, and would differ between the server
  // and client renders. Null until mounted, which is also what keeps the
  // date-dependent UI out of the first paint.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => { setNow(new Date()) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) { setError("Please sign in again."); return }
      const res = await fetch("/api/me/proof-project", { headers: { Authorization: `Bearer ${token}` } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setError(j?.error || `Couldn't load your proof project (${res.status})`)
        return
      }
      setProject(j.project ?? null)
    } catch {
      setError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading || !now) {
    return (
      <div style={wrap}>
        <div
          style={{
            height: 190, borderRadius: 20,
            background: T.CARD, border: `1px solid ${T.BORDER_SOFT}`,
          }}
          aria-busy="true"
          aria-label="Loading your proof project"
        />
      </div>
    )
  }

  if (error) return <Message title="We couldn't load this" body={error} />

  // Null covers all of: not coached, no flagged engagement, a flagged engagement
  // with no deliverables. They are one message on purpose — the client cannot
  // act on the difference, and naming it would leak how the coach's side works.
  if (!project) {
    return (
      <Message
        title="No proof project yet"
        body="When your coach sets one up, this is where you'll watch it come together."
      />
    )
  }

  const activities = allActivities(project.deliverables)
  const progress = progressOf(activities)
  const streak = computeStreak(project.completions, now)

  return (
    <div style={wrap}>
      <ProofProjectKeyframes />

      <Link
        href="/dashboard/coaching-hub"
        style={{
          display: "inline-block", marginBottom: 14, fontSize: 13,
          fontWeight: 700, color: T.MUTED, textDecoration: "none",
        }}
      >
        ← Coaches Hub
      </Link>

      <Hero
        name={project.name}
        progress={progress}
        finalDate={finalDueDate(project.deliverables)}
        now={now}
      />

      <JourneyMap deliverables={project.deliverables} />

      {/* Streak and calendar share a row on desktop and stack on a phone.
          minmax(0, …) rather than auto so the calendar's 7-column grid can
          shrink instead of forcing the page to scroll sideways. */}
      <div
        style={{
          marginTop: 26,
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
          alignItems: "start",
        }}
      >
        <Streak days={streak} />
        <DueCalendar deliverables={project.deliverables} now={now} />
      </div>

      <PlanTree deliverables={project.deliverables} />

      <p style={{ marginTop: 24, fontSize: 12, color: T.DIM, lineHeight: "18px" }}>
        This page is a view of your plan. To mark something done, head back to your{" "}
        <Link href="/dashboard/coaching-hub" style={{ color: T.MUTED, fontWeight: 700 }}>
          Coaches Hub
        </Link>
        .
      </p>
    </div>
  )
}
