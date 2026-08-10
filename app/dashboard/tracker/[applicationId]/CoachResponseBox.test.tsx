// Component tests for the coach-sourced response box.
//
// The rules that matter, and why each is here rather than assumed:
//
//   IT RENDERS ONLY WHEN THERE IS AN OPEN QUESTION. A box asking "let your
//   coach know" on a job no coach sent, or on one already answered, is worse
//   than no box — it invites an answer that means nothing.
//
//   "Not interested" STORES not_for_me. The label and the stored value differ
//   on purpose; the CHECK constraint allows not_for_me and rejects the
//   friendlier-sounding not_interested. The route that got this wrong was
//   deleted the same day. A test that only checked "it PATCHed" would pass
//   while sending a value the database refuses.
//
//   IT STAYS PUT ON FAILURE. Its predecessor swallowed write errors and let the
//   client believe they had answered. Disappearing on a failed save is the one
//   behaviour that reproduces the original bug.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { CoachResponseBox } from "./CoachResponseBox"

const authFetchMock = vi.fn()
vi.mock("../../network/authFetch", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  getToken: async () => "test-token",
}))

const json = (body: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: async () => body } as unknown as Response)

const APP_ID = "app-1"
const REC = { id: "rec-1", application_id: APP_ID, client_status: "new" }

/** Routes by URL so no test depends on call ordering. */
function routeFetch({ recs = [REC], respondOk = true }: { recs?: unknown[]; respondOk?: boolean } = {}) {
  return (url: string) => {
    const u = String(url)
    if (u.includes("/respond")) return json(respondOk ? { ok: true } : { error: "nope" }, respondOk, respondOk ? 200 : 500)
    if (u.startsWith("/api/coach/my-recommendations")) return json({ ok: true, recommendations: recs })
    throw new Error(`unexpected url ${u}`)
  }
}

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
const respondCalls = () => authFetchMock.mock.calls.filter((c) => String(c[0]).includes("/respond"))

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
})

describe("CoachResponseBox — when it appears", () => {
  it("renders for a coach-sourced job the client has not answered", async () => {
    authFetchMock.mockImplementation(routeFetch())
    render(<CoachResponseBox applicationId={APP_ID} />)
    expect(await screen.findByTestId("coach-response-box")).toBeTruthy()
    expect(screen.getByText(/let your coach know if you're interested/i)).toBeTruthy()
  })

  it("renders nothing when no coach sourced this job", async () => {
    authFetchMock.mockImplementation(routeFetch({ recs: [] }))
    const { container } = render(<CoachResponseBox applicationId={APP_ID} />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="coach-response-box"]')).toBeNull()
  })

  it("renders nothing once the client has already answered", async () => {
    authFetchMock.mockImplementation(
      routeFetch({ recs: [{ ...REC, client_status: "interested" }] }),
    )
    const { container } = render(<CoachResponseBox applicationId={APP_ID} />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="coach-response-box"]')).toBeNull()
  })

  it("ignores a recommendation belonging to a different job", async () => {
    authFetchMock.mockImplementation(
      routeFetch({ recs: [{ ...REC, application_id: "some-other-app" }] }),
    )
    const { container } = render(<CoachResponseBox applicationId={APP_ID} />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="coach-response-box"]')).toBeNull()
  })

  it("stays silent when the lookup fails — this box is an extra, not the page", async () => {
    authFetchMock.mockImplementation(() => json({ error: "boom" }, false, 500))
    const { container } = render(<CoachResponseBox applicationId={APP_ID} />)
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="coach-response-box"]')).toBeNull()
    expect(container.textContent).toBe("")
  })
})

describe("CoachResponseBox — what it sends", () => {
  it("Interested stores 'interested'", async () => {
    authFetchMock.mockImplementation(routeFetch())
    render(<CoachResponseBox applicationId={APP_ID} />)
    fireEvent.click(await screen.findByText("Interested"))
    await waitFor(() => expect(respondCalls().length).toBe(1))
    expect(String(respondCalls()[0][0])).toBe("/api/coach/my-recommendations/rec-1/respond")
    expect(bodyOf(respondCalls()[0])).toEqual({ client_status: "interested" })
  })

  it("Not interested stores 'not_for_me', NOT 'not_interested'", async () => {
    authFetchMock.mockImplementation(routeFetch())
    render(<CoachResponseBox applicationId={APP_ID} />)
    fireEvent.click(await screen.findByText("Not interested"))
    await waitFor(() => expect(respondCalls().length).toBe(1))
    const sent = bodyOf(respondCalls()[0])
    expect(sent).toEqual({ client_status: "not_for_me" })
    // The value the deleted route used, which the CHECK constraint rejects.
    expect(sent.client_status).not.toBe("not_interested")
    expect(sent.client_status).not.toBe("passed")
  })
})

describe("CoachResponseBox — after answering", () => {
  it("disappears on success and tells the page to refresh", async () => {
    authFetchMock.mockImplementation(routeFetch())
    const onResponded = vi.fn()
    const { container } = render(<CoachResponseBox applicationId={APP_ID} onResponded={onResponded} />)
    fireEvent.click(await screen.findByText("Interested"))
    await waitFor(() =>
      expect(container.querySelector('[data-testid="coach-response-box"]')).toBeNull(),
    )
    expect(onResponded).toHaveBeenCalledTimes(1)
  })

  it("STAYS and surfaces the error when the write fails", async () => {
    authFetchMock.mockImplementation(routeFetch({ respondOk: false }))
    const onResponded = vi.fn()
    render(<CoachResponseBox applicationId={APP_ID} onResponded={onResponded} />)
    fireEvent.click(await screen.findByText("Interested"))
    expect(await screen.findByText(/didn't save/i)).toBeTruthy()
    expect(screen.getByTestId("coach-response-box")).toBeTruthy()
    expect(onResponded).not.toHaveBeenCalled()
  })

  it("a second click while in flight does not send twice", async () => {
    authFetchMock.mockImplementation(routeFetch())
    render(<CoachResponseBox applicationId={APP_ID} />)
    const btn = await screen.findByText("Interested")
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(respondCalls().length).toBe(1))
  })
})
