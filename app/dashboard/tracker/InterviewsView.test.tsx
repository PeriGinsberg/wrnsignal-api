// Which group a round lands in, and whether the view actually renders it there.
//
// The bug: the view split on DATE ALONE while status stayed an editable control
// on every card. A tester set a round to "Awaiting feedback", the label changed,
// and nothing moved — because membership never consulted status. A control that
// looks consequential and is not is its own bug.
//
// The second bug, found while fixing the first: daysUntil(null) is null, so
// isUpcoming(undated) was false and an interview whose status was literally
// not_scheduled filed under COMPLETED.
//
// These pin the rule table, including the two precedence cases that a naive
// implementation gets wrong: terminal-status-beats-future-date, and
// awaiting-feedback-beats-future-date.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"
import { InterviewsView, groupOf, type Interview } from "./InterviewsView"

afterEach(cleanup)

const DAY = 86400000
/** Date-only string, N days from now, which is what the column holds. */
function dateStr(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

let seq = 0
function iv(over: Partial<Interview> = {}): Interview {
  seq++
  return {
    id: `i${seq}`, application_id: `a${seq}`,
    company_name: "Nodal", job_title: `Role ${seq}`,
    interview_stage: "phone", interview_date: dateStr(3), status: "scheduled",
    interviewer_names: null, notes: null, thank_you_sent: null,
    ...over,
  }
}

describe("groupOf — the rule table", () => {
  it("a future scheduled round is coming up", () => {
    expect(groupOf(iv({ interview_date: dateStr(5), status: "scheduled" }))).toBe("coming_up")
  })

  it("TODAY still counts as coming up", () => {
    expect(groupOf(iv({ interview_date: dateStr(0), status: "scheduled" }))).toBe("coming_up")
  })

  it("a past round with no outcome is waiting to hear", () => {
    expect(groupOf(iv({ interview_date: dateStr(-2), status: "scheduled" }))).toBe("waiting")
  })

  it("AWAITING FEEDBACK moves it, even with the date still ahead", () => {
    // The reported bug, in one line. The student is saying it happened; believe
    // them over the calendar.
    expect(groupOf(iv({ interview_date: dateStr(4), status: "awaiting_feedback" }))).toBe("waiting")
  })

  it("a terminal status beats a future date", () => {
    // A rejection is finished whether or not the date has passed.
    for (const status of ["offer_extended", "rejected", "ghosted"]) {
      expect(groupOf(iv({ interview_date: dateStr(9), status }))).toBe("completed")
    }
  })

  it("a terminal status also beats a past date", () => {
    expect(groupOf(iv({ interview_date: dateStr(-9), status: "offer_extended" }))).toBe("completed")
  })

  it("AN UNDATED ROUND IS COMING UP, NOT COMPLETED", () => {
    // The second bug: daysUntil(null) is null, which used to read as "not
    // upcoming" and therefore as done.
    expect(groupOf(iv({ interview_date: null, status: "not_scheduled" }))).toBe("coming_up")
  })

  it("…but an undated round with an outcome is still completed", () => {
    expect(groupOf(iv({ interview_date: null, status: "rejected" }))).toBe("completed")
  })
})

describe("the view renders the three groups", () => {
  const ROSTER = [
    iv({ job_title: "Soon", interview_date: dateStr(2), status: "scheduled" }),
    iv({ job_title: "Unbooked", interview_date: null, status: "not_scheduled" }),
    iv({ job_title: "Sat", interview_date: dateStr(-3), status: "scheduled" }),
    iv({ job_title: "Told", interview_date: dateStr(6), status: "awaiting_feedback" }),
    iv({ job_title: "Won", interview_date: dateStr(-10), status: "offer_extended" }),
  ]

  it("labels all three and puts each round under the right one", () => {
    render(<InterviewsView interviews={ROSTER} />)
    expect(screen.getByText("Coming up")).toBeTruthy()
    expect(screen.getByText("Waiting to hear")).toBeTruthy()
    expect(screen.getByText("Completed")).toBeTruthy()

    // THE REPORTED CASE, asserted on PLACEMENT rather than on the label
    // existing: "Told" is dated in the FUTURE but is awaiting feedback, so it
    // has to be under Waiting to hear and NOT under Coming up. Checking only
    // that the heading rendered would pass with the card in the wrong group.
    expect(within(screen.getByTestId("group-waiting")).getByText(/Told/)).toBeTruthy()
    expect(within(screen.getByTestId("group-coming_up")).queryByText(/Told/)).toBeNull()

    // And the rest of the table, by placement.
    expect(within(screen.getByTestId("group-coming_up")).getByText(/Soon/)).toBeTruthy()
    expect(within(screen.getByTestId("group-coming_up")).getByText(/Unbooked/)).toBeTruthy()
    expect(within(screen.getByTestId("group-waiting")).getByText(/Sat/)).toBeTruthy()
    expect(within(screen.getByTestId("group-completed")).getByText(/Won/)).toBeTruthy()
    // The second bug, asserted where it actually shows: an undated round must
    // not be sitting in Completed.
    expect(within(screen.getByTestId("group-completed")).queryByText(/Unbooked/)).toBeNull()
  })

  it("counts each group in the subtitle", () => {
    render(<InterviewsView interviews={ROSTER} />)
    const sub = screen.getByText(/coming up/)
    expect(sub.textContent).toContain("2 coming up")      // Soon + Unbooked
    expect(sub.textContent).toContain("2 waiting to hear") // Sat + Told
    expect(sub.textContent).toContain("1 completed")       // Won
  })

  it("gives the hero to the soonest DATED round, not the undated one", () => {
    // An undated card has no countdown to put in the hero, so it sorts last
    // inside Coming up rather than stealing the treatment.
    render(<InterviewsView interviews={ROSTER} />)
    expect(screen.getByText(/In 2 days/)).toBeTruthy()
  })

  it("says what an undated round is instead of printing a broken countdown", () => {
    render(<InterviewsView interviews={[iv({ interview_date: null, status: "not_scheduled" })]} />)
    expect(screen.getByText("Not scheduled yet")).toBeTruthy()
    expect(screen.getByText(/Add a date when you have one/)).toBeTruthy()
  })

  it("omits a group nobody is in", () => {
    render(<InterviewsView interviews={[iv({ interview_date: dateStr(2), status: "scheduled" })]} />)
    expect(screen.queryByText("Waiting to hear")).toBeNull()
    expect(screen.queryByText("Completed")).toBeNull()
  })

  it("still shows the empty state with no interviews at all", () => {
    render(<InterviewsView interviews={[]} />)
    expect(screen.getByText(/No interviews yet/)).toBeTruthy()
  })
})
