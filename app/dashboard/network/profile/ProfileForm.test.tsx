import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { ProfileForm } from "./ProfileForm"

const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...a: unknown[]) => authFetchMock(...a),
  getToken: async () => "t",
}))

const ok = (body: Record<string, unknown>) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, ...body }) } as unknown as Response)

const seeded = {
  client_first: "Jordan", school: "University of Illinois", target_role: "Marketing Analytics",
  target_field: "Marketing", grad_year: "2020", timeframe: "Immediate",
  key_strength: "quick learner", current_role_title: "Senior Marketing Analyst",
  current_employer: "Northbrook Consumer Group",
  degree: null, city: null, affinity_1: null, affinity_2: null, affinity_3: null,
  resume_link: null, calendar_link: null, elevator_pitch: null,
  touched_fields: [],
}

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(() => ok({ profile: seeded, completeness: { filled: 9, total: 17, missing: ["city"] } }))
})

describe("per-field state — the scan, not the read", () => {
  // The point of the restructure: before this, a done field and an empty one
  // looked identical, so finding what was left meant reading all 17.
  it("a filled field shows the check, an empty required one shows the warning", async () => {
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("field-client_first")).toBeTruthy())

    // client_first is seeded; city is deliberately never seeded (see 7a).
    expect(screen.getByTestId("field-client_first").getAttribute("data-state")).toBe("filled")
    expect(screen.getByTestId("check-client_first")).toBeTruthy()
    expect(screen.queryByTestId("needed-client_first")).toBeNull()

    expect(screen.getByTestId("field-city").getAttribute("data-state")).toBe("required-empty")
    expect(screen.getByTestId("needed-city")).toBeTruthy()
    expect(screen.queryByTestId("check-city")).toBeNull()
  })

  it("the four skippable fields say optional and never warn", async () => {
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("field-degree")).toBeTruthy())

    for (const k of ["degree", "resume_link", "calendar_link"]) {
      expect(screen.getByTestId(`field-${k}`).getAttribute("data-state")).toBe("optional-empty")
      expect(screen.getByTestId(`optional-${k}`)).toBeTruthy()
      expect(screen.queryByTestId(`needed-${k}`)).toBeNull()
    }
    // grad_year IS seeded in this fixture, so it must read filled rather than
    // optional — the optional label is for empty ones only.
    expect(screen.getByTestId("field-grad_year").getAttribute("data-state")).toBe("filled")
  })

  it("the elevator pitch is marked out from every other field", async () => {
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("field-elevator_pitch")).toBeTruthy())
    expect(screen.getByTestId("pitch-badge")).toBeTruthy()
    // Exactly one featured field — the emphasis is worthless if it spreads.
    expect(screen.queryAllByTestId("pitch-badge")).toHaveLength(1)
  })

  it("state follows the value, so filling a field flips it on the next load", async () => {
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("field-city")).toBeTruthy())
    expect(screen.getByTestId("field-city").getAttribute("data-state")).toBe("required-empty")

    authFetchMock.mockImplementation(() =>
      ok({ profile: { ...seeded, city: "Chicago" }, completeness: { filled: 10, total: 17, missing: [] } }))
    fireEvent.blur(screen.getByLabelText("City"), { target: { value: "Chicago" } })

    await waitFor(() => expect(screen.getByTestId("field-city").getAttribute("data-state")).toBe("filled"))
    expect(screen.getByTestId("check-city")).toBeTruthy()
  })
})

