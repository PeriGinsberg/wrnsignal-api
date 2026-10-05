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
  payment: { total_cents: 175000, mode: "split", payments: [{ amount_cents: 87500, days: 0, label: "Payment 1: $875, due when you click Let's Go" }, { amount_cents: 87500, days: 45, label: "Payment 2: $875, due 45 days after you click Let's Go" }],
    note: "Once you click Let's Go, an invoice will be sent via Intuit." },
}
const DEFAULTS = {
  status: "draft", saved: false, opening: null, price_override_cents: null, package_total_cents: 175000, total_cents: 175000,
  payment: { mode: "split", payments: [{ amount_cents: 87500, days: 0 }, { amount_cents: 87500, days: 45 }] },
  document: DOC, warnings: ["No SOW bullets for Resume. Add them in Settings > Services > Deliverables."],
  recipient: { email: "aiden@example.com", parent_email: "mom@example.com" },
  sent: null, changed_since_sent: false, other_sent: null,
  email: { subject: "Your plan with Workforce Ready Now", body: "Hi Aiden,\n\nSee the details here:\n\n[SOW link]" },
}
let sow: any
let puts: any[]
let posts: any[]
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  puts = []
  posts = []
  sow = DEFAULTS
  vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" && String(u).endsWith("/sow/send")) {
      posts.push(JSON.parse(String(init.body)))
      return json({ ok: true, sent: { to: "aiden@example.com" }, sow: { ...DEFAULTS, saved: true, sent: { at: "2026-10-05T15:00:00Z", to: "aiden@example.com", cc: "mom@example.com", count: 1 } } })
    }
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      puts.push(body)
      return json({ ok: true, sow: { ...DEFAULTS, saved: true, opening: body.opening || null, price_override_cents: body.price_override_cents, payment: body.payment } })
    }
    return json({ ok: true, sow })
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
    expect(within(dialog).getByText("Payment 2: $875, due 45 days after you click Let's Go")).toBeTruthy()
    expect(within(dialog).getByText("Once you click Let's Go, an invoice will be sent via Intuit.")).toBeTruthy()
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

describe("SOW panel: sending", () => {
  it("opens the email: To, cc the parent, the pre-filled message, the signature", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: "Send SOW" }))
    const d = await screen.findByRole("dialog", { name: "Send SOW" })
    expect(within(d).getByText("aiden@example.com")).toBeTruthy()
    expect(within(d).getByLabelText(/cc the parent \(mom@example.com\)/)).toBeTruthy()
    expect((within(d).getByLabelText("Subject") as HTMLInputElement).value).toBe("Your plan with Workforce Ready Now")
    expect((within(d).getByLabelText("Message") as HTMLTextAreaElement).value).toContain("[SOW link]")
    expect(within(d).getByTestId("sow-signature").innerHTML).not.toBe("")
  })

  it("won't send without [SOW link]; sends the edited email with the cc", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: "Send SOW" }))
    const d = await screen.findByRole("dialog", { name: "Send SOW" })
    const msg = within(d).getByLabelText("Message")
    fireEvent.change(msg, { target: { value: "Hi Aiden, here it is." } })
    expect((within(d).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(msg, { target: { value: "Hi Aiden,\n\n[SOW link]" } })
    fireEvent.click(within(d).getByLabelText(/cc the parent/))
    fireEvent.click(within(d).getByRole("button", { name: "Send" }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ subject: "Your plan with Workforce Ready Now", body: "Hi Aiden,\n\n[SOW link]", cc_parent: true })
    expect(await screen.findByText("Sent Oct 5, 2026 to aiden@example.com (cc mom@example.com)")).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("no parent email: no cc box", async () => {
    sow = { ...DEFAULTS, recipient: { email: "aiden@example.com", parent_email: null } }
    await open()
    fireEvent.click(screen.getByRole("button", { name: "Send SOW" }))
    const d = await screen.findByRole("dialog", { name: "Send SOW" })
    expect(within(d).queryByLabelText(/cc the parent/)).toBeNull()
  })

  it("warns that another package's SOW will be withdrawn", async () => {
    sow = { ...DEFAULTS, other_sent: { engagement_id: "eng-2", package_name: "Foundations" } }
    await open()
    fireEvent.click(screen.getByRole("button", { name: "Send SOW" }))
    const d = await screen.findByRole("dialog", { name: "Send SOW" })
    expect(within(d).getByRole("note").textContent).toContain("The Foundations SOW is out now. Sending this one withdraws it")
  })

  it("sent and changed since: says so, and offers Re-send with a new link", async () => {
    sow = { ...DEFAULTS, saved: true, sent: { at: "2026-10-05T15:00:00Z", to: "aiden@example.com", cc: null, count: 1 }, changed_since_sent: true }
    await open()
    expect(screen.getByTestId("sow-status").textContent).toBe("Sent Oct 5, 2026 to aiden@example.com")
    expect(screen.getByText(/Changed since sent/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Re-send SOW" }))
    const d = await screen.findByRole("dialog", { name: "Re-send SOW" })
    expect(within(d).getByText(/The link in the earlier email stops working/)).toBeTruthy()
  })

  it("no email on the record: Send is off and says why", async () => {
    sow = { ...DEFAULTS, recipient: { email: null, parent_email: null } }
    await open()
    expect((screen.getByRole("button", { name: "Send SOW" }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("Add an email to this record to send the SOW.")).toBeTruthy()
  })
})
