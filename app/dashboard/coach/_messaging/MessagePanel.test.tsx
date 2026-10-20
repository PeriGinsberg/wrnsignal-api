// The Message panel: channel picker, read-only To/From, parent CC, send, delete.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { MessagePanel, type MessageContext } from "./MessagePanel"

const CTX: MessageContext = {
  to: "alex@example.com", client_name: "Alex Rivera", parent_email: "pat@example.com", parent_name: "Pat Rivera",
  has_phone: false, from: "erin+coach@workforcereadynow.com", signature: "Erin\nCoach",
}
let ctx: MessageContext
let posts: unknown[]
let postReply: { status: number; body: unknown }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  ctx = CTX
  posts = []
  postReply = { status: 200, body: { ok: true, to: "alex@example.com", redirected: false } }
  vi.stubGlobal("fetch", vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)))
      return json(postReply.body, postReply.status)
    }
    return json({ ok: true, context: ctx })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const subject = () => screen.getByLabelText("SUBJECT") as HTMLInputElement
const body = () => screen.getByLabelText("MESSAGE") as HTMLTextAreaElement
const sendBtn = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement

describe("MessagePanel", () => {
  it("shows To, From and the signature, and no SMS without a phone", async () => {
    render(<MessagePanel open onClose={() => {}} coachClientId="cc-1" />)
    await screen.findByText("alex@example.com")
    expect(screen.getByText("erin+coach@workforcereadynow.com")).toBeTruthy()
    expect(screen.getByText(/Erin/).textContent).toContain("Coach")
    expect(screen.queryByText("SMS")).toBeNull()
  })

  it("shows SMS disabled when there is a phone", async () => {
    ctx = { ...CTX, has_phone: true }
    render(<MessagePanel open onClose={() => {}} coachClientId="cc-1" />)
    const sms = (await screen.findByText("SMS")).closest("button") as HTMLButtonElement
    expect(sms.disabled).toBe(true)
    expect(screen.getByText(/coming soon/i)).toBeTruthy()
  })

  it("sends subject, body and the parent CC only when ticked", async () => {
    const onSent = vi.fn()
    render(<MessagePanel open onClose={() => {}} coachClientId="cc-1" onSent={onSent} />)
    await screen.findByText("alex@example.com")
    const cc = screen.getByLabelText(/CC Pat Rivera/) as HTMLInputElement
    expect(cc.checked).toBe(false)
    expect(sendBtn().disabled).toBe(true)
    fireEvent.change(subject(), { target: { value: "Next steps" } })
    fireEvent.change(body(), { target: { value: "Hi Alex" } })
    fireEvent.click(sendBtn())
    await screen.findByText("Message sent.")
    expect(posts).toEqual([{ channel: "email", subject: "Next steps", body: "Hi Alex", cc_parent: false }])
    expect(onSent).toHaveBeenCalledOnce()
  })

  it("keeps the draft and shows the error when the send fails", async () => {
    postReply = { status: 502, body: { ok: false, error: "The message did not send: Inactive recipient" } }
    render(<MessagePanel open onClose={() => {}} coachClientId="cc-1" />)
    await screen.findByText("alex@example.com")
    fireEvent.change(subject(), { target: { value: "S" } })
    fireEvent.change(body(), { target: { value: "B" } })
    fireEvent.click(sendBtn())
    await screen.findByText(/Inactive recipient/)
    expect(subject().value).toBe("S")
    expect(body().value).toBe("B")
  })

  it("cannot send without a sending address", async () => {
    ctx = { ...CTX, from: null }
    render(<MessagePanel open onClose={() => {}} coachClientId="cc-1" />)
    await screen.findByText(/Ask Peri to set one up/)
    fireEvent.change(subject(), { target: { value: "S" } })
    fireEvent.change(body(), { target: { value: "B" } })
    expect(sendBtn().disabled).toBe(true)
  })

  it("Delete asks before discarding a draft, then clears it", async () => {
    const onClose = vi.fn()
    render(<MessagePanel open onClose={onClose} coachClientId="cc-1" />)
    await screen.findByText("alex@example.com")
    fireEvent.change(body(), { target: { value: "draft" } })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText("Discard this draft?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(body().value).toBe("")
  })

  it("closing keeps the draft", async () => {
    const { rerender } = render(<MessagePanel open onClose={() => {}} coachClientId="cc-1" />)
    await screen.findByText("alex@example.com")
    fireEvent.change(body(), { target: { value: "half written" } })
    rerender(<MessagePanel open={false} onClose={() => {}} coachClientId="cc-1" />)
    rerender(<MessagePanel open onClose={() => {}} coachClientId="cc-1" />)
    await waitFor(() => expect(body().value).toBe("half written"))
  })
})
