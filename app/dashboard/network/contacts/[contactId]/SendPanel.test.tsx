// Phase 8d — the full loop, end to end through the three pieces 8a-8c built:
// pickTemplate chooses, the stored body supplies the wording, renderTemplate
// fills it in, and one click copies AND advances the pipeline.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { SendPanel } from "./SendPanel"
import { DEFAULTS_BY_ID } from "../../../../../lib/network-tracker/templates"

const authFetchMock = vi.fn()
vi.mock("../../authFetch", () => ({
  authFetch: (...a: unknown[]) => authFetchMock(...a),
  getToken: async () => "t",
}))

const writeText = vi.fn((_text: string) => Promise.resolve())
Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })

const PROFILE = {
  client_first: "Jordan",
  current_role_title: "Senior Marketing Analyst",
  current_employer: "Northbrook Consumer Group",
  school: "University of Illinois",
  target_role: "Marketing Analytics",
  target_field: "Marketing",
  city: "Chicago",
  affinity_1: "Illinois alumni",
  key_strength: "turning messy data into decisions",
}

// A COLD contact DUE TOUCH 2 — the spec's worked example, which must resolve C2.
const COLD_DUE_T2 = {
  id: "c1", first_name: "Priya", relationship: "cold",
  stage: "sequence_active", next_due_reason: "touch_2",
  network_companies: { name: "Nodal Exchange" },
}

function api(over: Record<string, unknown> = {}) {
  return (url: string) => {
    if (String(url).includes("/actions")) {
      return Promise.resolve({
        ok: true, status: 201,
        json: async () => ({ ok: true, contact: { next_due_at: "2026-08-10T00:00:00Z" } }),
      } as unknown as Response)
    }
    if (String(url).includes("/templates")) {
      const templates = Object.values(DEFAULTS_BY_ID).map((d) => ({
        template_id: d.id, label: d.label, body: d.body, source: "default",
      }))
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({ ok: true, templates }),
      } as unknown as Response)
    }
    return Promise.resolve({
      ok: true, status: 200, json: async () => ({ ok: true, profile: PROFILE, ...over }),
    } as unknown as Response)
  }
}

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  writeText.mockClear()
  authFetchMock.mockImplementation(api())
})