describe("the 'enough to start sending' threshold", () => {
  it("says how many more, and which, while below it", async () => {
    // The fixture has client_first, target_role and target_field but NO pitch.
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("send-not-ready")).toBeTruthy())

    const line = screen.getByTestId("send-not-ready").textContent ?? ""
    expect(line).toMatch(/1 more to start sending/)
    expect(line).toMatch(/elevator pitch/)
    expect(screen.queryByTestId("send-ready")).toBeNull()
  })

  it("crosses the threshold when the last must-have lands, well short of 17", async () => {
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("send-not-ready")).toBeTruthy())

    authFetchMock.mockImplementation(() =>
      ok({ profile: { ...seeded, elevator_pitch: "I'm a marketing analyst moving into…" },
           completeness: { filled: 10, total: 17, missing: [] } }))
    fireEvent.blur(screen.getByLabelText("Elevator pitch"), { target: { value: "I'm a marketing analyst moving into…" } })

    await waitFor(() => expect(screen.getByTestId("send-ready")).toBeTruthy())
    expect(screen.queryByTestId("send-not-ready")).toBeNull()
    // Ready at 10 of 17 — the signal exists precisely so this is not all-or-nothing.
    expect(screen.getByTestId("completeness-count").textContent).toBe("10 of 17")
  })

  it("an empty profile needs all four and says so", async () => {
    authFetchMock.mockImplementation(() =>
      ok({ profile: {}, completeness: { filled: 0, total: 17, missing: [] } }))
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("send-not-ready")).toBeTruthy())
    expect(screen.getByTestId("send-not-ready").textContent).toMatch(/4 more to start sending/)
  })
})

describe("section-level progress", () => {
  it("each section carries its own count, so movement is visible inside it", async () => {
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("section-about-you")).toBeTruthy())

    // About you: client_first, current_role_title, current_employer, school,
    // grad_year filled; degree and city empty.
    expect(screen.getByTestId("section-about-you").textContent).toMatch(/5 of 7/)
    // The three things-in-common fields are all empty in the fixture. The
    // testid is derived from the section title, so it moved with the label.
    expect(screen.getByTestId("section-things-in-common").textContent).toMatch(/0 of 3/)
  })
})

describe("completeness meter", () => {
  it("shows filled of total, so gaps are visible before templates hit them", async () => {
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByTestId("completeness-count").textContent).toBe("9 of 17"))
  })

  it("updates from the server's count after a save, not from a local guess", async () => {
    render(<ProfileForm />)
    await waitFor(() => screen.getByTestId("completeness-count"))

    authFetchMock.mockImplementation(() =>
      ok({ profile: { ...seeded, city: "Chicago" }, completeness: { filled: 10, total: 17, missing: [] } }))
    fireEvent.blur(screen.getByLabelText("City"), { target: { value: "Chicago" } })

    await waitFor(() => expect(screen.getByTestId("completeness-count").textContent).toBe("10 of 17"))
  })

  it("reads complete at 17 of 17", async () => {
    authFetchMock.mockImplementation(() => ok({ profile: seeded, completeness: { filled: 17, total: 17, missing: [] } }))
    render(<ProfileForm />)
    await waitFor(() => expect(screen.getByText(/Complete — every template/)).toBeTruthy())
  })
})

