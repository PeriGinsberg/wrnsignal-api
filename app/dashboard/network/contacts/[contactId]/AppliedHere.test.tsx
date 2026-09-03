// Component tests for "what you've already applied to here".
//
// The states that matter are the two silent ones and the one that must NOT be
// silent. Nothing applied renders nothing, because not having applied is the
// normal case and often the whole reason for networking. A FAILED CHECK does
// render, because a swallowed failure looks exactly like "nothing applied" and
// would hide the single fact this component exists to surface.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import { AppliedHere } from "./AppliedHere"

const authFetchMock = vi.fn()
vi.mock("../../authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
  // Real behaviour under a test URL with no ?client_profile_id: no subject,
  // and every href passes through untouched.
  subjectId: () => null,
  withSubject: (href: string) => href,
}))

const respond = (applications: unknown[]) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, applications }) } as unknown as Response)

const APPS = [
  {
    id: "app-1", company_name: "Globex", job_title: "Operations Analyst",
    application_status: "applied", applied_date: "2026-08-12",
    signal_score: 71, signal_decision: "Review", created_at: "2026-08-10T00:00:00.000Z",
  },
  {
    id: "app-2", company_name: "Globex", job_title: "Data Coordinator",
    application_status: "saved", applied_date: null,
    signal_score: null, signal_decision: null, created_at: "2026-08-09T00:00:00.000Z",
  },
]

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(() => respond(APPS))
})

describe("AppliedHere", () => {
  it("reads the SCOPED endpoint, not the full applications list", async () => {
    render(<AppliedHere companyId="co-1" companyName="Globex" />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    // The narrow projection is the whole reason ?company_id= exists: the
    // unfiltered read carries the full pasted job description per row.
    expect(authFetchMock.mock.calls[0][0]).toBe("/api/applications?company_id=co-1")
  })

  it("names the company and counts the jobs", async () => {
    render(<AppliedHere companyId="co-1" companyName="Globex" />)
    expect(await screen.findByText(/You've applied to 2 jobs at Globex\./)).toBeTruthy()
  })

  it("says 'a job' rather than '1 jobs' for a single application", async () => {
    authFetchMock.mockImplementation(() => respond([APPS[0]]))
    render(<AppliedHere companyId="co-1" companyName="Globex" />)
    expect(await screen.findByText(/You've applied to a job at Globex\./)).toBeTruthy()
  })

  it("shows each role, its status in words, and links back to the application", async () => {
    render(<AppliedHere companyId="co-1" companyName="Globex" />)
    const link = await screen.findByRole("link", { name: "Operations Analyst" })
    expect(link.getAttribute("href")).toBe("/dashboard/tracker/app-1")
    // Status reads as words from the shared tracker vocabulary, never a raw
    // column value, and never as a button.
    expect(screen.getByText("Applied")).toBeTruthy()
    expect(screen.getByText("Saved")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("shows the applied date only when there is one", async () => {
    render(<AppliedHere companyId="co-1" companyName="Globex" />)
    // app-1 applied 2026-08-12; app-2 is only saved, so it has no date.
    expect(await screen.findByText("Aug 12")).toBeTruthy()
    expect(screen.queryByText("Aug 9")).toBeNull()
  })

  it("renders NOTHING when there are no applications at this company", async () => {
    authFetchMock.mockImplementation(() => respond([]))
    const { container } = render(<AppliedHere companyId="co-1" companyName="Globex" />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(""))
  })

  it("SPEAKS UP when the check fails, rather than looking like 'none'", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false }) } as unknown as Response))
    render(<AppliedHere companyId="co-1" companyName="Globex" />)
    expect(await screen.findByText(/couldn't check whether you've applied at Globex/i)).toBeTruthy()
  })

  it("also speaks up when the request throws", async () => {
    authFetchMock.mockImplementation(() => Promise.reject(new Error("offline")))
    render(<AppliedHere companyId="co-1" companyName="Globex" />)
    expect(await screen.findByText(/couldn't check whether you've applied at Globex/i)).toBeTruthy()
  })

  it("encodes the company id into the query string", async () => {
    render(<AppliedHere companyId="a b&c" companyName="Globex" />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    expect(authFetchMock.mock.calls[0][0]).toBe("/api/applications?company_id=a%20b%26c")
  })
})
