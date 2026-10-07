// A task's details: collapsed by default, a checklist from "-" lines, nothing
// at all when read-only and empty, and an editor that saves.

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { TaskDetails } from "./TaskDetails"

afterEach(cleanup)

const TEXT = "Bring these:\n- Your current resume\n- Two job postings"

describe("TaskDetails", () => {
  it("is collapsed by default and opens on click", () => {
    render(<TaskDetails details={TEXT} ink="#000" accent="#00569A" />)
    const toggle = screen.getByRole("button", { name: /details/i })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Your current resume")).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Bring these:")).toBeTruthy()
  })

  it("shows dash lines as a checklist", () => {
    render(<TaskDetails details={TEXT} ink="#000" accent="#00569A" />)
    fireEvent.click(screen.getByRole("button", { name: /details/i }))
    const items = screen.getAllByRole("listitem").map((li) => li.textContent)
    expect(items).toEqual(["Your current resume", "Two job postings"])
  })

  it("renders nothing when read-only and empty", () => {
    const { container } = render(<TaskDetails details={null} ink="#000" accent="#00569A" />)
    expect(container.innerHTML).toBe("")
  })

  it("offers Add details when editable and empty, and saves what is typed", async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<TaskDetails details={null} ink="#000" accent="#00569A" onSave={onSave} taskName="Run Mock Interview" />)
    fireEvent.click(screen.getByRole("button", { name: "+ Add details" }))
    fireEvent.change(screen.getByLabelText("Details for Run Mock Interview"), { target: { value: "- Record it" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("- Record it"))
    await waitFor(() => expect(screen.queryByLabelText("Details for Run Mock Interview")).toBeNull())
  })

  it("saves an emptied box as no details", async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<TaskDetails details={TEXT} ink="#000" accent="#00569A" onSave={onSave} taskName="T" />)
    fireEvent.click(screen.getByRole("button", { name: /details/i }))
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    fireEvent.change(screen.getByLabelText("Details for T"), { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null))
  })
})
