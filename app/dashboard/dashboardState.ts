// Which of the five dashboard states a student is in, and the numbers that
// state needs. Pure: everything in, one answer out, so the decision can be
// tested without a browser or a database.
//
// The Dashboard is HOME and the single "what needs you" surface, so it ADAPTS
// rather than showing everything at once. Ruthless prioritisation: one or two
// things, never a wall.
//
// PRIORITY ORDER, and why it is this order:
//   1. new        profile incomplete. Nothing else works without it: scoring,
//                 the outreach drafts, all of it reads the profile. So it
//                 outranks even an interview, because a half-set-up account
//                 cannot prep properly either.
//   2. interview  a scheduled interview with a date ahead. Time-bound and the
//                 highest-stakes thing on the calendar, so it takes the top.
//   3. ready      profile done, nothing tracked yet. The get-started state.
//   4. quiet      real data, but nothing due and nothing touched in a week.
//                 Re-engagement, warm and without guilt.
//   5. active     the normal working state.
//
// `active` is last as the FALLTHROUGH, not because it is least important. Every
// state above it is a specific situation; active is "you are just working".

const DAY = 86400000

export type DashboardState = "new" | "interview" | "ready" | "quiet" | "active"

export type ProfileLike = {
  name?: string | null
  resume_text?: string | null
  target_roles?: string | null
  target_locations?: string | null
  timeline?: string | null
  profile_complete?: boolean | null
}

export type AppLike = {
  id: string
  application_status?: string | null
  applied_date?: string | null
  created_at?: string | null
  company_name?: string | null
  job_title?: string | null
}

export type ContactLike = {
  id: string
  first_name?: string | null
  last_name?: string | null
  stage?: string | null
  next_due_at?: string | null
  next_due_reason?: string | null
  last_action_at?: string | null
  network_companies?: { name: string } | null
}

export type InterviewLike = {
  id: string
  interview_date?: string | null
  status?: string | null
  interview_stage?: string | null
  company_name?: string | null
  job_title?: string | null
}

/** The five fields the profile gate checks, in the order a student fills them. */
export const PROFILE_FIELDS: (keyof ProfileLike)[] = [
  "name", "resume_text", "target_roles", "target_locations", "timeline",
]

/**
 * How complete the profile is, 0 to 100.
 *
 * Deliberately NOT the same as `profile_complete`, which is a boolean over four
 * required fields. A percentage needs something to move, so it counts five
 * including timeline: a student who has done four of five should see 80% and one
 * field left, not "incomplete" with no sense of how close they are.
 */
export function profileCompletion(p: ProfileLike | null): { percent: number; missing: number } {
  if (!p) return { percent: 0, missing: PROFILE_FIELDS.length }
  const filled = PROFILE_FIELDS.filter((f) => {
    const v = p[f]
    return typeof v === "string" ? v.trim().length > 0 : Boolean(v)
  }).length
  return {
    percent: Math.round((filled / PROFILE_FIELDS.length) * 100),
    missing: PROFILE_FIELDS.length - filled,
  }
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Contacts the engine says are on the student now: due today or overdue. */
export function contactsDue(contacts: ContactLike[], now: Date): ContactLike[] {
  const today = startOfDay(now)
  return contacts.filter((c) => {
    if (!c.next_due_at) return false
    return startOfDay(new Date(c.next_due_at)) <= today
  })
}

/** Applied two or more weeks ago and still sitting at `applied`. */
export function staleApplications(apps: AppLike[], now: Date): AppLike[] {
  return apps.filter((a) => {
    if (a.application_status !== "applied") return false
    const when = a.applied_date || a.created_at
    if (!when) return false
    return now.getTime() - new Date(when).getTime() >= 14 * DAY
  })
}

/** Saved but never applied to. The other real application-side nudge. */
export function savedNotApplied(apps: AppLike[]): AppLike[] {
  return apps.filter((a) => a.application_status === "saved")
}

/** They wrote back and the student has not answered. */
export function awaitingReply(contacts: ContactLike[]): ContactLike[] {
  return contacts.filter((c) => c.stage === "replied")
}

/**
 * The next interview that has not happened yet.
 *
 * `not_scheduled` is excluded on purpose: a row exists but no date has been
 * agreed, so there is nothing to count down to and taking over the screen for it
 * would be a countdown to nothing.
 */
export function nextInterview(interviews: InterviewLike[], now: Date): InterviewLike | null {
  const upcoming = interviews
    .filter((i) => i.status !== "not_scheduled" && i.status !== "rejected" && i.interview_date)
    .filter((i) => new Date(i.interview_date as string).getTime() >= startOfDay(now))
    .sort((a, b) => new Date(a.interview_date as string).getTime() - new Date(b.interview_date as string).getTime())
  return upcoming[0] ?? null
}

/** Whole days until an interview, floored at 0 so "today" never reads negative. */
export function daysUntil(iso: string, now: Date): number {
  return Math.max(0, Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / DAY))
}

