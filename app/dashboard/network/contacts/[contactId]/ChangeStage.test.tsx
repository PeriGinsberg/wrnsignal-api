// The full stage control, now folded behind "Change stage" on the contact record.
//
// Migrated from PipelineStepper.test.tsx. The PhaseBar tests went with the bar
// (its job moved to the header pill, covered in ContactRecord.test.tsx); the
// dropdown tests survive here, because the control moved but its contract did
// not — every stage, any direction, and it must recover from a failed write.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { ChangeStage } from "./ChangeStage"

const authFetchMock = vi.fn()
vi.mock("../../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
  // Real behaviour under a test URL with no ?client_profile_id: no subject,
  // and every href passes through untouched.
  subjectId: () => null,
  withSubject: (href: string) => href,
}))

const ok = () =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response)

const contact = { id: "c1", stage: "identified", outcome_type: null, relationship: "personal" }

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(ok)
})

// Every test opens the panel first: the control is deliberately behind a toggle
// now, and going through it is how a user reaches the dropdown.
function openPanel(over: Partial<typeof contact> = {}, onChanged: () => void = () => {}) {
  const utils = render(<ChangeStage contact={{ ...contact, ...over }} onChanged={onChanged} />)
  fireEvent.click(screen.getByTestId("change-stage-open"))
  return utils
}

describe("the control is folded away until asked for", () => {
  it("shows only the toggle at rest, and the dropdown after opening", () => {
    render(<ChangeStage contact={contact} onChanged={() => {}} />)
    expect(screen.queryByLabelText("Stage")).toBeNull()

    fireEvent.click(screen.getByTestId("change-stage-open"))
    expect(screen.getByLabelText("Stage")).toBeTruthy()
  })
})

describe("ChangeStage — stage dropdown", () => {
  it("picking a stage fires the change", async () => {
    const onChanged = vi.fn()
    openPanel({}, onChanged)

    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "chat_scheduled" } })

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = authFetchMock.mock.calls[0]
    expect(url).toBe("/api/network/contacts/c1/stage")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body).stage).toBe("chat_scheduled")
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  it("offers every stage, including both dormant ones, in one control", () => {
    // The addition to the spec: this is the ONLY place on the record that reaches
    // all eleven. If it ever narrows to the quick-action stages, someone needing
    // "Keeping in touch" has to leave the record to set it.
    openPanel()
    const select = screen.getByLabelText("Stage") as HTMLSelectElement
    expect(select.options).toHaveLength(11)
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toContain("dormant_no_answer")
    expect(values).toContain("dormant_declined")
    expect(Array.from(select.options).map((o) => o.text)).toContain("Keeping in touch")
  })

  it("can move backwards, not just forwards", async () => {
    openPanel({ stage: "chat_done" })
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "replied" } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(authFetchMock.mock.calls[0][1].body).stage).toBe("replied")
  })

  it("re-enables the control after a failed change and surfaces the error", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: async () => ({ ok: false, error: "Forbidden" }) } as unknown as Response),
    )
    openPanel()
    const select = screen.getByLabelText("Stage") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "replied" } })

    await waitFor(() => expect(screen.getByText("Forbidden")).toBeTruthy())
    expect(select.disabled).toBe(false)
  })
})

describe("the two behaviours that rode along with the dropdown", () => {
  it("outcome type is settable at the outcome stage", async () => {
    openPanel({ stage: "outcome" })
    expect(screen.getByTestId("outcome-types")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Referral" }))
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(authFetchMock.mock.calls[0][1].body)
    expect(body.outcome_type).toBe("referral")
    // The stage rides along unchanged — this is a sub-attribute write, not a move.
    expect(body.stage).toBe("outcome")
  })

  it("does not offer outcome type at any other stage", () => {
    openPanel({ stage: "replied" })
    expect(screen.queryByTestId("outcome-types")).toBeNull()
  })

  it("suggests Referral after requesting an intro, and applies it on accept", async () => {
    openPanel({ relationship: "cold" })
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "intro_requested" } })

    await waitFor(() => expect(screen.getByText(/usually turns a contact into a/i)).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /Set to Referral/i }))

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(2))
    const [url, init] = authFetchMock.mock.calls[1]
    expect(url).toBe("/api/network/contacts/c1")
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body).relationship).toBe("referred")
  })

  it("does not suggest Referral when the contact already is", async () => {
    openPanel({ relationship: "referred" })
    fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "intro_requested" } })
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/usually turns a contact into a/i)).toBeNull()
  })
})
