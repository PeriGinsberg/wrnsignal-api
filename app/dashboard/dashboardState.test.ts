#!/usr/bin/env tsx
// Which of the five dashboard states a student lands in. tsx-script convention
// (pure logic), same as dashboardMetrics.test.ts.
//
// The PRIORITY is the thing worth pinning. Any one state is easy; the bugs live
// where two are true at once, and the screen has to pick the right one.

import {
  buildDashboard, profileCompletion, contactsDue, staleApplications,
  nextInterview, lastActivityAt, QUIET_AFTER_DAYS,
  type ProfileLike, type AppLike, type ContactLike, type InterviewLike,
} from "./dashboardState"

let pass = 0, fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`✓ ${label}`) } else { fail++; console.error(`✗ ${label}`) }
}
function eq(label: string, got: unknown, want: unknown) {
  ok(`${label} (got ${JSON.stringify(got)})`, got === want)
}

const NOW = new Date(2026, 7, 4, 12, 0, 0)
const ago = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString()
const ahead = (days: number) => new Date(NOW.getTime() + days * 86400000).toISOString()

const FULL: ProfileLike = {
  name: "Jordan Ellis", resume_text: "…", target_roles: "PM",
  target_locations: "Boston", timeline: "Now", profile_complete: true,
}
const app = (over: Partial<AppLike> = {}): AppLike =>
  ({ id: `a${Math.random()}`, application_status: "applied", applied_date: ago(1), ...over })
const contact = (over: Partial<ContactLike> = {}): ContactLike =>
  ({ id: `c${Math.random()}`, stage: "sequence_active", last_action_at: ago(1), ...over })

const build = (over: Partial<Parameters<typeof buildDashboard>[0]> = {}) =>
  buildDashboard({ profile: FULL, applications: [], contacts: [], interviews: [], now: NOW, ...over })

// ── completion ──────────────────────────────────────────────────────────────
eq("empty profile is 0%", profileCompletion(null).percent, 0)
eq("all five fields is 100%", profileCompletion(FULL).percent, 100)
eq("four of five is 80%", profileCompletion({ ...FULL, timeline: "" }).percent, 80)
eq("whitespace does not count as filled", profileCompletion({ ...FULL, timeline: "   " }).missing, 1)

// ── priority ────────────────────────────────────────────────────────────────
eq(
  "an incomplete profile beats everything, even a booked interview",
  build({
    profile: { ...FULL, profile_complete: false },
    interviews: [{ id: "i1", interview_date: ahead(2), status: "scheduled" }],
    contacts: [contact({ next_due_at: ago(1) })],
  }).state,
  "new",
)
eq(
  "an upcoming interview outranks ordinary work",
  build({
    interviews: [{ id: "i1", interview_date: ahead(3), status: "scheduled" }],
    contacts: [contact({ next_due_at: ago(1) })],
  }).state,
  "interview",
)
eq("a set-up account with nothing tracked is ready", build().state, "ready")
eq(
  "work to do is active",
  build({ contacts: [contact({ next_due_at: ago(1) })] }).state,
  "active",
)
eq(
  "data but nothing due and nothing touched for a week is quiet",
  build({
    applications: [app({ applied_date: ago(20), application_status: "interviewing" })],
    contacts: [contact({ last_action_at: ago(20), stage: "sequence_active" })],
  }).state,
  "quiet",
)
eq(
  "someone waiting on a reply keeps it active, however long it has been",
  build({
    contacts: [contact({ stage: "replied", last_action_at: ago(30) })],
  }).state,
  "active",
)

// ── the pieces the states render ────────────────────────────────────────────
{
  const due = contactsDue(
    [contact({ next_due_at: ago(3) }), contact({ next_due_at: ahead(3) }), contact({ next_due_at: null })],
    NOW,
  )
  eq("due counts overdue and today, not future or unset", due.length, 1)
}
{
  const stale = staleApplications(
    [app({ applied_date: ago(20) }), app({ applied_date: ago(3) }), app({ applied_date: ago(20), application_status: "interviewing" })],
    NOW,
  )
  eq("stale is applied-only and 14+ days", stale.length, 1)
}
{
  const iv: InterviewLike[] = [
    { id: "far", interview_date: ahead(9), status: "scheduled" },
    { id: "soon", interview_date: ahead(2), status: "scheduled" },
    { id: "past", interview_date: ago(2), status: "scheduled" },
    { id: "undated", interview_date: null, status: "not_scheduled" },
  ]
  eq("the nearest FUTURE interview wins", nextInterview(iv, NOW)?.id, "soon")
  eq("a dateless interview never takes over the screen", nextInterview([iv[3]], NOW), null)
  eq("days until is whole days", build({ interviews: [iv[1]] }).daysToInterview, 2)
}
eq("a cold account has no last activity", lastActivityAt([], []), null)
{
  const m = build({
    applications: [app({ applied_date: ago(2) }), app({ applied_date: ago(20) })],
    contacts: [contact({ last_action_at: ago(1) }), contact({ last_action_at: ago(30) })],
  })
  eq("this week counts only the last seven days, applications", m.appliedThisWeek, 1)
  eq("this week counts only the last seven days, people", m.reachedThisWeek, 1)
}
eq(
  `quiet needs ${QUIET_AFTER_DAYS} days, not fewer`,
  build({ contacts: [contact({ last_action_at: ago(QUIET_AFTER_DAYS - 1), stage: "sequence_active" })] }).state,
  "active",
)
eq("first name only, for the greeting", build().firstName, "Jordan")

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
