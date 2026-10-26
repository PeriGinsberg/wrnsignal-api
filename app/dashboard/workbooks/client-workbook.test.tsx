// The workbook page is full-bleed, so its header carries the way back into
// SIGNAL: a networking workbook to its contact (or the board), every other
// workbook to the Coaching Hub. And with no coach, nothing offers to send.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ClientWorkbook } from "../../../components/workbook/ClientWorkbook"
import { wbFetch } from "../../../components/workbook/api"
import { applyTemplate, type WorkbookContent } from "../../../lib/workbook/content"
import { getNetworkingTemplate, getTemplate } from "../../../lib/workbook/templates"

vi.mock("../../../components/workbook/api", async (orig) => ({ ...(await orig<typeof import("../../../components/workbook/api")>()), wbFetch: vi.fn() }))
const mockFetch = vi.mocked(wbFetch)
// next/font only works inside the Next compiler; the frame just needs a class name.
vi.mock("../../../components/workbook/fonts", () => ({ workbookFontClass: "" }))

const VALUES = {
  first_name: "Alex", full_name: "Alex Rivera", coach_first_name: "Peri",
  contact_full_name: "Jordan Lee", contact_first_name: "Jordan", contact_title: "", contact_company: "Acme",
}
const networking = applyTemplate(getNetworkingTemplate().content, VALUES) as WorkbookContent
const session = applyTemplate(getTemplate("session-1-foundations")!.content, VALUES) as WorkbookContent

function serve(workbook: Record<string, unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/opened")) return { status: 200, body: { ok: true } } as any
    return {
      status: 200,
      body: {
        ok: true,
        workbook: { id: "wb-1", status: "with_client", interview: null, homework_completed_at: null, ...workbook },
        answers: {}, comments: [], sends: [],
      },
    } as any
  })
  render(<ClientWorkbook workbookId="wb-1" />)
}

const back = async () => (await screen.findByTestId("workbook-back")) as HTMLAnchorElement

beforeEach(() => {
  mockFetch.mockReset()
  window.history.replaceState({}, "", "/dashboard/workbooks/wb-1")
})
afterEach(cleanup)

describe("the way back", () => {
  it("returns a networking workbook to its contact", async () => {
    serve({ content: networking, network_contact_id: "ct-1", has_coach: true })
    const a = await back()
    expect(a.getAttribute("href")).toBe("/dashboard/network/contacts/ct-1")
    expect(a.textContent).toContain("Back to Networking")
  })

  it("returns to the board when the contact was closed out", async () => {
    serve({ content: networking, network_contact_id: null, has_coach: true })
    expect((await back()).getAttribute("href")).toBe("/dashboard/network")
  })

  it("returns any other workbook to the Coaching Hub", async () => {
    serve({ content: session })
    const a = await back()
    expect(a.getAttribute("href")).toBe("/dashboard/coaching-hub")
    expect(a.textContent).toContain("Back to SIGNAL")
  })
})

describe("no coach", () => {
  it("offers no Send and no Ask", async () => {
    serve({ content: networking, network_contact_id: "ct-1", has_coach: false })
    await back()
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Ask / })).toBeNull()
  })

  it("offers Send once there is a coach", async () => {
    serve({ content: networking, network_contact_id: "ct-1", has_coach: true, coach_first_name: "Erin" })
    await back()
    expect(screen.getAllByRole("button", { name: "Send to Erin" }).length).toBeGreaterThan(0)
  })
})
