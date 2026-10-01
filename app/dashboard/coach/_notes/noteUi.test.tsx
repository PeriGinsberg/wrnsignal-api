// The note pieces the client page and the prospect page share.
//
// Pinned (2026-10-01): Action Item is not a type anyone can pick; the topic
// dropdown offers Phase, Deliverable and Milestone; the Add Note panel sends
// the topic; the tracker board groups topic notes under their topic and stays
// out of the way when there are none; an old action item says what its task
// is doing instead of offering a tick.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"
import { LegacyTaskLine, NoteTopicSelect, NoteTypeChips, TopicNotesBoard, firstLine } from "./noteUi"
import { AddNotePanel } from "../clients/[clientId]/AddNotePanel"

afterEach(() => cleanup())

describe("NoteTypeChips", () => {
  it("offers Session Recap and Other, and no Action Item", () => {
    render(<NoteTypeChips value="session_recap" onChange={() => {}} />)
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Session Recap", "Other"])
    expect(screen.queryByText(/Action Item/i)).toBeNull()
  })
  it("selects none for an old action item being edited", () => {
    render(<NoteTypeChips value="action_item" onChange={() => {}} />)
    expect(screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true)
  })
})

describe("NoteTopicSelect", () => {
  it("offers no topic, Phase, Deliverable and Milestone", () => {
    const onChange = vi.fn()
    render(<NoteTopicSelect id="t" value="" onChange={onChange} />)
    const select = screen.getByLabelText("TOPIC") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["No topic", "Phase", "Deliverable", "Milestone"])
    fireEvent.change(select, { target: { value: "milestone" } })
    expect(onChange).toHaveBeenCalledWith("milestone")
  })
})

describe("AddNotePanel", () => {
  it("sends the type, text and topic", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    const onSaved = vi.fn()
    render(<AddNotePanel open onClose={() => {}} onSaved={onSaved} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: "Other" }))
    fireEvent.change(screen.getByLabelText("TOPIC"), { target: { value: "deliverable" } })
    fireEvent.change(screen.getByPlaceholderText("What did you want to capture?"), { target: { value: " Resume v2 sent " } })
    fireEvent.click(screen.getByRole("button", { name: "Save note" }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onSubmit).toHaveBeenCalledWith({ type: "other", body: "Resume v2 sent", topic: "deliverable" })
  })
  it("sends a null topic when none is chosen", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true })
    render(<AddNotePanel open onClose={() => {}} onSaved={() => {}} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByPlaceholderText("What did you want to capture?"), { target: { value: "Recap" } })
    fireEvent.click(screen.getByRole("button", { name: "Save note" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ type: "session_recap", body: "Recap", topic: null }))
  })
  it("offers no Action Item and no due date or owner", () => {
    render(<AddNotePanel open onClose={() => {}} onSaved={() => {}} onSubmit={vi.fn()} />)
    expect(screen.queryByText(/Action Item/i)).toBeNull()
    expect(screen.queryByText("DUE")).toBeNull()
    expect(screen.queryByText("ASSIGN TO")).toBeNull()
  })
})

describe("TopicNotesBoard", () => {
  const notes = [
    { id: "a", topic: "phase" as const, type: "session_recap" as const, body: "Kickoff done\nmore", created_at: "2026-10-01T12:00:00Z" },
    { id: "b", topic: "milestone" as const, type: "other" as const, body: "Offer accepted", created_at: "2026-10-01T12:00:00Z" },
    { id: "c", topic: "phase" as const, type: "other" as const, body: "Search phase", created_at: "2026-10-01T12:00:00Z" },
    { id: "d", topic: null, type: "session_recap" as const, body: "No topic here", created_at: "2026-10-01T12:00:00Z" },
  ]
  it("groups notes under their topic and links each to the note", () => {
    const { container } = render(<TopicNotesBoard notes={notes} noteHref={(id) => `#note-${id}`} />)
    const phase = container.querySelector('[data-topic="phase"]') as HTMLElement
    const deliverable = container.querySelector('[data-topic="deliverable"]') as HTMLElement
    const milestone = container.querySelector('[data-topic="milestone"]') as HTMLElement
    expect(within(phase).getAllByRole("link").map((a) => a.textContent)).toEqual(["Kickoff done", "Search phase"])
    expect(within(phase).getByRole("link", { name: "Kickoff done" }).getAttribute("href")).toBe("#note-a")
    expect(within(deliverable).getByText("None yet")).toBeTruthy()
    expect(within(milestone).getAllByRole("link").map((a) => a.textContent)).toEqual(["Offer accepted"])
    expect(screen.queryByText("No topic here")).toBeNull()
  })
  it("renders nothing when no note has a topic", () => {
    const { container } = render(<TopicNotesBoard notes={[notes[3]]} noteHref={(id) => id} />)
    expect(container.innerHTML).toBe("")
  })
  it("caps a long first line", () => {
    expect(firstLine("x".repeat(200), 10)).toBe("xxxxxxxxx…")
  })
})

describe("LegacyTaskLine", () => {
  it("says what the old action item's task is doing", () => {
    render(<LegacyTaskLine task={{
      id: "t1", status: "done", due_at: new Date(2026, 9, 1, 12).toISOString(),
      due_has_time: false, assignee_profile_id: "c2", assignee_name: "Erin Coach",
    }} />)
    expect(screen.getByText("Now a task, done · Due Thu, Oct 1 · Erin")).toBeTruthy()
  })
  it("offers no checkbox", () => {
    render(<LegacyTaskLine task={null} />)
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.getByText("Old action item")).toBeTruthy()
  })
})