/** The most recent thing that happened anywhere, or null on a cold account. */
export function lastActivityAt(apps: AppLike[], contacts: ContactLike[]): Date | null {
  const stamps = [
    ...apps.map((a) => a.applied_date || a.created_at),
    ...contacts.map((c) => c.last_action_at),
  ].filter(Boolean) as string[]
  if (stamps.length === 0) return null
  const newest = stamps
    .map((s) => new Date(s).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a)[0]
  return newest ? new Date(newest) : null
}

export type DashboardModel = {
  state: DashboardState
  firstName: string
  completion: { percent: number; missing: number }
  due: ContactLike[]
  awaiting: ContactLike[]
  stale: AppLike[]
  saved: AppLike[]
  interview: InterviewLike | null
  daysToInterview: number
  /** Applications whose status is past `saved`, i.e. actually in flight. */
  liveApplications: AppLike[]
  appliedThisWeek: number
  reachedThisWeek: number
  quietDays: number
}

export const QUIET_AFTER_DAYS = 7

export function buildDashboard(input: {
  profile: ProfileLike | null
  applications: AppLike[]
  contacts: ContactLike[]
  interviews: InterviewLike[]
  now?: Date
}): DashboardModel {
  const now = input.now ?? new Date()
  const { profile, applications: apps, contacts, interviews } = input

  const completion = profileCompletion(profile)
  const due = contactsDue(contacts, now)
  const awaiting = awaitingReply(contacts)
  const stale = staleApplications(apps, now)
  const saved = savedNotApplied(apps)
  const interview = nextInterview(interviews, now)
  const liveApplications = apps.filter((a) => a.application_status && a.application_status !== "saved")

  const weekAgo = now.getTime() - 7 * DAY
  const appliedThisWeek = apps.filter((a) => {
    const when = a.applied_date || a.created_at
    return when && new Date(when).getTime() >= weekAgo
  }).length
  const reachedThisWeek = contacts.filter(
    (c) => c.last_action_at && new Date(c.last_action_at).getTime() >= weekAgo,
  ).length

  const last = lastActivityAt(apps, contacts)
  const quietDays = last ? Math.floor((now.getTime() - last.getTime()) / DAY) : 0

  // profile_complete is the server's own gate; the percentage is only for
  // showing progress. Trust the gate when it is present so the dashboard and
  // the scoring engine can never disagree about whether an account is set up.
  const setUp = profile?.profile_complete ?? completion.missing === 0

  let state: DashboardState
  if (!setUp) state = "new"
  else if (interview) state = "interview"
  else if (apps.length === 0 && contacts.length === 0) state = "ready"
  else if (due.length === 0 && awaiting.length === 0 && quietDays >= QUIET_AFTER_DAYS) state = "quiet"
  else state = "active"

  return {
    state,
    firstName: (profile?.name ?? "").trim().split(/\s+/)[0] || "",
    completion,
    due,
    awaiting,
    stale,
    saved,
    interview,
    daysToInterview: interview?.interview_date ? daysUntil(interview.interview_date, now) : 0,
    liveApplications,
    appliedThisWeek,
    reachedThisWeek,
    quietDays,
  }
}
