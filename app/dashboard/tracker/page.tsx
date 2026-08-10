"use client"

// Job Tracker — the shell: three views behind one tab strip.
//
// This replaces a single 1,494-line component that held four colour maps, seven
// metric tiles, a kanban toggle, two inline edit forms and an animated Insights
// dashboard. The work here was mostly SUBTRACTION, and the parts worth naming:
//
//   Insights tab GONE. Interview rate, average score, score distribution and
//   decision breakdown were student-facing metrics; the build plan moves them
//   to the coach side, where someone can act on a trend. A student staring at
//   their own 12% interview rate is not being helped.
//
//   The seven-tile metrics bar GONE, but its COUNTS survive on the status
//   chips inside Applications. The counts were navigation; the tiles were
//   scorekeeping.
//
//   The pipeline/kanban toggle GONE. Five columns by status is the same slice
//   the status chips give, in a layout that cannot show an action button or a
//   status dot at a readable size. Flagged rather than silent: nothing else was
//   reachable only through it.
//
//   The inline accordion GONE, replaced by /dashboard/tracker/[id]. Editing a
//   job inside a row meant a list that reflowed under the pointer and a detail
//   that could never grow. Every field it held is on the detail page.
//
// The tab lives in the URL (?view=interviews) so a tab is linkable, survives a
// refresh, and the browser Back button steps between views the way a student
// expects it to.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LIGHT as S } from "../../../lib/theme/surfaces"
import { authFetch } from "../network/authFetch"
import { openInSignal, JOBFIT_URL } from "./openInSignal"
import { daysUntil, parseLocalDate } from "../../../lib/localDate"
import { ApplicationsView } from "./ApplicationsView"
import { InterviewsView, type Interview } from "./InterviewsView"
import { HistoryView, type Run } from "./HistoryView"
import type { Application } from "./ApplicationCard"

const TABS = [
  { key: "applications", label: "Applications" },
  { key: "interviews", label: "Interviews" },
  { key: "history", label: "History" },
] as const

type TabKey = (typeof TABS)[number]["key"]

export default function TrackerPage() {
  return (
    // useSearchParams needs a Suspense boundary to prerender.
    <Suspense fallback={<Loading />}>
      <Tracker />
    </Suspense>
  )
}

function Loading() {
  return <p style={{ color: S.text.muted, fontSize: 14.5 }}>Loading your tracker…</p>
}

function Tracker() {
  const router = useRouter()
  const params = useSearchParams()
  const raw = params.get("view")
  const tab: TabKey = TABS.some((t) => t.key === raw) ? (raw as TabKey) : "applications"

  const [applications, setApplications] = useState<Application[]>([])
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [coachRecs, setCoachRecs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    // Four INDEPENDENT reads. A failure in any one leaves that section empty
    // rather than blanking the page: a student whose run history 500s should
    // still be able to work their applications.
    const [aRes, iRes, rRes, cRes] = await Promise.allSettled([
      authFetch("/api/applications"),
      authFetch("/api/interviews"),
      authFetch("/api/runs"),
      authFetch("/api/coach/my-recommendations"),
    ])

    async function body(r: PromiseSettledResult<Response>): Promise<any | null> {
      if (r.status !== "fulfilled" || !r.value.ok) return null
      return r.value.json().catch(() => null)
    }

    const [a, i, run, c] = await Promise.all([body(aRes), body(iRes), body(rRes), body(cRes)])
    if (a) setApplications(a.applications || [])
    else setError("We couldn't load your applications. Refresh to try again.")
    if (i) setInterviews(i.interviews || [])
    if (run) setRuns(run.runs || [])
    if (c) setCoachRecs(c.recommendations || [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // The Coaching Hub deep-links a single job as /dashboard/tracker?job=<id>.
  // That used to expand an inline accordion; the detail is now its own route,
  // so the link forwards to it. Handled here rather than in the hub so the old
  // link keeps working from anywhere it was saved or emailed.
  useEffect(() => {
    const job = params.get("job")
    if (job) router.replace(`/dashboard/tracker/${job}`)
  }, [params, router])

  function setTab(next: TabKey) {
    router.replace(next === "applications" ? "/dashboard/tracker" : `/dashboard/tracker?view=${next}`)
  }

  /** The soonest interview still ahead for a job. Drives Prep and the ordering. */
  const nextInterviewByApp = useMemo(() => {
    const m = new Map<string, string>()
    for (const iv of interviews) {
      if (!iv.interview_date || !iv.application_id) continue
      // Today counts as ahead. Parsed local, not UTC: see lib/localDate.ts.
      if ((daysUntil(iv.interview_date) ?? -1) < 0) continue
      const t = parseLocalDate(iv.interview_date)!.getTime()
      const held = m.get(iv.application_id)
      if (!held || t < parseLocalDate(held)!.getTime()) m.set(iv.application_id, iv.interview_date)
    }
    return m
  }, [interviews])

  const nextInterviewFor = useCallback(
    (a: Application) => nextInterviewByApp.get(a.id) ?? null,
    [nextInterviewByApp],
  )

  const trackedRunIds = useMemo(
    () => new Set(applications.map((a) => a.jobfit_run_id).filter(Boolean) as string[]),
    [applications],
  )

  // UNANSWERED ONLY. This used to include 'interested' as well, which is why
  // "Mark all seen" — which moved rows from 'new' to 'interested' — never
  // changed the count and never cleared the banner it belonged to. Filtering on
  // 'new' alone means the banner drains as the client answers each job, which
  // is the only behaviour that makes it honest as a prompt.
  const unanswered = coachRecs.filter((r) => r.client_status === "new")

  // Attribution comes from the UNANSWERED set, not from coachRecs[0]. Taking
  // the first recommendation's coach and applying it to all of them named the
  // wrong person as soon as a client had two coaches.
  const unansweredCoaches = [...new Set(unanswered.map((r) => r.coach_name).filter(Boolean))]
  const coachLabel =
    unansweredCoaches.length === 1 ? String(unansweredCoaches[0]) : "Your coaches"

  if (loading) return <Loading />

  return (
    <main style={{ maxWidth: 1080 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 26, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={active ? "page" : undefined}
              style={{
                background: active ? S.text.primary : S.card,
                color: active ? "#FFFFFF" : S.text.secondary,
                border: `1px solid ${active ? S.text.primary : S.borderSoft}`,
                borderRadius: 12, padding: "10px 22px", fontSize: 15, fontWeight: 800,
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: active ? "none" : S.shadow.card,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16, padding: "12px 16px", borderRadius: 12,
            background: S.meaning.error.fill, color: S.meaning.error.ink,
            fontSize: 14, fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}

      {tab === "applications" && (
        <ApplicationsView
          applications={applications}
          nextInterviewFor={nextInterviewFor}
          unanswered={unanswered}
          coachLabel={coachLabel}
          onCreated={load}
        />
      )}

      {tab === "interviews" && (
        // The whole list reloads on a status change: a round can move between
        // groups, so re-rendering one card would leave it under a heading that
        // no longer describes it.
        <InterviewsView interviews={interviews} onChanged={() => void load()} />
      )}

      {tab === "history" && (
        <HistoryView
          runs={runs}
          trackedRunIds={trackedRunIds}
          jobFitUrl={JOBFIT_URL}
          onView={openInSignal}
          onTracked={load}
        />
      )}
    </main>
  )
}
