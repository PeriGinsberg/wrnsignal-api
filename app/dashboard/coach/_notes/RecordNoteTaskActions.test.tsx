// The record's Add Note and Add Task buttons, shared by the prospect page and
// the converted-client page (coach-clients/[id]).
//
// Pinned: Add Note posts type, text and topic to the relationship's notes
// route and tells the page to re-read; a refused save shows the server's
// sentence and keeps the panel open. Add Task opens the form fixed to the
// relationship (labelled for what the record is), offers only the coaches who
// can open it, and saves against coach_client_id with no client profile.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { useRecordNoteTaskActions, type RecordNoteTaskOptions } from "./RecordNoteTaskActions"
import { apiJson } from "../_tasks/taskClient"

vi.mock("../_tasks/taskClient", async (orig) => ({
  ...(await orig<typeof import("../_tasks/taskClient")>()),
  apiJson: vi.fn(),
}))
const mockApi = vi.mocked(apiJson)

afterEach(() => { cleanup(); mockApi.mockReset() })

const ASSIGNEES = {
  me: "c1",
  assignees: [
    { id: "c1", name: "Peri Ginsberg", email: null, active: true },
    { id: "c2", name: "Erin Coach", email: null, active: true },
  ],
}

function Harness(props: Partial<RecordNoteTaskOptions>) {
  const { element, openNote } = useRecordNoteTaskActions({
    coachClientId: "cc-1",
    name: "Jamie Rivera",
    recordLabel: "Client",
    onNoteSaved: () => {},
    onTaskSaved: () => {},
    ...props,
  })
  return (
    <div>
      {element}
      <button type="button" onClick={openNote}>section add note</button>
    </div>
  )
}

function routeApi(handlers: Record<string, (opts?: RequestInit) => unknown>) {
  mockApi.mockImplementation(async (url: string, opts?: RequestInit) => {
    for (const [prefix, h] of Object.entries(handlers)) if (url.startsWith(prefix)) return h(opts) as any
    throw new Error(`unexpected call ${url}`)
  })
}

describe("useRecordNoteTaskActions", () => {
  it("shows both buttons and asks for the coaches who can open this record", async () => {
    routeApi({ "/api/coach/tasks/assignees": () => ASSIGNEES })
    render(<Harness />)
    expect(screen.getByRole("button", { name: "Add Note" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add Task" })).toBeTruthy()
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/coach/tasks/assignees?coach_client_id=cc-1"))
  })

  it("Add Note posts type, text and topic to the record's notes route", async () => {
    const posted: unknown[] = []
    routeApi({
      "/api/coach/tasks/assignees": () => ASSIGNEES,
      "/api/coach/prospects/cc-1/notes": (o) => { posted.push(JSON.parse(String(o?.body))); return { ok: true } },
    })
    const onNoteSaved = vi.fn()
    render(<Harness onNoteSaved={onNoteSaved} />)
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }))
    fireEvent.click(screen.getByRole("radio", { name: "Other" }))
    fireEvent.change(screen.getByLabelText("TOPIC"), { target: { value: "milestone" } })
    fireEvent.change(screen.getByPlaceholderText("What did you want to capture?"), { target: { value: "Offer accepted" } })
    fireEvent.click(screen.getByRole("button", { name: "Save note" }))
    await waitFor(() => expect(onNoteSaved).toHaveBeenCalled())
    expect(posted).toEqual([{ type: "other", body: "Offer accepted", topic: "milestone" }])
  })

  it("a refused note shows the server's sentence and nothing is reported saved", async () => {
    routeApi({
      "/api/coach/tasks/assignees": () => ASSIGNEES,
      "/api/coach/prospects/cc-1/notes": () => { throw new Error("Forbidden: annotate or full access required") },
    })
    const onNoteSaved = vi.fn()
    render(<Harness onNoteSaved={onNoteSaved} />)
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }))
    fireEvent.change(screen.getByPlaceholderText("What did you want to capture?"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Save note" }))
    await waitFor(() => expect(screen.getByText("Forbidden: annotate or full access required")).toBeTruthy())
    expect(onNoteSaved).not.toHaveBeenCalled()
  })

  it("the page's own '+ Add note' opens the same panel", () => {
    routeApi({ "/api/coach/tasks/assignees": () => ASSIGNEES })
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "section add note" }))
    expect(screen.getByPlaceholderText("What did you want to capture?")).toBeTruthy()
  })

  it("Add Task saves against the relationship, fixed and labelled for the record", async () => {
    const posted: any[] = []
    routeApi({
      "/api/coach/tasks/assignees": () => ASSIGNEES,
      "/api/coach/tasks": (o) => { posted.push(JSON.parse(String(o?.body))); return { task: { id: "t1" } } },
    })
    const onTaskSaved = vi.fn()
    render(<Harness onTaskSaved={onTaskSaved} />)
    await waitFor(() => expect(mockApi).toHaveBeenCalled())
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }))
    expect(screen.getByText("Client")).toBeTruthy()
    expect(screen.getByText("Jamie Rivera")).toBeTruthy()
    expect(screen.queryByLabelText("Client (optional)")).toBeNull()
    const owner = screen.getByLabelText("Assignee") as HTMLSelectElement
    expect(Array.from(owner.options).map((o) => o.value)).toEqual(["c1", "c2"])
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Send SOW" } })
    fireEvent.click(screen.getByRole("button", { name: "Create task" }))
    await waitFor(() => expect(onTaskSaved).toHaveBeenCalled())
    expect(posted[0]).toMatchObject({ title: "Send SOW", coach_client_id: "cc-1", client_profile_id: null, assignee_profile_id: "c1" })
  })
})