describe("refresh from profile", () => {
  it("an EDITED field survives the refresh; untouched ones update", async () => {
    render(<ProfileForm />)
    await waitFor(() => screen.getByTestId("completeness-count"))

    // The client rewrites the coach's strengths note in their own words.
    const edited = "I turn messy data into decisions"
    authFetchMock.mockImplementation(() =>
      ok({ profile: { ...seeded, key_strength: edited, touched_fields: ["key_strength"] },
           completeness: { filled: 9, total: 17, missing: [] } }))
    fireEvent.blur(screen.getByLabelText("Key strength"), { target: { value: edited } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(authFetchMock.mock.calls[1][1].body).key_strength).toBe(edited)

    // Refresh: the server re-seeds only untouched fields, so key_strength comes
    // back UNCHANGED while school picks up a new value.
    authFetchMock.mockImplementation(() =>
      ok({ profile: { ...seeded, key_strength: edited, school: "Illinois Urbana-Champaign" },
           refreshed: ["client_first", "school"], completeness: { filled: 9, total: 17, missing: [] } }))
    fireEvent.click(screen.getByRole("button", { name: /Refresh from profile/i }))

    await waitFor(() => expect(screen.getByText(/Refreshed 2 fields you hadn't edited/)).toBeTruthy())
    expect((screen.getByLabelText("Key strength") as HTMLTextAreaElement).value).toBe(edited)
    // …and the refresh request is the refresh ACTION, not a field write.
    const last = JSON.parse(authFetchMock.mock.calls.at(-1)![1].body)
    expect(last.action).toBe("refresh")
  })

  it("says so plainly when there is nothing left to refresh", async () => {
    render(<ProfileForm />)
    await waitFor(() => screen.getByTestId("completeness-count"))
    authFetchMock.mockImplementation(() =>
      ok({ profile: seeded, refreshed: [], completeness: { filled: 9, total: 17, missing: [] } }))
    fireEvent.click(screen.getByRole("button", { name: /Refresh from profile/i }))
    await waitFor(() => expect(screen.getByText(/Nothing to refresh/)).toBeTruthy())
  })
})

describe("first open is not blocked on the résumé extraction", () => {
  const blank = Object.fromEntries(Object.keys(seeded).filter((k) => k !== "touched_fields").map((k) => [k, null]))

  it("renders the form immediately, with the two résumé fields marked pending", async () => {
    let resolveSeed: (v: unknown) => void = () => {}
    authFetchMock.mockImplementation((url: string, init?: { body?: string }) => {
      if (init?.body && JSON.parse(init.body).action === "seed_resume") {
        return new Promise((r) => { resolveSeed = r })   // never settles until we say so
      }
      return ok({ profile: { ...blank, touched_fields: [] }, resume_pending: true,
                  completeness: { filled: 0, total: 17, missing: [] } })
    })

    render(<ProfileForm />)

    // The form is on screen while the extraction is still outstanding — this is
    // the whole point: no page-wide spinner behind an LLM call.
    await waitFor(() => expect(screen.getByLabelText("Elevator pitch")).toBeTruthy())
    expect(screen.getByLabelText("City")).toBeTruthy()

    const role = screen.getByLabelText("Current role") as HTMLInputElement
    expect(role.disabled).toBe(true)
    expect(role.placeholder).toMatch(/Reading your résumé/)
    // Everything else is editable meanwhile.
    expect((screen.getByLabelText("City") as HTMLInputElement).disabled).toBe(false)

    // Phase 2 lands.
    resolveSeed({ ok: true, status: 200, json: async () => ({
      ok: true, profile: { ...blank, current_role_title: "Senior Marketing Analyst", touched_fields: [] },
      completeness: { filled: 1, total: 17, missing: [] } }) })
    await waitFor(() => expect((screen.getByLabelText("Current role") as HTMLInputElement).value)
      .toBe("Senior Marketing Analyst"))
    expect((screen.getByLabelText("Current role") as HTMLInputElement).disabled).toBe(false)
  })

  it("a totally unseeded profile reads as a form to fill, not as broken", async () => {
    authFetchMock.mockImplementation(() =>
      ok({ profile: { ...blank, touched_fields: [] }, resume_pending: false,
           completeness: { filled: 0, total: 17, missing: [] } }))
    const { container } = render(<ProfileForm />)
    await waitFor(() => screen.getByTestId("completeness-count"))

    expect(screen.getByTestId("completeness-count").textContent).toBe("0 of 17")
    expect(container.textContent).not.toMatch(/error|failed|could not|unauthorized|undefined|NaN|\[object/i)
    // Every group heading is present, so the page explains itself. getAllByText
    // because "Elevator pitch" is both a group heading and a field label.
    for (const g of ["About you", "Your target", "Things in Common", "Links", "Elevator pitch"]) {
      expect(screen.getAllByText(g).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByRole("textbox").length).toBe(17)
  })
})

describe("city", () => {
  it("is blank with a placeholder about where you ARE, not where you want to work", async () => {
    render(<ProfileForm />)
    await waitFor(() => screen.getByTestId("completeness-count"))
    const city = screen.getByLabelText("City") as HTMLInputElement
    expect(city.value).toBe("")
    expect(city.placeholder).toMatch(/Where you're based/)
  })
})
