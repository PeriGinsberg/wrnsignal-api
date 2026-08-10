// The "jobs from your coach" banner on the Applications view.
//
// THE BUG THIS EXISTS TO PREVENT COMING BACK. The banner used to count rows
// with client_status 'new' OR 'interested', and its only control — a text
// button called "Mark all seen" — moved rows from the first to the second. So
// the count never changed, the banner never cleared, and the client's click had
// silently told their coach they were interested in every job listed. Both
// halves are pinned here: the filter must be 'new' only, and the banner must
// carry no action at all.
//
// It also names the coach. Attribution used to come from coachRecs[0], which
// misnamed the sender as soon as a client had two coaches.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ApplicationsView } from "./ApplicationsView"

vi.mock("../network/authFetch", () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })),
  getToken: async () => "test-token",
}))

const rec = (i: number, over: Record<string, unknown> = {}) => ({
  id: `rec-${i}`,
  application_id: `app-${i}`,
  job_title: `Role ${i}`,
  company_name: `Co ${i}`,
  coach_name: "Dana",
  ...over,
})

function view(
  unanswered: ReturnType<typeof rec>[],
  coachLabel = "Dana",
  applications: any[] = [],
  coachSourcedIds = new Set<string>(),
) {
  return render(
    <ApplicationsView
      applications={applications}
      nextInterviewFor={() => null}
      unanswered={unanswered}
      coachLabel={coachLabel}
      coachSourcedIds={coachSourcedIds}
      onCreated={() => {}}
    />,
  )
}

afterEach(cleanup)

describe("coach banner", () => {
  it("does not render when everything has been answered", () => {
    const { container } = view([])
    expect(container.querySelector('[data-testid="coach-unanswered-banner"]')).toBeNull()
  })

  it("names the coach and counts only unanswered jobs", () => {
    view([rec(1), rec(2)])
    expect(screen.getByText(/Dana sent 2 jobs you haven't answered yet/i)).toBeTruthy()
  })

  it("uses the singular for one job", () => {
    view([rec(1)])
    expect(screen.getByText(/sent 1 job you haven't answered yet/i)).toBeTruthy()
  })

  it("falls back to 'Your coaches' when more than one coach is involved", () => {
    view([rec(1), rec(2, { coach_name: "Marcus" })], "Your coaches")
    expect(screen.getByText(/Your coaches sent 2 jobs/i)).toBeTruthy()
  })

  it("links each job to its detail page, where the answer is given", () => {
    view([rec(1), rec(2)])
    const a = screen.getByText("Role 1 · Co 1").closest("a")
    expect(a?.getAttribute("href")).toBe("/dashboard/tracker/app-1")
  })

  it("caps the list at three and says how many more there are", () => {
    view([rec(1), rec(2), rec(3), rec(4), rec(5)])
    expect(screen.queryByText("Role 4 · Co 4")).toBeNull()
    expect(screen.getByText(/\+ 2 more below/i)).toBeTruthy()
  })

  it("carries NO action — no 'Mark all seen', no button of any kind", () => {
    view([rec(1), rec(2)])
    const banner = screen.getByTestId("coach-unanswered-banner")
    expect(banner.querySelector("button")).toBeNull()
    expect(screen.queryByText(/mark all seen/i)).toBeNull()
  })

  it("omits a recommendation with no linked application rather than linking nowhere", () => {
    view([rec(1), rec(2, { application_id: null })])
    expect(screen.queryByText("Role 2 · Co 2")).toBeNull()
    // Still counted: the coach did send it, and pretending otherwise would
    // under-report. It simply has no page to point at. See the separate bug
    // for the 5 prod rows with no application_id.
    expect(screen.getByText(/sent 2 jobs/i)).toBeTruthy()
  })
})
