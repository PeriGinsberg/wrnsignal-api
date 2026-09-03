// The "From your coach" row marker and its filter chip.
//
// WHAT THIS IS REPLACING. The pre-2026-08-04 tracker marked these rows with a
// teal "⚡ From {coach}" pill, a teal row tint AND a priority-coloured left
// border — three treatments for one fact, one of which competed with the status
// colour beside it. All three went in the Phase A rebuild (7e311c61) without
// being listed, along with the response buttons, and nothing replaced them: a
// student had no way to tell which jobs their coach had sent, or to see only
// those.
//
// THE RULE MOST WORTH PINNING is that the marker does NOT depend on whether the
// client has answered. Answering "Interested" does not stop a job having come
// from a coach, and an earlier draft of this feature keyed the marker off the
// unanswered set — which would have made it vanish on reply, reporting the
// client's own answer back to them instead of telling them where the job came
// from.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react"
import { ApplicationsView } from "./ApplicationsView"
import { ApplicationCard } from "./ApplicationCard"

vi.mock("../network/authFetch", () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })),
  getToken: async () => "test-token",
  // Real behaviour under a test URL with no ?client_profile_id: no subject,
  // and every href passes through untouched.
  subjectId: () => null,
  withSubject: (href: string) => href,
}))

const app = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  company_name: `Co ${id}`,
  job_title: `Role ${id}`,
  application_status: "saved",
  applied_date: null,
  created_at: "2026-08-01T00:00:00Z",
  location: null,
  signal_score: null,
  signal_decision: null,
  coach_annotations: [],
  ...over,
}) as any

function view(applications: any[], coachSourcedIds: Set<string>) {
  return render(
    <ApplicationsView
      applications={applications}
      nextInterviewFor={() => null}
      unanswered={[]}
      coachLabel="Dana"
      coachSourcedIds={coachSourcedIds}
      onCreated={() => {}}
    />,
  )
}

afterEach(cleanup)

describe("the row marker", () => {
  it("appears on a coach-sourced job", () => {
    render(<ApplicationCard application={app("a1")} fromCoach />)
    expect(screen.getByTestId("from-coach").textContent).toBe("From your coach")
  })

  it("is absent on a job the student added themselves", () => {
    const { container } = render(<ApplicationCard application={app("a1")} />)
    expect(container.querySelector('[data-testid="from-coach"]')).toBeNull()
  })

  it("does not name the coach", () => {
    render(<ApplicationCard application={app("a1")} fromCoach />)
    expect(screen.queryByText(/Dana/)).toBeNull()
    expect(screen.queryByText(/⚡/)).toBeNull()
  })

  it("survives the job moving through its statuses", () => {
    // The fact is about where the job came from, not what state it is in.
    for (const s of ["saved", "applied", "interviewing", "offer", "rejected"]) {
      cleanup()
      render(<ApplicationCard application={app("a1", { application_status: s })} fromCoach />)
      expect(screen.getByTestId("from-coach")).toBeTruthy()
    }
  })

  it("adds no border or background of its own — one signal, not three", () => {
    const { container: plain } = render(<ApplicationCard application={app("a1")} />)
    const plainCard = plain.firstElementChild as HTMLElement
    const plainStyle = `${plainCard.style.background}|${plainCard.style.border}|${plainCard.style.borderLeft}`
    cleanup()
    const { container: coached } = render(<ApplicationCard application={app("a1")} fromCoach />)
    const coachedCard = coached.firstElementChild as HTMLElement
    const coachedStyle = `${coachedCard.style.background}|${coachedCard.style.border}|${coachedCard.style.borderLeft}`
    expect(coachedStyle).toBe(plainStyle)
  })
})

describe("the filter chip", () => {
  it("does not render when no job came from a coach", () => {
    view([app("a1"), app("a2")], new Set())
    expect(screen.queryByText(/From your coach/)).toBeNull()
  })

  it("counts only the coach-sourced jobs", () => {
    view([app("a1"), app("a2"), app("a3")], new Set(["a1", "a3"]))
    expect(screen.getByRole("button", { name: /From your coach 2/ })).toBeTruthy()
  })

  it("filters the list down to them", () => {
    view([app("a1"), app("a2"), app("a3")], new Set(["a1", "a3"]))
    fireEvent.click(screen.getByRole("button", { name: /From your coach 2/ }))
    expect(screen.getByText("Role a1")).toBeTruthy()
    expect(screen.getByText("Role a3")).toBeTruthy()
    expect(screen.queryByText("Role a2")).toBeNull()
  })

  it("toggles off on a second click", () => {
    view([app("a1"), app("a2")], new Set(["a1"]))
    const chip = screen.getByRole("button", { name: /From your coach 1/ })
    fireEvent.click(chip)
    expect(screen.queryByText("Role a2")).toBeNull()
    fireEvent.click(chip)
    expect(screen.getByText("Role a2")).toBeTruthy()
  })

  it("is mutually exclusive with a status chip, like every other chip", () => {
    view(
      [app("a1"), app("a2", { application_status: "applied" }), app("a3", { application_status: "applied" })],
      new Set(["a1"]),
    )
    fireEvent.click(screen.getByRole("button", { name: /From your coach 1/ }))
    expect(screen.getByText("Role a1")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Applied 2/ }))
    // Switching chips replaces the filter rather than intersecting.
    expect(screen.queryByText("Role a1")).toBeNull()
    expect(screen.getByText("Role a2")).toBeTruthy()
  })

  it("the count on the chip matches the rows it shows", () => {
    view([app("a1"), app("a2"), app("a3"), app("a4")], new Set(["a1", "a2", "a4"]))
    const chip = screen.getByRole("button", { name: /From your coach 3/ })
    fireEvent.click(chip)
    const list = screen.getByText("Role a1").closest("div")!.parentElement!.parentElement!
    expect(within(list).queryByText("Role a3")).toBeNull()
    for (const id of ["a1", "a2", "a4"]) expect(screen.getByText(`Role ${id}`)).toBeTruthy()
  })

  it("carries the same colour as the row marker — one signal, two places", () => {
    // Both read COACH_SOURCED_MEANING, but a later edit could hardcode one of
    // them. Comparing the rendered dot colours catches that; comparing the
    // constant to itself would not.
    view([app("a1")], new Set(["a1"]))
    const chipDot = screen
      .getByRole("button", { name: /From your coach 1/ })
      .querySelector("span") as HTMLElement
    const markerDot = screen.getByTestId("from-coach").querySelector("span") as HTMLElement
    expect(chipDot.style.background).toBe(markerDot.style.background)
    expect(markerDot.style.background).not.toBe("")
  })

  it("sits in the existing filter row, not a control group of its own", () => {
    view([app("a1")], new Set(["a1"]))
    const coachChip = screen.getByRole("button", { name: /From your coach 1/ })
    const allChip = screen.getByRole("button", { name: /^All 1/ })
    expect(coachChip.parentElement).toBe(allChip.parentElement)
  })
})
