// Component tests for the running notes log.
//
// Clicks Save the way a user does — finds the button by its visible name and
// clicks it — rather than reaching for the handler. Per the audit, a test that
// invokes the handler proves the handler works while saying nothing about
// whether anyone can reach it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { NotesLog, type NoteEntry } from "./NotesLog"

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
  Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true }) } as unknown as Response)

const existing: NoteEntry[] = [
  { id: "n1", type: "note", action_date: "2026-07-20T10:00:00.000Z", note: "Met at the FIA conference." },
  { id: "n2", type: "note", action_date: "2026-07-24T10:00:00.000Z", note: "Prefers email over LinkedIn." },
]

afterEach(cleanup)
beforeEach(() => {
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(ok)
})

describe("NotesLog", () => {
  it("saves a note on click, clears the box, and shows the entry", async () => {
    render(<NotesLog contactId="c1" notes={[]} onSaved={() => {}} />)

    const box = screen.getByLabelText("Add a note") as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "Intro'd me to their VP." } })

    // Click the actual button, by the name a user reads.
    fireEvent.click(screen.getByRole("button", { name: /Save note/i }))

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = authFetchMock.mock.calls[0]
    expect(url).toBe("/api/network/contacts/c1/actions")
    expect(init.method).toBe("POST")

    // The box clears — that is how the user knows it saved.
    await waitFor(() => expect(box.value).toBe(""))
    // …and the note appears in the list below without waiting on a refetch.
    expect(screen.getByText("Intro'd me to their VP.")).toBeTruthy()
  })

  it("posts type 'note' — NOT 'note_logged' — so the route takes the inert path", async () => {
    // This is the whole fix. 'note_logged' carries the worklist's due reasons and
    // IS pipeline activity; sending it here would consume the snooze, move
    // last_action_at and recompute next_due_at.
    render(<NotesLog contactId="c1" notes={[]} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "Quiet since March." } })
    fireEvent.click(screen.getByRole("button", { name: /Save note/i }))

    await waitFor(() => expect(authFetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(authFetchMock.mock.calls[0][1].body)
    expect(body.type).toBe("note")
    expect(body.type).not.toBe("note_logged")
    // No action_date: a note is always "now". Backdating belongs to the Action Log.
    expect(body.action_date).toBeUndefined()
  })

  it("lists existing notes newest first, each with its date", () => {
    render(<NotesLog contactId="c1" notes={existing} onSaved={() => {}} />)
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(2)
    // n2 (Jul 24) must precede n1 (Jul 20).
    expect(items[0].textContent).toContain("Prefers email over LinkedIn.")
    expect(items[1].textContent).toContain("Met at the FIA conference.")
    expect(items[0].textContent).toMatch(/Jul 24, 2026/)
  })

  it("does not save an empty or whitespace-only note", () => {
    render(<NotesLog contactId="c1" notes={[]} onSaved={() => {}} />)
    const button = screen.getByRole("button", { name: /Save note/i }) as HTMLButtonElement

    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(authFetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "   " } })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(authFetchMock).not.toHaveBeenCalled()
  })

  it("keeps the text on failure so the note is not lost", async () => {
    authFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: "Log failed" }) } as unknown as Response),
    )
    render(<NotesLog contactId="c1" notes={[]} onSaved={() => {}} />)
    const box = screen.getByLabelText("Add a note") as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "Do not lose me." } })
    fireEvent.click(screen.getByRole("button", { name: /Save note/i }))

    await waitFor(() => expect(screen.getByText("Log failed")).toBeTruthy())
    expect(box.value).toBe("Do not lose me.")
  })
})
