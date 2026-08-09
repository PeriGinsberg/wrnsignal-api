// Notes on a job that was never scanned.
//
// Notes used to be keyed on the job's SCORING RUN, so a job typed in by hand had
// nowhere to put them and the component returned early with "Notes open up once
// this job has been scored by SIGNAL" — a message about scoring that was really
// about storage. Every hand-added job hit it.
//
// The gate came out one commit AFTER the routes switched to application_id, so
// that if notes stop appearing the cause is exactly one change back. These pin
// the state that made the gate safe to remove.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { ClientJobNotes } from "./ClientJobNotes"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", (...a: unknown[]) => fetchMock(...a))
vi.mock("../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, notes: [] }) } as unknown as Response))
})
afterEach(cleanup)

describe("notes on an unscored job", () => {
  it("does NOT gate on a scoring run", async () => {
    render(<ClientJobNotes applicationId="app-1" jobfitRunId={null} />)
    // The message that used to be the whole component.
    expect(screen.queryByText(/scored by SIGNAL/i)).toBeNull()
    // Both composers are present and usable.
    await waitFor(() => expect(screen.getByLabelText("This job")).toBeTruthy())
    expect(screen.getByLabelText("Your cover letter")).toBeTruthy()
  })

  it("READS by application, so an unscored job still fetches", async () => {
    render(<ClientJobNotes applicationId="app-1" jobfitRunId={null} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/notes/applications/app-1")
  })

  it("SAVES on an unscored job, and the body carries no run", async () => {
    render(<ClientJobNotes applicationId="app-1" jobfitRunId={null} />)
    const box = await screen.findByLabelText("This job")
    fireEvent.change(box, { target: { value: "Typed this one in by hand." } })
    fireEvent.click(screen.getAllByRole("button", { name: /Save note/i })[0])

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST")
      expect(post).toBeTruthy()
      // The route sets the key server-side from the path; the client never
      // sends a run id, which is what made the old NULL-key write possible.
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body).toEqual({ artifact_type: "jobfit", body: "Typed this one in by hand.", visibility: "private" })
      expect("jobfit_run_id" in body).toBe(false)
    })
  })

  it("still works the same way on a SCORED job", async () => {
    render(<ClientJobNotes applicationId="app-2" jobfitRunId="run-9" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // Same URL either way: the run is no longer part of how notes are addressed.
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/notes/applications/app-2")
  })
})