describe("the full loop", () => {
  it("a cold contact due touch 2 gets C2, rendered with profile and contact filled in", async () => {
    render(<SendPanel contact={COLD_DUE_T2} />)
    await waitFor(() => expect(screen.getByTestId("active-template")).toBeTruthy())

    // 8c chose it…
    expect(screen.getByTestId("active-template").textContent).toMatch(/^C2 ·/)

    // …8b filled it in. A contact variable resolved, and no bracket survived.
    const msg = screen.getByTestId("rendered-message").textContent ?? ""
    expect(msg).toContain("Priya")
    expect(msg).not.toMatch(/\[(NAME|FIRM|TARGET_ROLE|CURRENT_ROLE)\]/)
    expect(msg).not.toBe(DEFAULTS_BY_ID.C2.body) // it actually rendered
  })

  it("clicking copies AND logs touch_2, then confirms both", async () => {
    const onLogged = vi.fn()
    render(<SendPanel contact={COLD_DUE_T2} onLogged={onLogged} />)
    await waitFor(() => screen.getByTestId("rendered-message"))
    const msg = screen.getByTestId("rendered-message").textContent ?? ""

    fireEvent.click(screen.getByRole("button", { name: /Copy and mark as sent/i }))

    // Copied the RENDERED text, not the raw template.
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toBe(msg)

    // Logged the action the due reason implies — the same derivation the inline
    // Log button uses, so the two cannot disagree.
    const logCall = authFetchMock.mock.calls.find((c) => String(c[0]).includes("/actions"))
    expect(logCall).toBeTruthy()
    expect(JSON.parse(logCall![1].body).type).toBe("touch_2")

    // Confirms BOTH happened — the whole point of the button.
    await waitFor(() =>
      expect(screen.getByTestId("confirmation").textContent).toMatch(/Copied, and logged as/))
    expect(screen.getByTestId("confirmation").textContent).toMatch(/Touch 2/i)
    // The record refetches, which is how the advanced due date reaches the page.
    expect(onLogged).toHaveBeenCalledTimes(1)
  })

  it("copy only copies and logs NOTHING", async () => {
    render(<SendPanel contact={COLD_DUE_T2} />)
    await waitFor(() => screen.getByTestId("rendered-message"))

    fireEvent.click(screen.getByRole("button", { name: /Copy only/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/actions"))).toBe(false)
    await waitFor(() =>
      expect(screen.getByTestId("confirmation").textContent).toMatch(/Nothing logged/))
  })

  it("does NOT log when the clipboard fails — a false sent is worse than a failed copy", async () => {
    writeText.mockImplementationOnce(() => Promise.reject(new Error("denied")))
    render(<SendPanel contact={COLD_DUE_T2} />)
    await waitFor(() => screen.getByTestId("rendered-message"))

    fireEvent.click(screen.getByRole("button", { name: /Copy and mark as sent/i }))
    await waitFor(() => expect(screen.getByText(/nothing was logged/i)).toBeTruthy())
    expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/actions"))).toBe(false)
  })
})

describe("warnings before copy", () => {
  it("a toFill blank warns, and still allows the copy", async () => {
    // R1 carries [MUTUAL] — a fill-at-send prompt, not missing data.
    const referred = { ...COLD_DUE_T2, relationship: "referred", next_due_reason: null, stage: "identified" }
    render(<SendPanel contact={referred} />)
    await waitFor(() => screen.getByTestId("rendered-message"))

    const warn = screen.getByTestId("gap-warning")
    expect(warn.textContent).toMatch(/\[MUTUAL\]/)
    expect(warn.textContent).toMatch(/before sending/i)

    // Warned, not blocked.
    fireEvent.click(screen.getByRole("button", { name: /Copy only/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  })

  it("an unresolved PROFILE variable warns separately from a fill-at-send blank", async () => {
    // C1 (cold, first outreach) is the one that carries profile variables —
    // CURRENT_ROLE, CURRENT_EMPLOYER, TARGET_ROLE, CITY. C2 has only [NAME] and
    // a fill-at-send prompt, so an empty profile leaves it with nothing
    // unresolved, which is correct and would prove nothing here.
    const coldFirst = { ...COLD_DUE_T2, next_due_reason: null, stage: "identified" }
    authFetchMock.mockImplementation(api({ profile: { client_first: "Jordan" } })) // almost empty
    render(<SendPanel contact={coldFirst} />)
    await waitFor(() => screen.getByTestId("rendered-message"))

    const warn = screen.getByTestId("gap-warning")
    expect(warn.textContent).toMatch(/Still unfilled/)
    // And the message shows blanks, never raw brackets.
    expect(screen.getByTestId("rendered-message").textContent).not.toMatch(/\[TARGET_ROLE\]/)
  })
})

describe("no suggestion", () => {
  it("offers the full list instead of an error when pickTemplate returns null", async () => {
    const noRel = { id: "c9", first_name: "Sam", relationship: null, stage: "identified", next_due_reason: null }
    render(<SendPanel contact={noRel} />)
    await waitFor(() => screen.getByLabelText("Template"))

    expect(screen.getByText(/Set a relationship to get a suggested template/i)).toBeTruthy()
    const select = screen.getByLabelText("Template") as HTMLSelectElement
    expect(select.options.length).toBe(25) // 24 + the "Choose a template…" row

    // Picking one renders it.
    fireEvent.change(select, { target: { value: "S1" } })
    await waitFor(() => expect(screen.getByTestId("active-template").textContent).toMatch(/^S1 ·/))
  })
})
