// The "Add workbook" modal.
//
// The load-bearing claim is the last test: the modal posts THREE NAMES and a
// template id, never content. If it ever posts content, a coach's browser
// becomes the author of what a client reads, and the server's copy of the
// template stops being the thing that matters.
//
// Also pinned: the preview is the client's view by default (coach-only blocks
// absent until the toggle), the names reach the preview as typed, and Create is
// refused while a name is empty.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { AddWorkbookModal } from "./AddWorkbookModal"
import { getTemplate, listTemplates } from "../../../../../lib/workbook/templates"
import { wbFetch } from "../../../../../components/workbook/api"

vi.mock("../../../../../components/workbook/api", () => ({ wbFetch: vi.fn(), getToken: vi.fn() }))
const mockFetch = vi.mocked(wbFetch)

const TEMPLATE_ID = "session-1-foundations"
const template = getTemplate(TEMPLATE_ID)!

/** The three GETs the modal makes, in whatever order it makes them. */
function routeGets(overrides: { profileName?: string } = {}) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { status: 201, body: { ok: true, workbook: { id: "wb-1" } } } as any
    if (url === "/api/coach/workbook-templates") {
      return { status: 200, body: { ok: true, templates: listTemplates() } } as any
    }
    if (url.startsWith("/api/coach/workbook-templates/")) {
      return { status: 200, body: { ok: true, template } } as any
    }
    if (url === "/api/profile") {
      return { status: 200, body: { ok: true, profile: { name: overrides.profileName ?? "Peri Ginsberg" } } } as any
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

function open() {
  return render(
    <AddWorkbookModal
      clientId="client-1" clientName="Alex Rivera"
      onClose={() => {}} onCreated={() => {}}
    />,
  )
}

/** Step one: pick the template, so the rest of the tests start on the preview. */
async function pick() {
  open()
  const card = await screen.findByText(template.title)
  fireEvent.click(card.closest("button")!)
  await screen.findByText("Check it over")
}

beforeEach(() => { mockFetch.mockReset(); routeGets() })
afterEach(cleanup)

describe("picking a template", () => {
  it("lists what the coach is committing to", async () => {
    open()
    await screen.findByText(template.title)
    expect(screen.getByText(new RegExp(`${template.sections} sections?, ${template.fields} write-ins?`))).toBeTruthy()
  })
})

describe("the preview", () => {
  it("fills the names from the records, and shows them", async () => {
    await pick()
    expect((screen.getByLabelText(/What you call them/) as HTMLInputElement).value).toBe("Alex")
    expect((screen.getByLabelText(/Their full name/) as HTMLInputElement).value).toBe("Alex Rivera")
    await waitFor(() =>
      expect((screen.getByLabelText(/Your first name/) as HTMLInputElement).value).toBe("Peri"))
  })

  it("re-renders as the coach corrects a name", async () => {
    await pick()
    await waitFor(() => expect(screen.getAllByText(/Alex/).length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText(/What you call them/), { target: { value: "Xander" } })
    await waitFor(() => expect(screen.getAllByText(/Xander/).length).toBeGreaterThan(0))
  })

  it("is the client's view until the coach asks for their own notes", async () => {
    const coachOnlyBlocks = template.content.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b.type === "coach_only")
    expect(coachOnlyBlocks.length,
      "the template needs coach_only blocks for this test to mean anything").toBeGreaterThan(0)

    await pick()
    // Every coach_only block renders this marker, so counting them is the same
    // question as "are the coach's notes on screen", without depending on prose.
    const marker = /The client never sees this/
    expect(screen.queryAllByText(marker)).toHaveLength(0)
    fireEvent.click(screen.getByRole("checkbox"))
    await waitFor(() =>
      expect(screen.queryAllByText(marker)).toHaveLength(coachOnlyBlocks.length))
  })

  it("will not create with a name missing", async () => {
    await pick()
    fireEvent.change(screen.getByLabelText(/Their full name/), { target: { value: "  " } })
    expect((screen.getByText("Create draft").closest("button") as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("creating", () => {
  it("posts the names and the template id, and no content", async () => {
    await pick()
    await waitFor(() =>
      expect((screen.getByLabelText(/Your first name/) as HTMLInputElement).value).toBe("Peri"))
    fireEvent.click(screen.getByText("Create draft"))

    await waitFor(() => expect(mockFetch.mock.calls.some((c) => c[1]?.method === "POST")).toBe(true))
    const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST")!
    expect(post[0]).toBe("/api/coach/clients/client-1/workbooks")
    const sent = JSON.parse(String(post[1]!.body))
    expect(sent).toEqual({
      template_id: TEMPLATE_ID,
      first_name: "Alex",
      full_name: "Alex Rivera",
      coach_first_name: "Peri",
    })
    // Said twice on purpose: no content, no sections, under any key.
    expect(Object.keys(sent)).not.toContain("content")
    expect(JSON.stringify(sent)).not.toContain("sections")
  })

  it("hands the new workbook back to the tab", async () => {
    const onCreated = vi.fn()
    render(
      <AddWorkbookModal
        clientId="client-1" clientName="Alex Rivera"
        onClose={() => {}} onCreated={onCreated}
      />,
    )
    const card = await screen.findByText(template.title)
    fireEvent.click(card.closest("button")!)
    await screen.findByText("Check it over")
    await waitFor(() =>
      expect((screen.getByLabelText(/Your first name/) as HTMLInputElement).value).toBe("Peri"))
    fireEvent.click(screen.getByText("Create draft"))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("wb-1"))
  })

  it("shows the server's refusal rather than pretending it worked", async () => {
    await pick()
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? ({ status: 403, body: { ok: false, error: "Forbidden" } } as any)
        : ({ status: 200, body: { ok: true, template } } as any))
    fireEvent.click(screen.getByText("Create draft"))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Forbidden"))
  })
})
