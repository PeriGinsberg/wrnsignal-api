// Component tests for the add-contact form's return path.
//
// The loop this closes: an application knew its company, sent the user here,
// and used to forget both the company and the way back. These assert the
// prefill survives and that the return is offered WITHOUT being forced.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { AddContactForm } from "./AddContactForm"

const authFetchMock = vi.fn()
vi.mock("./authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
  // Real behaviour under a test URL with no ?client_profile_id: no subject,
  // and every href passes through untouched.
  subjectId: () => null,
  withSubject: (href: string) => href,
}))

const created = () =>
  Promise.resolve({
    ok: true, status: 201,
    json: async () => ({ ok: true, contact: { id: "ct-9", first_name: "Dana", last_name: "Reed" } }),
  } as unknown as Response)

/** The company list the typeahead reads on mount. */
const companies = () =>
  Promise.resolve({
    ok: true, status: 200,
    json: async () => ({ ok: true, companies: [{ id: "co-1", name: "Globex" }] }),
  } as unknown as Response)

/** The POST, found by method rather than by call index. */
const postCall = () =>
  authFetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation((url: string, init?: RequestInit) =>
    init?.method === "POST" ? created() : companies())
})

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Dana" } })
  fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: "Reed" } })
  fireEvent.click(screen.getByRole("button", { name: /^Add contact$/ }))
}

describe("AddContactForm prefill", () => {
  it("opens with the company already filled in", () => {
    render(<AddContactForm initialCompany="Globex" onClose={() => {}} onCreated={() => {}} />)
    expect((screen.getByLabelText(/^Company/) as HTMLInputElement).value).toBe("Globex")
  })

  it("sends that company on submit", async () => {
    render(<AddContactForm initialCompany="Globex" onClose={() => {}} onCreated={() => {}} />)
    fillAndSubmit()
    await waitFor(() => expect(postCall()).toBeTruthy())
    expect(JSON.parse((postCall()![1] as RequestInit).body as string).company_name).toBe("Globex")
  })

  // The route matches case-insensitively and CREATES on no match, which is
  // correct and silent. These assert the field says which one is about to
  // happen, so a typo is caught before it becomes a duplicate company.
  it("says the company already exists when the name matches one", async () => {
    render(<AddContactForm initialCompany="globex" onClose={() => {}} onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByTestId("company-hint").textContent).toBe("Adds to Globex"))
  })

  it("warns that an unmatched name will create a company", async () => {
    render(<AddContactForm initialCompany="Globbex" onClose={() => {}} onCreated={() => {}} />)
    await waitFor(() =>
      expect(screen.getByTestId("company-hint").textContent).toBe("New company. It will be created."))
  })

  it("says nothing at all when the field is empty", async () => {
    render(<AddContactForm onClose={() => {}} onCreated={() => {}} />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    expect(screen.queryByTestId("company-hint")).toBeNull()
  })

  it("offers the board's companies as suggestions", async () => {
    const { container } = render(<AddContactForm onClose={() => {}} onCreated={() => {}} />)
    await waitFor(() =>
      expect(container.querySelector('datalist option[value="Globex"]')).toBeTruthy())
    expect((screen.getByLabelText(/^Company/) as HTMLInputElement).getAttribute("list"))
      .toBe("add-contact-companies")
  })
})

describe("AddContactForm return path", () => {
  it("offers the named way back after saving", async () => {
    render(
      <AddContactForm
        initialCompany="Globex"
        returnTo="/dashboard/tracker/app-1"
        returnLabel="Operations Analyst at Globex"
        onClose={() => {}}
        onCreated={() => {}}
      />,
    )
    fillAndSubmit()
    const back = await screen.findByTestId("return-to-origin")
    expect(back.textContent).toBe("Back to Operations Analyst at Globex")
    expect(back.getAttribute("href")).toBe("/dashboard/tracker/app-1")
  })

  it("does NOT redirect on save: the contact and 'add another' are still reachable", async () => {
    render(
      <AddContactForm
        initialCompany="Globex"
        returnTo="/dashboard/tracker/app-1"
        returnLabel="Operations Analyst at Globex"
        onClose={() => {}}
        onCreated={() => {}}
      />,
    )
    fillAndSubmit()
    await screen.findByTestId("return-to-origin")
    // Someone who came here to staff one company usually has a second person
    // in mind, and the panel also explains the contact will not appear on the
    // worklist. An auto-redirect would take both away.
    expect(screen.getByRole("link", { name: "Open contact" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add another" })).toBeTruthy()
  })

  it("keeps the company when adding another, rather than clearing it", async () => {
    render(<AddContactForm initialCompany="Globex" onClose={() => {}} onCreated={() => {}} />)
    fillAndSubmit()
    fireEvent.click(await screen.findByRole("button", { name: "Add another" }))
    expect((screen.getByLabelText(/^Company/) as HTMLInputElement).value).toBe("Globex")
  })

  it("falls back to generic wording when there is a return but no label", async () => {
    render(<AddContactForm returnTo="/dashboard/tracker/app-1" onClose={() => {}} onCreated={() => {}} />)
    fillAndSubmit()
    expect((await screen.findByTestId("return-to-origin")).textContent).toBe("Back to where you were")
  })

  it("shows no return control at all when there is nowhere to return to", async () => {
    render(<AddContactForm onClose={() => {}} onCreated={() => {}} />)
    fillAndSubmit()
    await screen.findByRole("link", { name: "Open contact" })
    expect(screen.queryByTestId("return-to-origin")).toBeNull()
  })
})
