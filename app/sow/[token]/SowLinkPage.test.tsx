// The client's SOW link: Let's Go with a typed name, the thank-you, an
// accepted link opened again, and a dead link.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next/image", () => ({ default: (p: any) => <img alt={p.alt} src={p.src} /> }))

import { SowLinkPage, thankYou } from "./SowLinkPage"

const TOKEN = "A".repeat(43)
const DOC = {
  client_name: "Aiden Park", practice_name: "Workforce Ready Now", package_name: "Run the Search", opening: "Hi Aiden,",
  stages: [{ heading: "Stage One. Know: Your SIGNAL DNA and Career Paths", deliverables: [{ name: "DNA Report", bullets: [] }], note: null }],
  sections: [], payment: { total_cents: 175000, mode: "full", payments: [{ amount_cents: 175000, days: 0, label: "$1,750, due in full when you click Let's Go" }], note: "n" },
}
let getBody: any
let accepts: any[]
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  accepts = []
  getBody = { ok: true, sow: { status: "sent", document: DOC, accepted_at: null, accepted_name: null } }
  vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
    if (String(u).endsWith("/accept")) {
      accepts.push(JSON.parse(String(init!.body)))
      return json({ ok: true, accepted: { already: false, accepted_name: "Aiden Park", accepted_at: "2026-10-05T16:00:00Z", first_name: "Aiden", workspace_ready: true } })
    }
    return getBody.ok ? json(getBody) : json(getBody, 404)
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("SOW link", () => {
  it("Let's Go stays off until a name is typed, then accepts and thanks them", async () => {
    render(<SowLinkPage token={TOKEN} />)
    await screen.findByText("Stage One. Know: Your SIGNAL DNA and Career Paths")
    const go = screen.getByRole("button", { name: "Let's Go" }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Type your full name to accept"), { target: { value: "Aiden Park" } })
    expect(go.disabled).toBe(false)
    fireEvent.click(go)
    await waitFor(() => expect(accepts).toEqual([{ name: "Aiden Park" }]))
    expect((await screen.findByTestId("sow-accepted")).textContent).toBe(
      "Thank you, Aiden. You're all set. Your Google Drive workspace is ready, and I'll send your welcome email with your first step shortly. Your invoice will follow separately.")
    expect(screen.queryByRole("button", { name: "Let's Go" })).toBeNull()
  })

  it("without a workspace the thank-you doesn't claim one", () => {
    expect(thankYou({ name: "Aiden Park", at: "", first: "Aiden", justNow: true, workspaceReady: false })).toBe(
      "Thank you, Aiden. You're all set. I'll send your welcome email with your first step shortly. Your invoice will follow separately.")
  })

  it("an accepted link opened again says who accepted and when", async () => {
    getBody = { ok: true, sow: { status: "accepted", document: DOC, accepted_at: "2026-10-05T16:00:00Z", accepted_name: "Aiden Park" } }
    render(<SowLinkPage token={TOKEN} />)
    expect((await screen.findByTestId("sow-accepted")).textContent).toBe("Accepted by Aiden Park on October 5, 2026. Thank you, you're all set.")
    expect(screen.queryByLabelText("Type your full name to accept")).toBeNull()
  })

  it("a dead link says so", async () => {
    getBody = { ok: false, error: "This link is no longer active." }
    render(<SowLinkPage token={TOKEN} />)
    expect(await screen.findByText("This link is no longer active.")).toBeTruthy()
  })
})
