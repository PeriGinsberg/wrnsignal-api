// The SOW panel on a proposal: opening, price for this client, payment terms, preview.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react"

vi.mock("../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))
vi.mock("next/image", () => ({ default: (p: any) => <img alt={p.alt} src={p.src} /> }))

import { SowPanel } from "./SowPanel"

const DOC = {
  client_name: "Aiden Park", practice_name: "Workforce Ready Now", package_name: "Run the Search", opening: null,
  stages: [{ heading: "Stage One. Know: Your SIGNAL DNA and Career Paths", deliverables: [{ name: "DNA Report", bullets: ["A written report"] }], note: "Not a personality test." }],
  sections: [{ key: "included", label: "Included at no charge", lines: ["SIGNAL"] }],
  payment: { total_cents: 175000, mode: "split", payments: [{ amount_cents: 87500, days: 0, label: "Payment 1: $875, due at signing" }, { amount_cents: 87500, days: 45, label: "Payment 2: $875, due 45 days after signing" }] },
}
const DEFAULTS = {
  status: "draft", saved: false, opening: null, price_override_cents: null, package_total_cents: 175000, total_cents: 175000,
  payment: { mode: "split", payments: [{ amount_cents: 87500, days: 0 }, { amount_cents: 87500, days: 45 }] },
  document: DOC, warnings: ["No SOW bullets for Resume. Add them in Settings > Services > Deliverables."],
}
let puts: any[]
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  puts = []
  vi.stubGlobal("fetch", vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      puts.push(body)
      return json({ ok: true, sow: { ...DEFAULTS, saved: true, opening: body.opening || null, price_override_cents: body.price_override_cents, payment: body.payment } })
    }
    return json({ ok: true, sow: DEFAULTS })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function open() {
  render(<SowPanel coachClientId="cc-1" engagementId="eng-1" />)
  await screen.findByLabelText("Opening paragraph")
}

describe("SOW panel", () => {
  it("starts from the package's defaults: the package total and a half-and-half split", async () => {
    await open()
    expect(screen.getByText("Not saved yet (showing the defaults)")).toBeTruthy()
    expect((screen.getByLabelText("SOW price for this client") as HTMLInputElement).placeholder).toContain("$1,750")
    expect((screen.getByLabelText("Payment 1 amount") as HTMLInputElement).value).toBe("875")
    expect((screen.getByLabelText("Payment 2 days") as HTMLInputElement).value).toBe("45")
    expect(screen.getByTestId("sow-left").textContent).toBe("Adds up to $1,750")
    expect(screen.getByTestId("sow-warnings").textContent).toContain("No SOW bullets for Resume")
  })

  it("shows what is left to allocate as the price or amounts change", async () => {
    await open()
    fireEvent.change(screen.getByLabelText("SOW price for this client"), { target: { value: "1,600" } })
    expect(screen.getByTestId("sow-left").textContent).toBe("$150 over the total of $1,600")
    fireEvent.change(screen.getByLabelText("Payment 1 amount"), { target: { value: "800" } })
    expect(screen.getByTestId("sow-left").textContent).toBe("$75 over the total of $1,600")
    fireEvent.change(screen.getByLabelText("Payment 1 amount"), { target: { value: "600" } })
    expect(screen.getByTestId("sow-left").textContent).toBe("$125 left to allocate of $1,600")
    fireEvent.change(screen.getByLabelText("Payment 1 amount"), { target: { value: "800" } })
    fireEvent.change(screen.getByLabelText("Payment 2 amount"), { target: { value: "800" } })
    expect(screen.getByTestId("sow-left").textContent).toBe("Adds up to $1,600")
  })

  it("saves the opening, the price in cents and the split", async () => {
    await open()
    fireEvent.change(screen.getByLabelText("Opening paragraph"), { target: { value: "Welcome, Aiden." } })
    fireEvent.change(screen.getByLabelText("SOW price for this client"), { target: { value: "1600" } })
    fireEvent.change(screen.getByLabelText("Payment 1 amount"), { target: { value: "800" } })
    fireEvent.change(screen.getByLabelText("Payment 2 amount"), { target: { value: "800" } })
    fireEvent.click(screen.getByRole("button", { name: "Save SOW" }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({
      opening: "Welcome, Aiden.", price_override_cents: 160000,
      payment: { mode: "split", payments: [{ amount_cents: 80000, days: 0 }, { amount_cents: 80000, days: 45 }] },
    })
    expect(await screen.findByText("SOW saved.")).toBeTruthy()
  })

  it("full up front, and adding and removing split payments", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: "+ Add payment" }))
    expect(screen.getAllByTestId("sow-payment-row")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: "Remove payment 3" }))
    expect(screen.getAllByTestId("sow-payment-row")).toHaveLength(2)
    fireEvent.click(screen.getByLabelText(/Full up front/))
    expect(screen.queryByTestId("sow-payment-row")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Save SOW" }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].payment).toEqual({ mode: "full" })
  })

  it("previews the SOW as the client will see it, with Let's Go inactive", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: "Preview" }))
    const dialog = await screen.findByRole("dialog", { name: "SOW preview" })
    expect(within(dialog).getByText("Stage One. Know: Your SIGNAL DNA and Career Paths")).toBeTruthy()
    expect(within(dialog).getByText("Not a personality test.")).toBeTruthy()
    expect(within(dialog).getByText("Payment 2: $875, due 45 days after signing")).toBeTruthy()
    expect((within(dialog).getByRole("button", { name: "Let's Go" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("an unsaved change is saved before the preview", async () => {
    await open()
    fireEvent.change(screen.getByLabelText("Opening paragraph"), { target: { value: "Hi." } })
    fireEvent.click(screen.getByRole("button", { name: "Save and preview" }))
    await screen.findByRole("dialog", { name: "SOW preview" })
    expect(puts).toHaveLength(1)
  })
})
