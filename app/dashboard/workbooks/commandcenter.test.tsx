// The Coach Command Center, rendered from a small self-contained case.
//
// Pinned: the case prompt shown is the client's own block; each Copy button
// copies exactly the student-safe text (the prompt, or a message's `send`) and
// never the private working; a message with nothing to send has no Copy
// button; hints start collapsed; a rating saves through onSaveEvaluation with
// the content's own keys; a body-only coach_only from an older workbook still
// shows its text.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { CoachCommandCenter } from "../../../components/workbook/CoachCommandCenter"
import type { Section } from "../../../lib/workbook/content"

afterEach(cleanup)

const PROMPT = "A regional bakery chain's profits have fallen for two quarters. The owner wants to know why."
const SEND_A = "Revenue $10M last year, $9M this year. Costs $8M both years."
const PRIVATE_A = "Profit fell from $2M to $1M, down 50%."

const caseSection: Section = {
  id: "c1", number: 1, title: "Case 1", blocks: [
    { type: "text", body: PROMPT, case_prompt: true },
    { type: "coach_only", title: "Playbook", guide: {
      opening: ["Read only the case prompt."],
      messages: [
        { label: "A", title: "Financials", send: SEND_A, private: PRIVATE_A },
        { label: "B", title: "Coaching move", private: "Ask what else would matter." },
      ],
      hints: ["What equation connects revenue, cost and profit?"],
    } },
  ],
}
const debrief: Section = {
  id: "c2", number: 2, title: "Debrief", blocks: [
    { type: "coach_only", guide: { rubric: { items: [{ key: "structure", label: "Structure" }, { key: "math", label: "Quantitative reasoning" }] } } },
  ],
}

let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
})

describe("CoachCommandCenter", () => {
  it("shows the client's case prompt and copies exactly it", async () => {
    render(<CoachCommandCenter section={caseSection} first="Alex" evaluation={null} onSaveEvaluation={vi.fn()} />)
    expect(screen.getByText(PROMPT)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPT))
  })

  it("copies only a message's send text, never the private working", async () => {
    render(<CoachCommandCenter section={caseSection} first="Alex" evaluation={null} onSaveEvaluation={vi.fn()} />)
    expect(screen.getByText(PRIVATE_A)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Copy message A" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(SEND_A)
    expect(writeText.mock.calls.flat().join(" ")).not.toContain("Profit fell")
  })

  it("gives a coaching-move message no Copy button", () => {
    render(<CoachCommandCenter section={caseSection} first="Alex" evaluation={null} onSaveEvaluation={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Copy message B" })).toBeNull()
    expect(screen.getByText("Nothing to send. Coaching move only.")).toBeTruthy()
  })

  it("starts every hint collapsed", () => {
    const { container } = render(<CoachCommandCenter section={caseSection} first="Alex" evaluation={null} onSaveEvaluation={vi.fn()} />)
    const details = container.querySelectorAll(".wb-cc-hints details")
    expect(details.length).toBe(1)
    expect((details[0] as HTMLDetailsElement).open).toBe(false)
  })

  it("saves a rating with the content's own keys", async () => {
    const save = vi.fn().mockResolvedValue(true)
    render(<CoachCommandCenter section={debrief} first="Alex" evaluation={null} onSaveEvaluation={save} />)
    const group = screen.getByRole("group", { name: "Quantitative reasoning" })
    fireEvent.click(group.querySelectorAll("button")[1] as HTMLButtonElement)
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toEqual({ section_id: "c2", ratings: { math: { rating: "prompted" } }, note: null })
  })

  it("still shows an older workbook's free-text coach note", () => {
    const old: Section = { id: "o", number: 1, title: "Old", blocks: [{ type: "coach_only", body: "Watch the denominator." }] }
    render(<CoachCommandCenter section={old} first="Alex" evaluation={null} onSaveEvaluation={vi.fn()} />)
    expect(screen.getByText("Watch the denominator.")).toBeTruthy()
  })
})
