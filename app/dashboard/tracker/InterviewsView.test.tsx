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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react"
import { InterviewsView, groupOf, type Interview } from "./InterviewsView"

// The status control writes through authFetch, which reaches for a Supabase
// session that does not exist under jsdom.
const authFetchMock = vi.fn((_url: string, _init?: RequestInit) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response))
vi.mock("../network/authFetch", () => ({
  authFetch: (url: string, init?: RequestInit) => authFetchMock(url, init),
  getToken: async () => "t",
  // Real behaviour under a test URL with no ?client_profile_id: no subject,
  // and every href passes through untouched.
  subjectId: () => null,
  withSubject: (href: string) => href,
}))

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
    // NOT "Sat": a three-letter fixture name collides with a weekday or month
    // abbreviation the moment the rendered date happens to contain one. This
    // test passed for a day and then failed on a calendar roll with no code
    // change. Fixture names here must be words that cannot appear in a date.
    iv({ job_title: "Happened", interview_date: dateStr(-3), status: "scheduled" }),
    iv({ job_title: "Told", interview_date: dateStr(6), status: "awaiting_feedback" }),
    iv({ job_title: "Won", interview_date: dateStr(-10), status: "offer_extended" }),
  ]

  it("labels all three and puts each round under the right one", () => {
    render(<InterviewsView interviews={ROSTER} onChanged={() => {}} />)
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
    expect(within(screen.getByTestId("group-waiting")).getByText(/Happened/)).toBeTruthy()
    expect(within(screen.getByTestId("group-completed")).getByText(/Won/)).toBeTruthy()
    // The second bug, asserted where it actually shows: an undated round must
    // not be sitting in Completed.
    expect(within(screen.getByTestId("group-completed")).queryByText(/Unbooked/)).toBeNull()
  })

  it("counts each group in the subtitle", () => {
    render(<InterviewsView interviews={ROSTER} onChanged={() => {}} />)
    const sub = screen.getByText(/coming up/)
    expect(sub.textContent).toContain("2 coming up")      // Soon + Unbooked
    expect(sub.textContent).toContain("2 waiting to hear") // Happened + Told
    expect(sub.textContent).toContain("1 completed")       // Won
  })

  it("gives the hero to the soonest DATED round, not the undated one", () => {
    // An undated card has no countdown to put in the hero, so it sorts last
    // inside Coming up rather than stealing the treatment.
    render(<InterviewsView interviews={ROSTER} onChanged={() => {}} />)
    expect(screen.getByText(/In 2 days/)).toBeTruthy()
  })

  it("says what an undated round is instead of printing a broken countdown", () => {
    render(<InterviewsView interviews={[iv({ interview_date: null, status: "not_scheduled" })]} onChanged={() => {}} />)
    // "No date yet", not "Not scheduled yet": the status control on this card
    // owns the word "scheduled", and an interview can be status `scheduled`
    // with no date agreed.
    expect(screen.getByText("No date yet")).toBeTruthy()
    expect(screen.getByText(/Add a date when you have one/)).toBeTruthy()
  })

  it("omits a group nobody is in", () => {
    render(<InterviewsView interviews={[iv({ interview_date: dateStr(2), status: "scheduled" })]} onChanged={() => {}} />)
    expect(screen.queryByText("Waiting to hear")).toBeNull()
    expect(screen.queryByText("Completed")).toBeNull()
  })

  it("still shows the empty state with no interviews at all", () => {
    render(<InterviewsView interviews={[]} onChanged={() => {}} />)
    expect(screen.getByText(/No interviews yet/)).toBeTruthy()
  })
})

/**
 * The screen is called "Your interviews", it groups itself BY status, and until
 * now it could only display it — the control lived two levels down on the job
 * page behind a row labelled "Edit". A tester looked for "Awaiting feedback"
 * here, did not find it, and both interview tests were blocked on a field that
 * already existed.
 */
describe("status is settable where status is shown", () => {
  beforeEach(() => authFetchMock.mockClear())

  it("offers every status on a card, including the one she went looking for", () => {
    render(<InterviewsView interviews={[iv({ job_title: "Soon", interview_date: dateStr(2), status: "scheduled" })]} onChanged={() => {}} />)
    const select = screen.getByLabelText(/Status for/) as HTMLSelectElement
    const labels = Array.from(select.options).map((o) => o.text)
    expect(labels).toContain("Awaiting feedback")
    expect(labels).toHaveLength(6)
    expect(select.value).toBe("scheduled")
  })

  it("writes the change through the interview route", async () => {
    const target = iv({ interview_date: dateStr(2), status: "scheduled" })
    render(<InterviewsView interviews={[target]} onChanged={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Status for/), { target: { value: "awaiting_feedback" } })

    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    const [url, init] = authFetchMock.mock.calls[0]
    expect(url).toBe(`/api/interviews/${target.id}`)
    expect(init?.method).toBe("PUT")
    expect(JSON.parse(init?.body as string)).toEqual({ status: "awaiting_feedback" })
  })

  it("RELOADS THE LIST, because the round changes group", async () => {
    // Re-rendering one card in place would leave it sitting under a heading
    // that no longer describes it.
    const onChanged = vi.fn()
    render(<InterviewsView interviews={[iv({ interview_date: dateStr(2), status: "scheduled" })]} onChanged={onChanged} />)
    fireEvent.change(screen.getByLabelText(/Status for/), { target: { value: "awaiting_feedback" } })
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  it("writes nothing when the status is re-selected unchanged", async () => {
    render(<InterviewsView interviews={[iv({ interview_date: dateStr(2), status: "scheduled" })]} onChanged={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Status for/), { target: { value: "scheduled" } })
    expect(authFetchMock).not.toHaveBeenCalled()
  })

  it("says so when the write fails, instead of showing a status that did not save", async () => {
    authFetchMock.mockImplementationOnce((_u: string, _i?: RequestInit) =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false }) } as unknown as Response))
    render(<InterviewsView interviews={[iv({ interview_date: dateStr(2), status: "scheduled" })]} onChanged={() => {}} />)
    fireEvent.change(screen.getByLabelText(/Status for/), { target: { value: "rejected" } })
    expect(await screen.findByText(/Didn't save/)).toBeTruthy()
  })

  it("is reachable on a completed card too, not only the hero", () => {
    render(<InterviewsView interviews={[iv({ interview_date: dateStr(-9), status: "offer_extended" })]} onChanged={() => {}} />)
    expect((screen.getByLabelText(/Status for/) as HTMLSelectElement).value).toBe("offer_extended")
  })

  it("does not nest the control inside the card's link", () => {
    // A <select> inside an <a> navigates the moment you touch it, so the
    // control would have been unusable rather than merely hidden. It is also
    // invalid HTML.
    render(<InterviewsView interviews={[iv({ interview_date: dateStr(-9), status: "rejected" })]} onChanged={() => {}} />)
    const select = screen.getByLabelText(/Status for/)
    expect(select.closest("a")).toBeNull()
  })
})
