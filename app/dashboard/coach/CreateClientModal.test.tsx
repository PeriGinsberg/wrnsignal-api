// Creating a client account never sends the invite. After the account exists
// the form offers Send Invite (the client page's route) and Done.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import CreateClientModal from "./CreateClientModal"

let calls: { url: string; method: string }[] = []
let inviteOk = true

beforeEach(() => {
  calls = []
  inviteOk = true
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" })
    if (url === "/api/coach/create-client") {
      return { ok: true, status: 201, json: async () => ({ ok: true, clientId: "prof-new", invited: false }) } as Response
    }
    if (url.includes("/send-invite")) {
      return inviteOk
        ? ({ ok: true, status: 200, json: async () => ({ ok: true, invited_at: "2026-10-08T12:00:00Z" }) } as Response)
        : ({ ok: false, status: 500, json: async () => ({ ok: false, error: "Postmark is down" }) } as Response)
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function fillAndCreate() {
  fireEvent.change(screen.getByPlaceholderText("First name"), { target: { value: "Lily" } })
  fireEvent.change(screen.getByPlaceholderText("Last name"), { target: { value: "Chen" } })
  fireEvent.change(screen.getByPlaceholderText("client@email.com"), { target: { value: "lily@example.com" } })
  fireEvent.click(screen.getByText(/^Create Account/))
}

describe("CreateClientModal", () => {
  it("says Create Account, not Create Account & Send Invite", () => {
    render(<CreateClientModal onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText(/^Create Account/).textContent).toBe("Create Account →")
    expect(screen.queryByText(/Send Invite/)).toBeNull()
    expect(screen.queryByText(/sent automatically/)).toBeNull()
  })

  it("creating the account sends no invite and offers Send Invite and Done", async () => {
    const onSuccess = vi.fn()
    render(<CreateClientModal onClose={() => {}} onSuccess={onSuccess} />)
    fillAndCreate()
    await waitFor(() => expect(screen.getByText("Send Invite →")).toBeTruthy())
    expect(calls.some((c) => c.url.includes("send-invite"))).toBe(false)
    expect(screen.getByText(/invite not yet sent/)).toBeTruthy()
    expect(screen.getByText("Done")).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("Send Invite calls the client's invite route and confirms", async () => {
    render(<CreateClientModal onClose={() => {}} onSuccess={() => {}} />)
    fillAndCreate()
    await waitFor(() => expect(screen.getByText("Send Invite →")).toBeTruthy())
    fireEvent.click(screen.getByText("Send Invite →"))
    await waitFor(() => expect(screen.getByText(/invite sent to lily@example.com/)).toBeTruthy())
    expect(calls.find((c) => c.url.includes("send-invite"))).toEqual({ url: "/api/coach/clients/prof-new/send-invite", method: "POST" })
    expect(screen.queryByText("Send Invite →")).toBeNull()
  })

  it("a failed invite says so and the account still stands", async () => {
    inviteOk = false
    render(<CreateClientModal onClose={() => {}} onSuccess={() => {}} />)
    fillAndCreate()
    await waitFor(() => expect(screen.getByText("Send Invite →")).toBeTruthy())
    fireEvent.click(screen.getByText("Send Invite →"))
    await waitFor(() => expect(screen.getByText("Postmark is down")).toBeTruthy())
    expect(screen.getByText("Send Invite →")).toBeTruthy()
  })

  it("Done after creating refreshes the list behind", async () => {
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    render(<CreateClientModal onClose={onClose} onSuccess={onSuccess} />)
    fillAndCreate()
    await waitFor(() => expect(screen.getByText("Done")).toBeTruthy())
    fireEvent.click(screen.getByText("Done"))
    expect(onSuccess).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })
})
